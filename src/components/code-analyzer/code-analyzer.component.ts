import { Component, ChangeDetectionStrategy, signal, computed, effect, inject, ViewChild, ElementRef, OnInit, WritableSignal } from '@angular/core';
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
type LotteryType = '2D' | '3D';
interface Bet { number: string; amount: number; }
interface HistoryEntry { id: string; input: string; source: string; mode?: string; rawBets?: Bet[]; } // Added rawBets to store structured data if needed, though we re-parse for now
interface AcceptedSubmission { agent: string; content: string; timestamp: Date; total: number; }

interface PayoutDetails {
  winningNumber: string;
  totalBet: number;          // Total amount received on this number
  totalHeldBet: number;      // Amount kept (Within Limit)
  totalHeldPayout: number;   // Payout for kept amount
  totalOverLimitBet: number; // Amount over limit (Kathi)
  totalOverLimitPayout: number; // Payout for over limit amount
  // Updated: Now includes individualBets array for breakdown display
  agentPayouts: { name: string; payout: number; betAmount: number; individualBets: number[] }[];
  otherPayouts: { name: string; payout: number; betAmount: number; individualBets: number[] }[]; 
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
interface InboxResult {
  agent: string;
  totalAccepted: number;
  rejectedText?: string; // If any bets were rejected (safe only mode)
  isAllAccepted: boolean;
}

// Interface for Voucher Data
interface VoucherData {
  items: { number: string; amount: number }[];
  totalAmount: number;
  totalCount: number;
  date: string;
  time: string;
  currency: string;
}

interface AppState {
    betHistory: HistoryEntry[];
    defaultLimit: number;
    payoutRate: number;
    commissionToPay: number;
    commissionFromUpperBookie: number;
    agentCommissionFromBookie: number;
    individualLimits: Map<string, number>;
    // bookieName removed, replaced with specific names per mode
    myAgentName: string;
    agentProfiles: string[]; // List of agent names for the Agent Mode
    myMiddleBookieName: string;
    myMainBookieName: string;
    session?: 'morning' | 'evening';
    drawDate?: string;
    userInput: string;
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
  lotteryType = signal<LotteryType>('2D');
  modes = ['အေးဂျင့်', 'အလယ်ဒိုင်', 'ဒိုင်ကြီး'];
  activeMode = signal(this.modes[0]);
  
  appState = signal<Record<LotteryType, AppState>>({
    '2D': this.createInitialState('2D'),
    '3D': this.createInitialState('3D')
  });

  showReports = signal(false);
  showUserGuide = signal(false);
  showClearAllConfirmation = signal(false);
  isOnline = signal(navigator.onLine);
  currencies: Array<'K' | '฿' | '¥'> = ['K', '฿', '¥'];
  currencySymbol = signal<'K' | '฿' | '¥'>('K');
  
  // --- Relationship Management State (Shared) ---
  upperBookies = signal<UpperBookie[]>([]);
  newUpperBookieName = signal('');
  newUpperBookieCommission = signal(10);
  
  agentUpperBookies = signal<{name: string}[]>([]);
  newAgentUpperBookieName = signal('');
  
  // -- Agent State (Separated by Mode) --
  middleBookieAgents = signal<Agent[]>([]);
  mainBookieAgents = signal<Agent[]>([]);
  
  // Computed 'agents' signal to return the correct list based on activeMode
  agents = computed(() => {
      if (this.activeMode() === 'အလယ်ဒိုင်') return this.middleBookieAgents();
      if (this.activeMode() === 'ဒိုင်ကြီး') return this.mainBookieAgents();
      return []; // Agents don't manage sub-agents usually
  });

  newAgentName = signal('');
  newAgentCommission = signal(5);
  agentSortBy = signal<'name' | 'sales'>('sales');

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
  lastInboxResult = signal<InboxResult | null>(null); // For generating the reply voucher

  showPayoutModal = signal(false);
  winningNumber = signal('');
  payoutDetails = signal<PayoutDetails | null>(null);
  
  pendingSubmissions = signal<string[]>([]);
  showSubmissionModal = signal(false);
  submissionText = signal('');
  
  // --- Voucher Modal State ---
  showVoucherModal = signal(false);
  voucherData = signal<VoucherData | null>(null);

  acknowledgedOverLimits = signal<Map<string, number>>(new Map());
  
  // --- State for Middle Bookie Over-Limit Management ---
  rejectedOverLimits = signal<Set<string>>(new Set<string>());
  acknowledgedHeldOverLimits = signal<Map<string, number>>(new Map());
  isForwardingModalOpen = signal(false);

  // --- Bet Detail Editing State ---
  showBetDetailModal = signal(false);
  selectedNumberForDetail = signal<string | null>(null);

  // --- Limit Management State ---
  showLimitManagementModal = signal(false);
  limitManageNumber = signal('');
  limitManageAmount = signal<number>(0);

  // --- Messaging State ---
  confirmationMessage = signal('');
  statusMessage = signal('');
  
  // --- Profit Optimizer State ---
  profitOptimizerSuggestion = signal<ProfitOptimizerSuggestion | null>(null);
  suggestionAppliedRecently = signal(false);

  // --- 3D Specific State ---
  search3DTerm = signal('');

  // --- Proxy Computed Signals for Active State ---
  betHistory = computed(() => this.appState()[this.lotteryType()].betHistory);
  defaultLimit = computed(() => this.appState()[this.lotteryType()].defaultLimit);
  payoutRate = computed(() => this.appState()[this.lotteryType()].payoutRate);
  commissionToPay = computed(() => this.appState()[this.lotteryType()].commissionToPay);
  commissionFromUpperBookie = computed(() => this.appState()[this.lotteryType()].commissionFromUpperBookie);
  agentCommissionFromBookie = computed(() => this.appState()[this.lotteryType()].agentCommissionFromBookie);
  individualLimits = computed(() => this.appState()[this.lotteryType()].individualLimits);
  
  // Dynamic name based on active mode
  bookieName = computed(() => {
      const state = this.appState()[this.lotteryType()];
      switch (this.activeMode()) {
          case 'အေးဂျင့်': return state.myAgentName;
          case 'အလယ်ဒိုင်': return state.myMiddleBookieName;
          case 'ဒိုင်ကြီး': return state.myMainBookieName;
          default: return state.myMainBookieName;
      }
  });

  agentProfiles = computed(() => this.appState()[this.lotteryType()].agentProfiles || []);

  session = computed(() => this.appState()['2D'].session!);
  drawDate = computed(() => this.appState()['3D'].drawDate!);
  userInput = computed(() => this.appState()[this.lotteryType()].userInput);

  // --- Computed Signals (Logic) ---
  lotteryData = computed<Map<string, BetDetail[]>>(() => {
    const data = new Map<string, BetDetail[]>();
    // Filter history based strictly on active Mode
    const currentMode = this.activeMode();
    
    const history = this.betHistory().filter(h => {
        // Legacy data (undefined mode) is treated as 'ဒိုင်ကြီး'
        const entryMode = h.mode || 'ဒိုင်ကြီး';
        // Strict equality: 'အေးဂျင့်' sees only 'အေးဂျင့်', 'အလယ်ဒိုင်' sees only 'အလယ်ဒိုင်', etc.
        return entryMode === currentMode;
    });

    for (const entry of history) {
      // Changed to parseRaw to preserve individual bet entries
      const parsedBets = this.betParsingService.parseRaw(entry.input, this.lotteryType());
      parsedBets.forEach(bet => {
        const existingBets = data.get(bet.number) || [];
        const newBet: BetDetail = { id: crypto.randomUUID(), amount: bet.amount, source: entry.source, historyEntryId: entry.id };
        data.set(bet.number, [...existingBets, newBet]);
      });
    }
    return data;
  });

  // --- Computed Signals (UI) ---
  // Filter recent history strictly by mode for display as well
  recentHistory = computed(() => {
      const currentMode = this.activeMode();
      return this.betHistory()
        .filter(h => {
             const entryMode = h.mode || 'ဒိုင်ကြီး';
             return entryMode === currentMode;
        })
        .slice(-20)
        .reverse();
  });

