import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { emergencyOf } from '../core/emergency';
import { FlightSelection } from '../core/flight-selection';
import { FlightStream } from '../core/flight-stream';
import { ALTITUDE_BANDS, KIND_COLOR, KIND_LABEL, KINDS, type ColorBy } from '../core/format';
import { Icon } from '../core/icon';
import { MapSettings, type MapView, type Units } from '../core/map-settings';
import { PwaInstall } from '../core/pwa-install';
import { Watchlist } from '../core/watchlist';
import { compass, Weather, weatherText, type Conditions } from '../core/weather';
import { KpiBar } from '../kpi/kpi-bar';
import { FlightCard } from '../map/flight-card';
import { LiveMap } from '../map/live-map';

type Panel = 'settings' | 'weather' | 'filters' | 'saved';

/** Weather is re-read after this long, or when the place moved by more than ~0.5 degrees. */
const WEATHER_MAX_AGE_MS = 10 * 60_000;
const WEATHER_MOVE_DEG = 0.5;
/** Used before the map has reported a centre. */
const INDIA_CENTRE = { lat: 22.5, lon: 81 };

/**
 * Page 1 (/): the map fills the page. Counters float over its top-left and
 * the flight card opens under them. Three tools (Settings, Weather, Filters)
 * open a panel: a popover under the top-right buttons on desktop, a bottom
 * sheet above a floating dock on phones.
 */
