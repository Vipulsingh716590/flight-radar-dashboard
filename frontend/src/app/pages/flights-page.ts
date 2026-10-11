import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FlightList } from '../flights/flight-list';

/** Page 2 (/flights): every airborne flight in a searchable, sortable table. */
@Component({
  selector: 'app-flights-page',
  imports: [FlightList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-flight-list />`,
  styles: `
    :host { display: block; height: 100%; }
    app-flight-list { height: 100%; }
  `,
})
export class FlightsPage {}
