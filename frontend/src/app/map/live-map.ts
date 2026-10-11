import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  GeoJSONSource,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type MapMouseEvent,
} from 'maplibre-gl';
import { Api, type AirportPin, type TrackPoint } from '../core/api';
import { project } from '../core/extrapolate';
import { FlightSelection } from '../core/flight-selection';
import { FlightStream } from '../core/flight-stream';
import type { Flight, FlightKind } from '../core/flight.models';
import { ALTITUDE_BANDS, altitudeBand, KIND_COLOR, KINDS } from '../core/format';
import { MapSettings } from '../core/map-settings';

const PLANES = 'planes';
const PLANES_LAYER = 'planes-layer';
const RING_LAYER = 'selected-ring';
const AIRPORTS = 'airports';
const AIRPORT_DOT_LAYER = 'airports-dot';
const AIRPORT_LABEL_MAJOR = 'airports-label-major';
const AIRPORT_LABEL_MINOR = 'airports-label-minor';
const TRACK = 'track';
const TRACK_LAYER = 'track-line';
/** How often markers are advanced along their heading between data refreshes. */
const TICK_MS = 1000;
/** Zoom level used when another page/list asks the map to focus a flight. */
const FOCUS_ZOOM = 7;
/** A selected flight's recorded path is re-read this often. */
const TRACK_REFRESH_MS = 60_000;
/** Hours of recorded path shown behind a selected flight. */
const TRACK_HOURS = 6;

/**
 * OpenFreeMap vector style: free, no API key, attribution is part of the style.
 * (CARTO's raster tiles now require a key.) Swap the URL to change the basemap.
 */
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';

const kindIcon = (kind: FlightKind) => `plane-${kind}`;
const bandIcon = (band: number) => `plane-alt-${band}`;

/**
 * Live map: one rotated plane per airborne flight (coloured by route type or
 * altitude), airport pins, and the recorded path of the selected flight.
 * Details of the selected flight are shown by the page's flight card, not here.
 */
@Component({
  selector: 'app-live-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div #container class="map"></div>',
  styles: `
    :host { display: block; position: relative; }
    .map { position: absolute; inset: 0; }
  `,
})
export class LiveMap implements OnDestroy {
  private readonly stream = inject(FlightStream);
  private readonly selection = inject(FlightSelection);
  private readonly settings = inject(MapSettings);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  private map: MapLibreMap | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  /** Set when the map itself caused the selection, so it should not fly there. */
  private selectedFromMap: string | null = null;
  private byId = new Map<string, Flight>();
  private ready = false;
  private trackPoints: TrackPoint[] = [];
  private trackFor: string | null = null;
  private trackLoadedAt = 0;

  constructor() {
    afterNextRender(() => this.init());

    effect(() => {
      const id = this.selection.selectedId();
      untracked(() => this.onSelectionChanged(id));
    });
    effect(() => {
      this.settings.colorBy();
      untracked(() => this.render());
    });
    effect(() => {
      const visible = this.settings.showAirports();
      untracked(() => this.applyAirportVisibility(visible));
    });
  }

  ngOnDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.map?.remove();
  }

  private init(): void {
    // The worker is copied to the site root by angular.json "assets"; the dev
    // server's dependency pre-bundling otherwise breaks MapLibre's own lookup.
    setWorkerUrl(new URL('maplibre-gl-worker.mjs', document.baseURI).href);
    const map = new MapLibreMap({
      container: this.container().nativeElement,
      style: BASEMAP_STYLE,
      center: [81, 22.5],
      zoom: 4,
      minZoom: 3,
      maxZoom: 11,
      attributionControl: { compact: true },
    });
    this.map = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

    // Surface style/layer problems instead of failing silently with a blank map.
    map.on('error', (event) => console.error('[map]', event.error?.message ?? event));

    // `style.load` (not `load`): `load` waits for every visible basemap tile, which
    // can take a long time on slow links, and the planes do not depend on them.
    map.once('style.load', () => {
      try {
        this.setUpLayers(map);
      } catch (error) {
        console.error('[map] setup failed', error);
      }
    });
  }

  /** Adds icons, sources and layers once the basemap style is ready. */
  private setUpLayers(map: MapLibreMap): void {
    {
      for (const kind of KINDS) map.addImage(kindIcon(kind), planeIcon(KIND_COLOR[kind]));
      ALTITUDE_BANDS.forEach((band, index) => map.addImage(bandIcon(index), planeIcon(band.color)));

      const empty = { type: 'FeatureCollection' as const, features: [] };
      map.addSource(AIRPORTS, { type: 'geojson', data: empty });
      map.addSource(TRACK, { type: 'geojson', data: empty });
      map.addSource(PLANES, { type: 'geojson', data: empty });

      // Drawing order, bottom to top: path, airport pins, selection ring, planes.
      map.addLayer({
        id: TRACK_LAYER,
        type: 'line',
        source: TRACK,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: AIRPORT_DOT_LAYER,
        type: 'circle',
        source: AIRPORTS,
        paint: {
          'circle-radius': ['match', ['get', 'size'], 'large', 5, 'medium', 4, 3],
          'circle-color': '#7fb2ff',
          'circle-stroke-color': '#0f1419',
          'circle-stroke-width': 1.5,
        },
        minzoom: 3.5,
        filter: ['any', ['==', ['get', 'size'], 'large'], ['>=', ['zoom'], 6]],
      });
      const label = {
        type: 'symbol' as const,
        source: AIRPORTS,
        layout: {
          'text-field': ['get', 'code'] as unknown as string,
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.1] as [number, number],
          'text-anchor': 'top' as const,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#a9c4ff',
          'text-halo-color': '#0f1419',
          'text-halo-width': 1.5,
        },
      };
      map.addLayer({
        ...label,
        id: AIRPORT_LABEL_MAJOR,
        minzoom: 5,
        filter: ['==', ['get', 'size'], 'large'],
      });
      map.addLayer({
        ...label,
        id: AIRPORT_LABEL_MINOR,
        minzoom: 7,
        filter: ['!=', ['get', 'size'], 'large'],
      });
      map.addLayer({
        id: RING_LAYER,
        type: 'circle',
        source: PLANES,
        filter: ['==', ['get', 'selected'], true],
        paint: {
          'circle-radius': 18,
          'circle-color': '#ffffff',
          'circle-opacity': 0.12,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: PLANES_LAYER,
        type: 'symbol',
        source: PLANES,
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.3, 6, 0.45, 9, 0.7],
        },
      });

      map.on('click', (event) => this.onMapClick(event));
      const pointer = (on: boolean) => () => (map.getCanvas().style.cursor = on ? 'pointer' : '');
      for (const layer of [PLANES_LAYER, AIRPORT_DOT_LAYER]) {
        map.on('mouseenter', layer, pointer(true));
        map.on('mouseleave', layer, pointer(false));
      }
      map.on('moveend', () => this.updateInView());

      this.ready = true;
      void this.loadAirportPins();
      this.applyAirportVisibility(this.settings.showAirports());
      this.render();
      // Re-render every tick: new snapshots are picked up and planes keep moving.
      this.tickTimer = setInterval(() => this.render(), TICK_MS);
      this.onSelectionChanged(this.selection.selectedId());
    }
  }

  /** Writes current (dead-reckoned) positions of all airborne planes to the map. */
  private render(): void {
    const map = this.map;
    if (!map || !this.ready) return;
    const source = map.getSource<GeoJSONSource>(PLANES);
    const snapshot = this.stream.snapshot();
    if (!source || !snapshot) return;

    const now = Date.now();
    const selectedId = this.selection.selectedId();
    const byAltitude = this.settings.colorBy() === 'altitude';
    this.byId = new Map();
    const features = [];
    let selectedPosition: [number, number] | null = null;
    for (const flight of snapshot.flights) {
      if (flight.onGround) continue;
      this.byId.set(flight.id, flight);
      const position = project(flight, now);
      if (flight.id === selectedId) selectedPosition = position;
      features.push({
        type: 'Feature' as const,
        properties: {
          id: flight.id,
          heading: flight.heading ?? 0,
          icon: byAltitude ? bandIcon(altitudeBand(flight.alt)) : kindIcon(flight.kind),
          selected: flight.id === selectedId,
        },
        geometry: { type: 'Point' as const, coordinates: position },
      });
    }
    source.setData({ type: 'FeatureCollection', features });
    this.drawTrack(selectedPosition);
    this.updateInView(features.map((feature) => feature.geometry.coordinates));

    // Refresh the recorded path now and then (new points arrive every poll).
    if (selectedId && Date.now() - this.trackLoadedAt > TRACK_REFRESH_MS) void this.loadTrack(selectedId);
  }

  private onMapClick(event: MapMouseEvent): void {
    const map = this.map;
    if (!map) return;
    const hits = map.queryRenderedFeatures(event.point, { layers: [PLANES_LAYER, AIRPORT_DOT_LAYER] });
    const plane = hits.find((hit) => hit.layer.id === PLANES_LAYER);
    if (plane && typeof plane.properties['id'] === 'string') {
      this.selectedFromMap = plane.properties['id'];
      this.selection.select(plane.properties['id']);
      return;
    }
    const airport = hits.find((hit) => hit.layer.id === AIRPORT_DOT_LAYER);
    if (airport && typeof airport.properties['code'] === 'string') {
      void this.router.navigate(['/airports', airport.properties['code']]);
      return;
    }
    // Empty map: close the flight card.
    this.selection.select(null);
  }

  private onSelectionChanged(id: string | null): void {
    const map = this.map;
    this.trackPoints = [];
    this.trackFor = id;
    if (!map || !this.ready) return;

    const flight = id ? this.byId.get(id) : undefined;
    if (flight && this.selectedFromMap !== id) {
      map.flyTo({ center: project(flight, Date.now()), zoom: Math.max(map.getZoom(), FOCUS_ZOOM), speed: 1.4 });
    }
    this.selectedFromMap = null;

    this.drawTrack(null);
    if (id) void this.loadTrack(id);
    this.render();
  }

  private async loadTrack(id: string): Promise<void> {
    this.trackLoadedAt = Date.now();
    let points: TrackPoint[] = [];
    try {
      points = await this.api.track(id, TRACK_HOURS);
    } catch {
      // No history is fine: the path simply is not drawn.
    }
    if (this.trackFor !== id) return; // selection moved on while the request ran
    this.trackPoints = points;
    this.drawTrack(null);
  }

  /** Path of the selected flight: recorded points plus where it is right now. */
  private drawTrack(livePosition: [number, number] | null): void {
    const source = this.map?.getSource<GeoJSONSource>(TRACK);
    if (!source) return;
    const coordinates: [number, number][] = this.trackPoints.map((p) => [p.lon, p.lat]);
    if (livePosition && coordinates.length > 0) coordinates.push(livePosition);
    source.setData(
      coordinates.length < 2
        ? { type: 'FeatureCollection', features: [] }
        : { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } },
    );
  }

  private async loadAirportPins(): Promise<void> {
    const source = this.map?.getSource<GeoJSONSource>(AIRPORTS);
    if (!source) return;
    let pins: AirportPin[] = [];
    try {
      pins = await this.api.airportPins();
    } catch {
      return;
    }
    source.setData({
      type: 'FeatureCollection',
      features: pins.map((pin) => ({
        type: 'Feature' as const,
        properties: { code: pin.code, name: pin.name, size: pin.size },
        geometry: { type: 'Point' as const, coordinates: [pin.lon, pin.lat] },
      })),
    });
  }

  private applyAirportVisibility(visible: boolean): void {
    const map = this.map;
    if (!map || !this.ready) return;
    for (const layer of [AIRPORT_DOT_LAYER, AIRPORT_LABEL_MAJOR, AIRPORT_LABEL_MINOR]) {
      map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
    }
  }

  /** Counts airborne planes inside the visible map area. */
  private updateInView(positions?: number[][]): void {
    const map = this.map;
    if (!map || !this.ready) return;
    const coordinates =
      positions ??
      [...this.byId.values()].map((flight) => project(flight, Date.now()) as number[]);
    const bounds = map.getBounds();
    let count = 0;
    for (const [lon, lat] of coordinates) {
      if (bounds.contains([lon!, lat!])) count += 1;
    }
    if (this.settings.inView() !== count) this.settings.inView.set(count);
  }
}

/** Draws a north-pointing aeroplane silhouette; MapLibre rotates it by heading. */
function planeIcon(fill: string): ImageData {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  const outline: [number, number][] = [
    [32, 3], [36, 18], [60, 36], [60, 42], [36, 34], [34, 50], [44, 56],
    [44, 61], [32, 58], [20, 61], [20, 56], [30, 50], [28, 34], [4, 42],
    [4, 36], [28, 18],
  ];
  outline.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
