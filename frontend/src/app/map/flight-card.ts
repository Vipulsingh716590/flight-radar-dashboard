import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FlightSelection } from '../core/flight-selection';
import { FlightStream } from '../core/flight-stream';
import { feet, KIND_COLOR, KIND_LABEL, knots } from '../core/format';
import { routeProgress } from '../core/geo';
import { MapSettings } from '../core/map-settings';

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
  imports: [DecimalPipe, UpperCasePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './flight-card.html',
  styleUrl: './flight-card.scss',
})
export class FlightCard {
  private readonly stream = inject(FlightStream);
  private readonly selection = inject(FlightSelection);
  private readonly settings = inject(MapSettings);

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

  protected readonly stats = computed(() => {
    const flight = this.flight();
    if (!flight) return [];
    const alt = feet(flight.alt);
    const speed = knots(flight.speed);
    const vrate =
      flight.vrate === null ? null : Math.round(flight.vrate * METRES_PER_SECOND_TO_FPM);
    return [
      { label: 'Altitude', value: alt === null ? '—' : `${alt.toLocaleString()} ft` },
      { label: 'Speed', value: speed === null ? '—' : `${speed} kt` },
      { label: 'Heading', value: flight.heading === null ? '—' : `${Math.round(flight.heading)}°` },
      {
        label: 'Vertical rate',
        value:
          vrate === null
            ? '—'
            : Math.abs(vrate) < LEVEL_FPM
              ? 'Level'
              : `${vrate > 0 ? '▲' : '▼'} ${Math.abs(vrate).toLocaleString()} ft/min`,
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

  protected close(): void {
    this.settings.follow.set(false);
    this.selection.select(null);
  }
}
