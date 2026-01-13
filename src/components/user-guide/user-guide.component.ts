import { Component, ChangeDetectionStrategy, output, inject } from '@angular/core';
import { LicenseService } from '../../services/license.service';

@Component({
  selector: 'app-user-guide',
  templateUrl: './user-guide.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserGuideComponent {
  close = output<void>();
  licenseService = inject(LicenseService);

  closePanel(): void {
    this.close.emit();
  }
}