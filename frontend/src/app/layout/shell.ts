import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from '../core/auth';
import { FlightSelection } from '../core/flight-selection';
import { FlightStream } from '../core/flight-stream';
import { FEED_LABEL } from '../core/format';
import { Icon } from '../core/icon';
import { ThemeService } from '../core/theme';
import { GlobalSearch } from './global-search';

/**
 * The signed-in frame shared by every page:
 *  - a navigation rail (left on desktop, a bottom tab bar on phones),
 *  - a slim top bar with search, feed health, theme switch and account menu,
 *  - the page itself.
 * It owns the live stream so switching pages does not reconnect; the stream
 * closes when the user signs out.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, GlobalSearch, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnDestroy {
  private readonly auth = inject(Auth);
  private readonly stream = inject(FlightStream);
  private readonly selection = inject(FlightSelection);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly themeService = inject(ThemeService);

  protected readonly user = this.auth.user;
  protected readonly authDisabled = this.auth.authDisabled;
  protected readonly links = [
    { path: '/', label: 'Live map', icon: 'map', exact: true },
    { path: '/flights', label: 'Flights', icon: 'list', exact: false },
    { path: '/insights', label: 'Insights', icon: 'chart', exact: false },
    { path: '/airports', label: 'Airports', icon: 'pin', exact: false },
  ];

  protected readonly menuOpen = signal(false);

  protected readonly initial = computed(() => (this.user()?.email ?? '?').charAt(0).toUpperCase());
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

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected logout(): void {
    this.menuOpen.set(false);
    void this.auth.logout();
  }

  /** Closes the account menu on a click anywhere outside it. */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen()) return;
    const menu = this.host.nativeElement.querySelector('.account');
    if (menu && !menu.contains(event.target as Node)) this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.menuOpen.set(false);
  }

  ngOnDestroy(): void {
    this.stream.disconnect();
    this.selection.select(null);
  }
}
