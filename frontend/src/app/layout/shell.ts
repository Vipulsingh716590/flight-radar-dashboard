import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from '../core/auth';
import { FlightSelection } from '../core/flight-selection';
import { FlightStream } from '../core/flight-stream';
import { FEED_LABEL } from '../core/format';
import { GlobalSearch } from './global-search';

/**
 * The signed-in frame shared by every page: brand, navigation, feed health and
 * the account menu. It owns the live stream so switching pages does not
 * reconnect; the stream closes when the user signs out.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, GlobalSearch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnDestroy {
  private readonly auth = inject(Auth);
  private readonly stream = inject(FlightStream);
  private readonly selection = inject(FlightSelection);

  protected readonly user = this.auth.user;
  protected readonly authDisabled = this.auth.authDisabled;
  protected readonly links = [
    { path: '/', label: 'Live map', exact: true },
    { path: '/flights', label: 'Flights', exact: false },
    { path: '/insights', label: 'Insights', exact: false },
    { path: '/airports', label: 'Airports', exact: false },
  ];

  protected readonly feedLabel = computed(() => FEED_LABEL[this.stream.state()]);
  protected readonly feedOk = computed(() => ['live', 'partial'].includes(this.stream.state()));
  protected readonly feedBad = computed(() =>
    ['stale', 'down', 'offline'].includes(this.stream.state()),
  );
  protected readonly feedAge = computed(() => {
    const age = this.stream.ageSeconds();
    return age === null ? null : age < 90 ? `${age}s ago` : `${Math.round(age / 60)} min ago`;
  });
  protected readonly feedSource = computed(() => this.stream.snapshot()?.source ?? null);

  constructor() {
    this.stream.connect();
  }

  protected logout(): void {
    void this.auth.logout();
  }

  ngOnDestroy(): void {
    this.stream.disconnect();
    this.selection.select(null);
  }
}
