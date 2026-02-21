import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CodeAnalyzerComponent } from './src/components/code-analyzer/code-analyzer.component';
import { LicenseService } from './src/services/license.service';
import { ActivationComponent } from './src/components/activation/activation.component';
import { LicenseGeneratorComponent } from './src/components/license-generator/license-generator.component';
import { PersistenceService } from './src/services/persistence.service';

@Component({
  selector: 'app',
  templateUrl: 'app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CodeAnalyzerComponent, ActivationComponent, LicenseGeneratorComponent]
})
export class AppComponent implements OnInit {
  licenseService = inject(LicenseService);
  persistenceService = inject(PersistenceService);
  showAdminPanel = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      // Run migration first to ensure all data is in IndexedDB
      await this.persistenceService.migrateFromLocalStorage();
      await this.licenseService.init();
    } catch (error) {
      console.error('Error during app initialization:', error);
      // Optionally, set a state to display an error message to the user
      this.licenseService.licenseState.set('INVALID'); 
    }
  }

  toggleAdminPanel(): void {
    this.showAdminPanel.update(v => !v);
  }
}