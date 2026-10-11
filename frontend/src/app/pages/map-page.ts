import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ALTITUDE_BANDS, KIND_COLOR, KIND_LABEL, KINDS, type ColorBy } from '../core/format';
import { MapSettings } from '../core/map-settings';
import { KpiBar } from '../kpi/kpi-bar';
import { FlightCard } from '../map/flight-card';
import { LiveMap } from '../map/live-map';

/** Page 1 (/): counters on top, the live map with its overlays filling the rest. */
@Component({
  selector: 'app-map-page',
  imports: [KpiBar, LiveMap, FlightCard, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './map-page.html',
  styleUrl: './map-page.scss',
})
export class MapPage {
  protected readonly settings = inject(MapSettings);

  protected readonly modes: { id: ColorBy; label: string }[] = [
    { id: 'route', label: 'Route type' },
    { id: 'altitude', label: 'Altitude' },
  ];
  protected readonly kindLegend = KINDS.map((kind) => ({ label: KIND_LABEL[kind], color: KIND_COLOR[kind] }));
  protected readonly altitudeLegend = ALTITUDE_BANDS.map((band) => ({ label: band.label, color: band.color }));

  protected toggleAirports(): void {
    this.settings.showAirports.update((on) => !on);
  }
}
