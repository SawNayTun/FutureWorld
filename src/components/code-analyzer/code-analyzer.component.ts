
import { Component, ChangeDetectionStrategy, signal, computed, inject, effect, ElementRef, ViewChild, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BetParsingService, RawBet } from '../../services/bet-parsing.service';
import { LicenseService } from '../../services/license.service';
import { VoiceRecognitionService } from '../../services/voice-recognition.service';
import { PersistenceService } from '../../services/persistence.service';
import { 
  GridCell, BetDetail, VoucherSettings, Report, Agent, UpperBookie 
} from '../../models/app.models';

import { SummaryCardComponent } from '../summary-card/summary-card.component';
import { LoaderComponent } from '../loader/loader.component';
import { ChatComponent } from '../chat/chat.component';
import { ReportViewerComponent } from '../report-viewer/report-viewer.component';
import { UserGuideComponent } from '../user-guide/user-guide.component';
import { ForwardingModalComponent, Assignments } from '../forwarding-modal/forwarding-modal.component';

declare var html2canvas: any;

interface HistoryEntry {
  id: string;
  input: string;
  timestamp: number;
  bets: BetDetail[]; 
}

@Component({
  selector: 'app-code-analyzer',
  templateUrl: './code-analyzer.component.html',
  styleUrls: ['./code-analyzer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    SummaryCardComponent, 
    LoaderComponent,
    ChatComponent,
    ReportViewerComponent,
    UserGuideComponent,
    ForwardingModalComponent
  ],
  providers: [DatePipe]
})
export class CodeAnalyzerComponent implements OnInit {
  betParsingService = inject(BetParsingService);
  licenseService = inject(LicenseService);
  voiceService = inject(VoiceRecognitionService);
  persistenceService = inject(PersistenceService);
  private datePipe = inject(DatePipe);

  @ViewChild('mainBetInput') mainBetInput!: ElementRef<HTMLTextAreaElement>;

  // --- Panic Mode State ---
  isPanicMode = signal(false);
  panicInput = signal('');

  // --- App State ---
  lotteryType = signal<'2D' | '3D'>('2D');
  session = signal<'morning' | 'evening'>('morning');
  drawDate = signal<string>(new Date().toISOString().split('T')[0]);
  activeMode = signal<string>('အေးဂျင့်'); // 'အေးဂျင့်' | 'အလယ်ဒိုင်' | 'ဒိုင်ကြီး'
  modes = ['အေးဂျင့်', 'အလယ်ဒိုင်', 'ဒိုင်ကြီး'];

  // --- Settings ---
  bookieName = signal('My Shop');
  agentProfiles = signal<string[]>(['My Shop']);
  payoutRate = signal(80);
  defaultLimit = signal(10000);
  commissionToPay = signal(0); // For direct inputs
  commissionFromUpperBookie = signal(0); // Middle bookie gets from Upper
  agentCommissionFromBookie = signal(15); // Agent gets from Bookie
  currencySymbol = signal('K');
  currencies = ['K', '฿', '¥'];

  // --- Data ---
  userInput = signal('');
  history = signal<HistoryEntry[]>([]);
  customLimits = signal<Map<string, number>>(new Map()); // Key: Number, Value: Limit
  
  // --- Agents & Bookies Management ---
  agents = signal<Agent[]>([]);
  upperBookies = signal<UpperBookie[]>([]);
  agentUpperBookies = signal<UpperBookie[]>([]); // For Agent mode

  // --- UI Toggles ---
  showUserGuide = signal(false);
  showRiskModal = signal(false);
  showHeatmap = signal(false);
  showPayoutModal = signal(false);
  showReports = signal(false);
  showChat = signal(false);
  showCustomLimitsDropdown = signal(false);
  showLimitManagementModal = signal(false);
  showClearAllConfirmation = signal(false);
  showSubmissionModal = signal(false);
  showVoucherModal = signal(false);
  showVoucherSettings = signal(false);
  showBetDetailModal = signal(false);
  pendingInboxConfirmation = signal(false);
  
  // --- UI Temporary State ---
  statusMessage = signal('');
  isGeneratingImage = signal(false);
  search3DTerm = signal('');
  batchLimitAmount = signal<number>(0);
  limitManageNumber = signal('');
  limitManageAmount = signal(0);
  
  // --- Complex Logic State ---
  profitOptimizerSuggestion = signal<any>(null); // Placeholder for profit logic
  suggestionAppliedRecently = signal(false);
  
