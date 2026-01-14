import { Component, ChangeDetectionStrategy, signal, computed, effect, inject, ViewChild, ElementRef, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LicenseService } from '../../services/license.service';
import { PersistenceService } from '../../services/persistence.service';
import { ReportViewerComponent } from '../report-viewer/report-viewer.component';
import { UserGuideComponent } from '../user-guide/user-guide.component';
import { ForwardingModalComponent, Assignments } from '../forwarding-modal/forwarding-modal.component';
import { Agent, UpperBookie, Report, GridCell, BetDetail } from '../../models/app.models';

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

// --- Constants ---
const POWER_NUMBERS = ['05', '16', '27', '38', '49'];
const NAKHAT_NUMBERS = ['07', '18', '35', '69', '24'];
const NYI_KO_NUMBERS = ['01', '12', '23', '34', '45', '56', '67', '78', '89', '90'];
const EVEN_DIGITS = ['0', '2', '4', '6', '8'];
const ODD_DIGITS = ['1', '3', '5', '7', '9'];

@Component({
  selector: 'app-code-analyzer',
  templateUrl: './code-analyzer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ReportViewerComponent, UserGuideComponent, ForwardingModalComponent],
  host: {
    '(window:keydown)': 'handleKeyboardEvents($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)'
  }
})
export class CodeAnalyzerComponent implements OnInit {
  licenseService = inject(LicenseService);
  persistenceService = inject(PersistenceService);

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

  // --- Messaging State ---
  confirmationMessage = signal('');
  statusMessage = signal('');

