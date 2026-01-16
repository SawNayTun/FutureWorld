import { Component, ChangeDetectionStrategy, signal, computed, output, OnInit, inject } from '@angular/core';
import { Report } from '../../models/app.models';
import { PersistenceService } from '../../services/persistence.service';

interface GridCell {
  number: string;
  amount: number;
}

@Component({
  selector: 'app-report-viewer',
  templateUrl: './report-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportViewerComponent implements OnInit {
  close = output<void>();
  private persistenceService = inject(PersistenceService);

  allReports = signal<Report[]>([]);
  selectedReport = signal<Report | null>(null);
  statusMessage = signal<string>('');
  reportToDelete = signal<Report | null>(null);
  
  modes = ['အားလုံး', 'အလယ်ဒိုင်', 'ဒိုင်ကြီး', 'အေးဂျင့်'];
  activeModeFilter = signal(this.modes[0]);

  lotteryTypes = ['အားလုံး', '2D', '3D'];
  activeTypeFilter = signal(this.lotteryTypes[0]);

  filteredReports = computed(() => {
    const reports = this.allReports();
    const modeFilter = this.activeModeFilter();
    const typeFilter = this.activeTypeFilter();

    return reports.filter(r => {
      const modeMatch = modeFilter === 'အားလုံး' || r.mode === modeFilter;
      const typeMatch = typeFilter === 'အားလုံး' || r.lotteryType === typeFilter;
      return modeMatch && typeMatch;
    });
  });
  
  reportGrid = computed<GridCell[]>(() => {
    const report = this.selectedReport();
    if (!report || report.lotteryType !== '2D') return [];
    
    const data = new Map(report.lotteryData);
    const cells: GridCell[] = [];
    for (let i = 0; i < 100; i++) {
      const numberStr = i.toString().padStart(2, '0');
      const amount = Number(data.get(numberStr) as any) || 0;
      cells.push({ number: numberStr, amount });
    }
    return cells;
  });

  reportList = computed(() => {
    const report = this.selectedReport();
    if (!report || report.lotteryType !== '3D') return [];
    return [...report.lotteryData].sort((a,b) => a[0].localeCompare(b[0])).map(([number, amount]) => ({ number, amount: Number(amount) }));
  });


  weeklySummary = computed(() => this.calculateSummaryForPeriod('week'));
  monthlySummary = computed(() => this.calculateSummaryForPeriod('month'));
  yearlySummary = computed(() => this.calculateSummaryForPeriod('year'));

  summaryCurrencySymbol = computed(() => {
    const reports = this.allReports();
    if (reports.length > 0) {
        // Reports are sorted descending by date, so the first one is the most recent.
        return reports[0].currencySymbol || 'K';
    }
    return 'K';
  });

  ngOnInit(): void {
    this.loadReports();
  }
  
  private async loadReports(): Promise<void> {
    const reports = await this.persistenceService.getAllReports();
    reports.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    this.allReports.set(reports);
  }

  private calculateSummaryForPeriod(period: 'week' | 'month' | 'year'): { sales: number; net: number } {
    const reports = this.allReports();
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - now.getDay()));
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
    }
    startDate.setHours(0, 0, 0, 0);

    const relevantReports = reports.filter(r => new Date(r.date) >= startDate);
    
    return relevantReports.reduce((acc, report) => {
      acc.sales += Number(report.totalBetAmount);
      acc.net += Number(report.netAmount as any);
      return acc;
    }, { sales: 0, net: 0 });
  }

  selectReport(report: Report): void {
    this.selectedReport.set(report);
  }

  clearSelectedReport(): void {
    this.selectedReport.set(null);
  }

  deleteReport(report: Report): void {
    this.reportToDelete.set(report);
  }

  cancelDelete(): void {
    this.reportToDelete.set(null);
  }

  async confirmDelete(): Promise<void> {
    const report = this.reportToDelete();
    if (!report) return;

    try {
      await this.persistenceService.deleteReport(report.id);
      
      await this.loadReports();

      if(this.selectedReport()?.id === report.id) {
        this.selectedReport.set(null);
      }

      this.statusMessage.set('မှတ်တမ်းကို အောင်မြင်စွာ ဖျက်လိုက်ပါပြီ။');
      
    } catch (error) {
      console.error('Failed to delete report:', error);
      this.statusMessage.set('မှတ်တမ်းဖျက်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်။');
    } finally {
      this.reportToDelete.set(null); // Hide modal
      setTimeout(() => this.statusMessage.set(''), 3000);
    }
  }

  printReport(): void {
    window.print();
  }

  setModeFilter(mode: string): void {
    this.activeModeFilter.set(mode);
  }
  
  setTypeFilter(type: string): void {
    this.activeTypeFilter.set(type);
  }

  closePanel(): void {
    this.close.emit();
  }
  
  formatDate(isoString: string): string {
    return new Date(isoString).toLocaleDateString('en-CA'); // YYYY-MM-DD format
  }
}