  // 2D Grid
  gridCells = computed<GridCell[]>(() => {
    if (this.lotteryType() !== '2D') return [];
    const data = this.lotteryData();
    const cells: GridCell[] = [];
    const isAgentMode = this.activeMode() === 'အေးဂျင့်';
    const currentIndLimits = this.individualLimits();
    const currentDefLimit = this.defaultLimit();

    for (let i = 0; i < 100; i++) {
      const numberStr = i.toString().padStart(2, '0');
      const breakdown = data.get(numberStr) || [];
      const amount = breakdown.reduce((sum, bet) => sum + bet.amount, 0);
      
      const hasCustomLimit = (this.activeMode() === 'ဒိုင်ကြီး' || this.activeMode() === 'အလယ်ဒိုင်') && currentIndLimits.has(numberStr);
      const limit = hasCustomLimit ? currentIndLimits.get(numberStr)! : currentDefLimit;
      
      const isOverLimit = amount > limit;
      const overLimitAmount = isOverLimit ? amount - limit : 0;

      const amounts = breakdown.map(b => b.amount);
      const betsString = isAgentMode
        ? amounts.join(', ')
        : (amounts.length > 0 ? `(${amounts.join(', ')})` : '');
      
      const betsTooltip = breakdown.map(b => `${b.source}: ${b.amount}`).join('; ');

      cells.push({ number: numberStr, amount, isOverLimit, hasCustomLimit, breakdown, betsString, betsTooltip, overLimitAmount, limit });
    }
    return cells;
  });

  // 3D List
  listItems = computed<GridCell[]>(() => {
      if (this.lotteryType() !== '3D') return [];
      const data = this.lotteryData();
      const items: GridCell[] = [];
      const currentIndLimits = this.individualLimits();
      const currentDefLimit = this.defaultLimit();

      for (const [numberStr, breakdown] of data.entries()) {
          const amount = breakdown.reduce((sum, bet) => sum + bet.amount, 0);
          if (amount === 0) continue;
          
          const hasCustomLimit = (this.activeMode() === 'ဒိုင်ကြီး' || this.activeMode() === 'အလယ်ဒိုင်') && currentIndLimits.has(numberStr);
          const limit = hasCustomLimit ? currentIndLimits.get(numberStr)! : currentDefLimit;

          const isOverLimit = amount > limit;
          const overLimitAmount = isOverLimit ? amount - limit : 0;
          const amounts = breakdown.map(b => b.amount);
          const betsString = amounts.length > 0 ? `(${amounts.join(', ')})` : '';
          const betsTooltip = breakdown.map(b => `${b.source}: ${b.amount}`).join('; ');
          
          items.push({ number: numberStr, amount, isOverLimit, hasCustomLimit, breakdown, betsString, betsTooltip, overLimitAmount, limit });
      }
      return items.sort((a, b) => a.number.localeCompare(b.number));
  });

  filteredListItems = computed(() => {
      const term = this.search3DTerm().toLowerCase();
      if (!term) return this.listItems();
      return this.listItems().filter(item => item.number.includes(term));
  });
  
  customLimitsList = computed(() => {
      const limits = this.individualLimits();
      return Array.from(limits.entries())
        .map(([number, limit]) => ({ number, limit }))
        .sort((a, b) => a.number.localeCompare(b.number));
  });

  totalBetAmount = computed<number>(() => {
    const data = this.lotteryType() === '2D' ? this.gridCells() : this.listItems();
    return data.reduce((sum, cell) => sum + cell.amount, 0);
  });

  overLimitCells = computed(() => {
    const data = this.lotteryType() === '2D' ? this.gridCells() : this.listItems();
    return data.filter(cell => cell.isOverLimit)
  });

  betsForDetailModal = computed<BetDetail[]>(() => {
    const selectedNumber = this.selectedNumberForDetail();
    if (!selectedNumber) return [];
    return this.lotteryData().get(selectedNumber) || [];
  });

  // --- New Over-Limit List Computations ---
  private filterAcknowledged(list: GridCell[], acknowledgedMap: Map<string, number>): OverLimitListItem[] {
      const displayed: OverLimitListItem[] = [];
      for (const cell of list) {
          const acknowledgedAmount = acknowledgedMap.get(cell.number) || 0;
          const newOverLimitPortion = cell.overLimitAmount - acknowledgedAmount;
          if (newOverLimitPortion > 0) {
              displayed.push({ number: cell.number, overLimitAmount: newOverLimitPortion });
          }
      }
      return displayed;
  }
  
  displayedOverLimitNumbers = computed<OverLimitListItem[]>(() => {
    if (this.activeMode() === 'အေးဂျင့်') return [];
    return this.filterAcknowledged(this.overLimitCells(), this.acknowledgedOverLimits());
  });

  forwardableOverLimitNumbers = computed<OverLimitListItem[]>(() => {
      if (this.activeMode() !== 'အလယ်ဒိုင်') return [];
      const nonRejected = this.overLimitCells().filter(cell => !this.rejectedOverLimits().has(cell.number));
      return this.filterAcknowledged(nonRejected, this.acknowledgedOverLimits());
  });

  forwardableNumbersForModal = computed(() => {
    return this.forwardableOverLimitNumbers().map(item => ({ number: item.number, amount: item.overLimitAmount }));
  });

  heldOverLimitNumbers = computed<OverLimitListItem[]>(() => {
      if (this.activeMode() !== 'အလယ်ဒိုင်') return [];
      const rejected = this.overLimitCells().filter(cell => this.rejectedOverLimits().has(cell.number));
      return this.filterAcknowledged(rejected, this.acknowledgedHeldOverLimits());
  });

  // --- New Comma-Separated String Computations for Display ---
  commaSeparatedDisplayedOverLimits = computed(() => {
    return this.displayedOverLimitNumbers().map(item => `${item.number}=${item.overLimitAmount}`).join(',');
  });

  commaSeparatedForwardableOverLimits = computed(() => {
    return this.forwardableOverLimitNumbers().map(item => `${item.number}=${item.overLimitAmount}`).join(',');
  });

