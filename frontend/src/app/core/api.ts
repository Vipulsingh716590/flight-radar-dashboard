import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface HourlyPoint {
  hour: string;
  airborne: number;
  arrivals: number;
  departures: number;
  domestic: number;
  overflights: number;
  unknownRoute: number;
  peakAirborne: number;
  samples: number;
}

export interface TopAirport {
  iata: string | null;
  icao: string | null;
  name: string;
  city: string | null;
  arrivals: number;
  departures: number;
  total: number;
}

export interface AirlineShare {
  airline: string;
  flights: number;
  share: number;
}

export interface AirportInfo {
  iata: string | null;
  icao: string | null;
  name: string;
  city: string | null;
  lat: number;
  lon: number;
}

export interface BoardFlight {
  id: string;
  callsign: string | null;
  airline: string | null;
  aircraftType: string | null;
  other: { code: string; city: string | null } | null;
  altitudeM: number | null;
  speedMs: number | null;
  distanceKm: number;
}

export interface AirportBoard {
  airport: AirportInfo;
  updatedAt: string | null;
  arrivals: BoardFlight[];
  departures: BoardFlight[];
}

export interface AirportPin {
  code: string;
  icao: string | null;
  name: string;
  city: string | null;
  lat: number;
  lon: number;
  size: 'large' | 'medium' | 'small';
}

export interface TrackPoint {
  lat: number;
  lon: number;
  alt: number | null;
  t: number;
}

/** Typed wrappers over the history/airport endpoints. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  async hourly(hours: number): Promise<HourlyPoint[]> {
    const params = new HttpParams().set('hours', hours);
    const body = await firstValueFrom(
      this.http.get<{ points: HourlyPoint[] }>('/api/stats/hourly', { params }),
    );
    return body.points;
  }

  async topAirports(hours: number, limit = 10): Promise<TopAirport[]> {
    const params = new HttpParams().set('hours', hours).set('limit', limit);
    const body = await firstValueFrom(
      this.http.get<{ airports: TopAirport[] }>('/api/stats/top-airports', { params }),
    );
    return body.airports;
  }

  async airlines(hours: number, limit = 8): Promise<AirlineShare[]> {
    const params = new HttpParams().set('hours', hours).set('limit', limit);
    const body = await firstValueFrom(
      this.http.get<{ airlines: AirlineShare[] }>('/api/stats/airlines', { params }),
    );
    return body.airlines;
  }

  async searchAirports(search: string): Promise<AirportInfo[]> {
    const params = new HttpParams().set('search', search).set('limit', 8);
    const body = await firstValueFrom(
      this.http.get<{ airports: AirportInfo[] }>('/api/airports', { params }),
    );
    return body.airports;
  }

  async airportPins(): Promise<AirportPin[]> {
    const body = await firstValueFrom(this.http.get<{ airports: AirportPin[] }>('/api/airports/pins'));
    return body.airports;
  }

  async track(icao24: string, hours = 6): Promise<TrackPoint[]> {
    const params = new HttpParams().set('hours', hours);
    const body = await firstValueFrom(
      this.http.get<{ points: TrackPoint[] }>(`/api/flights/${encodeURIComponent(icao24)}/track`, { params }),
    );
    return body.points;
  }

  airportBoard(code: string): Promise<AirportBoard> {
    return firstValueFrom(this.http.get<AirportBoard>(`/api/airports/${encodeURIComponent(code)}`));
  }
}
