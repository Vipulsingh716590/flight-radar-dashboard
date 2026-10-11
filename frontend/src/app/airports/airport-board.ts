import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { Api, type AirportBoard, type AirportInfo, type BoardFlight } from '../core/api';
import { FlightSelection } from '../core/flight-selection';
import { FlightStream } from '../core/flight-stream';
import { feet } from '../core/format';

const SEARCH_DEBOUNCE_MS = 250;

/** Live arrivals/departures board for one Indian airport, with search. */
@Component({
  selector: 'app-airport-board',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './airport-board.html',
  styleUrl: './airport-board.scss',
})
export class AirportBoardView implements OnDestroy {
  private readonly api = inject(Api);
  private readonly stream = inject(FlightStream);
  private readonly selection = inject(FlightSelection);
  private readonly router = inject(Router);

  /** IATA/ICAO code from the route (/airports/:code); null shows only the search. */
  readonly airportCode = input<string | null | undefined>(null);

  protected readonly results = signal<AirportInfo[]>([]);
  protected readonly searching = signal(false);
  protected readonly board = signal<AirportBoard | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedId = this.selection.selectedId;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;

  constructor() {
    // Reload when the user picks another airport or a fresh snapshot arrives.
    effect(() => {
      const code = this.airportCode() ?? null;
      this.stream.snapshot()?.updatedAt;
      untracked(() => void this.loadBoard(code));
    });
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  protected onSearch(event: Event): void {
    const text = (event.target as HTMLInputElement).value.trim();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (text.length < 2) {
      this.results.set([]);
      return;
    }
    this.searchTimer = setTimeout(() => void this.runSearch(text), SEARCH_DEBOUNCE_MS);
  }

  protected pick(airport: AirportInfo): void {
    this.results.set([]);
    const code = airport.iata ?? airport.icao;
    if (code) void this.router.navigate(['/airports', code]);
  }

  protected select(flight: BoardFlight): void {
    // Show the plane on the live map.
    this.selection.select(flight.id);
    void this.router.navigate(['/']);
  }

  protected altitudeFt = (flight: BoardFlight) => feet(flight.altitudeM);
  protected code = (airport: AirportInfo) => airport.iata ?? airport.icao ?? '';

  private async runSearch(text: string): Promise<void> {
    this.searching.set(true);
    try {
      this.results.set(await this.api.searchAirports(text));
    } catch {
      this.results.set([]);
    } finally {
      this.searching.set(false);
    }
  }

  private async loadBoard(code: string | null): Promise<void> {
    if (!code) {
      this.board.set(null);
      return;
    }
    const seq = ++this.requestSeq;
    try {
      const board = await this.api.airportBoard(code);
      if (seq !== this.requestSeq) return;
      this.board.set(board);
      this.error.set(null);
    } catch {
      if (seq !== this.requestSeq) return;
      this.board.set(null);
      this.error.set(`Could not load the board for ${code}.`);
    }
  }
}