  commaSeparatedHeldOverLimits = computed(() => {
    return this.heldOverLimitNumbers().map(item => `${item.number}=${item.overLimitAmount}`).join(',');
  });
  
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
    // This relies on the computed 'agents' signal which is already filtered by mode
    const currentAgents = this.agents();
    const agents = currentAgents.map(agent => ({ ...agent, totalSales: salesMap.get(agent.name) || 0 }));
    agents.sort((a, b) => this.agentSortBy() === 'sales' ? b.totalSales - a.totalSales : a.name.localeCompare(b.name));
    return agents;
  });
  
  isInboxSubmitDisabled = computed(() => {
    const input = this.inboxInput();
    if (!input.trim()) return true;
    if (this.selectedAgentForInbox()) return false;
  
    const agentLineMatch = input.match(/^Agent\s*:\s*(.+)/im);
    if (agentLineMatch) return false;
    
    // Check for the new format: --- AgentName ---
    const newFormatMatch = input.match(/^---\s*(.+?)\s*---/m);
    if (newFormatMatch) return false;
  
    const lines = input.split(/\r?\n/);
    const firstLineTrimmed = lines.find(l => l.trim() !== '')?.trim();
    if (firstLineTrimmed && !firstLineTrimmed.toLowerCase().startsWith('agent') && firstLineTrimmed.includes(':')) {
        return false;
    }
    
    // If there is a first line that doesn't look like a bet, we allow it (auto-detect agent logic)
    if (firstLineTrimmed && !firstLineTrimmed.includes('=') && !/^\d+\s+\d+/.test(firstLineTrimmed)) {
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
  
  // --- Inbox Reply Text Generator ---
  inboxReplyText = computed(() => {
      const result = this.lastInboxResult();
      if (!result) return '';
      
      const header = `--- ${this.bookieName()} ---`;
      
      const today = new Date().toLocaleDateString('en-CA');
      let dateLine = `နေ့စွဲ: ${this.lotteryType() === '3D' ? this.formatDate(this.drawDate()) : today}`;
      if (this.lotteryType() === '2D') {
          const sessionText = this.session() === 'morning' ? 'မနက်ပိုင်း' : 'ညနေပိုင်း';
          dateLine += ` (${sessionText})`;
      }
      
      const agentLine = `Agent: ${result.agent}`;
      const separator = '--------------------';
      
      let statusBody = '';

      if (result.isAllAccepted) {
          statusBody = "စာရင်းအားလုံး လက်ခံရရှိပါသည်။";
      } else {
          statusBody = "လစ်မစ်ကျော် ဂဏန်းများမှလွဲ၍ ကျန်စာရင်းများ လက်ခံရရှိပါသည်။\n\n(မရသော ဂဏန်းများ)\n" + (result.rejectedText || '-');
      }
      
      const totalLine = `စုစုပေါင်း လက်ခံငွေ: ${result.totalAccepted.toLocaleString()} ${this.currencySymbol()}`;
      const footer = "ကျေးဇူးတင်ပါသည်။";
      
      return `${header}\n${dateLine}\n${agentLine}\n${separator}\n${statusBody}\n${separator}\n${totalLine}\n${footer}`;
  });

  constructor() {
    window.addEventListener('online', () => this.isOnline.set(true));
    window.addEventListener('offline', () => this.isOnline.set(false));
      
    // --- Persistence Effects for Shared State ---
    // Update: Persist separate agent lists
    effect(() => this.persistenceService.set('lottery_agents_middle', this.middleBookieAgents()));
    effect(() => this.persistenceService.set('lottery_agents_main', this.mainBookieAgents()));
    
    effect(() => this.persistenceService.set('lottery_upper_bookies', this.upperBookies()));
    effect(() => this.persistenceService.set('lottery_agent_upper_bookies', this.agentUpperBookies()));
    effect(() => this.persistenceService.set('lottery_currency', this.currencySymbol()));

    // --- Persistence Effects for 2D/3D State ---
    effect(() => this.persistenceService.set('lottery_app_state_2d', this.appState()['2D']));
    effect(() => this.persistenceService.set('lottery_app_state_3d', this.appState()['3D']));
    
    // Auto-select agent logic updated to react to current 'agents' list
    effect(() => {
      const currentAgents = this.agents();
      if (currentAgents.length > 0 && !currentAgents.some(a => a.name === this.selectedAgentForInbox())) {
        this.selectedAgentForInbox.set(currentAgents[0].name);
      } else if (currentAgents.length === 0) {
        this.selectedAgentForInbox.set(null);
      }
    });

    // Profit Optimizer Suggestion Effect (Only for 2D)
    effect(() => {
      const topNumbers = this.top10OverLimitCells();
      const mode = this.activeMode();
      const type = this.lotteryType();
  
      if (topNumbers.length === 0 || mode === 'အေးဂျင့်' || type !== '2D') {
        this.profitOptimizerSuggestion.set(null);
        return;
      }
  
      const totalOverLimitOfTop10 = topNumbers.reduce((sum, cell) => sum + cell.overLimitAmount, 0);
      const averageOverLimit = totalOverLimitOfTop10 / topNumbers.length;
      
      const baseSuggestion = averageOverLimit * 0.25;
      let suggestedHoldingIncrease = 0;

      if (baseSuggestion > 10000) suggestedHoldingIncrease = Math.round(baseSuggestion / 1000) * 1000;
      else if (baseSuggestion > 1000) suggestedHoldingIncrease = Math.round(baseSuggestion / 100) * 100;
      else if (baseSuggestion > 100) suggestedHoldingIncrease = Math.round(baseSuggestion / 50) * 50;
      else { this.profitOptimizerSuggestion.set(null); return; }

      if (suggestedHoldingIncrease <= 0) { this.profitOptimizerSuggestion.set(null); return; }
      
      let potentialProfitIncrease = 0;
      const commToPay = this.commissionToPay();
      const commFromUpper = this.commissionFromUpperBookie();

      for (const cell of topNumbers) {
        const extraHeldAmount = Math.min(cell.overLimitAmount, suggestedHoldingIncrease);
        if (mode === 'အလယ်ဒိုင်') potentialProfitIncrease += extraHeldAmount * (1 - (commToPay / 100) - (commFromUpper / 100));
        else potentialProfitIncrease += extraHeldAmount * (1 - (commToPay / 100));
      }
      
      if (potentialProfitIncrease <= 0) { this.profitOptimizerSuggestion.set(null); return; }
  
      this.profitOptimizerSuggestion.set({ topNumbers, suggestedHoldingIncrease, potentialProfitIncrease });
      this.suggestionAppliedRecently.set(false);
    });
  }

  async ngOnInit(): Promise<void> {
    // Load Shared State
    const [legacyAgents, midAgents, mainAgents, upperBookies, agentUpperBookies, currency] = await Promise.all([
      this.persistenceService.get<Agent[]>('lottery_agents'), // Legacy key for fallback
      this.persistenceService.get<Agent[]>('lottery_agents_middle'),
      this.persistenceService.get<Agent[]>('lottery_agents_main'),
      this.persistenceService.get<UpperBookie[]>('lottery_upper_bookies'),
      this.persistenceService.get<{name: string}[]>('lottery_agent_upper_bookies'),
      this.persistenceService.get<'K' | '฿' | '¥'>('lottery_currency'),
    ]);

    if (midAgents) this.middleBookieAgents.set(midAgents);
    
    // Logic: Use mainAgents if exists, otherwise fallback to legacy agents to keep data for existing users
    if (mainAgents) {
        this.mainBookieAgents.set(mainAgents);
    } else if (legacyAgents) {
        this.mainBookieAgents.set(legacyAgents);
    }

    if (upperBookies) this.upperBookies.set(upperBookies);
    if (agentUpperBookies) this.agentUpperBookies.set(agentUpperBookies);
    if (currency) this.currencySymbol.set(currency);

    // Load 2D/3D State
    const storedState2D = await this.persistenceService.get<AppState>('lottery_app_state_2d');
    const storedState3D = await this.persistenceService.get<AppState>('lottery_app_state_3d');
    
    this.appState.update(current => ({
      '2D': this.mergeState(current['2D'], storedState2D),
      '3D': this.mergeState(current['3D'], storedState3D)
    }));
  }

  private createInitialState(type: LotteryType): AppState {
    const today = new Date().toISOString().split('T')[0];
    const defaultName = type === '2D' ? 'My 2D' : 'My 3D';
    return {
      betHistory: [],
      defaultLimit: type === '2D' ? 50000 : 500000,
      payoutRate: type === '2D' ? 80 : 500,
      commissionToPay: 10,
      commissionFromUpperBookie: 10,
      agentCommissionFromBookie: 10,
      individualLimits: new Map<string, number>(),
      myAgentName: defaultName + ' Agent',
      agentProfiles: [defaultName + ' Agent'],
      myMiddleBookieName: defaultName + ' Middle',
      myMainBookieName: defaultName + ' Main',
      session: 'morning',
      drawDate: today,
      userInput: '',
    };
  }

  private mergeState(initial: AppState, stored?: AppState | null): AppState {
    if (!stored) return initial;
    // Handle migration: If stored state has legacy 'bookieName', we might want to preserve it
    // by assigning it to the relevant fields if they are empty or default.
    // For now, we prefer the structure of the new state but keep stored values.
    const legacyName = (stored as any).bookieName;
    const currentName = (stored as any).myAgentName || legacyName || initial.myAgentName;
    
    // Ensure agentProfiles is initialized correctly and includes the current name
    let profiles = (stored as any).agentProfiles;
    if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
        profiles = [currentName];
    } else if (!profiles.includes(currentName)) {
        profiles = [...profiles, currentName];
    }
    
    return {
      ...initial,
      ...stored,
      individualLimits: new Map(stored.individualLimits),
      // Ensure new name fields are populated if coming from old version
      myAgentName: currentName,
      agentProfiles: profiles,
      myMiddleBookieName: (stored as any).myMiddleBookieName || legacyName || initial.myMiddleBookieName,
      myMainBookieName: (stored as any).myMainBookieName || legacyName || initial.myMainBookieName,
    };
  }
  
  updateCurrentState(key: keyof AppState, value: any): void {
      const type = this.lotteryType();
      this.appState.update(current => ({
        ...current,
        [type]: {
          ...current[type],
          [key]: value
        }
      }));
  }

  updateBookieName(name: string) {
      const mode = this.activeMode();
      let key: keyof AppState;
      if (mode === 'အေးဂျင့်') key = 'myAgentName';
      else if (mode === 'အလယ်ဒိုင်') key = 'myMiddleBookieName';
      else key = 'myMainBookieName';
      
      this.updateCurrentState(key, name);
  }

  onProfileSelect(event: Event) {
      const select = event.target as HTMLSelectElement;
      const name = select.value;
      if (name) {
          this.updateBookieName(name);
          // Reset select to default so the same profile can be re-selected if needed (visual reset)
          select.value = '';
      }
  }

  addAgentProfile() {
      const currentName = this.bookieName().trim();
      
      if (currentName) {
          const type = this.lotteryType();
          this.appState.update(current => {
              const profiles = current[type].agentProfiles || [];
              if (profiles.includes(currentName)) {
                  this.statusMessage.set("ဤအမည်ရှိပြီးသားဖြစ်ပါသည်။");
                  setTimeout(() => this.statusMessage.set(""), 2000);
                  return current;
              }
              this.statusMessage.set(`'${currentName}' ကို Profile စာရင်းတွင် သိမ်းဆည်းလိုက်ပါသည်။`);
              setTimeout(() => this.statusMessage.set(""), 2000);
              return {
                  ...current,
                  [type]: {
                      ...current[type],
                      agentProfiles: [...profiles, currentName]
                  }
              };
          });
      } else {
          this.statusMessage.set("အမည်ရိုက်ထည့်ပါ");
          setTimeout(() => this.statusMessage.set(""), 2000);
      }
  }

  removeAgentProfile() {
      const currentName = this.bookieName();
      const profiles = this.agentProfiles();
      
      if (profiles.length <= 1) {
          alert("အနည်းဆုံး အမည်တစ်ခု ကျန်ရှိနေရပါမည်။");
          return;
      }
      
      if (confirm(`'${currentName}' ကို Profile စာရင်းမှ ဖျက်ရန် သေချာပါသလား?`)) {
           const type = this.lotteryType();
           this.appState.update(current => {
              const newProfiles = profiles.filter(p => p !== currentName);
              
              // If the current name was removed, switch to the first available one to avoid phantom state
              let nextName = current[type].myAgentName;
              if (nextName === currentName) {
                  nextName = newProfiles[0];
              }

              return {
                  ...current,
                  [type]: {
                      ...current[type],
                      agentProfiles: newProfiles,
                      myAgentName: nextName
                  }
              };
           });
           this.statusMessage.set("ဖျက်ပြီးပါပြီ။");
           setTimeout(() => this.statusMessage.set(""), 2000);
      }
  }

  handleKeyboardEvents(event: KeyboardEvent) {
    if (this.showReports() || this.showUserGuide() || this.showSubmissionModal() || this.showPayoutModal() || this.showBetDetailModal() || this.isForwardingModalOpen() || this.showLimitManagementModal()) return;
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && target.id !== 'main-bet-input') return;

    if (event.altKey) {
      event.preventDefault();
      switch (event.key.toLowerCase()) {
        case 'c': this.clearAllBets(); break;
        case 'z': this.undoLastBet(); break;
        case 's': this.saveReport(); break;
        case 'm': if (this.lotteryType() === '2D') this.setSession(this.session() === 'morning' ? 'evening' : 'morning'); break;
        case '1': this.setActiveMode(this.modes[0]); break;
        case '2': this.setActiveMode(this.modes[1]); break;
        case '3': this.setActiveMode(this.modes[2]); break;
        case 'b': this.backupData(); break;
        case 'r': this.fileInput.nativeElement.click(); break;
        case 'p': if (this.activeMode() !== 'အေးဂျင့်') this.openPayoutModal(); break;
        case 'd': this.setLotteryType(this.lotteryType() === '2D' ? '3D' : '2D'); break;
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

  setLotteryType(type: LotteryType) { this.lotteryType.set(type); }
  setActiveMode(mode: string): void { this.activeMode.set(mode); }
  setSession(session: 'morning' | 'evening'): void {
    this.appState.update(current => ({
      ...current,
      '2D': {
        ...current['2D'],
        session: session
      }
    }));
  }
  toggleReports(): void { this.showReports.update(v => !v); }

  addBetsFromInput(): void {
    const input = this.userInput().trim();
    if (!input) return;

    const source = this.activeMode() === 'အေးဂျင့်' ? this.bookieName() : 'Direct Input';
    if (this.addBetsToHistory(input, source)) {
      if (this.activeMode() === 'အေးဂျင့်') {
        this.pendingSubmissions.update(s => [...s, input]);
      }
      this.updateCurrentState('userInput', '');
    }
  }

  private addBetsToHistory(input: string, source: string): boolean {
    // UPDATED: Use parseRaw to ensure individual bets are preserved
    const parsedBets = this.betParsingService.parseRaw(input, this.lotteryType());
    if (parsedBets.length === 0) return false;

    // IMPORTANT: Tag the history entry with the active mode so we can filter it later
    const newEntry: HistoryEntry = { 
        id: crypto.randomUUID(), 
        input, 
        source,
        mode: this.activeMode() 
    };
    
    const type = this.lotteryType();
    this.appState.update(current => ({
      ...current,
      [type]: {
        ...current[type],
        betHistory: [...current[type].betHistory, newEntry]
      }
    }));
    return true;
  }
  
  clearAllBets(): void {
    if (this.recentHistory().length === 0) {
      this.statusMessage.set('ဖျက်ရန် စာရင်းများမရှိသေးပါ။');
      setTimeout(() => this.statusMessage.set(''), 3000);
      return;
    }
    this.showClearAllConfirmation.set(true);
  }

  confirmClearAll(): void {
    const type = this.lotteryType();
    const currentMode = this.activeMode();

    this.appState.update(current => {
      // Filter out history that belongs to the current mode view
      // Keep history that belongs to other modes
      const currentHistory = current[type].betHistory;
      const retainedHistory = currentHistory.filter(h => {
          const entryMode = h.mode || 'ဒိုင်ကြီး'; // default legacy to Bookie
          // Strict segregation: Only remove items belonging to current mode
          return entryMode !== currentMode;
      });

      return {
        ...current,
        [type]: {
          ...current[type],
          betHistory: retainedHistory,
          userInput: '',
          // Only clear limits if we are in a Bookie mode (optional, but requested to keep shared structure for now)
          // For now, we don't clear individual limits when clearing bets, as limits are settings.
          // individualLimits: current[type].individualLimits
        }
      };
    });

    // Clear auxiliary state
    this.inboxInput.set('');
    this.confirmationMessage.set('');
    this.submissionText.set('');
    
    // Clear pending submissions only if we are in agent mode
    if (currentMode === 'အေးဂျင့်') {
        this.pendingSubmissions.set([]);
    }
    
    // Clear Bookie specific transient state depending on mode
    if (currentMode === 'အလယ်ဒိုင်' || currentMode === 'ဒိုင်ကြီး') {
        this.acceptedSubmissions.set([]);
        this.acknowledgedOverLimits.set(new Map());
        this.rejectedOverLimits.set(new Set());
        this.acknowledgedHeldOverLimits.set(new Map());
    }

    this.showClearAllConfirmation.set(false);
    this.profitOptimizerSuggestion.set(null);
    this.lastInboxResult.set(null);
    this.statusMessage.set('စာရင်းအားလုံးကို အောင်မြင်စွာ ဖျက်လိုက်ပါပြီ။');
    setTimeout(() => this.statusMessage.set(''), 3000);
  }

  undoLastBet(): void {
    const type = this.lotteryType();
    const currentMode = this.activeMode();
    const history = this.appState()[type].betHistory;
    
    // Find the last entry index that matches the current mode strictly
    let indexToRemove = -1;
    for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i];
        const entryMode = h.mode || 'ဒိုင်ကြီး';
        if (entryMode === currentMode) {
            indexToRemove = i;
            break;
        }
    }

    if (indexToRemove === -1) return;
    
    const entryToDelete = history[indexToRemove];

    // Create new history array without that element
    const newHistory = [...history];
    newHistory.splice(indexToRemove, 1);

    this.appState.update(current => ({
      ...current,
      [type]: {
        ...current[type],
        betHistory: newHistory
      }
    }));
    
    if (this.activeMode() === 'အေးဂျင့်' && entryToDelete.source === this.bookieName()) {
      this.pendingSubmissions.update(submissions => {
        const index = submissions.lastIndexOf(entryToDelete.input);
        if (index > -1) {
          const newSubmissions = [...submissions];
          newSubmissions.splice(index, 1);
          return newSubmissions;
        }
        return submissions;
      });
    }
  }

  deleteHistoryEntry(idToDelete: string): void {
    const type = this.lotteryType();
    const entryToDelete = this.betHistory().find(h => h.id === idToDelete);
    if (!entryToDelete) return;

    this.appState.update(current => ({
      ...current,
      [type]: {
        ...current[type],
        betHistory: current[type].betHistory.filter(e => e.id !== idToDelete)
      }
    }));
    
    if (this.activeMode() === 'အေးဂျင့်' && entryToDelete.source === this.bookieName()) {
      this.pendingSubmissions.update(submissions => {
        const index = submissions.indexOf(entryToDelete.input);
        if (index > -1) {
          const newSubmissions = [...submissions];
          newSubmissions.splice(index, 1);
          return newSubmissions;
        }
        return submissions;
      });
    }
  }

  editHistoryEntry(entryToEdit: HistoryEntry): void {
    this.updateCurrentState('userInput', entryToEdit.input);
    this.deleteHistoryEntry(entryToEdit.id);
    this.mainBetInput.nativeElement.focus();
  }

  addAgent() {
    const name = this.newAgentName().trim();
    const commission = this.newAgentCommission();
    const mode = this.activeMode();

    if (name && commission >= 0) {
        if (mode === 'အလယ်ဒိုင်') {
            if (!this.middleBookieAgents().some(a => a.name === name)) {
                this.middleBookieAgents.update(a => [...a, { name, commission }]);
                this.newAgentName.set('');
            }
        } else if (mode === 'ဒိုင်ကြီး') {
            if (!this.mainBookieAgents().some(a => a.name === name)) {
                this.mainBookieAgents.update(a => [...a, { name, commission }]);
                this.newAgentName.set('');
            }
        }
    }
  }

  removeAgent(agentNameToRemove: string) { 
      const mode = this.activeMode();
      if (mode === 'အလယ်ဒိုင်') {
          this.middleBookieAgents.update(a => a.filter(agent => agent.name !== agentNameToRemove));
      } else if (mode === 'ဒိုင်ကြီး') {
          this.mainBookieAgents.update(a => a.filter(agent => agent.name !== agentNameToRemove));
      }
  }
  
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

  // --- Limit Management ---
  openLimitModal(number: string | null = null) {
    if (this.activeMode() === 'အေးဂျင့်') return;
    this.limitManageNumber.set(number || '');
    const currentLimit = number ? (this.individualLimits().get(number) || this.defaultLimit()) : this.defaultLimit();
    this.limitManageAmount.set(currentLimit);
    this.showLimitManagementModal.set(true);
  }

  saveIndividualLimit() {
    const number = this.limitManageNumber().trim();
    const limit = this.limitManageAmount();
    
    if (number && !isNaN(limit) && limit >= 0) {
      const type = this.lotteryType();
      this.appState.update(current => {
        const newLimits = new Map(current[type].individualLimits);
        newLimits.set(number, limit);
        return {
          ...current,
          [type]: {
            ...current[type],
            individualLimits: newLimits
          }
        };
      });
      if (!this.limitManageNumber()) {
          // If adding new from list view, keep modal open or clear input?
          // Let's clear to allow adding another
          this.limitManageNumber.set('');
          this.limitManageAmount.set(this.defaultLimit());
          this.statusMessage.set('လစ်မစ်သတ်မှတ်ပြီးပါပြီ။');
          setTimeout(() => this.statusMessage.set(''), 2000);
      } else {
        // If editing specific, close modal
        this.showLimitManagementModal.set(false);
      }
    } else {
        this.statusMessage.set('ကျေးဇူးပြု၍ ဂဏန်းနှင့် ပမာဏကို မှန်ကန်စွာထည့်ပါ။');
        setTimeout(() => this.statusMessage.set(''), 3000);
    }
  }

  removeIndividualLimit(number: string) {
      const type = this.lotteryType();
      this.appState.update(current => {
        const newLimits = new Map(current[type].individualLimits);
        newLimits.delete(number);
        return {
          ...current,
          [type]: {
            ...current[type],
            individualLimits: newLimits
          }
        };
      });
      if (this.limitManageNumber() === number) {
          this.showLimitManagementModal.set(false);
      }
  }

  closeLimitModal() {
    this.showLimitManagementModal.set(false);
    this.limitManageNumber.set('');
  }

  addBetsFromInbox(): void {
    let input = this.inboxInput().trim();
    if (!input) return;
    
    let agentName: string | null = this.selectedAgentForInbox();
    let betContent = input;

    // --- 1. DETECT AGENT NAME FROM CONTENT ---
    // Try to auto-detect if the user pasted a full message like "pp \n 13 = 200"
    const lines = input.split(/\r?\n/);
    const firstLine = lines[0].trim();
    
    // Check various formats: "--- Name ---", "Agent: Name", or just "Name"
    const dashMatch = firstLine.match(/^---\s*(.+?)\s*---$/);
    const colonMatch = firstLine.match(/^(?:Agent\s*:\s*)?([^:]+)$/i);
    
    let potentialName = '';
    if (dashMatch) {
      potentialName = dashMatch[1].trim();
    } else if (colonMatch) {
        // Heuristic: If the line doesn't have '=', and doesn't look like a standard bet (12 200)
        // we treat it as a name.
        if (!firstLine.includes('=') && !/^\d+\s+\d+/.test(firstLine)) {
            potentialName = firstLine.replace(/^Agent\s*:\s*/i, '').trim();
        }
    }

    if (potentialName) {
      // Logic: If we detected a potential name, we prefer it over "nothing selected".
      // We also update the UI to show this selection.
      
      // Check if it matches an existing agent
      if (this.agents().some(a => a.name === potentialName)) {
          agentName = potentialName;
          this.selectedAgentForInbox.set(potentialName); // Update UI dropdown
      } 
      // If it looks like a name (short enough) and we haven't selected one, assume it's a new agent
      else if (!agentName && potentialName.length < 20) {
          agentName = potentialName;
          this.selectedAgentForInbox.set(potentialName); // Update UI dropdown (will likely show as empty/custom until created)
      }
    }
    
    if (!agentName) {
        this.statusMessage.set('ကျေးဇူးပြု၍ Agent ကို ရွေးချယ်ပါ သို့မဟုတ် စာရင်းတွင် Agent အမည် ထည့်သွင်းပါ။');
        setTimeout(() => this.statusMessage.set(''), 3000);
        return;
    }
    
    const finalAgentName = agentName as string;

    // --- 2. STRIP AGENT NAME FROM CONTENT ---
    // If the content starts with the agent name, remove it to avoid parsing issues
    if (finalAgentName) {
        const escapedName = finalAgentName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const headerRegex = new RegExp(`^\\s*(?:---|Agent\\s*:)?\\s*${escapedName}\\s*(?:---)?\\s*(?:\\r?\\n|$)`, 'i');
        
        if (headerRegex.test(betContent)) {
            betContent = betContent.replace(headerRegex, '').trim();
        }
    }

    // Auto-create agent if they don't exist
    // Update logic: Check strictly against CURRENT mode's agent list
    const currentMode = this.activeMode();
    const currentAgentList = this.agents();
    
    if (!currentAgentList.some(a => a.name === finalAgentName)) {
      if (currentMode === 'အလယ်ဒိုင်') {
          this.middleBookieAgents.update(a => [...a, { name: finalAgentName, commission: 5 }]);
      } else if (currentMode === 'ဒိုင်ကြီး') {
          this.mainBookieAgents.update(a => [...a, { name: finalAgentName, commission: 5 }]);
      }
      this.statusMessage.set(`အေးဂျင့် '${finalAgentName}' ကို အလိုအလျောက် စာရင်းသွင်းလိုက်သည်။`);
    }
    
    // Use parseRaw to get array of bets sequentially
    const rawBets = this.betParsingService.parseRaw(betContent, this.lotteryType());
    
    if (rawBets.length === 0) {
        if (betContent.length > 20) {
            this.statusMessage.set('Format တွေ့သော်လည်း စာရင်းများမတွေ့ပါ။ 2D/3D Mode မှန်ကန်ကြောင်း စစ်ဆေးပါ။');
        } else {
            this.statusMessage.set('ထည့်သွင်းရန် မှန်ကန်သောစာရင်းများ မတွေ့ရှိပါ။');
        }
        setTimeout(() => this.statusMessage.set(''), 4000);
        return;
    }
    
    const safeBets: Bet[] = [];
    const overLimitBets: Bet[] = [];
    const currentData = this.lotteryData();
    const currentIndLimits = this.individualLimits();
    const currentDefLimit = this.defaultLimit();

    // Create a temporary map to track cumulative totals as we iterate through this batch
    // We start with the existing totals from the database
    const tempCurrentDataMap = new Map<string, number>();
    currentData.forEach((bets, number) => {
        const total = bets.reduce((sum, b) => sum + b.amount, 0);
        tempCurrentDataMap.set(number, total);
    });

    rawBets.forEach(bet => {
        const number = bet.number;
        const amount = bet.amount;
        
        const existingAmount = tempCurrentDataMap.get(number) || 0;
        const limit = currentIndLimits.get(number) ?? currentDefLimit;
        
        if (existingAmount >= limit) {
            // Already over limit, reject the full amount
            overLimitBets.push({ number, amount });
        } else if (existingAmount + amount > limit) {
            // Partially over limit
            const safeAmount = limit - existingAmount;
            const rejectedAmount = amount - safeAmount;
            
            if (safeAmount > 0) {
                safeBets.push({ number, amount: safeAmount });
            }
            if (rejectedAmount > 0) {
                overLimitBets.push({ number, amount: rejectedAmount });
            }
            // Update tracking map to the limit (since we filled it)
            tempCurrentDataMap.set(number, limit);
        } else {
            // Fully safe
            safeBets.push({ number, amount });
            tempCurrentDataMap.set(number, existingAmount + amount);
        }
    });

    if (overLimitBets.length > 0) {
        this.pendingInboxConfirmation.set({
            safeBets,
            overLimitBets,
            agent: finalAgentName,
            originalInput: betContent
        });
    } else {
        if (this.addBetsToHistory(betContent, finalAgentName)) {
            // For total amount, sum up raw bets
            const totalAmount = rawBets.reduce((sum, b) => sum + b.amount, 0);
            this.acceptedSubmissions.update(s => [...s, { agent: finalAgentName, content: betContent, timestamp: new Date(), total: totalAmount }]);
            this.inboxInput.set(''); // Explicitly clear input on success
            
            // Set success result for voucher
            this.lastInboxResult.set({
                agent: finalAgentName,
                totalAccepted: totalAmount,
                isAllAccepted: true
            });
            
            this.statusMessage.set(`'${finalAgentName}' ၏ စာရင်းကို အောင်မြင်စွာ လက်ခံပြီးပါပြီ။`);
            setTimeout(() => this.statusMessage.set(''), 3000);
        }
    }
  }

  acceptAllFromInbox(): void {
    const confirmation = this.pendingInboxConfirmation();
    if (!confirmation) return;

    if (this.addBetsToHistory(confirmation.originalInput, confirmation.agent)) {
      const totalAmount = [...confirmation.safeBets, ...confirmation.overLimitBets].reduce((sum: number, b: Bet) => sum + b.amount, 0);
      this.acceptedSubmissions.update(s => [...s, { agent: confirmation.agent, content: confirmation.originalInput, timestamp: new Date(), total: totalAmount }]);
      this.inboxInput.set('');
      
      this.lastInboxResult.set({
         agent: confirmation.agent,
         totalAccepted: totalAmount,
         isAllAccepted: true
      });

      this.statusMessage.set(`'${confirmation.agent}' ၏ စာရင်းအားလုံးကို အောင်မြင်စွာ လက်ခံပြီးပါပြီ။`);
      setTimeout(() => this.statusMessage.set(''), 3000);
    }
    this.cancelInboxConfirmation();
  }

  acceptSafeOnlyFromInbox(): void {
    const confirmation = this.pendingInboxConfirmation();
    if (!confirmation) return;

    // Use newline separator for cleaner history
    const safeBetsString = confirmation.safeBets.map(b => `${b.number} ${b.amount}`).join('\n');
    let safeTotal = 0;

    // Add safe bets to history if any exist
    if (safeBetsString) {
        if (this.addBetsToHistory(safeBetsString, confirmation.agent)) {
            safeTotal = confirmation.safeBets.reduce((sum: number, b: Bet) => sum + b.amount, 0);
            this.acceptedSubmissions.update(s => [...s, { agent: confirmation.agent, content: safeBetsString, timestamp: new Date(), total: safeTotal }]);
        }
    }

    // Always generate a result voucher, even if totalAccepted is 0 (all rejected)
    const overLimitText = confirmation.overLimitBets.map(b => `${b.number}=${b.amount}`).join(', ');
    
    this.lastInboxResult.set({
        agent: confirmation.agent,
        totalAccepted: safeTotal,
        rejectedText: overLimitText,
        isAllAccepted: false
    });

    if (safeTotal > 0) {
        this.statusMessage.set('လစ်မစ်အတွင်း စာရင်းများကိုသာ လက်ခံပြီးပါပြီ။');
    } else {
        this.statusMessage.set('စာရင်းအားလုံး လစ်မစ်ကျော်နေသဖြင့် ပယ်ဖျက်လိုက်ပါသည်။ (Reply Voucher တွင် ကြည့်ပါ)');
    }
    
    setTimeout(() => this.statusMessage.set(''), 4000);

    this.inboxInput.set('');
    this.cancelInboxConfirmation();
  }

  cancelInboxConfirmation(): void {
    this.pendingInboxConfirmation.set(null);
    this.confirmationMessage.set('');
  }
  
  closeInboxResult(): void {
      this.lastInboxResult.set(null);
  }
  
  copyInboxReply(): void {
      this.copyToClipboard(this.inboxReplyText());
      this.statusMessage.set('Reply Voucher ကို ကူးယူပြီးပါပြီ။');
      setTimeout(() => this.statusMessage.set(''), 2000);
  }

  openSubmissionModal() {
    if (this.pendingSubmissions().length === 0) return;
    
    // CHANGED: Use parseRaw and array to avoid aggregation
    const allBets: { number: string; amount: number }[] = [];
    const pending = this.pendingSubmissions();
    
    for (const input of pending) {
        const bets = this.betParsingService.parseRaw(input, this.lotteryType());
        allBets.push(...bets);
    }

    // Construct the formatted string
    const today = new Date().toLocaleDateString('en-CA');
    let dateLine = `နေ့စွဲ: ${this.lotteryType() === '3D' ? this.formatDate(this.drawDate()) : today}`;
    if (this.lotteryType() === '2D') {
        const sessionText = this.session() === 'morning' ? 'မနက်ပိုင်း' : 'ညနေပိုင်း';
        dateLine += ` (${sessionText})`;
    }

    const header = `--- ${this.bookieName()} ---`;
    const separator = '--------------------';
    
    // Map directly without sorting to preserve input order
    const body = allBets.map(b => `${b.number} = ${b.amount}`).join('\n');
    const totalAmount = allBets.reduce((sum, b) => sum + b.amount, 0);
    const count = allBets.length;

    const footer = `စုစုပေါင်း (${count}) ကွက်: ${totalAmount.toLocaleString()} ${this.currencySymbol()}`;

    const formattedText = `${header}\n${dateLine}\n${separator}\n${body}\n${separator}\n${footer}`;

    this.submissionText.set(formattedText);
    this.showSubmissionModal.set(true);
  }

  copySubmissionText() {
    this.copyToClipboard(this.submissionText());
    this.statusMessage.set('စာရင်းကို Copy ကူးပြီးပါပြီ။');
    setTimeout(() => this.statusMessage.set(''), 3000);
  }

  finishBatch() {
    this.copyToClipboard(this.submissionText());
    this.pendingSubmissions.set([]); // Clear the pending list
    this.showSubmissionModal.set(false); // Close the modal
    this.statusMessage.set('စာရင်းပို့ပြီးပါပြီ။ နောက်တစ်သုတ် စတင်နိုင်ပါပြီ။ (ပင်မဇယားတွင် စုစုပေါင်း ကျန်ရှိနေမည်)');
    setTimeout(() => this.statusMessage.set(''), 4000);
  }
  
  clearSubmissions() {
    this.pendingSubmissions.set([]);
  }
  
  openPayoutModal() { this.showPayoutModal.set(true); this.payoutDetails.set(null); this.winningNumber.set(''); }
  
  calculatePayout() {
    const num = this.winningNumber().trim();
    const type = this.lotteryType();
    const requiredLength = type === '2D' ? 2 : 3;

    if (num.length !== requiredLength || isNaN(parseInt(num))) { alert(`ကျေးဇူးပြု၍ ဂဏန်း ${requiredLength} လုံးကို မှန်ကန်စွာထည့်ပါ။`); return; }
    
    const cell = (type === '2D' ? this.gridCells() : this.listItems()).find(c => c.number === num);
    
    if (!cell) { 
        this.payoutDetails.set({ 
            winningNumber: num, 
            totalBet: 0,
            totalHeldBet: 0, 
            totalHeldPayout: 0, 
            totalOverLimitBet: 0, 
            totalOverLimitPayout: 0, 
            agentPayouts: [],
            otherPayouts: []
        }); 
        return; 
    }

    const totalBet = cell.amount;
    const totalOverLimitBet = cell.overLimitAmount;
    const totalHeldBet = totalBet - totalOverLimitBet;
    
    const totalHeldPayout = totalHeldBet * this.payoutRate();
    const totalOverLimitPayout = totalOverLimitBet * this.payoutRate();
    
    // Group bets by source first
    const sourceMap = new Map<string, number[]>(); // Map source to list of amounts
    cell.breakdown.forEach(b => {
        const amount = Number(b.amount);
        const list = sourceMap.get(b.source) || [];
        list.push(amount);
        sourceMap.set(b.source, list);
    });

    const knownAgentNames = new Set(this.agents().map(a => a.name));
    const agentPayouts: { name: string; payout: number; betAmount: number; individualBets: number[] }[] = [];
    const otherPayouts: { name: string; payout: number; betAmount: number; individualBets: number[] }[] = [];

    sourceMap.forEach((amounts, source) => {
        const totalAmount = amounts.reduce((a, b) => a + b, 0);
        const entry = { 
            name: source, 
            betAmount: totalAmount, 
            payout: totalAmount * this.payoutRate(),
            individualBets: amounts 
        };
        
        if (knownAgentNames.has(source)) {
            agentPayouts.push(entry);
        } else {
            otherPayouts.push(entry);
        }
    });

    // Sort by amount desc
    agentPayouts.sort((a, b) => b.betAmount - a.betAmount);
    otherPayouts.sort((a, b) => b.betAmount - a.betAmount);
    
    this.payoutDetails.set({ 
        winningNumber: num, 
        totalBet,
        totalHeldBet, 
        totalHeldPayout, 
        totalOverLimitBet,
        totalOverLimitPayout,
        agentPayouts,
        otherPayouts
    });
  }

  printPayout() { window.print(); }

  async saveReport(): Promise<void> {
    if (this.lotteryData().size === 0) {
      this.statusMessage.set('မှတ်တမ်းတင်ရန် စာရင်းများမရှိသေးပါ။');
      setTimeout(() => this.statusMessage.set(''), 3000);
      return;
    }
    const type = this.lotteryType();
    const currentMode = this.activeMode();
    
    try {
        // Filter bets for the report based on strict active view mode
        const filteredHistory = this.betHistory().filter(h => {
             const entryMode = h.mode || 'ဒိုင်ကြီး';
             return entryMode === currentMode;
        });

        const report: Report = {
            id: `report_${new Date().toISOString()}_${this.activeMode()}_${type === '2D' ? this.session() : this.drawDate()}_${type}`,
            lotteryType: type,
            date: new Date().toISOString(),
            session: type === '2D' ? this.session() : undefined,
            drawDate: type === '3D' ? this.drawDate() : undefined,
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
            betHistory: filteredHistory.map(h => h.input),
            bookieName: this.bookieName(),
            defaultLimit: this.defaultLimit(),
            payoutRate: this.payoutRate(),
            commissionToPay: this.commissionToPay(),
            agentCommissionFromBookie: this.agentCommissionFromBookie(),
            commissionFromUpperBookie: this.commissionFromUpperBookie(),
            individualLimits: Array.from(this.individualLimits().entries()),
            upperBookies: this.upperBookies(),
            agents: this.agents(), // This will save the mode-specific agent list
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
        this.statusMessage.set('Backup ပြုလုပ်နေသည်...');
        const appData = await this.persistenceService.getAllDataForBackup();
        const licenseData = await this.licenseService.getBackupData();
        
        const fullBackup = {
            appData,
            licenseData,
            backupVersion: '1.0',
            timestamp: new Date().toISOString()
        };

        const jsonString = JSON.stringify(fullBackup, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().split('T')[0];
        a.href = url;
        a.download = `future2d_backup_${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.statusMessage.set('Backup ကို အောင်မြင်စွာ ပြုလုပ်ပြီးပါပြီ။');
     } catch(e) {
        console.error("Backup failed", e);
        this.statusMessage.set('Backup ပြုလုပ်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်။');
     } finally {
        setTimeout(() => this.statusMessage.set(''), 4000);
     }
  }

  handleRestore(event: Event): void {
     const file = (event.target as HTMLInputElement).files?.[0];
     if (!file) return;

     if (!confirm('Restore ပြုလုပ်ပါက လက်ရှိဒေတာအားလုံး ပျက်စီးပြီး Backup ဖိုင်ထဲမှ ဒေတာများဖြင့် အစားထိုးသွားမည်ဖြစ်သည်။ ရှေ့ဆက်ရန် သေချာပါသလား?')) {
        (event.target as HTMLInputElement).value = ''; // Reset file input
        return;
     }

     const reader = new FileReader();
     reader.onload = async (e) => {
        try {
            this.statusMessage.set('Restore ပြုလုပ်နေသည်...');
            const content = e.target?.result as string;
            const backupData = JSON.parse(content);
            
            if (!backupData.appData || !backupData.licenseData) {
                throw new Error('Invalid backup file format.');
            }

            await this.persistenceService.restoreAllData(backupData.appData);
            await this.licenseService.restoreFromBackup(backupData.licenseData);

            this.statusMessage.set('Restore ကို အောင်မြင်စွာ ပြုလုပ်ပြီးပါပြီ။ Application ကို ပြန်လည်စတင်နေသည်...');
            
            setTimeout(() => {
                window.location.reload();
            }, 2000);

        } catch (err) {
            console.error('Failed to restore data', err);
            this.statusMessage.set('Restore ပြုလုပ်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်။ ဖိုင်ကိုစစ်ဆေးပါ။');
            setTimeout(() => this.statusMessage.set(''), 4000);
        } finally {
            (event.target as HTMLInputElement).value = ''; // Reset file input
        }
     };
     reader.readAsText(file);
  }

  logout() { this.licenseService.logout(); }
  setAgentSort(sortBy: 'name' | 'sales') { this.agentSortBy.set(sortBy); }

  // --- Over-limit Management Methods ---
  rejectOverLimit(number: string): void {
    // Transfer any acknowledged amount from the 'forwardable' map to the 'held' map
    const amountToTransfer = this.acknowledgedOverLimits().get(number);
    if (amountToTransfer) {
      this.acknowledgedOverLimits.update(currentMap => {
        const newMap = new Map(currentMap);
        newMap.delete(number);
        return newMap;
      });
      this.acknowledgedHeldOverLimits.update(currentMap => {
        const newMap = new Map(currentMap);
        newMap.set(number, (newMap.get(number) || 0) + amountToTransfer);
        return newMap;
      });
    }

    // Move the number to the rejected set
    this.rejectedOverLimits.update(s => {
      const newSet = new Set(s);
      newSet.add(number);
      return newSet;
    });
  }
  reforwardOverLimit(number: string): void {
    // Transfer any acknowledged amount from the 'held' map back to the 'forwardable' map
    const amountToTransfer = this.acknowledgedHeldOverLimits().get(number);
    if (amountToTransfer) {
        this.acknowledgedHeldOverLimits.update(currentMap => {
            const newMap = new Map(currentMap);
            newMap.delete(number);
            return newMap;
        });
        this.acknowledgedOverLimits.update(currentMap => {
            const newMap = new Map(currentMap);
            newMap.set(number, (newMap.get(number) || 0) + amountToTransfer);
            return newMap;
        });
    }
    
    // Remove the number from the rejected set
    this.rejectedOverLimits.update(s => {
      const newSet = new Set(s);
      newSet.delete(number);
      return newSet;
    });
  }

  private acknowledgeList(list: OverLimitListItem[], mapSignal: WritableSignal<Map<string, number>>, title: string): void {
      if (list.length === 0) return;
      const message = this.formatOverLimitForCopy(list);
      this.copyToClipboard(message);
      this.statusMessage.set(`${title} စာရင်းကို copy ကူးပြီးပါပြီ။`);
      setTimeout(() => this.statusMessage.set(''), 3000);

      const fullOverLimitMap = new Map(this.overLimitCells().map(c => [c.number, c.overLimitAmount]));

      mapSignal.update(currentMap => {
        const newMap = new Map(currentMap);
        list.forEach(item => {
          // Get the total current over-limit amount for the number, not just the displayed portion.
          const totalOverLimit = fullOverLimitMap.get(item.number) || 0;
          newMap.set(item.number, totalOverLimit);
        });
        return newMap;
      });
  }

  acknowledgeAllForwardableOverLimits(): void {
      this.acknowledgeList(this.forwardableOverLimitNumbers(), this.acknowledgedOverLimits, 'အပေါ်ဒိုင်သို့ လွှဲရန်စာရင်း');
  }
  acknowledgeAllHeldOverLimits(): void {
      this.acknowledgeList(this.heldOverLimitNumbers(), this.acknowledgedHeldOverLimits, 'ကိုင်ထားသော ကာသီးစာရင်း');
  }
  acknowledgeMainBookieOverLimits(): void {
      this.acknowledgeList(this.displayedOverLimitNumbers(), this.acknowledgedOverLimits, 'လစ်မစ်ကျော်စာရင်းများ');
  }
  
  formatDate(isoString: string): string {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString('en-CA');
  }

  applyProfitSuggestion(): void {
    const suggestion = this.profitOptimizerSuggestion();
    if (!suggestion) return;
  
    const newLimit = this.defaultLimit() + suggestion.suggestedHoldingIncrease;
    this.updateCurrentState('defaultLimit', newLimit);
  
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

  private formatOverLimitForCopy(list: OverLimitListItem[]): string {
      if (!list || list.length === 0) return '';

      const header = `--- ${this.bookieName()} ---`;
      
      const today = new Date().toLocaleDateString('en-CA');
      let dateLine = `နေ့စွဲ: ${today}`;
      if (this.lotteryType() === '2D') {
          const sessionText = this.session() === 'morning' ? 'မနက်ပိုင်း' : 'ညနေပိုင်း';
          dateLine += ` (${sessionText})`;
      }

      const separator = '--------------------';
      
      const totalAmount = list.reduce((sum, item) => sum + item.overLimitAmount, 0);
      const totalCount = list.length;

      const bodyParts: string[] = [];
      list.forEach((item, index) => {
          bodyParts.push(`${item.number} = ${item.overLimitAmount}`);
          // Add separator after every 10th item, but not if it's the very last item
          if ((index + 1) % 10 === 0 && (index + 1) < list.length) {
              bodyParts.push(separator);
          }
      });
      const body = bodyParts.join('\n');
      
      const footer = `စုစုပေါင်း (${totalCount}) ကွက်: ${totalAmount.toLocaleString()} ${this.currencySymbol()}`;

      return `${header}\n${dateLine}\n${separator}\n${body}\n${separator}\n${footer}`;
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
    if (historyEntry) this.editHistoryEntry(historyEntry);
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

  handleForwardingModalClose(assignments: Assignments | null): void {
    this.isForwardingModalOpen.set(false);
    if (assignments) {
        // User saved. "Acknowledge" all the bets that were assigned.
        const assignedNumbers = new Set<string>();
        Object.values(assignments).forEach(betList => {
            betList.forEach(bet => assignedNumbers.add(bet.number));
        });
        
        const fullOverLimitMap = new Map(this.overLimitCells().map(c => [c.number, c.overLimitAmount]));

        this.acknowledgedOverLimits.update(currentMap => {
            const newMap = new Map(currentMap);
            assignedNumbers.forEach(number => {
                // FIX: Explicitly convert to number to resolve potential type inference issue.
                const totalOverLimit = Number(fullOverLimitMap.get(number) || 0);
                if (totalOverLimit > 0) {
                    newMap.set(number, totalOverLimit);
                }
            });
            return newMap;
        });

        this.statusMessage.set('ကာသီးစာရင်းများကို အောင်မြင်စွာ ခွဲဝေပြီးပါပြီ။');
        setTimeout(() => this.statusMessage.set(''), 3000);
    }
  }

  // --- Voucher Functions ---
  openVoucherModal(): void {
    if (this.pendingSubmissions().length === 0) return;

    // Use parseRaw to get all bets from pending strings
    const allBets: { number: string; amount: number }[] = [];
    const pending = this.pendingSubmissions();
    for (const input of pending) {
        const bets = this.betParsingService.parseRaw(input, this.lotteryType());
        allBets.push(...bets);
    }

    if (allBets.length === 0) {
        this.statusMessage.set('ဘောင်ချာထုတ်ရန် စာရင်းမရှိပါ။');
        setTimeout(() => this.statusMessage.set(''), 2000);
        return;
    }

    const totalAmount = allBets.reduce((sum, b) => sum + b.amount, 0);
    const date = new Date().toLocaleDateString('en-CA');
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    this.voucherData.set({
        items: allBets,
        totalAmount,
        totalCount: allBets.length,
        date,
        time,
        currency: this.currencySymbol() // Added currency symbol
    });
    this.showVoucherModal.set(true);
  }

  printVoucher(): void {
    window.print();
  }

  closeVoucherModal(): void {
    this.showVoucherModal.set(false);
    this.voucherData.set(null);
  }
}