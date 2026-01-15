import { Component, ChangeDetectionStrategy, signal, computed, effect, inject, ViewChild, ElementRef, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LicenseService } from '../../services/license.service';
import { PersistenceService } from '../../services/persistence.service';
import { BetParsingService } from '../../services/bet-parsing.service';
import { ReportViewerComponent } from '../report-viewer/report-viewer.component';
import { UserGuideComponent } from '../user-guide/user-guide.component';
import { ForwardingModalComponent, Assignments } from '../forwarding-modal/forwarding-modal.component';
import { Agent, UpperBookie, Report, GridCell, BetDetail } from '../../models/app.models';
import { SummaryCardComponent } from '../summary-card/summary-card.component';

// --- Interfaces ---
interface Bet { number: string; amount: number; }
interface HistoryEntry { id: string; input: string; source: string; }
interface AcceptedSubmission { agent: string; content: string; timestamp: Date; total: number; }
interface PayoutDetails {
  winningNumber: string;
  totalHeldBet: number;
  totalPayout: number;
  agentPayouts: { name: string; payout: number; betAmount: number }[];
}
interface AgentWithPerformance extends Agent {
  totalSales: number;
}
type OverLimitListItem = { number: string; overLimitAmount: number };
interface ProfitOptimizerSuggestion {
  topNumbers: GridCell[];
  suggestedHoldingIncrease: number;
  potentialProfitIncrease: number;
}

@Component({
  selector: 'app-code-analyzer',
  templateUrl: './code-analyzer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ReportViewerComponent, UserGuideComponent, ForwardingModalComponent, SummaryCardComponent],
  host: {
    '(window:keydown)': 'handleKeyboardEvents($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)'
  }
})
export class CodeAnalyzerComponent implements OnInit {
  licenseService = inject(LicenseService);
  persistenceService = inject(PersistenceService);
  betParsingService = inject(BetParsingService);

  // --- Child Elements ---
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('mainBetInput') mainBetInput!: ElementRef<HTMLTextAreaElement>;


  // --- Core State ---
  modes = ['အေးဂျင့်', 'အလယ်ဒိုင်', 'ဒိုင်ကြီး'];
  activeMode = signal(this.modes[0]);
  session = signal<'morning' | 'evening'>('morning');
  betHistory = signal<HistoryEntry[]>([]);
  showReports = signal(false);
  showUserGuide = signal(false);
  showForwardingModal = signal(false);
  showClearAllConfirmation = signal(false);
  isOnline = signal(navigator.onLine);
  
  // --- Mode-Specific State ---
  bookieName = signal('My 2D');
  defaultLimit = signal(50000);
  payoutRate = signal(80);
  commissionToPay = signal(10); // Commission for agents below
  commissionFromUpperBookie = signal(10); // Commission from upper bookies
  userInput = signal('');
  currencies: Array<'K' | '฿' | '¥'> = ['K', '฿', '¥'];
  currencySymbol = signal<'K' | '฿' | '¥'>('K');
  
  // --- Relationship Management State ---
  upperBookies = signal<UpperBookie[]>([]);
  newUpperBookieName = signal('');
  newUpperBookieCommission = signal(10);
  
  individualLimits = signal<Map<string, number>>(new Map());
  
  agentCommissionFromBookie = signal(10);
  agentUpperBookies = signal<{name: string}[]>([]);
  newAgentUpperBookieName = signal('');

  // --- Workflow State ---
  inboxInput = signal('');
  selectedAgentForInbox = signal<string | null>(null);
  pendingInboxConfirmation = signal<{ 
    safeBets: Bet[];
    overLimitBets: Bet[];
    agent: string;
    originalInput: string;
  } | null>(null);
  acceptedSubmissions = signal<AcceptedSubmission[]>([]);

  showPayoutModal = signal(false);
  winningNumber = signal('');
  payoutDetails = signal<PayoutDetails | null>(null);
  
  pendingSubmissions = signal<string[]>([]);
  showSubmissionModal = signal(false);
  submissionText = signal('');
  
  agents = signal<Agent[]>([]);
  newAgentName = signal('');
  newAgentCommission = signal(5);
  agentSortBy = signal<'name' | 'sales'>('sales');
  
  forwardingAssignments = signal<Assignments | null>(null);
  acknowledgedOverLimits = signal<Map<string, number>>(new Map()); // For Main Bookie & Forwardable list in Middle Bookie
  
  // --- State for Middle Bookie Over-Limit Management ---
  rejectedOverLimits = signal<Set<string>>(new Set<string>()); // Numbers the upper bookie rejected
  acknowledgedHeldOverLimits = signal<Map<string, number>>(new Map()); // For the held list in Middle Bookie

  // --- Bet Detail Editing State ---
  showBetDetailModal = signal(false);
  selectedNumberForDetail = signal<string | null>(null);

  // --- Messaging State ---
  confirmationMessage = signal('');
  statusMessage = signal('');
  
  // --- Profit Optimizer State ---
  profitOptimizerSuggestion = signal<ProfitOptimizerSuggestion | null>(null);
  suggestionAppliedRecently = signal(false);


  // --- Computed Signals (Logic) ---
  lotteryData = computed<Map<string, BetDetail[]>>(() => {
    const data = new Map<string, BetDetail[]>();
    const history = this.betHistory();
    for (const entry of history) {
      const parsedAmounts = this.betParsingService.parse(entry.input);
      parsedAmounts.forEach((amount, number) => {
        const existingBets = data.get(number) || [];
        const newBet: BetDetail = { id: crypto.randomUUID(), amount, source: entry.source, historyEntryId: entry.id };
        data.set(number, [...existingBets, newBet]);
      });
    }
    return data;
  });

  // --- Computed Signals (UI) ---
  recentHistory = computed(() => this.betHistory().slice(-20).reverse());

