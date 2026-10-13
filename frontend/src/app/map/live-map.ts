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
  RasterTileSource,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type MapMouseEvent,
} from 'maplibre-gl';
import { Api, type AirportPin, type TrackPoint } from '../core/api';
import { project } from '../core/extrapolate';
import { emergencyOf } from '../core/emergency';
import { FlightSelection } from '../core/flight-selection';
import { FlightStream } from '../core/flight-stream';
import type { Flight, FlightKind } from '../core/flight.models';
import { ALTITUDE_BANDS, altitudeBand, KIND_COLOR, KINDS } from '../core/format';
import { MapSettings, type MapView } from '../core/map-settings';
import { Replay } from '../core/replay';
import { nightRing } from '../core/solar';
import { Watchlist } from '../core/watchlist';
import { Weather } from '../core/weather';
import { ThemeService, type Theme } from '../core/theme';

const PLANES = 'planes';
const PLANES_LAYER = 'planes-layer';
const RING_LAYER = 'selected-ring';
const AIRPORTS = 'airports';
const AIRPORT_DOT_LAYER = 'airports-dot';
const AIRPORT_LABEL_MAJOR = 'airports-label-major';
const AIRPORT_LABEL_MINOR = 'airports-label-minor';
const TRACK = 'track';
const TRACK_LAYER = 'track-line';
const DEM = 'terrain-dem';
const BUILDINGS_LAYER = 'buildings-3d';
const SHADOW_LAYER = 'planes-shadow';
const WATCH_LAYER = 'watched-ring';
const NIGHT = 'night';
const TRAILS = 'trails';
const TRAILS_LAYER = 'trails-line';
/** Positions kept per plane for the short tails (about 8 poll cycles, ~10 minutes). */
const TRAIL_POINTS = 8;
/** Sun altitudes whose "below" regions are stacked: night, civil and nautical twilight edges. */
const NIGHT_LEVELS = [0, -6, -12];
const NIGHT_REFRESH_MS = 60_000;
const EMERGENCY_LAYER = 'emergency-ring';
/** Free elevation tiles (Mapzen Terrarium encoding), no key needed. */
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
/** Camera used while following a flight. */
const RADAR = 'rain-radar';
const RADAR_LAYER = 'rain-radar-layer';
/** RainViewer's free tiles stop at zoom 7; MapLibre scales them up beyond that. */
const RADAR_MAX_ZOOM = 7;
/** Frames used by the animation (newest N) and how long each is shown. */
const RADAR_FRAMES = 8;
const RADAR_STEP_MS = 800;
/** Frame list is re-read this often so the radar stays current. */
const RADAR_REFRESH_MS = 10 * 60_000;
const FOLLOW_PITCH = 62;
const FOLLOW_ZOOM = 9;
const TILT_PITCH = 60;
const TILT_BEARING = -18;
const MAX_ZOOM_BY_VIEW: Record<MapView, number> = { '2d': 11, '3d': 15, globe: 11 };
/** Vertical screen offset per altitude band, so higher planes float above their shadow in 3D. */
const LIFT_PX = 14;
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
const BASEMAP_STYLES: Record<Theme, string> = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
  glass: 'https://tiles.openfreemap.org/styles/dark',
};

/** Colours that must contrast with the basemap, per theme. */
interface MapInk {
  track: string;
  ring: string;
  label: string;
  halo: string;
  stroke: string;
  building: string;
}

