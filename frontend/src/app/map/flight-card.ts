import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FlightSelection } from '../core/flight-selection';
import { FlightStream } from '../core/flight-stream';
import { feet, KIND_COLOR, KIND_LABEL, knots } from '../core/format';
import { routeProgress } from '../core/geo';

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

  protected readonly stats = computed(() => {
    const flight = this.flight();
    if (!flight) return [];
    const alt = feet(flight.alt);
    const speed = knots(flight.speed);
    const vrate = flight.vrate === null ? null : Math.round(flight.vrate * METRES_PER_SECOND_TO_FPM);
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

  protected close(): void {
    this.selection.select(null);
  }
}
