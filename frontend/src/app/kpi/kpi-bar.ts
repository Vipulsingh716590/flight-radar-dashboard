import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FlightStream } from '../core/flight-stream';
import { KIND_COLOR } from '../core/format';

interface Card {
  label: string;
  value: number | null;
  color: string;
  hint: string;
}

/** Counts by relation to India. Feed health lives in the shell header, on every page. */
@Component({
  selector: 'app-kpi-bar',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kpi-bar.html',
  styleUrl: './kpi-bar.scss',
})
export class KpiBar {
  private readonly stream = inject(FlightStream);

  protected readonly snapshot = this.stream.snapshot;
  protected readonly airborne = computed(() => this.snapshot()?.summary.airborne ?? null);

  protected readonly cards = computed<Card[]>(() => {
    const s = this.snapshot()?.summary;
    return [
      {
        label: 'Arrivals',
        value: s?.arrivals ?? null,
        color: KIND_COLOR.arrival,
        hint: 'Airborne, landing in India, departed from abroad',
      },
      {
        label: 'Departures',
        value: s?.departures ?? null,
        color: KIND_COLOR.departure,
        hint: 'Airborne, departed from India, landing abroad',
      },
      {
        label: 'Domestic',
        value: s?.domestic ?? null,
        color: KIND_COLOR.domestic,
        hint: 'Airborne, both ends in India',
      },
      {
        label: 'Overflights',
        value: s?.overflights ?? null,
        color: KIND_COLOR.overflight,
        hint: 'Airborne, crossing Indian airspace without landing or departing here',
      },
    ];
  });

  protected readonly routeCoverage = computed(() => {
    const s = this.snapshot()?.summary;
    if (!s || s.airborne === 0) return null;
    return { known: s.airborne - s.unknownRoute, of: s.airborne };
  });
}
