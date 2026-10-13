import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { emergencyOf } from '../core/emergency';
import { FlightSelection } from '../core/flight-selection';
import { FlightStream } from '../core/flight-stream';
import { feet, KIND_COLOR, KIND_LABEL, knots } from '../core/format';
import { routeProgress } from '../core/geo';
import { Icon } from '../core/icon';
import { MapSettings } from '../core/map-settings';
import { AircraftPhotos, type AircraftPhoto } from '../core/photos';
import { Watchlist } from '../core/watchlist';

/** Vertical rates below this (ft/min) are shown as level flight. */
const LEVEL_FPM = 100;
const METRES_PER_SECOND_TO_FPM = 196.85;

/**
 * Details of the selected flight, in the style of Flightradar24's flight
 * panel: airline and aircraft, big origin -> destination, trip progress and
 * the key numbers. Opens when a plane is clicked on the map or a row elsewhere.
 */
@Component({
  selector: 'app-flight-card',
  imports: [DecimalPipe, UpperCasePipe, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './flight-card.html',
  styleUrl: './flight-card.scss',
})
export class FlightCard {
  private readonly stream = inject(FlightStream);
  private readonly selection = inject(FlightSelection);
  private readonly settings = inject(MapSettings);
  private readonly photos = inject(AircraftPhotos);
  protected readonly watchlist = inject(Watchlist);

  protected readonly selectedId = this.selection.selectedId;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly kindColor = KIND_COLOR;

  protected readonly flight = computed(() => {
    const id = this.selectedId();
    return id ? (this.stream.snapshot()?.flights.find((f) => f.id === id) ?? null) : null;
  });

  protected readonly progress = computed(() => {
    const flight = this.flight();
    return flight ? routeProgress(flight) : null;
  });

  /** Straight-line time to go at the current ground speed, e.g. "1h 10m". */
  protected readonly eta = computed(() => {
    const flight = this.flight();
    const progress = this.progress();
    if (!flight || !progress?.plausible || !flight.speed || flight.speed < 50) return null;
    const minutes = Math.round((progress.remainingKm * 1000) / flight.speed / 60);
    if (minutes < 1) return '< 1 min';
    return minutes < 60
      ? `${minutes} min`
      : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  });

  protected readonly following = this.settings.follow;
  protected readonly emergency = computed(() => {
    const flight = this.flight();
    return flight ? emergencyOf(flight) : null;
  });
  protected readonly photo = signal<AircraftPhoto | null>(null);
  protected readonly watched = computed(() => {
    const id = this.selectedId();
    return id !== null && this.watchlist.has(id);
  });
  protected readonly hasData = computed(() => this.stream.snapshot() !== null);
  protected readonly copied = signal(false);

  protected readonly stats = computed(() => {
    const flight = this.flight();
    if (!flight) return [];
    const metric = this.settings.units() === 'metric';
    const alt = metric ? (flight.alt === null ? null : Math.round(flight.alt)) : feet(flight.alt);
    const speed = metric
      ? flight.speed === null
        ? null
        : Math.round(flight.speed * 3.6)
      : knots(flight.speed);
    const vrate =
      flight.vrate === null
        ? null
        : metric
          ? Math.round(flight.vrate * 10) / 10
          : Math.round(flight.vrate * METRES_PER_SECOND_TO_FPM);
    const vrateLevel = metric ? 0.5 : LEVEL_FPM;
    const vrateUnit = metric ? 'm/s' : 'ft/min';
    return [
      {
        label: 'Altitude',
        value: alt === null ? '—' : `${alt.toLocaleString()} ${metric ? 'm' : 'ft'}`,
      },
      { label: 'Speed', value: speed === null ? '—' : `${speed} ${metric ? 'km/h' : 'kt'}` },
      { label: 'Heading', value: flight.heading === null ? '—' : `${Math.round(flight.heading)}°` },
      {
        label: 'Vertical rate',
        value:
          vrate === null
            ? '—'
            : Math.abs(vrate) < vrateLevel
              ? 'Level'
              : `${vrate > 0 ? '▲' : '▼'} ${Math.abs(vrate).toLocaleString()} ${vrateUnit}`,
      },
      { label: 'Registration', value: flight.reg ?? '—' },
      { label: 'Squawk', value: flight.squawk ?? '—' },
      { label: 'ICAO24', value: flight.id.toUpperCase() },
      {
        label: 'Position age',
        value: `${Math.max(0, Math.round((this.stream.now() - flight.t) / 1000))} s`,
      },
    ];
  });

  /** Chase camera in 3D: tilts the map and keeps this flight centred. */
  protected toggleFollow(): void {
    if (this.settings.follow()) {
      this.settings.follow.set(false);
      return;
    }
    this.settings.view.set('3d');
    this.settings.follow.set(true);
  }

  constructor() {
    // One photo lookup per aircraft: the key is the aircraft, not every position update.
    effect(() => {
      const id = this.selectedId();
      untracked(() => {
        this.photo.set(null);
        if (!id) return;
        const reg = this.flight()?.reg ?? null;
        void this.photos.photo(id, reg).then((found) => {
          if (this.selectedId() === id) this.photo.set(found);
        });
      });
    });
  }

  protected toggleWatch(): void {
    const flight = this.flight();
    if (flight) this.watchlist.toggle(flight);
  }

  /** Copies a link that opens the map on this flight. */
  protected async share(): Promise<void> {
    const id = this.selectedId();
    if (!id) return;
    const url = `${location.origin}/?flight=${encodeURIComponent(id)}`;
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard blocked: show the link so it can be copied by hand.
      window.prompt('Copy this link', url);
    }
  }

  protected close(): void {
    this.settings.follow.set(false);
    this.selection.select(null);
  }
}
