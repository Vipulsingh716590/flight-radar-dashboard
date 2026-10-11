import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Insights } from '../insights/insights';

/** Page 3 (/insights): history charts from PostgreSQL. */
@Component({
  selector: 'app-insights-page',
  imports: [Insights],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-insights />`,
  styles: `
    :host { display: block; height: 100%; }
  `,
})
export class InsightsPage {}