  gridCells = computed<GridCell[]>(() => {
    const data = this.lotteryData();
    const cells: GridCell[] = [];
    const isAgentMode = this.activeMode() === 'အေးဂျင့်';
    const currentIndLimits = this.individualLimits();
    const currentDefLimit = this.defaultLimit();

    for (let i = 0; i < 100; i++) {
      const numberStr = i.toString().padStart(2, '0');
      const breakdown = data.get(numberStr) || [];
      const amount = breakdown.reduce((sum, bet) => sum + bet.amount, 0);
      const limit = (this.activeMode() === 'ဒိုင်ကြီး' || this.activeMode() === 'အလယ်ဒိုင်') && currentIndLimits.has(numberStr)
        ? currentIndLimits.get(numberStr)!
        : currentDefLimit;
      
      const isOverLimit = amount > limit;
      const overLimitAmount = isOverLimit ? amount - limit : 0;

      const amounts = breakdown.map(b => b.amount);
      const betsString = isAgentMode
        ? amounts.join(', ')
        : (amounts.length > 0 ? `(${amounts.join(', ')})` : '');
      
      const betsTooltip = breakdown.map(b => `${b.source}: ${b.amount}`).join('; ');

      cells.push({ number: numberStr, amount, isOverLimit, breakdown, betsString, betsTooltip, overLimitAmount, limit });
    }
    return cells;
  });

  totalBetAmount = computed<number>(() => this.gridCells().reduce((sum, cell) => sum + cell.amount, 0));
  overLimitCells = computed(() => this.gridCells().filter(cell => cell.isOverLimit));

  betsForDetailModal = computed<BetDetail[]>(() => {
    const selectedNumber = this.selectedNumberForDetail();
    if (!selectedNumber) return [];
    return this.lotteryData().get(selectedNumber) || [];
  });

  // --- New Over-Limit List Computations ---
  forwardableOverLimitNumbers = computed<OverLimitListItem[]>(() => {
      if (this.activeMode() !== 'အလယ်ဒိုင်') return [];
      const allForwardable = this.overLimitCells().filter(cell => !this.rejectedOverLimits().has(cell.number));
      return this.filterAcknowledged(allForwardable, this.acknowledgedOverLimits());
  });

  heldOverLimitNumbers = computed<OverLimitListItem[]>(() => {
      if (this.activeMode() !== 'အလယ်ဒိုင်') return [];
      const allHeld = this.overLimitCells().filter(cell => this.rejectedOverLimits().has(cell.number));
      return this.filterAcknowledged(allHeld, this.acknowledgedHeldOverLimits());
  });
  
  // For 'ဒိုင်ကြီး' mode
  displayedOverLimitNumbers = computed<OverLimitListItem[]>(() => {
      if (this.activeMode() !== 'ဒိုင်ကြီး') return [];
      return this.filterAcknowledged(this.overLimitCells(), this.acknowledgedOverLimits());
  });

  private filterAcknowledged(list: GridCell[], acknowledgedMap: Map<string, number>): OverLimitListItem[] {
      const displayed: OverLimitListItem[] = [];
      for (const cell of list) {
          const acknowledgedAmount = acknowledgedMap.get(cell.number);
          if (acknowledgedAmount !== undefined) {
              const newOverLimitPortion = cell.overLimitAmount - acknowledgedAmount;
              if (newOverLimitPortion > 0) {
                  displayed.push({ number: cell.number, overLimitAmount: newOverLimitPortion });
              }
          } else {
              displayed.push({ number: cell.number, overLimitAmount: cell.overLimitAmount });
          }
      }
      return displayed;
  }

  // --- Financial Computations ---
  totalOverLimitAmount = computed<number>(() => this.overLimitCells().reduce((sum, cell) => sum + cell.overLimitAmount, 0));

  forwardableOverLimitAmount = computed<number>(() => {
    if (this.activeMode() !== 'အလယ်ဒိုင်') return 0;
    return this.overLimitCells()
        .filter(cell => !this.rejectedOverLimits().has(cell.number))
        .reduce((sum, cell) => sum + cell.overLimitAmount, 0);
  });
  
  totalHeldAmount = computed<number>(() => {
    const totalSales = this.totalBetAmount();
    if (this.activeMode() === 'အလယ်ဒိုင်') {
        return totalSales - this.forwardableOverLimitAmount();
    }
    return totalSales - this.totalOverLimitAmount();
  });
  
  payableCommissionAmount = computed<number>(() => this.totalHeldAmount() * (this.commissionToPay() / 100));
  
  receivableCommissionAmount = computed<number>(() => {
    if (this.activeMode() !== 'အလယ်ဒိုင်') return 0;
    return this.forwardableOverLimitAmount() * (this.commissionFromUpperBookie() / 100);
  });
  
  agentCommissionEarned = computed<number>(() => this.totalBetAmount() * (this.agentCommissionFromBookie() / 100));
  
  netAmount = computed<number>(() => {
    switch (this.activeMode()) {
      case 'အလယ်ဒိုင်':
        return this.totalHeldAmount() - this.payableCommissionAmount() + this.receivableCommissionAmount();
      case 'ဒိုင်ကြီး':
        return this.totalHeldAmount() - this.payableCommissionAmount();
      case 'အေးဂျင့်':
        return this.agentCommissionEarned();
      default: return 0;
    }
  });

  agentsWithPerformance = computed<AgentWithPerformance[]>(() => {
    const salesMap = new Map<string, number>();
    this.lotteryData().forEach(bets => {
      bets.forEach(bet => {
        salesMap.set(bet.source, (salesMap.get(bet.source) || 0) + bet.amount);
      });
    });
    const agents = this.agents().map(agent => ({ ...agent, totalSales: salesMap.get(agent.name) || 0 }));
    agents.sort((a, b) => this.agentSortBy() === 'sales' ? b.totalSales - a.totalSales : a.name.localeCompare(b.name));
    return agents;
  });
  