@Component({
  selector: 'app-map-page',
  imports: [KpiBar, LiveMap, FlightCard, DecimalPipe, UpperCasePipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './map-page.html',
  styleUrl: './map-page.scss',
})
export class MapPage {
  protected readonly settings = inject(MapSettings);
  private readonly stream = inject(FlightStream);
  private readonly selection = inject(FlightSelection);
  private readonly weather = inject(Weather);
  protected readonly watchlist = inject(Watchlist);
  protected readonly pwa = inject(PwaInstall);

  /** Airborne flights squawking 7500 / 7600 / 7700. */
  protected readonly emergencies = computed(() =>
    (this.stream.snapshot()?.flights ?? [])
      .filter((flight) => !flight.onGround)
      .flatMap((flight) => {
        const meaning = emergencyOf(flight);
        return meaning ? [{ flight, meaning }] : [];
      }),
  );

  /** Saved flights, with the live flight when it is currently in range. */
  protected readonly saved = computed(() => {
    const flights = new Map((this.stream.snapshot()?.flights ?? []).map((f) => [f.id, f]));
    return this.watchlist.items().map((item) => {
      const flight = flights.get(item.id);
      return { item, flight: flight && !flight.onGround ? flight : null };
    });
  });

  protected pickFlight(id: string): void {
    this.selection.select(id);
    this.panel.set(null);
  }

  protected readonly panel = signal<Panel | null>(null);
  protected readonly hasFlight = computed(() => this.selection.selectedId() !== null);

  protected readonly tools: { id: Panel; label: string; icon: string }[] = [
    { id: 'settings', label: 'Settings', icon: 'settings' },
    { id: 'weather', label: 'Weather', icon: 'cloud' },
    { id: 'filters', label: 'Filters', icon: 'filter' },
    { id: 'saved', label: 'Saved', icon: 'star' },
  ];
  protected readonly modes: { id: ColorBy; label: string }[] = [
    { id: 'route', label: 'Route type' },
    { id: 'altitude', label: 'Altitude' },
  ];
  protected readonly views: { id: MapView; label: string; icon: string; hint: string }[] = [
    { id: '2d', label: '2D', icon: 'map', hint: 'Flat map' },
    {
      id: '3d',
      label: '3D',
      icon: 'cube',
      hint: 'Tilted map with terrain and buildings; planes float above their shadow',
    },
    { id: 'globe', label: 'Globe', icon: 'globe', hint: 'Spinning globe' },
  ];
  protected readonly unitOptions: { id: Units; label: string }[] = [
    { id: 'aviation', label: 'ft · kt' },
    { id: 'metric', label: 'm · km/h' },
  ];
  protected readonly kinds = KINDS.map((kind) => ({
    id: kind,
    label: KIND_LABEL[kind],
    color: KIND_COLOR[kind],
  }));
  protected readonly bands = ALTITUDE_BANDS.map((band, index) => ({
    id: index,
    label: band.label,
    color: band.color,
  }));
  protected readonly kindLegend = this.kinds;
  protected readonly altitudeLegend = this.bands;

  /** Flights that pass the filters, for "Showing X of Y". */
  protected readonly shown = computed(() => {
    this.settings.hiddenKinds();
    this.settings.hiddenBands();
    this.settings.knownRouteOnly();
    const flights = (this.stream.snapshot()?.flights ?? []).filter((f) => !f.onGround);
    return { shown: flights.filter((f) => this.settings.passes(f)).length, total: flights.length };
  });

  // ---- weather ---------------------------------------------------------------
  protected readonly conditions = signal<Conditions | null>(null);
  protected readonly weatherState = signal<'idle' | 'loading' | 'error'>('idle');
  protected readonly locateError = signal<string | null>(null);
  private weatherAt: { lat: number; lon: number; at: number } | null = null;

  /** Where the weather is shown for: the selected flight, otherwise the map centre. */
  private readonly place = computed(() => {
    const id = this.selection.selectedId();
    const flight = id ? this.stream.snapshot()?.flights.find((f) => f.id === id) : undefined;
    if (flight)
      return { lat: flight.lat, lon: flight.lon, label: flight.callsign ?? 'Selected flight' };
    const centre = this.settings.center() ?? INDIA_CENTRE;
    return { ...centre, label: 'Map centre' };
  });
  protected readonly placeLabel = computed(() => this.place().label);

  protected readonly skyText = computed(() => {
    const c = this.conditions();
    return c ? weatherText(c.code) : '';
  });

  constructor() {
    const id = inject(ActivatedRoute).snapshot.queryParamMap.get('flight');
    if (id) this.selection.select(id.toLowerCase());

    effect(() => {
      if (this.panel() !== 'weather') return;
      const place = this.place();
      untracked(() => void this.loadWeather(place.lat, place.lon));
    });
  }

  protected togglePanel(panel: Panel): void {
    this.panel.update((current) => (current === panel ? null : panel));
  }

  protected closePanel(): void {
    this.panel.set(null);
  }

  protected toggleAirports(): void {
    this.settings.showAirports.update((on) => !on);
  }

  protected toggleDayNight(): void {
    this.settings.dayNight.update((on) => !on);
  }

  protected toggleRadar(): void {
    this.settings.radar.update((on) => !on);
  }

  protected toggleKnownRoute(): void {
    this.settings.knownRouteOnly.update((on) => !on);
  }

  protected retryWeather(): void {
    this.weatherAt = null;
    const place = this.place();
    void this.loadWeather(place.lat, place.lon);
  }

  protected locate(): void {
    this.locateError.set(null);
    if (!('geolocation' in navigator)) {
      this.locateError.set('Location is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => this.settings.fly(position.coords.latitude, position.coords.longitude, 9),
      () => this.locateError.set('Location permission was denied.'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  protected radarClock(): string {
    const time = this.settings.radarTime();
    return time === null
      ? ''
      : new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  protected wind(knots: number): string {
    return this.settings.units() === 'metric'
      ? `${Math.round(knots * 1.852)} km/h`
      : `${Math.round(knots)} kt`;
  }

  protected compass = compass;

  private async loadWeather(lat: number, lon: number): Promise<void> {
    const last = this.weatherAt;
    const fresh =
      last &&
      Date.now() - last.at < WEATHER_MAX_AGE_MS &&
      Math.abs(last.lat - lat) < WEATHER_MOVE_DEG &&
      Math.abs(last.lon - lon) < WEATHER_MOVE_DEG;
    if (fresh && this.conditions()) return;
    this.weatherAt = { lat, lon, at: Date.now() };
    this.weatherState.set('loading');
    try {
      this.conditions.set(await this.weather.conditions(lat, lon));
      this.weatherState.set('idle');
    } catch {
      this.weatherAt = null;
      this.weatherState.set('error');
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.panel.set(null);
  }
}
