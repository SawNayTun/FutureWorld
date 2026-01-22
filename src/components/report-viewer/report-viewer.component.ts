
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
  restore = output<Report>(); 
  private persistenceService = inject(PersistenceService);

  allReports = signal<Report[]>([]);
  selectedReport = signal<Report | null>(null);
  statusMessage = signal<string>('');
  reportToDelete = signal<Report | null>(null);
  
  modes = ['အားလုံး', 'အလယ်ဒိုင်', 'ဒိုင်ကြီး', 'အေးဂျင့်'];
  activeModeFilter = signal(this.modes[0]);

  lotteryTypes = ['အားလုံး', '2D', '3D'];
  activeTypeFilter = signal(this.lotteryTypes[0]);

  // Helper to normalize mode strings for filtering (handles Eng/Burmese mix)
  private normalizeMode(mode: string | undefined): string {
      const m = (mode || '').trim().toLowerCase();
      if (['agent', 'အေးဂျင့်'].includes(m)) return 'agent';
      if (['middle', 'middle bookie', 'အလယ်ဒိုင်'].includes(m)) return 'middle';
      if (['main', 'main bookie', 'ဒိုင်ကြီး'].includes(m)) return 'main';
      if (['all', 'အားလုံး'].includes(m)) return 'all';
      return m;
  }

  filteredReports = computed(() => {
    const reports = this.allReports();
    const modeFilterRaw = this.activeModeFilter();
    const typeFilter = this.activeTypeFilter();

    const normalizedFilter = this.normalizeMode(modeFilterRaw);

    return reports.filter(r => {
      const rMode = this.normalizeMode(r.mode);
      const modeMatch = normalizedFilter === 'all' || rMode === normalizedFilter;
      const typeMatch = typeFilter === 'အားလုံး' || r.lotteryType === typeFilter;
      return modeMatch && typeMatch;
    });
  });
  
  reportGrid = computed<GridCell[]>(() => {
    const report = this.selectedReport();
    if (!report || report.lotteryType !== '2D') return [];
    
    // Robust data loading: Handle both Array (new) and Object (legacy) formats
    let dataMap: Map<string, number>;
    const rawData = report.lotteryData as any;

    try {
        if (Array.isArray(rawData)) {
            dataMap = new Map(rawData);
        } else if (typeof rawData === 'object' && rawData !== null) {
            dataMap = new Map(Object.entries(rawData));
        } else {
            dataMap = new Map();
        }
    } catch (e) {
        console.warn("Failed to parse report data", e);
        dataMap = new Map();
    }

    const cells: GridCell[] = [];
    for (let i = 0; i < 100; i++) {
      const numberStr = i.toString().padStart(2, '0');
      const amount = Number(dataMap.get(numberStr)) || 0;
      cells.push({ number: numberStr, amount });
    }
    return cells;
  });

  reportList = computed(() => {
    const report = this.selectedReport();
    if (!report || report.lotteryType !== '3D') return [];
    
    // Robust data loading for 3D as well
    let entries: [string, any][] = [];
    const rawData = report.lotteryData as any;

    try {
        if (Array.isArray(rawData)) {
            entries = rawData;
        } else if (typeof rawData === 'object' && rawData !== null) {
            entries = Object.entries(rawData);
        }
    } catch (e) {
        console.warn("Failed to parse 3D report data", e);
    }

    return entries
        .sort((a,b) => a[0].localeCompare(b[0]))
        .map(([number, amount]) => ({ number, amount: Number(amount) }));
  });


  weeklySummary = computed(() => this.calculateSummaryForPeriod('week'));
  monthlySummary = computed(() => this.calculateSummaryForPeriod('month'));
  yearlySummary = computed(() => this.calculateSummaryForPeriod('year'));

  summaryCurrencySymbol = computed(() => {
    const reports = this.allReports();
    if (reports.length > 0) {
        return reports[0].currencySymbol || 'K';
    }
    return 'K';
  });

  ngOnInit(): void {
    this.loadReports();
  }
  
  private async loadReports(): Promise<void> {
    try {
        const reports = await this.persistenceService.getAllReports();
        if (!reports) {
            this.allReports.set([]);
            return;
        }
        // Safe sorting that handles invalid dates
        reports.sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            // If date is invalid, treat as older (0 or min value)
            const valA = isNaN(dateA) ? 0 : dateA;
            const valB = isNaN(dateB) ? 0 : dateB;
            return valB - valA;
        });
        this.allReports.set(reports);
    } catch (error) {
        console.error("Error loading reports:", error);
        this.statusMessage.set("မှတ်တမ်းများ ရှာဖွေရာတွင် အမှားအယွင်းရှိပါသည်။");
    }
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

    const relevantReports = reports.filter(r => {
        const d = new Date(r.date);
        return !isNaN(d.getTime()) && d >= startDate;
    });
    
    return relevantReports.reduce((acc, report) => {
      acc.sales += Number(report.totalBetAmount) || 0;
      acc.net += Number(report.netAmount as any) || 0;
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
  
  onRestore(): void {
      const report = this.selectedReport();
      if (report) {
          this.restore.emit(report);
      }
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
    if (!isoString) return '-';
    try {
        const d = new Date(isoString);
        return isNaN(d.getTime()) ? isoString : d.toLocaleDateString('en-CA');
    } catch {
        return isoString;
    }
  }
}