  overLimitForModal = computed(() => {
    return this.overLimitCells().map(n => ({ number: n.number, amount: n.overLimitAmount })).filter(n => n.amount > 0);
  });

  isInboxSubmitDisabled = computed(() => {
    const input = this.inboxInput();
    if (!input.trim()) return true;
    if (this.selectedAgentForInbox()) return false;
  
    const agentLineMatch = input.match(/^Agent\s*:\s*(.+)/im);
    if (agentLineMatch) return false;
  
    const lines = input.split(/\r?\n/);
    const firstLineTrimmed = lines.find(l => l.trim() !== '')?.trim();
    if (firstLineTrimmed && !firstLineTrimmed.toLowerCase().startsWith('agent') && firstLineTrimmed.includes(':')) {
        return false;
    }
    
    return true;
  });

  overLimitConfirmationText = computed(() => {
    const confirmation = this.pendingInboxConfirmation();
    if (!confirmation) {
      return '';
    }
    return confirmation.overLimitBets.map(b => `${b.number}=${b.amount}`).join(', ');
  });

  top10OverLimitCells = computed<GridCell[]>(() => {
    return this.overLimitCells()
      .sort((a, b) => b.overLimitAmount - a.overLimitAmount)
      .slice(0, 10);
  });

  constructor() {
    window.addEventListener('online', () => this.isOnline.set(true));
    window.addEventListener('offline', () => this.isOnline.set(false));
      
    effect(() => this.persistenceService.set('lottery_agents', this.agents()));
    effect(() => this.persistenceService.set('lottery_upper_bookies', this.upperBookies()));
    effect(() => this.persistenceService.set('lottery_agent_upper_bookies', this.agentUpperBookies()));
    effect(() => this.persistenceService.set('lottery_currency', this.currencySymbol()));
    effect(() => this.persistenceService.set('lottery_bookieName', this.bookieName()));
    effect(() => this.persistenceService.set('lottery_defaultLimit', this.defaultLimit()));
    effect(() => this.persistenceService.set('lottery_payoutRate', this.payoutRate()));
    effect(() => this.persistenceService.set('lottery_commissionToPay', this.commissionToPay()));
    effect(() => this.persistenceService.set('lottery_commissionFromUpperBookie', this.commissionFromUpperBookie()));
    effect(() => this.persistenceService.set('lottery_agentCommissionFromBookie', this.agentCommissionFromBookie()));
    
    effect(() => {
      if (this.agents().length > 0 && !this.agents().some(a => a.name === this.selectedAgentForInbox())) {
        this.selectedAgentForInbox.set(this.agents()[0].name);
      } else if (this.agents().length === 0) {
        this.selectedAgentForInbox.set(null);
      }
    });

    // Profit Optimizer Suggestion Effect
    effect(() => {
      const topNumbers = this.top10OverLimitCells();
      const mode = this.activeMode();
  
      if (topNumbers.length === 0 || mode === 'အေးဂျင့်') {
        this.profitOptimizerSuggestion.set(null);
        return;
      }
  
      const totalOverLimitOfTop10 = topNumbers.reduce((sum, cell) => sum + cell.overLimitAmount, 0);
      const averageOverLimit = totalOverLimitOfTop10 / topNumbers.length;
      
      const baseSuggestion = averageOverLimit * 0.25;
      let suggestedHoldingIncrease = 0;

      // Create a "nice" rounded number for the suggestion, and avoid tiny suggestions.
      if (baseSuggestion > 10000) {
        suggestedHoldingIncrease = Math.round(baseSuggestion / 1000) * 1000;
      } else if (baseSuggestion > 1000) {
        suggestedHoldingIncrease = Math.round(baseSuggestion / 100) * 100;
      } else if (baseSuggestion > 100) {
        suggestedHoldingIncrease = Math.round(baseSuggestion / 50) * 50;
      } else {
        // The potential increase is too small to make a suggestion.
        this.profitOptimizerSuggestion.set(null);
        return;
      }

      if (suggestedHoldingIncrease <= 0) {
        this.profitOptimizerSuggestion.set(null);
        return;
      }
      
      let potentialProfitIncrease = 0;
      const commToPay = this.commissionToPay();
      const commFromUpper = this.commissionFromUpperBookie();

      for (const cell of topNumbers) {
        const extraHeldAmount = Math.min(cell.overLimitAmount, suggestedHoldingIncrease);
        if (mode === 'အလယ်ဒိုင်') {
          // For Middle Bookie, profit = extraHeldAmount - (commission to agent) - (lost commission from upper bookie)
          potentialProfitIncrease += extraHeldAmount * (1 - (commToPay / 100) - (commFromUpper / 100));
        } else { // 'ဒိုင်ကြီး'
          // For Main Bookie, profit = extraHeldAmount - (commission to agent)
          potentialProfitIncrease += extraHeldAmount * (1 - (commToPay / 100));
        }
      }
      
      if (potentialProfitIncrease <= 0) {
        this.profitOptimizerSuggestion.set(null);
        return;
      }
  
      this.profitOptimizerSuggestion.set({
        topNumbers,
        suggestedHoldingIncrease,
        potentialProfitIncrease,
      });
      // Reset the 'applied' state whenever the suggestion re-calculates
      this.suggestionAppliedRecently.set(false);
    });
  }

