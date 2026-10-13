import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ALTITUDE_BANDS, KIND_COLOR, KIND_LABEL, KINDS, type ColorBy } from '../core/format';
import { Icon } from '../core/icon';
import { MapSettings } from '../core/map-settings';
import { KpiBar } from '../kpi/kpi-bar';
import { FlightCard } from '../map/flight-card';
import { LiveMap } from '../map/live-map';

/**
 * Page 1 (/): the map fills the page. Counters float over its top-left, the
 * flight card opens under them, display options live in a "Layers" popover and
 * the legend sits in the bottom-left corner.
 */
@Component({
  selector: 'app-map-page',
  imports: [KpiBar, LiveMap, FlightCard, DecimalPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './map-page.html',
  styleUrl: './map-page.scss',
})
export class MapPage {
  protected readonly settings = inject(MapSettings);
  protected readonly layersOpen = signal(false);

  protected readonly modes: { id: ColorBy; label: string }[] = [
    { id: 'route', label: 'Route type' },
    { id: 'altitude', label: 'Altitude' },
  ];
  protected readonly kindLegend = KINDS.map((kind) => ({ label: KIND_LABEL[kind], color: KIND_COLOR[kind] }));
  protected readonly altitudeLegend = ALTITUDE_BANDS.map((band) => ({ label: band.label, color: band.color }));

  protected toggleLayers(): void {
    this.layersOpen.update((open) => !open);
  }

  protected toggleAirports(): void {
    this.settings.showAirports.update((on) => !on);
  }

  @HostListener('document:keydown.escape')
  protected closeLayers(): void {
    this.layersOpen.set(false);
  }
}
