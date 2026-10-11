import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AirportBoardView } from '../airports/airport-board';

/**
 * Page 4 (/airports and /airports/:code): airport search and live board. The
 * code comes from the URL (route input binding), so a board can be bookmarked.
 */
@Component({
  selector: 'app-airports-page',
  imports: [AirportBoardView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-airport-board [airportCode]="code()" />`,
  styles: `
    :host { display: block; height: 100%; }
    app-airport-board { height: 100%; }
  `,
})
export class AirportsPage {
  /** Bound from the `:code` route parameter. */
  readonly code = input<string | undefined>(undefined);
}