  // --- Computed Signals (Logic) ---
  lotteryData = computed<Map<string, BetDetail[]>>(() => {
    const data = new Map<string, BetDetail[]>();
    const history = this.betHistory();
    for (const entry of history) {
      const parsedAmounts = this.parseBetString(entry.input);
      parsedAmounts.forEach((amount, number) => {
        const existingBets = data.get(number) || [];
        const newBet: BetDetail = { id: crypto.randomUUID(), amount, source: entry.source };
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

    for (let i = 0; i < 100; i++) {
      const numberStr = i.toString().padStart(2, '0');
      const breakdown = data.get(numberStr) || [];
      const amount = breakdown.reduce((sum, bet) => sum + bet.amount, 0);
      const limit = (this.activeMode() === 'ဒိုင်ကြီး' && this.individualLimits().has(numberStr))
        ? this.individualLimits().get(numberStr)!
        : this.defaultLimit();
      
      const isOverLimit = amount > limit;
      const overLimitAmount = isOverLimit ? amount - limit : 0;

      const amounts = breakdown.map(b => b.amount);
      const betsString = isAgentMode
        ? amounts.join(', ')
        : (amounts.length > 0 ? `(${amounts.join(', ')})` : '');
      
      const betsTooltip = breakdown.map(b => `${b.source}: ${b.amount}`).join('; ');

      cells.push({ number: numberStr, amount, isOverLimit, breakdown, betsString, betsTooltip, overLimitAmount });
    }
    return cells;
  });

  totalBetAmount = computed<number>(() => this.gridCells().reduce((sum, cell) => sum + cell.amount, 0));
  overLimitCells = computed(() => this.gridCells().filter(cell => cell.isOverLimit));

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

  constructor() {
    window.addEventListener('online', () => this.isOnline.set(true));
    window.addEventListener('offline', () => this.isOnline.set(false));
      
    effect(() => this.persistenceService.set('lottery_agents', this.agents()));
    effect(() => this.persistenceService.set('lottery_upper_bookies', this.upperBookies()));
    effect(() => this.persistenceService.set('lottery_agent_upper_bookies', this.agentUpperBookies()));
    effect(() => this.persistenceService.set('lottery_currency', this.currencySymbol()));
    
    effect(() => {
      if (this.agents().length > 0 && !this.agents().some(a => a.name === this.selectedAgentForInbox())) {
        this.selectedAgentForInbox.set(this.agents()[0].name);
      } else if (this.agents().length === 0) {
        this.selectedAgentForInbox.set(null);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    const [agents, upperBookies, agentUpperBookies, currency] = await Promise.all([
      this.persistenceService.get<Agent[]>('lottery_agents'),
      this.persistenceService.get<UpperBookie[]>('lottery_upper_bookies'),
      this.persistenceService.get<{name: string}[]>('lottery_agent_upper_bookies'),
      this.persistenceService.get<'K' | '฿' | '¥'>('lottery_currency'),
    ]);
    if (agents) this.agents.set(agents);
    if (upperBookies) this.upperBookies.set(upperBookies);
    if (agentUpperBookies) this.agentUpperBookies.set(agentUpperBookies);
    if (currency) this.currencySymbol.set(currency);
  }

  handleKeyboardEvents(event: KeyboardEvent) {
    if (this.showReports() || this.showUserGuide() || this.showForwardingModal() || this.showSubmissionModal() || this.showPayoutModal()) return;
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
    const parsedAmounts = this.parseBetString(input);
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
    this.betHistory.set([]);
    this.confirmationMessage.set('');
    this.submissionText.set('');
    this.pendingSubmissions.set([]);
    this.acceptedSubmissions.set([]);
    this.forwardingAssignments.set(null);
    this.acknowledgedOverLimits.set(new Map());
    this.rejectedOverLimits.set(new Set());
    this.acknowledgedHeldOverLimits.set(new Map());
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
    if (this.activeMode() !== 'ဒိုင်ကြီး') return;
    const currentLimit = this.individualLimits().get(number) || this.defaultLimit();
    const newLimit = prompt(`ဂဏန်း ${number} အတွက် သီးသန့်လစ်မစ် သတ်မှတ်ပါ:`, currentLimit.toString());
    if (newLimit !== null && !isNaN(parseInt(newLimit))) {
      this.individualLimits.update(limits => limits.set(number, parseInt(newLimit)));
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
    const newAmounts = this.parseBetString(finalInputForParsing);
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
    const subTotal = Array.from(this.parseBetString(content).values()).reduce((a, b) => a + b, 0);
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
      this.rejectedOverLimits.update(set => {
          set.add(number);
          return new Set(set);
      });
      this.acknowledgedOverLimits.update(map => {
          map.delete(number);
          return new Map(map);
      });
  }

  reforwardOverLimit(number: string): void {
      this.rejectedOverLimits.update(set => {
          set.delete(number);
          return new Set(set);
      });
      this.acknowledgedHeldOverLimits.update(map => {
          map.delete(number);
          return new Map(map);
      });
  }

  private acknowledgeList(list: OverLimitListItem[], mapToUpdate: (cb: (currentMap: Map<string, number>) => Map<string, number>) => void, title: string): void {
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

  private formatOverLimitForCopy(list: OverLimitListItem[], title: string): string {
      const name = this.bookieName() || 'စာရင်း';
      const date = new Date().toLocaleDateString('en-CA');
      const session = this.session() === 'morning' ? 'မနက်ပိုင်း' : 'ညနေပိုင်း';
      const totalCount = list.length;
      const totalAmount = list.reduce((sum, cell) => sum + cell.overLimitAmount, 0);

      const chunks: string[][] = [];
      const chunkSize = 10;
      for (let i = 0; i < totalCount; i += chunkSize) {
          const chunk = list.slice(i, i + chunkSize);
          const chunkContent = chunk.map(cell => `${cell.number} = ${cell.overLimitAmount.toLocaleString()}`);
          chunks.push(chunkContent);
      }

      const totalChunks = chunks.length;
      let fullText = '';
      
      chunks.forEach((chunk, index) => {
          fullText += `--- ${name} (${title}) (${index + 1}/${totalChunks}) ---\n`;
          if (index === 0) {
              fullText += `နေ့စွဲ: ${date} (${session})\n`;
          }
          fullText += `--------------------\n`;
          fullText += chunk.join('\n') + '\n';
          if (index < totalChunks - 1) {
              fullText += `--------------------\n\n`;
          }
      });

      if (totalChunks > 0) {
        fullText += `--------------------\n`;
      }
      fullText += `စုစုပေါင်း (${totalCount}) ကွက်: ${totalAmount.toLocaleString()} ${this.currencySymbol()}`;

      return fullText.trim();
  }

  private parseBetString(input: string): Map<string, number> {
    const burmeseToEnglishMap: { [key: string]: string } = { 'အပူး': 'apu', 'ညီကို': 'nk', 'ပါဝါ': 'pao', 'နက်ခတ်': 'nat', 'စုံစုံ': 'ss', 'မမ': 'mm', 'စုံမ': 'sm', 'မစုံ': 'ms', 'ဆယ်ပြည့်': 'sp', 'အကုန်': 'all', 'ဘူဘဒိတ်': 'bb', 'ထိပ်': 't', 'ပိတ်': 'p', 'အပါ': 'a', 'ခွေ': 'k', 'ဗြိတ်': 'v', 'ဘဒိတ်': 'b', 'အကပ်': 'ak' };
    let processedInput = input;
    for (const burmese of Object.keys(burmeseToEnglishMap)) {
        const regex = new RegExp(burmese, 'g');
        processedInput = processedInput.replace(regex, burmeseToEnglishMap[burmese]);
    }

    const burmeseDigits = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'];
    burmeseDigits.forEach((digit, index) => {
        processedInput = processedInput.replace(new RegExp(digit, 'g'), index.toString());
    });

    const lines = processedInput.split(/\r?\n/);
    const cleanedLines = lines.filter(line => !/^(agent|session|sub-total|total)/i.test(line.trim()) && !line.trim().startsWith('---') && line.trim() !== '');
    processedInput = cleanedLines.join('\n');
    
    const newAmounts = new Map<string, number>();
    const entries = processedInput.replace(/[=/၊,]/g, ' ').split(/\s+/).map(s => s.trim()).filter(Boolean);
    
    const add = (n: string, a: number) => { if (n && n.length === 2 && !isNaN(parseInt(n))) { newAmounts.set(n, (newAmounts.get(n) || 0) + a); } };
    const addPair = (n: string, a: number) => { add(n, a); if (n[0] !== n[1]) { add(n.split('').reverse().join(''), a); } };
    
    for (let i = 0; i < entries.length; i += 2) {
        if (i + 1 >= entries.length) continue;
        let numPart = entries[i].toLowerCase();
        
        let amountStr = entries[i+1];
        let amount: number;

        if (amountStr.toLowerCase().endsWith('k')) {
            const numValue = parseFloat(amountStr.slice(0, -1));
            amount = isNaN(numValue) ? NaN : numValue * 1000;
        } else {
            amount = parseInt(amountStr.replace(/ကျပ်/gi, ''), 10);
        }

        if (isNaN(amount)) continue;

        if (numPart.endsWith('r')) { const baseNum = numPart.slice(0, -1); if (baseNum.length === 2 && !isNaN(parseInt(baseNum))) { const halfAmount = amount / 2; add(baseNum, halfAmount); add(baseNum.split('').reverse().join(''), halfAmount); continue; } }
        if (['apu'].includes(numPart)) { for (let j = 0; j < 10; j++) add(`${j}${j}`, amount); } else if (['nk'].includes(numPart)) { NYI_KO_NUMBERS.forEach(n => addPair(n, amount)); } else if (['pao'].includes(numPart)) { POWER_NUMBERS.forEach(n => addPair(n, amount)); } else if (['nat'].includes(numPart)) { NAKHAT_NUMBERS.forEach(n => addPair(n, amount)); } else if (['ss'].includes(numPart)) { EVEN_DIGITS.forEach(d1 => EVEN_DIGITS.forEach(d2 => add(`${d1}${d2}`, amount))); } else if (['mm'].includes(numPart)) { ODD_DIGITS.forEach(d1 => ODD_DIGITS.forEach(d2 => add(`${d1}${d2}`, amount))); } else if (['sm'].includes(numPart)) { EVEN_DIGITS.forEach(d1 => ODD_DIGITS.forEach(d2 => add(`${d1}${d2}`, amount))); } else if (['ms'].includes(numPart)) { ODD_DIGITS.forEach(d1 => EVEN_DIGITS.forEach(d2 => add(`${d1}${d2}`, amount))); } else if (['sp'].includes(numPart)) { ['19', '28', '37', '46', '55'].forEach(n => addPair(n, amount)); } else if (['all'].includes(numPart)) { for (let j = 0; j < 100; j++) add(j.toString().padStart(2, '0'), amount); } else if (['bb'].includes(numPart)) { for (let j = 0; j < 100; j++) { const numStr = j.toString().padStart(2, '0'); if ((parseInt(numStr[0], 10) + parseInt(numStr[1], 10)) % 10 === 0) add(numStr, amount); } } else {
            let handled = false; const lastChar = numPart.slice(-1); const firstPart = numPart.slice(0, -1);
            if (firstPart.length > 0 && !isNaN(parseInt(firstPart[0]))) {
                if (['t'].includes(lastChar) && firstPart.length === 1) { for (let j = 0; j < 10; j++) add(`${firstPart}${j}`, amount); handled = true; } else if (['p'].includes(lastChar) && firstPart.length === 1) { for (let j = 0; j < 10; j++) { if (j.toString() !== firstPart) add(`${j}${firstPart}`, amount); } handled = true; } else if (['a'].includes(lastChar) && firstPart.length === 1) { for (let j = 0; j < 100; j++) { const numStr = j.toString().padStart(2, '0'); if (numStr.includes(firstPart)) add(numStr, amount); } handled = true; } else if (['k'].includes(lastChar)) { const digits = Array.from(new Set(firstPart.split(''))); for (let d1 of digits) { for (let d2 of digits) add(`${d1}${d2}`, amount); } handled = true; } else if (['v', 'b'].includes(lastChar)) { const targetSum = parseInt(firstPart); if (!isNaN(targetSum) && targetSum >= 0 && targetSum <= 9) { for (let j = 0; j < 100; j++) { const numStr = j.toString().padStart(2, '0'); if ((parseInt(numStr[0], 10) + parseInt(numStr[1], 10)) % 10 === targetSum) add(numStr, amount); } handled = true; } }
            }
            if (!handled && numPart.endsWith('ak')) { const digitStr = numPart.replace(/ak/g, ''); if (digitStr.length === 1 && !isNaN(parseInt(digitStr))) { const digit = parseInt(digitStr); const prev = (digit + 9) % 10; const next = (digit + 1) % 10; add(`${digit}${next}`, amount); add(`${digit}${prev}`, amount); add(`${next}${digit}`, amount); add(`${prev}${digit}`, amount); handled = true; } }
            if (!handled && numPart.length === 2 && !isNaN(parseInt(numPart))) { add(numPart, amount); }
        }
    }
    return newAmounts;
  }
}