  // Forwarding / Holding
  acknowledgedOverLimits = signal<Map<string, number>>(new Map()); // Number -> Amount
  heldOverLimits = signal<Map<string, number>>(new Map()); // Number -> Amount explicitly held
  
  isForwardingModalOpen = signal(false);
  submissionText = signal('');
  overLimitConfirmationText = signal('');
  
  // Inbox
  selectedAgentForInbox = signal<string | null>(null);
  inboxInput = signal('');
  lastInboxResult = signal<string | null>(null);
  inboxReplyText = signal('');
  inboxPendingBets = signal<RawBet[]>([]);

  // Payout
  winningNumber = signal('');
  payoutDetails = signal<any>(null);

  // Voucher
  voucherData = signal<any>(null);
  voucherSettings = signal<VoucherSettings>({
    headerText: 'အောင်စေပိုင်စေ',
    footerText: 'ကံကောင်းပါစေ',
    fontSize: 'small',
    showDateTime: true
  });

  // Management Inputs
  newAgentName = signal('');
  newAgentCommission = signal(15);
  newUpperBookieName = signal('');
  newUpperBookieCommission = signal(10);
  newAgentUpperBookieName = signal('');

  // Detail Modal State
  selectedNumberForDetail = signal('');
  betsForDetailModal = signal<BetDetail[]>([]);

