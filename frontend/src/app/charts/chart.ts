import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  viewChild,
} from '@angular/core';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LinearScale,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';

// Register only what the three charts use (keeps the bundle small).
Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LinearScale,
  Tooltip,
);
Chart.defaults.color = '#8b98a5';
Chart.defaults.borderColor = '#2a3541';
Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * Thin wrapper around a Chart.js chart. When the `config` input changes the
 * chart is rebuilt; data arrives at most once a minute so that is cheap.
 */
@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas role="img" [attr.aria-label]="label()"></canvas>`,
  styles: `
    :host { display: block; position: relative; height: 100%; }
    canvas { max-width: 100%; }
  `,
})
export class ChartView implements OnDestroy {
  readonly config = input.required<ChartConfiguration>();
  readonly label = input('Chart');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart | null = null;

  constructor() {
    effect(() => {
      const config = this.config();
      const canvas = this.canvas().nativeElement;
      this.chart?.destroy();
      this.chart = new Chart(canvas, config);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }
}
