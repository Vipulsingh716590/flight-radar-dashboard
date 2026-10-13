import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import type { ChartConfiguration } from 'chart.js';
import { ChartView } from '../charts/chart';
import { Api, type AirlineShare, type HourlyPoint, type TopAirport } from '../core/api';
import { KIND_COLOR } from '../core/format';

const REFRESH_MS = 60_000;
const WINDOWS = [6, 24, 72] as const;
/** Categorical palette for airlines; "Other" is always the neutral grey. */
const AIRLINE_COLORS = [
  '#4cc9f0',
  '#ffb703',
  '#3ddc84',
  '#b388ff',
  '#ff7aa2',
  '#ff9f43',
  '#5eead4',
  '#a3e635',
];
const OTHER_COLOR = '#566370';

/** Historical charts built from PostgreSQL: traffic mix, busiest airports, airline share. */
@Component({
  selector: 'app-insights',
  imports: [ChartView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './insights.html',
  styleUrl: './insights.scss',
})
export class Insights implements OnDestroy {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly windows = WINDOWS;
  protected readonly hours = signal<number>(24);
  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);

  private readonly hourly = signal<HourlyPoint[]>([]);
  private readonly airports = signal<TopAirport[]>([]);
  private readonly airlines = signal<AirlineShare[]>([]);
  private timer: ReturnType<typeof setInterval>;

  protected readonly empty = computed(() => this.loaded() && this.hourly().length === 0);

  protected readonly trafficChart = computed<ChartConfiguration>(() => {
    const points = this.hourly();
    const labels = points.map((p) =>
      new Date(p.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    );
    const series = (label: string, key: keyof HourlyPoint, color: string) => ({
      label,
      data: points.map((p) => p[key] as number),
      backgroundColor: color,
      borderWidth: 0,
    });
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          series('Arrivals', 'arrivals', KIND_COLOR.arrival),
          series('Departures', 'departures', KIND_COLOR.departure),
          series('Domestic', 'domestic', KIND_COLOR.domestic),
          series('Overflights', 'overflights', KIND_COLOR.overflight),
          series('Route unknown', 'unknownRoute', KIND_COLOR.unknown),
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: {
            stacked: true,
            beginAtZero: true,
            title: { display: true, text: 'Avg airborne flights' },
          },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10 } },
          tooltip: { mode: 'index', intersect: false },
        },
      },
    };
  });

  protected readonly airportChart = computed<ChartConfiguration>(() => {
    const airports = this.airports();
    const labels = airports.map((a) => a.iata ?? a.icao ?? a.name);
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Arriving',
            data: airports.map((a) => a.arrivals),
            backgroundColor: KIND_COLOR.arrival,
          },
          {
            label: 'Departing',
            data: airports.map((a) => a.departures),
            backgroundColor: KIND_COLOR.departure,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            beginAtZero: true,
            title: { display: true, text: 'Distinct flights' },
          },
          y: { stacked: true },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10 } },
          tooltip: {
            callbacks: {
              title: (items) => {
                const airport = airports[items[0]?.dataIndex ?? 0];
                return airport ? `${airport.name}${airport.city ? ` · ${airport.city}` : ''}` : '';
              },
            },
          },
        },
        onClick: (_event, elements) => {
          const airport = airports[elements[0]?.index ?? -1];
          const code = airport?.iata ?? airport?.icao;
          if (code) void this.router.navigate(['/airports', code]);
        },
        onHover: (event, elements) => {
          const target = event.native?.target as HTMLElement | undefined;
          if (target) target.style.cursor = elements.length ? 'pointer' : 'default';
        },
      },
    };
  });

  protected readonly airlineChart = computed<ChartConfiguration>(() => {
    const airlines = this.airlines();
    return {
      type: 'doughnut',
      data: {
        labels: airlines.map((a) => a.airline),
        datasets: [
          {
            data: airlines.map((a) => a.flights),
            backgroundColor: airlines.map((a, index) =>
              a.airline === 'Other' ? OTHER_COLOR : AIRLINE_COLORS[index % AIRLINE_COLORS.length],
            ),
            borderWidth: 0,
            spacing: 2,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: {
            // Beside the ring on wide screens, under it on phones (long airline names).
            position: typeof innerWidth === 'number' && innerWidth < 640 ? 'bottom' : 'right',
            labels: { boxWidth: 10 },
          },
          tooltip: {
            callbacks: {
              label: (item) => {
                const airline = airlines[item.dataIndex];
                return airline
                  ? `${airline.airline}: ${airline.flights} flights (${airline.share}%)`
                  : '';
              },
            },
          },
        },
      },
    };
  });

  constructor() {
    void this.load();
    this.timer = setInterval(() => void this.load(), REFRESH_MS);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected setHours(hours: number): void {
    this.hours.set(hours);
    void this.load();
  }

  private async load(): Promise<void> {
    const hours = this.hours();
    try {
      const [hourly, airports, airlines] = await Promise.all([
        this.api.hourly(hours),
        this.api.topAirports(hours, 10),
        this.api.airlines(hours, 6),
      ]);
      // Ignore a slow response for a window the user has already left.
      if (hours !== this.hours()) return;
      this.hourly.set(hourly);
      this.airports.set(airports);
      this.airlines.set(airlines);
      this.failed.set(false);
    } catch {
      this.failed.set(true);
    } finally {
      this.loaded.set(true);
    }
  }
}
