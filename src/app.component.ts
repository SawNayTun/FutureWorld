import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CodeAnalyzerComponent } from './components/code-analyzer/code-analyzer.component';
import { LicenseService } from './services/license.service';
import { ActivationComponent } from './components/activation/activation.component';
import { LicenseGeneratorComponent } from './components/license-generator/license-generator.component';
import { PersistenceService } from './services/persistence.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CodeAnalyzerComponent, ActivationComponent, LicenseGeneratorComponent]
})
export class AppComponent implements OnInit {
  licenseService = inject(LicenseService);
  persistenceService = inject(PersistenceService);
  showAdminPanel = signal(false);

  async ngOnInit(): Promise<void> {
    // Run migration first to ensure all data is in IndexedDB
    await this.persistenceService.migrateFromLocalStorage();
    await this.licenseService.init();
  }

  toggleAdminPanel(): void {
    this.showAdminPanel.update(v => !v);
  }
}