  async ngOnInit(): Promise<void> {
    const [
        agents, upperBookies, agentUpperBookies, currency,
        bookieName, defaultLimit, payoutRate, commissionToPay,
        commissionFromUpperBookie, agentCommissionFromBookie
    ] = await Promise.all([
      this.persistenceService.get<Agent[]>('lottery_agents'),
      this.persistenceService.get<UpperBookie[]>('lottery_upper_bookies'),
      this.persistenceService.get<{name: string}[]>('lottery_agent_upper_bookies'),
      this.persistenceService.get<'K' | '฿' | '¥'>('lottery_currency'),
      this.persistenceService.get<string>('lottery_bookieName'),
      this.persistenceService.get<number>('lottery_defaultLimit'),
      this.persistenceService.get<number>('lottery_payoutRate'),
      this.persistenceService.get<number>('lottery_commissionToPay'),
      this.persistenceService.get<number>('lottery_commissionFromUpperBookie'),
      this.persistenceService.get<number>('lottery_agentCommissionFromBookie'),
    ]);
    if (agents) this.agents.set(agents);
    if (upperBookies) this.upperBookies.set(upperBookies);
    if (agentUpperBookies) this.agentUpperBookies.set(agentUpperBookies);
    if (currency) this.currencySymbol.set(currency);
    if (bookieName !== null) this.bookieName.set(bookieName);
    if (defaultLimit !== null) this.defaultLimit.set(Number(defaultLimit));
    if (payoutRate !== null) this.payoutRate.set(Number(payoutRate));
    if (commissionToPay !== null) this.commissionToPay.set(Number(commissionToPay));
    if (commissionFromUpperBookie !== null) this.commissionFromUpperBookie.set(Number(commissionFromUpperBookie));
    if (agentCommissionFromBookie !== null) this.agentCommissionFromBookie.set(Number(agentCommissionFromBookie));
  }

  handleKeyboardEvents(event: KeyboardEvent) {
    if (this.showReports() || this.showUserGuide() || this.showForwardingModal() || this.showSubmissionModal() || this.showPayoutModal() || this.showBetDetailModal()) return;
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && target.id !== 'main-bet-input') return;

