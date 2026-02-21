import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-summary-card',
  templateUrl: './summary-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule]
})
export class SummaryCardComponent {
  title = input<string>('');
  value = input<string | number>('');
  color = input<string>('text-green-400');
}
