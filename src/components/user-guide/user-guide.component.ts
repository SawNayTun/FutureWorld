import { Component, ChangeDetectionStrategy, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LicenseService } from '../../services/license.service';

@Component({
  selector: 'app-user-guide',
  templateUrl: './user-guide.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule]
})
export class UserGuideComponent {
  close = output<void>();
  licenseService = inject(LicenseService);

  closePanel(): void {
    this.close.emit();
  }
}