    if (event.altKey) {
      event.preventDefault();
      switch (event.key.toLowerCase()) {
        case 'c': this.clearAllBets(); break;
        case 'z': this.undoLastBet(); break;
        case 's': this.saveReport(); break;
        case 'm': this.setSession(this.session() === 'morning' ? 'evening' : 'morning'); break;
        case '1': this.setActiveMode(this.modes[0]); break;
        case '2': this.setActiveMode(this.modes[1]); break;
        case '3': this.setActiveMode(this.modes[2]); break;
        case 'b': this.backupData(); break;
        case 'r': this.fileInput.nativeElement.click(); break;
        case 'p': if (this.activeMode() !== 'အေးဂျင့်') this.openPayoutModal(); break;
      }
    }
  }

  onBeforeUnload(event: BeforeUnloadEvent) {
    if (this.betHistory().length > 0) {
      event.preventDefault();
      event.returnValue = true;
    }
  }

  onInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.addBetsFromInput();
    }
  }

  setActiveMode(mode: string): void { this.activeMode.set(mode); }
  setSession(session: 'morning' | 'evening'): void { this.session.set(session); }
  toggleReports(): void { this.showReports.update(v => !v); }

  addBetsFromInput(): void {
    const input = this.userInput().trim();
    if (!input) return;

    const source = this.activeMode() === 'အေးဂျင့်' ? this.bookieName() : 'Direct Input';
    if (this.addBetsToHistory(input, source)) {
      if (this.activeMode() === 'အေးဂျင့်') {
        this.pendingSubmissions.update(s => [...s, input]);
      }
      this.userInput.set('');
    }
  }

  private addBetsToHistory(input: string, source: string): boolean {
    const parsedAmounts = this.betParsingService.parse(input);
    if (parsedAmounts.size === 0) return false;

    const newEntry: HistoryEntry = {
        id: crypto.randomUUID(),
        input,
        source
    };
    this.betHistory.update(history => [...history, newEntry]);
    return true;
  }
  
  clearAllBets(): void {
    if (this.betHistory().length === 0) {
      this.statusMessage.set('ဖျက်ရန် စာရင်းများမရှိသေးပါ။');
      setTimeout(() => this.statusMessage.set(''), 3000);
      return;
    }
    this.showClearAllConfirmation.set(true);
  }

  confirmClearAll(): void {
    this.betHistory.set([]);
    this.userInput.set('');
    this.inboxInput.set('');
    this.confirmationMessage.set('');
    this.submissionText.set('');
    this.pendingSubmissions.set([]);
    this.acceptedSubmissions.set([]);
    this.forwardingAssignments.set(null);
    this.acknowledgedOverLimits.set(new Map());
    this.rejectedOverLimits.set(new Set());
    this.acknowledgedHeldOverLimits.set(new Map());
    this.individualLimits.set(new Map());
    this.showClearAllConfirmation.set(false);
    this.profitOptimizerSuggestion.set(null);
    this.statusMessage.set('စာရင်းအားလုံးကို အောင်မြင်စွာ ဖျက်လိုက်ပါပြီ။');
    setTimeout(() => this.statusMessage.set(''), 3000);
  }

  undoLastBet(): void {
    this.betHistory.update(history => {
      if (history.length === 0) return history;
      const newHistory = [...history];
      const lastEntry = newHistory.pop()!;

      if (this.activeMode() === 'အေးဂျင့်' && lastEntry.source === this.bookieName()) {
        this.pendingSubmissions.update(submissions => {
          const index = submissions.lastIndexOf(lastEntry.input);
          if (index > -1) submissions.splice(index, 1);
          return [...submissions];
        });
      }
      return newHistory;
    });
  }

  deleteHistoryEntry(idToDelete: string): void {
    const entryToDelete = this.betHistory().find(h => h.id === idToDelete);
    if (!entryToDelete) return;

    this.betHistory.update(history => history.filter(entry => entry.id !== idToDelete));
    
    if (this.activeMode() === 'အေးဂျင့်' && entryToDelete.source === this.bookieName()) {
      this.pendingSubmissions.update(submissions => {
        const index = submissions.indexOf(entryToDelete.input);
        if (index > -1) submissions.splice(index, 1);
        return [...submissions];
      });
    }
  }

  editHistoryEntry(entryToEdit: HistoryEntry): void {
    this.userInput.set(entryToEdit.input);
    this.deleteHistoryEntry(entryToEdit.id);
    this.mainBetInput.nativeElement.focus();
  }

  addAgent() {
    const name = this.newAgentName().trim();
    const commission = this.newAgentCommission();
    if (name && commission >= 0 && !this.agents().some(a => a.name === name)) {
      this.agents.update(a => [...a, { name, commission }]);
      this.newAgentName.set('');
    }
  }
  removeAgent(agentNameToRemove: string) { this.agents.update(a => a.filter(agent => agent.name !== agentNameToRemove)); }
  
  addUpperBookie() {
    const name = this.newUpperBookieName().trim();
    const commission = this.newUpperBookieCommission();
    if (name && commission >= 0 && !this.upperBookies().some(b => b.name === name)) {
      this.upperBookies.update(b => [...b, { name, commission }]);
      this.newUpperBookieName.set('');
    }
  }
  removeUpperBookie(bookieNameToRemove: string) { this.upperBookies.update(b => b.filter(bookie => bookie.name !== bookieNameToRemove)); }
  
  addAgentUpperBookie() {
    const name = this.newAgentUpperBookieName().trim();
    if (name && !this.agentUpperBookies().some(b => b.name === name)) {
      this.agentUpperBookies.update(b => [...b, { name }]);
      this.newAgentUpperBookieName.set('');
    }
  }
  removeAgentUpperBookie(bookieNameToRemove: string) { this.agentUpperBookies.update(b => b.filter(bookie => bookie.name !== bookieNameToRemove)); }

  openLimitModal(number: string) {
    if (this.activeMode() === 'အေးဂျင့်') return;
    const currentLimit = this.individualLimits().get(number) || this.defaultLimit();
    const newLimit = prompt(`ဂဏန်း ${number} အတွက် သီးသန့်လစ်မစ် သတ်မှတ်ပါ:`, currentLimit.toString());
    if (newLimit !== null && !isNaN(parseInt(newLimit))) {
      this.individualLimits.update(limits => new Map(limits).set(number, parseInt(newLimit)));
    }
  }

  addBetsFromInbox(): void {
    let input = this.inboxInput().trim();
    if (!input) return;

    let agentToUse: string | null = null;
    let finalInputForParsing = input;

    const agentLineMatch = input.match(/^Agent\s*:\s*(.+)/im);
    if (agentLineMatch && agentLineMatch[1]) {
        const potentialAgentName = agentLineMatch[1].trim();
        const foundAgent = this.agents().find(a => a.name.toLowerCase() === potentialAgentName.toLowerCase());
        if (foundAgent) {
            agentToUse = foundAgent.name;
        } else {
            this.statusMessage.set(`"${potentialAgentName}" အမည်ဖြင့် အေးဂျင့် မတွေ့ရှိပါ။`);
            setTimeout(() => this.statusMessage.set(''), 4000);
            return;
        }
    } 
    else {
        const lines = input.split(/\r?\n/);
        const firstLineTrimmed = lines.find(l => l.trim() !== '')?.trim();
        if (firstLineTrimmed && !firstLineTrimmed.toLowerCase().startsWith('agent')) {
            const nameColonMatch = firstLineTrimmed.match(/^(.+?)\s*[:>]/);
            if (nameColonMatch && nameColonMatch[1]) {
                const potentialAgentName = nameColonMatch[1].trim();
                const foundAgent = this.agents().find(a => a.name.toLowerCase() === potentialAgentName.toLowerCase());
                if (foundAgent) {
                    agentToUse = foundAgent.name;
                    const firstLineIndex = lines.findIndex(l => l.trim() === firstLineTrimmed);
                    finalInputForParsing = lines.slice(firstLineIndex + 1).join('\n');
                }
            }
        }
    }

    const finalAgent = agentToUse || this.selectedAgentForInbox();

    if (!finalAgent) {
        this.statusMessage.set(`ကျေးဇူးပြု၍ အေးဂျင့်တစ်ဦးကို ရွေးချယ်ပါ သို့မဟုတ် စာရင်း၏ထိပ်တွင် Agent အမည်ကို ထည့်သွင်းပါ။`);
        setTimeout(() => this.statusMessage.set(''), 4000);
        return;
    }
    
    if (agentToUse) {
        this.statusMessage.set(`${finalAgent} ကို အလိုအလျောက် ရွေးချယ်ပြီးပါပြီ။`);
        setTimeout(() => this.statusMessage.set(''), 3000);
    }

    const agent = finalAgent;
    const newAmounts = this.betParsingService.parse(finalInputForParsing);
    if (newAmounts.size === 0) {
        this.statusMessage.set('ထည့်သွင်းရန် စာရင်းများမတွေ့ရှိပါ။');
        setTimeout(() => this.statusMessage.set(''), 3000);
        return;
    }

    const safeBets: Bet[] = [];
    const overLimitBets: Bet[] = [];

    newAmounts.forEach((amount, number) => {
        const currentAmount = (this.lotteryData().get(number) || []).reduce((sum, bet) => sum + bet.amount, 0);
        const limit = this.individualLimits().get(number) || this.defaultLimit();
        if (currentAmount + amount > limit) {
            overLimitBets.push({ number, amount });
        } else {
            safeBets.push({ number, amount });
        }
    });

    if (overLimitBets.length === 0) {
        if (this.addBetsToHistory(finalInputForParsing, agent)) {
            const totalAmount = Array.from(newAmounts.values()).reduce((a, b) => a + b, 0);
            this.confirmationMessage.set(`${agent} ၏စာရင်း စုစုပေါင်း ${totalAmount.toLocaleString()} ${this.currencySymbol()} အားလုံးကို လက်ခံရရှိပါသည်။`);
            const cleanContent = Array.from(newAmounts.entries()).map(([num, amt]) => `${num} ${amt}`).join('\n');
            this.acceptedSubmissions.update(s => [...s, { agent, content: cleanContent, timestamp: new Date(), total: totalAmount }]);
        }
        this.inboxInput.set('');
    } else {
        this.pendingInboxConfirmation.set({ safeBets, overLimitBets, agent, originalInput: finalInputForParsing });
        this.inboxInput.set('');
        this.confirmationMessage.set('');
    }
  }

  acceptAllFromInbox(): void {
    const confirmation = this.pendingInboxConfirmation();
    if (!confirmation) return;

    const allBets = [...confirmation.safeBets, ...confirmation.overLimitBets];
    const totalAmount = allBets.reduce((sum, b) => sum + b.amount, 0);
    
    if (this.addBetsToHistory(confirmation.originalInput, confirmation.agent)) {
        const overLimitNumbersStr = confirmation.overLimitBets.map(b => b.number).join(', ');
        this.confirmationMessage.set(`${confirmation.agent} ၏စာရင်း စုစုပေါင်း ${totalAmount.toLocaleString()} ${this.currencySymbol()} လက်ခံရရှိပါသည်။ သတိပြုရန်: ${overLimitNumbersStr} တို့သည် လစ်မစ်ကျော်ပါသည်။`);
    }
    this.pendingInboxConfirmation.set(null);
  }

  acceptSafeOnlyFromInbox(): void {
    const confirmation = this.pendingInboxConfirmation();
    if (!confirmation) return;
  
    const safeBetsMap = new Map<string, number>();
    confirmation.safeBets.forEach(bet => safeBetsMap.set(bet.number, (safeBetsMap.get(bet.number) || 0) + bet.amount));
    const safeBetsString = Array.from(safeBetsMap.entries()).map(([num, amt]) => `${num} ${amt}`).join('\n');
  
    if (safeBetsString) {
      if (this.addBetsToHistory(safeBetsString, confirmation.agent)) {
        const totalAcceptedAmount = confirmation.safeBets.reduce((sum, b) => sum + b.amount, 0);
        const rejectedStr = confirmation.overLimitBets.map(b => `${b.number}=${b.amount}`).join(', ');
        this.confirmationMessage.set(`${confirmation.agent} ၏စာရင်းမှ ${totalAcceptedAmount.toLocaleString()} ${this.currencySymbol()} လက်ခံရရှိပါသည်။ လစ်မစ်ကျော်သောကြောင့် (${rejectedStr}) တို့ကို လက်မခံပါ။`);
      }
    } else {
      const rejectedStr = confirmation.overLimitBets.map(b => `${b.number}=${b.amount}`).join(', ');
      this.confirmationMessage.set(`${confirmation.agent} ၏စာရင်းကို လက်မခံပါ။ (${rejectedStr}) တို့သည် လစ်မစ်ကျော်နေပါသည်။`);
    }
    this.pendingInboxConfirmation.set(null);
  }

  cancelInboxConfirmation(): void {
    const confirmation = this.pendingInboxConfirmation();
    if(confirmation) {
      this.inboxInput.set(confirmation.originalInput);
    }
    this.pendingInboxConfirmation.set(null);
    this.confirmationMessage.set('');
  }

  openSubmissionModal() {
    if (this.pendingSubmissions().length === 0) {
      this.statusMessage.set('ပို့ရန်စာရင်း မရှိသေးပါ။');
      setTimeout(() => this.statusMessage.set(''), 3000);
      return;
    }
    const content = this.pendingSubmissions().join('\n');
    const subTotal = Array.from(this.betParsingService.parse(content).values()).reduce((a, b) => a + b, 0);
    this.submissionText.set(`Agent: ${this.bookieName()}\nSession: ${this.session()}\n---------------------------------\n${content}\n---------------------------------\nSub-Total: ${subTotal.toLocaleString()} ${this.currencySymbol()}`);
    this.showSubmissionModal.set(true);
  }

  clearSubmissions() {
    this.pendingSubmissions.set([]);
    this.showSubmissionModal.set(false);
    this.submissionText.set('');
    this.statusMessage.set('စာရင်းကို အောင်မြင်စွာ ပို့ပြီးပါပြီ။ Pending list ကိုရှင်းလင်းပြီးပါပြီ။');
    setTimeout(() => this.statusMessage.set(''), 3000);
  }
  
  openPayoutModal() { this.showPayoutModal.set(true); this.payoutDetails.set(null); this.winningNumber.set(''); }
  
  calculatePayout() {
    const num = this.winningNumber().trim();
    if (num.length !== 2 || isNaN(parseInt(num))) { alert('ကျေးဇူးပြု၍ ဂဏန်း ၂ လုံးကို မှန်ကန်စွာထည့်ပါ။'); return; }
    
    const cell = this.gridCells().find(c => c.number === num);
    if (!cell) { this.payoutDetails.set({ winningNumber: num, totalHeldBet: 0, totalPayout: 0, agentPayouts: [] }); return; }

    const totalHeldBet = cell.amount - cell.overLimitAmount;
    const totalPayout = totalHeldBet * this.payoutRate();
    
    const agentPayouts = this.agents().map(agent => {
      const agentBetAmount = cell.breakdown.filter(b => b.source === agent.name).reduce((sum, b) => sum + b.amount, 0);
      return { name: agent.name, betAmount: agentBetAmount, payout: agentBetAmount * this.payoutRate() };
    }).filter(p => p.payout > 0);
    
    this.payoutDetails.set({ winningNumber: num, totalHeldBet, totalPayout, agentPayouts });
  }

  printPayout() { window.print(); }

  handleForwardingUpdate(assignments: Assignments | null): void {
    if (assignments) {
      this.forwardingAssignments.set(assignments);
    }
    this.showForwardingModal.set(false);
  }

  async saveReport(): Promise<void> {
    if (this.lotteryData().size === 0) {
      this.statusMessage.set('မှတ်တမ်းတင်ရန် စာရင်းများမရှိသေးပါ။');
      setTimeout(() => this.statusMessage.set(''), 3000);
      return;
    }

    try {
        const report: Report = {
            id: `report_${new Date().toISOString()}_${this.activeMode()}_${this.session()}`,
            date: new Date().toISOString(),
            session: this.session(),
            mode: this.activeMode(),
            totalBetAmount: this.totalBetAmount(),
            totalOverLimitAmount: this.totalOverLimitAmount(),
            totalHeldAmount: this.totalHeldAmount(),
            payableCommissionAmount: this.payableCommissionAmount(),
            receivableCommissionAmount: this.receivableCommissionAmount(),
            agentCommissionEarned: this.agentCommissionEarned(),
            netAmount: this.netAmount(),
            lotteryData: Array.from(this.lotteryData().entries()).map(([key, value]) => {
                const totalAmount = value.reduce((sum, bet) => sum + bet.amount, 0);
                return [key, totalAmount];
            }),
            betHistory: this.betHistory().map(h => h.input),
            bookieName: this.bookieName(),
            defaultLimit: this.defaultLimit(),
            payoutRate: this.payoutRate(),
            commissionToPay: this.commissionToPay(),
            agentCommissionFromBookie: this.agentCommissionFromBookie(),
            commissionFromUpperBookie: this.commissionFromUpperBookie(),
            individualLimits: Array.from(this.individualLimits().entries()),
            upperBookies: this.upperBookies(),
            agents: this.agents(),
            currencySymbol: this.currencySymbol(),
        };
        await this.persistenceService.saveReport(report);
        this.statusMessage.set('မှတ်တမ်းကို အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။');
        setTimeout(() => this.statusMessage.set(''), 3000);
    } catch (error) {
        console.error("Failed to save report:", error);
        this.statusMessage.set('မှတ်တမ်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်။');
    }
  }

  copyToClipboard(text: string) { if(text) navigator.clipboard.writeText(text); }
  
  copyConfirmationAndClear(): void {
    const msg = this.confirmationMessage();
    if (msg) {
      this.copyToClipboard(msg);
      this.confirmationMessage.set('');
    }
  }

  share(text: string) { if (navigator.share) navigator.share({ text }); else { this.copyToClipboard(text); alert('Copied to clipboard!'); } }

  async backupData(): Promise<void> {
    try {
        const backupData = await this.persistenceService.getAllDataForBackup();
        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
        a.href = url;
        a.download = `future2d_backup_${timestamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.statusMessage.set('Backup ဖိုင်ကို အောင်မြင်စွာ ဒေါင်းလုဒ်လုပ်ပြီးပါပြီ။');
    } catch (error) {
        console.error("Backup failed:", error);
        this.statusMessage.set('Backup ပြုလုပ်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်။');
    } finally {
        setTimeout(() => this.statusMessage.set(''), 3000);
    }
  }

  handleRestore(event: Event): void {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      if (!confirm('Restore ပြုလုပ်ပါက လက်ရှိဒေတာအားလုံး ပျက်စီးပြီး Backup ဖိုင်ထဲမှ ဒေတာများဖြင့် အစားထိုးသွားမည်ဖြစ်သည်။ ရှေ့ဆက်လိုပါသလား?')) {
          (event.target as HTMLInputElement).value = '';
          return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
          try {
              const content = e.target?.result as string;
              const backupData = JSON.parse(content);
              await this.persistenceService.restoreAllData(backupData);
              alert('Restore အောင်မြင်ပါသည်။ App ကို ပြန်လည်စတင်ပါမည်။');
              window.location.reload();
          } catch (err) {
              alert('Restore မအောင်မြင်ပါ။ Backup ဖိုင် format မှားယွင်းနေပါသည်။');
          }
      };
      reader.onerror = () => {
          alert('Restore မအောင်မြင်ပါ။ Backup ဖိုင်ကို ဖတ်မရပါ။');
      };
      reader.readAsText(file);
      (event.target as HTMLInputElement).value = '';
  }

  logout() { this.licenseService.logout(); }
  setAgentSort(sortBy: 'name' | 'sales') { this.agentSortBy.set(sortBy); }

  // --- Over-limit Management Methods ---
  rejectOverLimit(number: string): void {
    const cell = this.gridCells().find(c => c.number === number);
    if (!cell) return;

    const currentAckForward = this.acknowledgedOverLimits().get(number) || 0;
    const displayedForwardableAmount = cell.overLimitAmount - currentAckForward;
    
    if (displayedForwardableAmount <= 0) return;

    this.rejectedOverLimits.update(set => new Set(set).add(number));
    
    this.acknowledgedOverLimits.update(map => new Map(map).set(number, cell.overLimitAmount));
    
    this.acknowledgedHeldOverLimits.update(map => new Map(map).set(number, currentAckForward));
  }

  reforwardOverLimit(number: string): void {
      const cell = this.gridCells().find(c => c.number === number);
      if (!cell) return;

      const currentAckHeld = this.acknowledgedHeldOverLimits().get(number) || 0;
      const displayedHeldAmount = cell.overLimitAmount - currentAckHeld;

      if(displayedHeldAmount <= 0) return;

      this.rejectedOverLimits.update(set => {
          const newSet = new Set(set);
          newSet.delete(number);
          return newSet;
      });
      
      this.acknowledgedHeldOverLimits.update(map => new Map(map).set(number, cell.overLimitAmount));
      this.acknowledgedOverLimits.update(map => new Map(map).set(number, currentAckHeld));
  }

  private acknowledgeList(list: OverLimitListItem[], mapToUpdate: (cb: (currentMap: Map<string, number>) => Map<string, number>) => void, title: string): void {
      if (this.profitOptimizerSuggestion() && !this.suggestionAppliedRecently()) {
        if (!confirm('လက်ရှိတွင် အတည်မပြုရသေးသော အမြတ်အစွန်းအကြံပြုချက်တစ်ခု ရှိနေပါသည်။ လက်ရှိ Limit အဟောင်းဖြင့်သာ စာရင်းကူးရန် သေချာပါသလား?')) {
          return;
        }
      }

      if (list.length === 0) return;

      const fullText = this.formatOverLimitForCopy(list, title);
      navigator.clipboard.writeText(fullText);

      const allOver = this.overLimitCells();
      mapToUpdate(currentMap => {
          const newMap = new Map(currentMap);
          list.forEach(displayedCell => {
              const totalOverLimitCell = allOver.find(c => c.number === displayedCell.number);
              if (totalOverLimitCell) {
                  newMap.set(displayedCell.number, totalOverLimitCell.overLimitAmount);
              }
          });
          return newMap;
      });

      this.statusMessage.set(`${title} ကာသီးစာရင်းကို ကူးယူပြီး ယာယီဖျောက်ထားလိုက်ပါပြီ။`);
      setTimeout(() => this.statusMessage.set(''), 3000);
  }

  acknowledgeAllForwardableOverLimits(): void {
      this.acknowledgeList(this.forwardableOverLimitNumbers(), (cb) => this.acknowledgedOverLimits.update(cb), 'အပေါ်ဒိုင်သို့ပို့ရန်');
  }

  acknowledgeAllHeldOverLimits(): void {
      this.acknowledgeList(this.heldOverLimitNumbers(), (cb) => this.acknowledgedHeldOverLimits.update(cb), 'ကိုယ်တိုင်ကိုင်');
  }

  acknowledgeMainBookieOverLimits(): void {
      this.acknowledgeList(this.displayedOverLimitNumbers(), (cb) => this.acknowledgedOverLimits.update(cb), 'လစ်မစ်ကျော်');
  }
  
  formatDate(isoString: string): string {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString('en-CA');
  }

  applyProfitSuggestion(): void {
    const suggestion = this.profitOptimizerSuggestion();
    if (!suggestion) return;
  
    const newLimit = this.defaultLimit() + suggestion.suggestedHoldingIncrease;
    this.defaultLimit.set(newLimit);
  
    this.suggestionAppliedRecently.set(true);
    this.statusMessage.set('Default Limit ကို အကြံပြုချက်အတိုင်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။');
    setTimeout(() => this.statusMessage.set(''), 3000);
  }
  
  dismissProfitSuggestion(): void {
    this.profitOptimizerSuggestion.set(null);
    this.suggestionAppliedRecently.set(false);
  }

  showSuggestionPanelAgain(): void {
    this.suggestionAppliedRecently.set(false);
  }

  private formatOverLimitForCopy(list: OverLimitListItem[], title: string): string {
      const name = this.bookieName() || 'စာရင်း';
      const date = new Date().toLocaleDateString('en-CA');
      const session = this.session() === 'morning' ? 'မနက်ပိုင်း' : 'ညနေပိုင်း';
      const totalCount = list.length;
      const totalAmount = list.reduce((sum, cell) => sum + cell.overLimitAmount, 0);

      let fullText = `--- ${name} ---\n`;
      fullText += `နေ့စွဲ: ${date} (${session})\n`;
      fullText += `--------------------\n`;
      
      const chunks: string[][] = [];
      const chunkSize = 10;
      for (let i = 0; i < totalCount; i += chunkSize) {
          const chunk = list.slice(i, i + chunkSize);
          const chunkContent = chunk.map(cell => `${cell.number} = ${cell.overLimitAmount.toLocaleString()}`);
          chunks.push(chunkContent);
      }
      
      fullText += chunks.map(chunk => chunk.join('\n')).join('\n--------------------\n');

      fullText += `\n--------------------\n`;
      fullText += `စုစုပေါင်း (${totalCount}) ကွက်: ${totalAmount.toLocaleString()} ${this.currencySymbol()}`;

      return fullText.trim();
  }

  // --- Bet Detail Modal Methods ---
  openBetDetailModal(number: string): void {
    if ((this.lotteryData().get(number) || []).length === 0) return;
    this.selectedNumberForDetail.set(number);
    this.showBetDetailModal.set(true);
  }

  closeBetDetailModal(): void {
    this.showBetDetailModal.set(false);
    this.selectedNumberForDetail.set(null);
  }

  editBetFromDetail(betToEdit: BetDetail): void {
    const historyEntry = this.betHistory().find(h => h.id === betToEdit.historyEntryId);
    if (historyEntry) {
        this.editHistoryEntry(historyEntry);
    }
    this.closeBetDetailModal();
  }

  deleteBetFromDetail(betToDelete: BetDetail): void {
    const historyEntry = this.betHistory().find(h => h.id === betToDelete.historyEntryId);
    if (historyEntry) {
        if (confirm(`"${historyEntry.input}" ဟူသော စာရင်းတစ်ခုလုံးကို ဖျက်ရန် သေချာပါသလား?`)) {
            this.deleteHistoryEntry(historyEntry.id);
        }
    }
    this.closeBetDetailModal();
  }
}
