import { Component, ChangeDetectionStrategy, input } from '@angular/core';

@Component({
  selector: 'app-summary-card',
  templateUrl: './summary-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryCardComponent {
  title = input<string>('');
  value = input<string | number>('');
  color = input<string>('text-green-400');
}