const MAP_INK: Record<Theme, MapInk> = {
  dark: {
    track: '#ffffff',
    ring: '#ffffff',
    label: '#a9c4ff',
    halo: '#0f1419',
    stroke: '#0f1419',
    building: '#3a4656',
  },
  light: {
    track: '#16202a',
    ring: '#16202a',
    label: '#1f4fa3',
    halo: '#ffffff',
    stroke: '#ffffff',
    building: '#c5ccd6',
  },
  glass: {
    track: '#d4f54a',
    ring: '#d4f54a',
    label: '#c9e8ff',
    halo: '#121924',
    stroke: '#121924',
    building: '#3b4a60',
  },
};

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
    :host {
      display: block;
      position: relative;
    }
    .map {
      position: absolute;
      inset: 0;
    }
  `,
})
export class LiveMap implements OnDestroy {
  private readonly stream = inject(FlightStream);
  private readonly selection = inject(FlightSelection);
  private readonly settings = inject(MapSettings);
  private readonly weather = inject(Weather);
  private readonly watchlist = inject(Watchlist);
  private readonly replay = inject(Replay);
  private readonly themeService = inject(ThemeService);
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
  private pins: AirportPin[] | null = null;
  private appliedTheme: Theme | null = null;
  private listenersBound = false;
  private appliedView: MapView = '2d';
  private radarHost = '';
  private radarFrames: { path: string; time: number }[] = [];
  private radarLoadedAt = 0;
  private radarLoading = false;
  private radarIndex = 0;
  private radarTimer: ReturnType<typeof setInterval> | null = null;
  private lastFlyN = 0;
  private trailMap = new Map<string, [number, number][]>();
  private trailStamp: string | null = null;
  private nightTimer: ReturnType<typeof setInterval> | null = null;

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
      const theme = this.themeService.theme();
      untracked(() => this.applyTheme(theme));
    });
    effect(() => {
      const view = this.settings.view();
      untracked(() => {
        if (view !== '3d') this.settings.follow.set(false);
        this.applyView(view);
      });
    });
    effect(() => {
      this.watchlist.ids();
      untracked(() => this.render());
    });
    effect(() => {
      this.settings.follow();
      untracked(() => this.render());
    });
    effect(() => {
      // Filters changed: redraw straight away instead of waiting for the next tick.
      this.settings.hiddenKinds();
      this.settings.hiddenBands();
      this.settings.knownRouteOnly();
      untracked(() => this.render());
    });
    effect(() => {
      // Replay frames advance this clock; redraw on every step.
      this.replay.active();
      this.replay.clock();
      untracked(() => this.render());
    });
    effect(() => {
      this.settings.trails();
      untracked(() => this.render());
    });
    effect(() => {
      this.settings.dayNight();
      untracked(() => this.applyNight());
    });
    effect(() => {
      this.settings.radar();
      this.settings.radarPlaying();
      untracked(() => this.applyRadar());
    });
    effect(() => {
      const target = this.settings.flyTo();
      if (!target || target.n === this.lastFlyN) return;
      this.lastFlyN = target.n;
      untracked(() =>
        this.map?.flyTo({ center: [target.lon, target.lat], zoom: target.zoom, speed: 1.6 }),
      );
    });
    effect(() => {
      const visible = this.settings.showAirports();
      untracked(() => this.applyAirportVisibility(visible));
    });
  }

  ngOnDestroy(): void {
    if (this.radarTimer) clearInterval(this.radarTimer);
    if (this.nightTimer) clearInterval(this.nightTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.map?.remove();
  }

  private init(): void {
    // The worker is copied to the site root by angular.json "assets"; the dev
    // server's dependency pre-bundling otherwise breaks MapLibre's own lookup.
    setWorkerUrl(new URL('maplibre-gl-worker.mjs', document.baseURI).href);
    const map = new MapLibreMap({
      container: this.container().nativeElement,
      style: BASEMAP_STYLES[this.themeService.theme()],
      center: [81, 22.5],
      zoom: 4,
      minZoom: 3,
      maxZoom: MAX_ZOOM_BY_VIEW['2d'],
      attributionControl: { compact: true },
    });
    this.map = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

    // Surface style/layer problems instead of failing silently with a blank map.
    map.on('error', (event) => console.error('[map]', event.error?.message ?? event));

    // `style.load` (not `load`): `load` waits for every visible basemap tile, which
    // can take a long time on slow links, and the planes do not depend on them.
    // Runs again after every setStyle (theme change), which wipes all custom layers.
    map.on('style.load', () => {
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
      const ink = MAP_INK[this.themeService.theme()];
      this.appliedTheme = this.themeService.theme();
      const ensureImage = (id: string, fill: string) => {
        if (!map.hasImage(id)) map.addImage(id, planeIcon(fill));
      };
      for (const kind of KINDS) ensureImage(kindIcon(kind), KIND_COLOR[kind]);
      ALTITUDE_BANDS.forEach((band, index) => ensureImage(bandIcon(index), band.color));

      const empty = { type: 'FeatureCollection' as const, features: [] };
      map.addSource(AIRPORTS, { type: 'geojson', data: empty });
      map.addSource(TRACK, { type: 'geojson', data: empty });
      map.addSource(PLANES, { type: 'geojson', data: empty });
      map.addSource(DEM, {
        type: 'raster-dem',
        tiles: [DEM_TILES],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 12,
      });

      // 3D buildings from the basemap's own vector tiles (only shown in the 3D view).
      const buildingLayer = map
        .getStyle()
        .layers.find(
          (layer) => (layer as { 'source-layer'?: string })['source-layer'] === 'building',
        ) as { source?: string } | undefined;
      if (buildingLayer?.source) {
        map.addLayer({
          id: BUILDINGS_LAYER,
          type: 'fill-extrusion',
          source: buildingLayer.source,
          'source-layer': 'building',
          minzoom: 13,
          layout: { visibility: 'none' },
          paint: {
            'fill-extrusion-color': ink.building,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.75,
          },
        });
      }

      // Drawing order, bottom to top: path, airport pins, selection ring, planes.
      map.addLayer({
        id: TRACK_LAYER,
        type: 'line',
        source: TRACK,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ink.track, 'line-width': 2.5, 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: AIRPORT_DOT_LAYER,
        type: 'circle',
        source: AIRPORTS,
        paint: {
          'circle-radius': ['match', ['get', 'size'], 'large', 5, 'medium', 4, 3],
          'circle-color': '#7fb2ff',
          'circle-stroke-color': ink.stroke,
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
          'text-color': ink.label,
          'text-halo-color': ink.halo,
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
      // Ground shadow: in 3D the plane icon floats above it, which shows altitude.
      map.addLayer({
        id: SHADOW_LAYER,
        type: 'circle',
        source: PLANES,
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 9, 8, 14, 16],
          'circle-color': '#000000',
          'circle-opacity': 0.4,
          'circle-blur': 0.8,
          'circle-pitch-alignment': 'map',
        },
      });
      map.addSource(TRAILS, { type: 'geojson', data: empty });
      map.addLayer({
        id: TRAILS_LAYER,
        type: 'line',
        source: TRAILS,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': ink.track, 'line-width': 1.6, 'line-opacity': 0.55 },
      });
      // Saved flights get a gold ring, emergencies a larger red one.
      map.addLayer({
        id: WATCH_LAYER,
        type: 'circle',
        source: PLANES,
        filter: ['==', ['get', 'watched'], true],
        paint: {
          'circle-radius': 15,
          'circle-color': '#ffd23f',
          'circle-opacity': 0.18,
          'circle-stroke-color': '#ffd23f',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: EMERGENCY_LAYER,
        type: 'circle',
        source: PLANES,
        filter: ['==', ['get', 'emergency'], true],
        paint: {
          'circle-radius': 24,
          'circle-color': '#ff3b30',
          'circle-opacity': 0.25,
          'circle-stroke-color': '#ff3b30',
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: RING_LAYER,
        type: 'circle',
        source: PLANES,
        filter: ['==', ['get', 'selected'], true],
        paint: {
          'circle-radius': 18,
          'circle-color': ink.ring,
          'circle-opacity': 0.12,
          'circle-stroke-color': ink.ring,
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
          'icon-pitch-alignment': 'viewport',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.3, 6, 0.45, 9, 0.7],
        },
      });

      // Map-level listeners survive setStyle; bind them only once.
      if (!this.listenersBound) {
        this.listenersBound = true;
        map.on('click', (event) => this.onMapClick(event));
        const pointer = (on: boolean) => () => (map.getCanvas().style.cursor = on ? 'pointer' : '');
        for (const layer of [PLANES_LAYER, AIRPORT_DOT_LAYER]) {
          map.on('mouseenter', layer, pointer(true));
          map.on('mouseleave', layer, pointer(false));
        }
        map.on('moveend', () => {
          this.updateInView();
          const centre = map.getCenter();
          this.settings.center.set({ lat: centre.lat, lon: centre.lng });
        });
        // Dragging the map with the mouse/finger ends the chase camera.
        map.on('dragstart', (event) => {
          if (event.originalEvent && this.settings.follow()) this.settings.follow.set(false);
        });
      }

      this.ready = true;
      this.applyView(this.settings.view());
      this.applyRadar();
      this.applyNight();
      this.showPins();
      this.applyAirportVisibility(this.settings.showAirports());
      this.render();
      // Re-render every tick: new snapshots are picked up and planes keep moving.
      this.tickTimer ??= setInterval(() => this.render(), TICK_MS);
      this.onSelectionChanged(this.selection.selectedId());
    }
  }

  /** Writes current (dead-reckoned) positions of all airborne planes to the map. */
  private render(): void {
    const map = this.map;
    if (!map || !this.ready) return;
    if (this.replay.active()) {
      this.renderReplay(map);
      return;
    }
    const source = map.getSource<GeoJSONSource>(PLANES);
    const snapshot = this.stream.snapshot();
    if (!source || !snapshot) return;

    const now = Date.now();
    const selectedId = this.selection.selectedId();
    const byAltitude = this.settings.colorBy() === 'altitude';
    const watched = this.watchlist.ids();
    this.byId = new Map();
    const features = [];
    let selectedPosition: [number, number] | null = null;
    for (const flight of snapshot.flights) {
      if (flight.onGround) continue;
      if (flight.id !== selectedId && !this.settings.passes(flight)) continue;
      this.byId.set(flight.id, flight);
      const position = project(flight, now);
      if (flight.id === selectedId) selectedPosition = position;
      features.push({
        type: 'Feature' as const,
        properties: {
          id: flight.id,
          heading: flight.heading ?? 0,
          band: altitudeBand(flight.alt),
          icon: byAltitude ? bandIcon(altitudeBand(flight.alt)) : kindIcon(flight.kind),
          selected: flight.id === selectedId,
          watched: watched.has(flight.id),
          emergency: emergencyOf(flight) !== null,
        },
        geometry: { type: 'Point' as const, coordinates: position },
      });
    }
    source.setData({ type: 'FeatureCollection', features });
    this.drawTrails(map, snapshot.updatedAt);
    this.drawTrack(selectedPosition);
    this.followSelected(selectedId, selectedPosition);
    this.updateInView(features.map((feature) => feature.geometry.coordinates));

    // Refresh the recorded path now and then (new points arrive every poll).
    if (selectedId && Date.now() - this.trackLoadedAt > TRACK_REFRESH_MS)
      void this.loadTrack(selectedId);
  }

  /** Recorded traffic instead of the live feed; everything else stays as is. */
  private renderReplay(map: MapLibreMap): void {
    const source = map.getSource<GeoJSONSource>(PLANES);
    if (!source) return;
    const selectedId = this.selection.selectedId();
    const byAltitude = this.settings.colorBy() === 'altitude';
    const watched = this.watchlist.ids();
    const kinds: FlightKind[] = ['arrival', 'departure', 'domestic', 'overflight', 'unknown'];
    const features = [];
    for (const item of this.replay.sample()) {
      const kind = (kinds as string[]).includes(item.kind) ? (item.kind as FlightKind) : 'unknown';
      const probe = {
        kind,
        alt: item.alt,
        squawk: null,
        origin: item.origin,
        destination: item.destination,
      };
      if (item.id !== selectedId && !this.settings.passes(probe)) continue;
      features.push({
        type: 'Feature' as const,
        properties: {
          id: item.id,
          heading: item.heading ?? 0,
          band: altitudeBand(item.alt),
          icon: byAltitude ? bandIcon(altitudeBand(item.alt)) : kindIcon(kind),
          selected: item.id === selectedId,
          watched: watched.has(item.id),
          emergency: false,
        },
        geometry: { type: 'Point' as const, coordinates: [item.lon, item.lat] },
      });
    }
    source.setData({ type: 'FeatureCollection', features });
    this.drawTrack(null);
    this.drawTrails(map, null);
    this.updateInView(features.map((feature) => feature.geometry.coordinates));
  }

  /**
   * Short tails: the last few reported positions of every airborne plane, taken
   * from successive snapshots. Kept in memory only (a reload starts them over).
   */
  private drawTrails(map: MapLibreMap, stamp: string | null): void {
    const source = map.getSource<GeoJSONSource>(TRAILS);
    if (!source) return;
    const on = this.settings.trails() && !this.replay.active();
    map.setLayoutProperty(TRAILS_LAYER, 'visibility', on ? 'visible' : 'none');
    if (!on) return;

    const snapshot = this.stream.snapshot();
    if (snapshot && stamp !== null && stamp !== this.trailStamp) {
      this.trailStamp = stamp;
      const seen = new Set<string>();
      for (const flight of snapshot.flights) {
        if (flight.onGround) continue;
        seen.add(flight.id);
        const points = this.trailMap.get(flight.id) ?? [];
        const last = points.at(-1);
        if (!last || last[0] !== flight.lon || last[1] !== flight.lat)
          points.push([flight.lon, flight.lat]);
        if (points.length > TRAIL_POINTS) points.shift();
        this.trailMap.set(flight.id, points);
      }
      for (const id of this.trailMap.keys()) if (!seen.has(id)) this.trailMap.delete(id);
    }

    const features = [];
    for (const [id, points] of this.trailMap) {
      if (points.length < 2) continue;
      const flight = this.byId.get(id);
      const head = flight ? project(flight, Date.now()) : points[points.length - 1]!;
      features.push({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: [...points, head] },
      });
    }
    source.setData({ type: 'FeatureCollection', features });
  }

  private onMapClick(event: MapMouseEvent): void {
    const map = this.map;
    if (!map) return;
    const hits = map.queryRenderedFeatures(event.point, {
      layers: [PLANES_LAYER, AIRPORT_DOT_LAYER],
    });
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

    if (!id) this.settings.follow.set(false);
    const flight = id ? this.byId.get(id) : undefined;
    if (flight && this.selectedFromMap !== id) {
      map.flyTo({
        center: project(flight, Date.now()),
        zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
        speed: 1.4,
      });
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

  /** Draws the cached airport pins, fetching them the first time. */
  private showPins(): void {
    if (this.pins) {
      this.drawPins(this.pins);
      return;
    }
    void this.api
      .airportPins()
      .then((pins) => {
        this.pins = pins;
        this.drawPins(pins);
      })
      .catch(() => undefined);
  }

  private applyTheme(theme: Theme): void {
    const map = this.map;
    if (!map || this.appliedTheme === null || this.appliedTheme === theme) return;
    const sameBasemap = BASEMAP_STYLES[this.appliedTheme] === BASEMAP_STYLES[theme];
    this.appliedTheme = theme;
    if (!sameBasemap) {
      map.setStyle(BASEMAP_STYLES[theme]); // `style.load` rebuilds the layers with this theme's ink
      return;
    }
    if (!this.ready) return;
    // Dark and glass share a basemap: only the overlay colours change.
    const ink = MAP_INK[theme];
    map.setPaintProperty(TRACK_LAYER, 'line-color', ink.track);
    map.setPaintProperty(AIRPORT_DOT_LAYER, 'circle-stroke-color', ink.stroke);
    for (const layer of [AIRPORT_LABEL_MAJOR, AIRPORT_LABEL_MINOR]) {
      map.setPaintProperty(layer, 'text-color', ink.label);
      map.setPaintProperty(layer, 'text-halo-color', ink.halo);
    }
    map.setPaintProperty(RING_LAYER, 'circle-color', ink.ring);
    map.setPaintProperty(RING_LAYER, 'circle-stroke-color', ink.ring);
    if (map.getLayer(BUILDINGS_LAYER)) {
      map.setPaintProperty(BUILDINGS_LAYER, 'fill-extrusion-color', ink.building);
    }
  }

  /**
   * 2D flat map, 3D (tilted, terrain, buildings, planes lifted above their
   * shadow) or a globe. Also re-run after a style swap, which drops terrain.
   */
  private applyView(view: MapView): void {
    const map = this.map;
    if (!map || !this.ready) return;
    const is3d = view === '3d';
    try {
      map.setProjection({ type: view === 'globe' ? 'globe' : 'mercator' });
      map.setTerrain(is3d ? { source: DEM, exaggeration: 1.5 } : null);
    } catch (error) {
      console.error('[map] 3D setup failed', error);
    }
    map.setMaxZoom(MAX_ZOOM_BY_VIEW[view]);
    map.setMinZoom(view === 'globe' ? 1.5 : 3);
    const visibility = is3d ? 'visible' : 'none';
    for (const layer of [BUILDINGS_LAYER, SHADOW_LAYER]) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', visibility);
    }
    const lift = [0, 1, 2, 3, 4, 5, 6].flatMap((band) => [band, ['literal', [0, -band * LIFT_PX]]]);
    map.setLayoutProperty(
      PLANES_LAYER,
      'icon-offset',
      is3d
        ? (['match', ['get', 'band'], ...lift, ['literal', [0, 0]]] as unknown as [number, number])
        : [0, 0],
    );

    if (view === this.appliedView) return;
    this.appliedView = view;
    if (view === '3d') {
      map.easeTo({
        pitch: TILT_PITCH,
        bearing: TILT_BEARING,
        zoom: Math.max(map.getZoom(), 6),
        duration: 1100,
      });
    } else if (view === 'globe') {
      map.easeTo({ pitch: 0, bearing: 0, center: [82, 22], zoom: 2.6, duration: 1100 });
    } else {
      map.easeTo({
        pitch: 0,
        bearing: 0,
        zoom: Math.min(map.getZoom(), MAX_ZOOM_BY_VIEW['2d']),
        duration: 900,
      });
    }
  }

  /**
   * Night shading: three stacked polygons (sun below 0, -6 and -12 degrees), so
   * the darkness deepens through twilight. Recomputed every minute from the
   * clock; no data is fetched.
   */
  private applyNight(): void {
    const map = this.map;
    if (!map || !this.ready) return;
    const on = this.settings.dayNight();
    if (this.nightTimer) {
      clearInterval(this.nightTimer);
      this.nightTimer = null;
    }
    if (map.getLayer(NIGHT)) map.setLayoutProperty(NIGHT, 'visibility', on ? 'visible' : 'none');
    if (!on) return;
    this.drawNight(map);
    this.nightTimer = setInterval(() => this.drawNight(map), NIGHT_REFRESH_MS);
  }

  private drawNight(map: MapLibreMap): void {
    const now = new Date();
    const data = {
      type: 'FeatureCollection' as const,
      features: NIGHT_LEVELS.map((level) => ({
        type: 'Feature' as const,
        properties: { level },
        geometry: { type: 'Polygon' as const, coordinates: [nightRing(now, level)] },
      })),
    };
    const existing = map.getSource<GeoJSONSource>(NIGHT);
    if (existing) {
      existing.setData(data);
      return;
    }
    map.addSource(NIGHT, { type: 'geojson', data });
    map.addLayer(
      {
        id: NIGHT,
        type: 'fill',
        source: NIGHT,
        paint: { 'fill-color': '#020a1c', 'fill-opacity': 0.2, 'fill-antialias': false },
      },
      map.getLayer(TRACK_LAYER) ? TRACK_LAYER : undefined,
    );
  }

  /**
   * Rain radar (RainViewer). Shows the newest frame, or loops over the last
   * few when playing. Sources are rebuilt after a style swap, so this is
   * also called from `setUpLayers`.
   */
  private applyRadar(): void {
    const map = this.map;
    if (!map || !this.ready) return;
    if (this.radarTimer) {
      clearInterval(this.radarTimer);
      this.radarTimer = null;
    }
    const on = this.settings.radar();
    if (map.getLayer(RADAR_LAYER))
      map.setLayoutProperty(RADAR_LAYER, 'visibility', on ? 'visible' : 'none');
    if (!on) return;

    if (this.radarFrames.length === 0 || Date.now() - this.radarLoadedAt > RADAR_REFRESH_MS) {
      void this.loadRadar();
      if (this.radarFrames.length === 0) return;
    }
    this.ensureRadarLayer(map);
    const frames = this.radarFrames.slice(-RADAR_FRAMES);
    if (!this.settings.radarPlaying()) {
      this.showRadarFrame(map, frames.length - 1);
      return;
    }
    this.radarIndex = 0;
    this.showRadarFrame(map, 0);
    this.radarTimer = setInterval(() => {
      this.radarIndex = (this.radarIndex + 1) % frames.length;
      this.showRadarFrame(map, this.radarIndex);
    }, RADAR_STEP_MS);
  }

  private async loadRadar(): Promise<void> {
    if (this.radarLoading) return;
    this.radarLoading = true;
    try {
      const data = await this.weather.radarFrames();
      this.radarHost = data.host;
      this.radarFrames = data.frames;
      this.radarLoadedAt = Date.now();
      this.settings.radarError.set(data.frames.length === 0);
    } catch {
      this.settings.radarError.set(true);
    } finally {
      this.radarLoading = false;
    }
    if (this.radarFrames.length > 0) this.applyRadar();
  }

  private radarTiles(path: string): string[] {
    return [`${this.radarHost}${path}/256/{z}/{x}/{y}/2/1_1.png`];
  }

  private ensureRadarLayer(map: MapLibreMap): void {
    if (map.getSource(RADAR) || this.radarFrames.length === 0) return;
    const latest = this.radarFrames[this.radarFrames.length - 1]!;
    map.addSource(RADAR, {
      type: 'raster',
      tiles: this.radarTiles(latest.path),
      tileSize: 256,
      maxzoom: RADAR_MAX_ZOOM,
      attribution: '<a href="https://www.rainviewer.com/">RainViewer</a>',
    });
    map.addLayer(
      { id: RADAR_LAYER, type: 'raster', source: RADAR, paint: { 'raster-opacity': 0.7 } },
      map.getLayer(TRACK_LAYER) ? TRACK_LAYER : undefined,
    );
  }

  private showRadarFrame(map: MapLibreMap, index: number): void {
    const frames = this.radarFrames.slice(-RADAR_FRAMES);
    const frame = frames[index];
    const source = map.getSource<RasterTileSource>(RADAR);
    if (!frame || !source) return;
    source.setTiles(this.radarTiles(frame.path));
    this.settings.radarTime.set(frame.time);
  }

  /** Chase camera: centre on the selected flight and look along its heading. */
  private followSelected(selectedId: string | null, position: [number, number] | null): void {
    const map = this.map;
    if (!map || !selectedId || !position || !this.settings.follow()) return;
    const heading = this.byId.get(selectedId)?.heading ?? map.getBearing();
    const narrow = innerWidth <= 760;
    map.easeTo({
      center: position,
      bearing: heading,
      pitch: FOLLOW_PITCH,
      zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
      // Keep the plane in the part of the map the flight card does not cover.
      padding: narrow
        ? { top: 0, left: 0, right: 0, bottom: Math.round(innerHeight * 0.42) }
        : { top: 0, bottom: 0, right: 0, left: 380 },
      duration: TICK_MS,
      easing: (t) => t,
    });
  }

  private drawPins(pins: AirportPin[]): void {
    const source = this.map?.getSource<GeoJSONSource>(AIRPORTS);
    if (!source) return;
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
      positions ?? [...this.byId.values()].map((flight) => project(flight, Date.now()) as number[]);
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
    [32, 3],
    [36, 18],
    [60, 36],
    [60, 42],
    [36, 34],
    [34, 50],
    [44, 56],
    [44, 61],
    [32, 58],
    [20, 61],
    [20, 56],
    [30, 50],
    [28, 34],
    [4, 42],
    [4, 36],
    [28, 18],
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