  constructor() {
    // Keyboard listener for Panic Mode
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'h') {
        this.isPanicMode.update(v => !v);
      }
      if (this.isPanicMode() && e.key === 'Escape') {
        this.isPanicMode.set(false);
      }
    });

    // Auto-save effect
    effect(() => {
        // Simple auto-save trigger on key changes if needed
        // For performance, we usually do this on specific actions (add/delete)
    });
  }

  async ngOnInit() {
      await this.loadState();
  }

  // --- Computed: Core Data Aggregation ---
  aggregatedBets = computed(() => {
    const hist = this.history();
    const totals = new Map<string, number>();
    const breakdown = new Map<string, BetDetail[]>();

    hist.forEach(entry => {
        entry.bets.forEach(b => {
            const num = (b as any).number; 
            if (num) {
                totals.set(num, (totals.get(num) || 0) + b.amount);
                const list = breakdown.get(num) || [];
                list.push(b);
                breakdown.set(num, list);
            }
        });
    });

    return { totals, breakdown };
  });

  customLimitsList = computed(() => {
      const list: {number: string, limit: number}[] = [];
      this.customLimits().forEach((val, key) => list.push({number: key, limit: val}));
      return list.sort((a,b) => a.number.localeCompare(b.number));
  });

  gridCells = computed<GridCell[]>(() => {
    const { totals, breakdown } = this.aggregatedBets();
    const defLimit = this.defaultLimit();
    const custom = this.customLimits();
    const cells: GridCell[] = [];
    const is3D = this.lotteryType() === '3D';
    
    if (!is3D) {
        for (let i = 0; i < 100; i++) {
          const num = i.toString().padStart(2, '0');
          const amount = totals.get(num) || 0;
          const limit = custom.get(num) ?? defLimit;
          const isOverLimit = amount > limit;
          const overLimitAmount = Math.max(0, amount - limit);
          
          cells.push({
            number: num,
            amount,
            isOverLimit,
            hasCustomLimit: custom.has(num),
            breakdown: breakdown.get(num) || [], 
            betsString: (breakdown.get(num) || []).map(b => b.amount).join(', '),
            betsTooltip: (breakdown.get(num) || []).map(b => `${b.amount} (${b.source})`).join('\n'),
            overLimitAmount,
            limit
          });
        }
    } else {
        const allNumbers = new Set([...totals.keys(), ...custom.keys()]);
        const sorted = Array.from(allNumbers).sort();
        
        for (const num of sorted) {
             const amount = totals.get(num) || 0;
             const limit = custom.get(num) ?? defLimit;
             const isOverLimit = amount > limit;
             const overLimitAmount = Math.max(0, amount - limit);

             cells.push({
                number: num,
                amount,
                isOverLimit,
                hasCustomLimit: custom.has(num),
                breakdown: breakdown.get(num) || [],
                betsString: (breakdown.get(num) || []).map(b => b.amount).join(', '),
                betsTooltip: (breakdown.get(num) || []).map(b => `${b.amount} (${b.source})`).join('\n'),
                overLimitAmount,
                limit
             });
        }
    }
    return cells;
  });

  filteredListItems = computed(() => {
      const term = this.search3DTerm();
      if (!term) return this.gridCells();
      return this.gridCells().filter(c => c.number.includes(term));
  });

  recentHistory = computed(() => {
      // Return top 20 recent history entries
      return this.history().slice(0, 20);
  });

  // --- Computed: Financials & Over Limits ---
  totalBetAmount = computed(() => this.gridCells().reduce((sum, c) => sum + c.amount, 0));
  
  overLimitCells = computed(() => this.gridCells().filter(c => c.isOverLimit));
  
  totalOverLimitAmount = computed(() => this.overLimitCells().reduce((sum, c) => sum + c.overLimitAmount, 0));

  forwardableOverLimitNumbers = computed(() => {
    const acknowledged = this.acknowledgedOverLimits();
    const held = this.heldOverLimits();
    return this.overLimitCells().map(cell => {
      const ack = acknowledged.get(cell.number) || 0;
      const hld = held.get(cell.number) || 0;
      const diff = cell.overLimitAmount - (ack + hld);
      return { number: cell.number, overLimitAmount: diff };
    }).filter(i => i.overLimitAmount > 0);
  });

  forwardableNumbersForModal = computed(() => this.forwardableOverLimitNumbers().map(i => ({number: i.number, amount: i.overLimitAmount})));

  heldOverLimitNumbers = computed(() => {
      const held = this.heldOverLimits();
      const list: {number: string, overLimitAmount: number}[] = [];
      held.forEach((amt, num) => {
          if (amt > 0) list.push({ number: num, overLimitAmount: amt });
      });
      return list;
  });

  displayedOverLimitNumbers = computed(() => {
      const acknowledged = this.acknowledgedOverLimits();
      return this.overLimitCells().map(cell => {
          const ack = acknowledged.get(cell.number) || 0;
          const diff = cell.overLimitAmount - ack;
          return { number: cell.number, overLimitAmount: diff };
      }).filter(i => i.overLimitAmount > 0);
  });

  totalHeldAmount = computed<number>(() => {
      const baseHeld = this.totalBetAmount() - this.totalOverLimitAmount();
      const heldValues = Array.from<number>(this.heldOverLimits().values());
      const explicitHeld = heldValues.reduce((a, b) => a + b, 0);
      return baseHeld + explicitHeld;
  });

  payableCommissionAmount = computed(() => {
      return this.totalBetAmount() * (this.commissionToPay() / 100);
  });

  receivableCommissionAmount = computed(() => {
      return this.totalHeldAmount() * (this.commissionFromUpperBookie() / 100);
  });

  agentCommissionEarned = computed(() => {
      return this.totalBetAmount() * (this.agentCommissionFromBookie() / 100);
  });

  agentPayableToBookie = computed(() => {
      return this.totalBetAmount() - this.agentCommissionEarned();
  });

  netAmount = computed(() => {
      if (this.activeMode() === 'အေးဂျင့်') return this.agentCommissionEarned();
      return this.totalBetAmount() - this.payableCommissionAmount() - this.totalOverLimitAmount(); 
  });

  pendingForwardableAmount = computed(() => {
      return this.forwardableOverLimitNumbers().reduce((sum, item) => sum + item.overLimitAmount, 0);
  });

  pendingSubmissions = computed(() => {
      const hist = this.history();
      return [...hist].reverse().map(h => h.input);
  });

  riskAnalysis = computed(() => {
     const totalIncome = this.totalHeldAmount(); 
     const rate = this.payoutRate();
     
     const risks = this.gridCells()
        .filter(c => c.amount > 0)
        .map(cell => {
            const heldBetOnThis = cell.amount - cell.overLimitAmount; 
            const payout = heldBetOnThis * rate;
            const net = totalIncome - payout;
            return {
                number: cell.number,
                totalHeld: heldBetOnThis,
                estimatedPayout: payout,
                netProfitLoss: net
            };
        });
     return risks.sort((a,b) => a.netProfitLoss - b.netProfitLoss).slice(0, 10);
  });
  
  agentsWithPerformance = computed(() => {
      return this.agents().map(a => ({
          name: a.name,
          commission: a.commission,
          totalSales: 0 
      }));
  });

  // --- Methods: Panic Mode ---
  onPanicCalculatorInput(val: string) {
    if (val === 'C') {
      this.panicInput.set('');
    } else if (val === '=') {
      try {
        // eslint-disable-next-line no-eval
        this.panicInput.set(eval(this.panicInput()).toString());
      } catch {
        this.panicInput.set('Error');
      }
    } else {
      this.panicInput.update(v => v + val);
    }
  }

  // --- Methods: State Updates ---
  updateCurrentState(key: string, value: any) {
      if (key === 'drawDate') this.drawDate.set(value);
      if (key === 'payoutRate') this.payoutRate.set(value);
      if (key === 'userInput') this.userInput.set(value);
      if (key === 'commissionToPay') this.commissionToPay.set(value);
      if (key === 'commissionFromUpperBookie') this.commissionFromUpperBookie.set(value);
      if (key === 'agentCommissionFromBookie') this.agentCommissionFromBookie.set(value);
  }

  setLotteryType(type: '2D' | '3D') {
      this.lotteryType.set(type);
      this.history.set([]); 
      this.customLimits.set(new Map());
      this.acknowledgedOverLimits.set(new Map());
      this.heldOverLimits.set(new Map());
      this.saveToStorage();
  }

  setSession(s: 'morning' | 'evening') {
      this.session.set(s);
  }

  setActiveMode(m: string) {
      this.activeMode.set(m);
  }

  updateBookieName(name: string) {
      this.bookieName.set(name);
  }

  updateDefaultLimit(val: number) {
      this.defaultLimit.set(val);
      // When default limit changes, over-limit amounts change, so we must sanitize
      this.sanitizeOverLimitMaps();
  }

  // --- Methods: Betting ---
  onInputKeydown(event: KeyboardEvent) {
      if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          this.addBetsFromInput();
      }
  }

  addBetsFromInput() {
      const input = this.userInput();
      if (!input.trim()) return;

      const bets = this.betParsingService.parseRaw(input, this.lotteryType());
      if (bets.length === 0) {
          this.statusMessage.set('စာရင်းပုံစံမှားယွင်းနေပါသည်');
          setTimeout(() => this.statusMessage.set(''), 2000);
          return;
      }

      this.processNewBets(bets, 'Direct', input);
      this.userInput.set('');
  }

  processNewBets(bets: RawBet[], source: string, rawInput: string) {
      const newEntry: HistoryEntry = {
          id: Date.now().toString(),
          input: rawInput,
          timestamp: Date.now(),
          bets: bets.map(b => ({
              id: Math.random().toString(36).substr(2, 9),
              amount: b.amount,
              source: source,
              historyEntryId: Date.now().toString(),
              number: b.number // Storing number explicitly for aggregation
          } as any))
      };

      this.history.update(h => [newEntry, ...h]);
      this.saveToStorage();
      this.statusMessage.set('စာရင်းသွင်းပြီးပါပြီ');
      setTimeout(() => this.statusMessage.set(''), 2000);
  }

  undoLastBet() {
      this.history.update(h => h.slice(1));
      this.saveToStorage();
      this.sanitizeOverLimitMaps(); // Fix: Sanitize maps after undo
  }

  clearAllBets() {
      this.showClearAllConfirmation.set(true);
  }

  confirmClearAll() {
      this.history.set([]);
      this.acknowledgedOverLimits.set(new Map());
      this.heldOverLimits.set(new Map());
      this.saveToStorage();
      this.showClearAllConfirmation.set(false);
  }
  
  editHistoryEntry(entry: HistoryEntry) {
      // Implement basic edit: load into input, delete old
      this.userInput.set(entry.input);
      this.deleteHistoryEntry(entry.id);
  }
  
  deleteHistoryEntry(id: string) {
      this.history.update(h => h.filter(x => x.id !== id));
      this.saveToStorage();
      this.sanitizeOverLimitMaps(); // Fix: Sanitize maps after delete
  }

  // --- Helper: Ensure acknowledged amounts don't exceed current actual over-limit ---
  sanitizeOverLimitMaps() {
      const grid = this.gridCells();
      
      this.acknowledgedOverLimits.update(map => {
          const newMap = new Map(map);
          let changed = false;
          for (const [num, ackAmt] of newMap.entries()) {
              const cell = grid.find(c => c.number === num);
              const currentOver = cell ? cell.overLimitAmount : 0;
              // If we acknowledged more than what is currently over limit (due to deletion), reduce it
              if (ackAmt > currentOver) {
                  if (currentOver <= 0) newMap.delete(num);
                  else newMap.set(num, currentOver);
                  changed = true;
              }
          }
          return changed ? newMap : map;
      });

      this.heldOverLimits.update(map => {
          const newMap = new Map(map);
          let changed = false;
          for (const [num, heldAmt] of newMap.entries()) {
              // 'held' is also constrained by current over limit
              const cell = grid.find(c => c.number === num);
              const currentOver = cell ? cell.overLimitAmount : 0;
              if (heldAmt > currentOver) {
                  if (currentOver <= 0) newMap.delete(num);
                  else newMap.set(num, currentOver);
                  changed = true;
              }
          }
          return changed ? newMap : map;
      });
  }

  // --- Methods: Over Limit Actions ---
  rejectOverLimit(number: string) {
      const item = this.forwardableOverLimitNumbers().find(i => i.number === number);
      if (item) {
          this.heldOverLimits.update(map => {
              const newMap = new Map(map);
              const current = newMap.get(number) || 0;
              newMap.set(number, current + item.overLimitAmount);
              return newMap;
          });
      }
  }

  reforwardOverLimit(number: string) {
      this.heldOverLimits.update(map => {
          const newMap = new Map(map);
          newMap.delete(number);
          return newMap;
      });
  }

  acknowledgeAllForwardableOverLimits() {
      const list = this.forwardableOverLimitNumbers();
      this.updateAcknowledgedMap(list);
  }

  acknowledgeAllHeldOverLimits() {
     // Implementation depends on desired behavior (clear list visually?)
     // For now, no-op or clear held map?
     this.heldOverLimits.set(new Map());
  }

  acknowledgeMainBookieOverLimits() {
      const list = this.displayedOverLimitNumbers();
      this.updateAcknowledgedMap(list);
  }

  private updateAcknowledgedMap(items: {number: string, overLimitAmount: number}[]) {
      this.acknowledgedOverLimits.update(map => {
          const newMap = new Map(map);
          const grid = this.gridCells();
          items.forEach(i => {
              const cell = grid.find(c => c.number === i.number);
              if (cell) {
                  newMap.set(i.number, cell.overLimitAmount); 
              }
          });
          return newMap;
      });
  }

  // --- Methods: Image Generation ---
  async copyForwardableListAsImage() {
      if (typeof html2canvas === 'undefined') {
          alert('Error: Image generation library not loaded.');
          return;
      }
      const list = this.forwardableOverLimitNumbers();
      if (list.length === 0) {
          this.statusMessage.set('ထုတ်ရန် စာရင်းမရှိပါ။');
          return;
      }

      this.isGeneratingImage.set(true);
      
      setTimeout(async () => {
          const element = document.getElementById('forward-voucher-capture');
          if (!element) {
              this.isGeneratingImage.set(false);
              return;
          }

          try {
              const canvas = await html2canvas(element, {
                  scale: 2,
                  backgroundColor: '#1e293b', 
                  logging: false,
                  useCORS: true
              });

              canvas.toBlob(async (blob: Blob | null) => {
                  if(!blob) {
                      this.statusMessage.set('Image generation failed.');
                      this.isGeneratingImage.set(false);
                      return;
                  }
                  try {
                      await navigator.clipboard.write([
                          new ClipboardItem({ 'image/png': blob })
                      ]);
                      this.statusMessage.set('Img Copy ကူးပြီးပါပြီ! Messenger တွင် Paste (Ctrl+V) ချနိုင်ပါပြီ။');

                      const fullOverLimitMap = new Map(this.overLimitCells().map(c => [c.number, c.overLimitAmount]));
                      this.acknowledgedOverLimits.update(currentMap => {
                        const newMap = new Map(currentMap);
                        list.forEach(item => {
                          const totalOverLimit = fullOverLimitMap.get(item.number) || 0;
                          newMap.set(item.number, totalOverLimit);
                        });
                        return newMap;
                      });

                  } catch (err) {
                      console.error(err);
                      this.statusMessage.set('Clipboard Error: HTTPS required.');
                  }
                  
                  setTimeout(() => this.statusMessage.set(''), 4000);
                  this.isGeneratingImage.set(false);
              }, 'image/png');
          } catch (e) {
              console.error(e);
              this.isGeneratingImage.set(false);
              this.statusMessage.set('Error generating image.');
          }
      }, 100);
  }

  // --- Methods: Persistence ---
  saveToStorage() {
      const data = {
          history: this.history(),
          customLimits: Array.from(this.customLimits().entries()),
          // ... other state
      };
      this.persistenceService.set('app_state', data);
  }
  
  async loadState() {
      const data = await this.persistenceService.get<any>('app_state');
      if (data) {
          if (data.history) this.history.set(data.history);
          if (data.customLimits) this.customLimits.set(new Map(data.customLimits));
      }
      
      const agents = await this.persistenceService.get<Agent[]>('lottery_agents');
      if(agents) this.agents.set(agents);
      
      const uppers = await this.persistenceService.get<UpperBookie[]>('lottery_upper_bookies');
      if(uppers) this.upperBookies.set(uppers);
  }

  backupData() {
      this.persistenceService.getAllDataForBackup().then(data => {
          const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `backup-${new Date().toISOString()}.json`;
          a.click();
      });
  }

  handleRestore(event: any) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
          try {
              const data = JSON.parse(e.target?.result as string);
              await this.persistenceService.restoreAllData(data);
              window.location.reload();
          } catch(err) {
              alert('Invalid Backup File');
          }
      };
      reader.readAsText(file);
  }

  // --- Methods: UI Toggles ---
  toggleHeatmap() { this.showHeatmap.update(v => !v); }
  toggleReports() { this.showReports.set(true); }
  toggleChat() { this.showChat.set(true); }
  
  logout() {
      this.licenseService.logout();
      window.location.reload();
  }

  // --- Methods: Limits Management ---
  toggleCustomLimitsDropdown() { this.showCustomLimitsDropdown.update(v => !v); }
  clearAllCustomLimits() { this.customLimits.set(new Map()); }
  openLimitModal(num?: string) { 
      if(num) this.limitManageNumber.set(num);
      else this.limitManageNumber.set('');
      this.showLimitManagementModal.set(true); 
  }
  closeLimitModal() { this.showLimitManagementModal.set(false); }
  
  saveIndividualLimit() {
      const num = this.limitManageNumber();
      const amt = this.limitManageAmount();
      if (num) {
          // Simplified: split by comma/space
          const tokens = num.split(/[\s,]+/).filter(x => x);
          this.customLimits.update(m => {
              const newMap = new Map(m);
              tokens.forEach(t => {
                   if (!isNaN(parseInt(t))) newMap.set(t, amt);
              });
              return newMap;
          });
      } else if (!num && amt > 0) {
          this.defaultLimit.set(amt);
      }
      this.sanitizeOverLimitMaps(); // Fix: Sanitize maps after limit change
      this.closeLimitModal();
  }
  
  removeIndividualLimit(num: string) {
      this.customLimits.update(m => {
          const newMap = new Map(m);
          newMap.delete(num);
          return newMap;
      });
      this.sanitizeOverLimitMaps(); // Fix: Sanitize maps after limit change
  }

  applyBatchLimitChange(type: 'add' | 'sub' | 'set') {
      const val = this.batchLimitAmount();
      if (val <= 0) return;
      this.customLimits.update(m => {
          const newMap = new Map(m);
          for (const key of newMap.keys()) {
              const current = newMap.get(key) || 0;
              if (type === 'add') newMap.set(key, current + val);
              if (type === 'sub') newMap.set(key, Math.max(0, current - val));
              if (type === 'set') newMap.set(key, val);
          }
          return newMap;
      });
      this.sanitizeOverLimitMaps(); // Fix: Sanitize maps after batch limit change
  }
  
  removeBatchLimits() {
      const nums = this.limitManageNumber().split(/[,\s]+/).filter(x => x);
      this.customLimits.update(m => {
          const newMap = new Map(m);
          nums.forEach(n => newMap.delete(n));
          return newMap;
      });
      this.sanitizeOverLimitMaps(); // Fix: Sanitize maps after limit removal
      this.closeLimitModal();
  }

  // --- Agent Profile ---
  addAgentProfile() {
      const name = this.bookieName();
      if (!this.agentProfiles().includes(name)) {
          this.agentProfiles.update(p => [...p, name]);
      }
  }
  removeAgentProfile() {
      const name = this.bookieName();
      this.agentProfiles.update(p => p.filter(n => n !== name));
      if(this.agentProfiles().length > 0) this.bookieName.set(this.agentProfiles()[0]);
  }
  onProfileSelect(e: any) {
      this.bookieName.set(e.target.value);
  }

  // --- Inbox / Chat Import ---
  handleChatImport(data: {text: string, agentName: string}) {
      this.showChat.set(false);
      this.inboxInput.set(data.text);
      this.selectedAgentForInbox.set(data.agentName); // Auto select if possible
      this.addBetsFromInbox();
  }

  addBetsFromInbox() {
      const input = this.inboxInput();
      const agent = this.selectedAgentForInbox();
      
      if (!input || !agent) return;

      const bets = this.betParsingService.parseRaw(input, this.lotteryType());
      this.processNewBets(bets, `Inbox: ${agent}`, input);
      this.inboxInput.set('');
  }
  
  isInboxSubmitDisabled() { return !this.inboxInput(); }
  
  acceptAllFromInbox() {
      this.pendingInboxConfirmation.set(false);
  }
  
  acceptSafeOnlyFromInbox() {
      this.pendingInboxConfirmation.set(false);
  }
  
  cancelInboxConfirmation() {
      this.pendingInboxConfirmation.set(false);
  }
  
  closeInboxResult() {
      this.lastInboxResult.set(null);
  }
  
  copyInboxReply() {
      navigator.clipboard.writeText(this.inboxReplyText());
  }

  // --- Payout ---
  openPayoutModal() { this.showPayoutModal.set(true); }
  
  calculatePayout() {
      const win = this.winningNumber();
      if (!win) return;
      
      const grid = this.gridCells();
      const winCell = grid.find(c => c.number === win);
      
      // Ensure we are working with numbers to prevent "left-hand side of arithmetic operation" errors
      const cellAmount = winCell ? winCell.amount : 0;
      const cellOverLimit = winCell ? winCell.overLimitAmount : 0;
      const totalHeldWin = cellAmount - cellOverLimit;
      
      this.payoutDetails.set({
          winningNumber: win,
          totalBet: this.totalBetAmount(),
          totalOverLimitBet: this.totalOverLimitAmount(),
          totalHeldBet: this.totalHeldAmount(),
          totalHeldPayout: totalHeldWin * this.payoutRate(),
          agentPayouts: [], 
          otherPayouts: []
      });
  }
  printPayout() { window.print(); }

  // --- Detail Modal ---
  openBetDetailModal(num: string) {
      this.selectedNumberForDetail.set(num);
      const cell = this.gridCells().find(c => c.number === num);
      this.betsForDetailModal.set(cell ? cell.breakdown : []);
      this.showBetDetailModal.set(true);
  }
  closeBetDetailModal() { this.showBetDetailModal.set(false); }
  editBetFromDetail(bet: BetDetail) {
      this.deleteBetFromDetail(bet);
      this.userInput.set(`${(bet as any).number} ${bet.amount}`);
      this.showBetDetailModal.set(false);
  }
  deleteBetFromDetail(bet: BetDetail) {
      this.history.update(h => {
          return h.map(entry => {
              const filteredBets = entry.bets.filter(b => b.id !== bet.id);
              return { ...entry, bets: filteredBets };
          }).filter(entry => entry.bets.length > 0);
      });
      this.saveToStorage();
      this.sanitizeOverLimitMaps(); // Fix: Sanitize maps after delete from detail
      this.openBetDetailModal(this.selectedNumberForDetail());
  }

  // --- Voucher ---
  openVoucherModal() {
      this.voucherData.set({
          items: this.gridCells().filter(c => c.amount > 0).map(c => ({number: c.number, amount: c.amount})),
          totalCount: this.gridCells().filter(c => c.amount > 0).length,
          totalAmount: this.totalBetAmount(),
          date: this.datePipe.transform(new Date(), 'dd/MM/yyyy'),
          time: this.datePipe.transform(new Date(), 'shortTime'),
          settings: this.voucherSettings()
      });
      this.showVoucherModal.set(true);
  }
  closeVoucherModal() { this.showVoucherModal.set(false); }
  printVoucher() { window.print(); }
  saveVoucherSettings() { this.showVoucherSettings.set(false); }

  // --- Submission ---
  openSubmissionModal() {
      const lines = this.pendingSubmissions();
      this.submissionText.set(lines.join('\n'));
      this.showSubmissionModal.set(true);
  }
  copySubmissionText() {
      navigator.clipboard.writeText(this.submissionText());
  }
  share(text: string) {
      if (navigator.share) {
          navigator.share({ title: '2D List', text: text });
      }
  }
  finishBatch() {
      this.showSubmissionModal.set(false);
      this.clearSubmissions();
  }
  clearSubmissions() {
      this.confirmClearAll();
  }

  // --- Voice ---
  toggleVoiceInput() {
      if (this.voiceService.isListening()) {
          this.voiceService.stopListening();
      } else {
          this.voiceService.startListening((text, isFinal) => {
              if (isFinal) {
                  this.userInput.update(v => v + ' ' + text);
              }
          });
      }
  }

  // --- Agents Management (Basic Impl) ---
  addAgent() {
      if(this.newAgentName()) {
          this.agents.update(a => [...a, { name: this.newAgentName(), commission: this.newAgentCommission() }]);
          this.persistenceService.set('lottery_agents', this.agents());
          this.newAgentName.set('');
      }
  }
  removeAgent(name: string) {
      this.agents.update(a => a.filter(x => x.name !== name));
      this.persistenceService.set('lottery_agents', this.agents());
  }
  addUpperBookie() {
      if(this.newUpperBookieName()) {
          this.upperBookies.update(u => [...u, { name: this.newUpperBookieName(), commission: this.newUpperBookieCommission() }]);
          this.persistenceService.set('lottery_upper_bookies', this.upperBookies());
          this.newUpperBookieName.set('');
      }
  }
  removeUpperBookie(name: string) {
      this.upperBookies.update(u => u.filter(x => x.name !== name));
      this.persistenceService.set('lottery_upper_bookies', this.upperBookies());
  }
  addAgentUpperBookie() {
      if(this.newAgentUpperBookieName()) {
          this.agentUpperBookies.update(u => [...u, { name: this.newAgentUpperBookieName(), commission: 0 }]);
          this.newAgentUpperBookieName.set('');
      }
  }
  removeAgentUpperBookie(name: string) {
      this.agentUpperBookies.update(u => u.filter(x => x.name !== name));
  }

  // --- Reports ---
  saveReport() {
      const report: Report = {
          id: `report_${Date.now()}`,
          lotteryType: this.lotteryType(),
          date: new Date().toISOString(),
          mode: this.activeMode(),
          totalBetAmount: this.totalBetAmount(),
          totalOverLimitAmount: this.totalOverLimitAmount(),
          totalHeldAmount: this.totalHeldAmount(),
          payableCommissionAmount: this.payableCommissionAmount(),
          receivableCommissionAmount: this.receivableCommissionAmount(),
          agentCommissionEarned: this.agentCommissionEarned(),
          netAmount: this.netAmount(),
          lotteryData: this.gridCells().filter(c => c.amount > 0).map(c => [c.number, c.amount]),
          betHistory: this.history().map(h => h.input),
          bookieName: this.bookieName(),
          defaultLimit: this.defaultLimit(),
          payoutRate: this.payoutRate(),
          commissionToPay: this.commissionToPay(),
          agentCommissionFromBookie: this.agentCommissionFromBookie(),
          commissionFromUpperBookie: this.commissionFromUpperBookie(),
          individualLimits: [],
          upperBookies: [],
          agents: [],
          currencySymbol: this.currencySymbol()
      };
      
      this.persistenceService.saveReport(report);
      this.statusMessage.set('Report saved.');
      setTimeout(() => this.statusMessage.set(''), 2000);
  }
  
  handleReportRestore(r: Report) {
      this.history.set([]); 
      if (r.betHistory) {
          r.betHistory.forEach(input => {
             const bets = this.betParsingService.parseRaw(input, r.lotteryType);
             this.processNewBets(bets, 'Restored', input);
          });
      }
      this.showReports.set(false);
  }

  // --- Forwarding Modal ---
  handleForwardingModalClose(result: Assignments | null) {
      this.isForwardingModalOpen.set(false);
      if (result) {
          this.acknowledgeAllForwardableOverLimits();
      }
  }

  // --- Profit Optimizer ---
  dismissProfitSuggestion() { this.profitOptimizerSuggestion.set(null); }
  applyProfitSuggestion() { 
      this.suggestionAppliedRecently.set(true);
  }
  showSuggestionPanelAgain() { this.suggestionAppliedRecently.set(false); }

  formatDate(d: string) { 
      try { return new Date(d).toLocaleDateString(); } catch { return d; }
  }
}
