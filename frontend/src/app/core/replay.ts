import { Injectable, computed, inject, signal } from '@angular/core';
import { Api, type ReplayAircraft, type ReplayFrame } from './api';

/** A gap between two recorded cycles longer than this is not bridged (backend was down). */
const MAX_GAP_MS = 5 * 60_000;
const TICK_MS = 100;

export interface ReplayItem {
  id: string;
  lat: number;
  lon: number;
  heading: number | null;
  alt: number | null;
  kind: string;
  callsign: string | null;
  origin: string | null;
  destination: string | null;
}

/** Playback speeds, in recorded minutes per real second. */
export const REPLAY_SPEEDS = [1, 5, 15] as const;
/** Windows the user can load, in minutes. */
export const REPLAY_WINDOWS = [30, 60, 180] as const;

/**
 * Plays back recorded traffic on the map. The server returns one frame per
 * poll cycle (about 75 s apart); between two frames positions are
 * interpolated so planes glide instead of jumping.
 */
@Injectable({ providedIn: 'root' })
export class Replay {
  private readonly api = inject(Api);

  readonly active = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly range = signal<{ from: number | null; to: number | null } | null>(null);
  readonly frames = signal<ReplayFrame[]>([]);
  readonly truncated = signal(false);
  readonly windowMinutes = signal<number>(60);
  readonly speed = signal<number>(5);
  readonly playing = signal(false);
  /** Playback clock, epoch ms. */
  readonly clock = signal(0);

  readonly start = computed(() => this.frames()[0]?.t ?? 0);
  readonly end = computed(() => this.frames().at(-1)?.t ?? 0);

  private timer: ReturnType<typeof setInterval> | null = null;

  /** Loads the available range (cheap) so the panel can show what exists. */
  async loadRange(): Promise<void> {
    try {
      this.range.set(await this.api.replayRange());
    } catch {
      this.range.set(null);
    }
  }

  /** Loads the newest `windowMinutes` of history and starts playing from its beginning. */
  async open(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const range = await this.api.replayRange();
      this.range.set(range);
      if (range.to === null || range.from === null) {
        this.error.set('Nothing has been recorded yet. History fills in while the backend runs.');
        return;
      }
      const minutes = this.windowMinutes();
      const from = Math.max(range.from, range.to - minutes * 60_000);
      const data = await this.api.replay(from, minutes);
      if (data.frames.length < 2) {
        this.error.set('Not enough recorded data in that window yet. Try a longer window later.');
        return;
      }
      this.frames.set(data.frames);
      this.truncated.set(data.truncated);
      this.clock.set(data.frames[0]!.t);
      this.active.set(true);
      this.play();
    } catch {
      this.error.set(
        'Replay is not available. The backend may need updating, or the history could not be read.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  close(): void {
    this.pause();
    this.active.set(false);
    this.frames.set([]);
    this.error.set(null);
  }

  play(): void {
    if (this.timer || !this.active()) return;
    if (this.clock() >= this.end()) this.clock.set(this.start());
    this.playing.set(true);
    this.timer = setInterval(() => {
      const next = this.clock() + this.speed() * 60_000 * (TICK_MS / 1000);
      if (next >= this.end()) {
        this.clock.set(this.end());
        this.pause();
        return;
      }
      this.clock.set(next);
    }, TICK_MS);
  }

  pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing.set(false);
  }

  seek(ms: number): void {
    this.clock.set(Math.min(Math.max(ms, this.start()), this.end()));
  }

  /** Aircraft at the current clock time, interpolated between the surrounding frames. */
  sample(): ReplayItem[] {
    return sampleFrames(this.frames(), this.clock());
  }
}

const toItem = (a: ReplayAircraft): ReplayItem => ({
  id: a[0],
  lat: a[1],
  lon: a[2],
  heading: a[3],
  alt: a[4],
  kind: a[5],
  callsign: a[6],
  origin: a[7],
  destination: a[8],
});

/** Pure helper (unit-tested): positions at `time` from time-ordered frames. */
export function sampleFrames(frames: ReplayFrame[], time: number): ReplayItem[] {
  if (frames.length === 0) return [];
  // Last frame at or before `time` (binary search).
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle]!.t <= time) low = middle;
    else high = middle - 1;
  }
  const a = frames[low]!;
  const b = frames[low + 1];
  if (!b || b.t - a.t > MAX_GAP_MS || time <= a.t) {
    // After the last frame, or a recording gap: show the frame itself if it is recent enough.
    return time - a.t > MAX_GAP_MS ? [] : a.f.map(toItem);
  }
  const fraction = (time - a.t) / (b.t - a.t);
  const next = new Map(b.f.map((aircraft) => [aircraft[0], aircraft]));
  return a.f.map((aircraft) => {
    const item = toItem(aircraft);
    const to = next.get(aircraft[0]);
    if (!to) return item;
    item.lat = aircraft[1] + (to[1] - aircraft[1]) * fraction;
    item.lon = aircraft[2] + (to[2] - aircraft[2]) * fraction;
    if (aircraft[4] !== null && to[4] !== null)
      item.alt = aircraft[4] + (to[4] - aircraft[4]) * fraction;
    return item;
  });
}
