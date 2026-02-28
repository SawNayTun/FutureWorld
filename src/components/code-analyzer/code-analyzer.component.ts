import { Component, ChangeDetectionStrategy, signal, computed, inject, effect, ElementRef, ViewChild, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BetParsingService, RawBet } from '../../services/bet-parsing.service';
import { LicenseService } from '../../services/license.service';
import { VoiceRecognitionService } from '../../services/voice-recognition.service';
import { PersistenceService } from '../../services/persistence.service';
import { QrService, QrBetData } from '../../services/qr.service';
import { 
  GridCell, BetDetail, VoucherSettings, Report as AppReport, Agent, UpperBookie, LimitGroup 
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
  qrService = inject(QrService);
  private datePipe = inject(DatePipe);

  @ViewChild('mainBetInput') mainBetInput!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('historyContainer') historyContainer!: ElementRef<HTMLDivElement>;

  // --- Panic Mode State ---
  isPanicMode = signal(false);
  panicInput = signal('');

  // --- App State ---
  lotteryType = signal<'2D' | '3D'>('2D');
  session = signal<'morning' | 'evening'>('morning');
  drawDate = signal<string>(new Date().toISOString().split('T')[0]);
  
  // REMOVED Agent Mode. Default is now Middle Bookie
  activeMode = signal<string>('အလယ်ဒိုင်'); 
  modes = ['အလယ်ဒိုင်', 'ဒိုင်ကြီး'];

  // --- Settings ---
  bookieName = signal('My Shop');
  payoutRate = signal(80);
  defaultLimit = signal(10000);
  commissionToPay = signal(0); // For direct inputs
  commissionFromUpperBookie = signal(0); // Middle bookie gets from Upper
  currencySymbol = signal('K');
  currencies = ['K', '฿', '¥'];

  // --- Data ---
  userInput = signal('');
  history = signal<HistoryEntry[]>([]);
  
  // New Limit Group System
  limitGroups = signal<LimitGroup[]>([]);
  
  // Computed Map for calculations (derived from groups)
  customLimits = computed<Map<string, number>>(() => {
      const map = new Map<string, number>();
      this.limitGroups().forEach(group => {
          group.numbers.forEach(num => {
              map.set(num, group.amount);
          });
      });
      return map;
  });
  
  // --- Agents & Bookies Management ---
  agents = signal<Agent[]>([]);
  upperBookies = signal<UpperBookie[]>([]);

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
  imageGenerationTime = signal(''); 
  search3DTerm = signal('');
  
  // Image Preview Modal State
  showImagePreview = signal(false);
  previewImageUrl = signal('');
  
  batchLimitAmount = signal<number>(0); 
  limitManageNumber = signal('');
  limitManageAmount = signal(0);
  
  // --- Complex Logic State ---
  profitOptimizerSuggestion = signal<any>(null); 
  suggestionAppliedRecently = signal(false);
  
  // Forwarding / Holding
  acknowledgedOverLimits = signal<Map<string, number>>(new Map()); 
  heldOverLimits = signal<Map<string, number>>(new Map()); 
  heldNumberStatus = signal<Set<string>>(new Set()); // Tracks numbers designated as "held"
  
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
  voucherQrCodeUrl = signal(''); // To hold QR for hidden voucher

  // Management Inputs
  newAgentName = signal('');
  newAgentCommission = signal(15);
  newUpperBookieName = signal('');
  newUpperBookieCommission = signal(10);

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

    // Auto-scroll history effect
    effect(() => {
        const len = this.recentHistory().length;
        if(len > 0 && this.historyContainer?.nativeElement) {
            setTimeout(() => {
                try {
                    // Scroll to top because newest items are now at the top
                    this.historyContainer.nativeElement.scrollTop = 0;
                } catch(e) {}
            }, 50);
        }
    });

    // Effect to auto-move new over-limits for "sticky held" numbers to the held list
    effect(() => {
        const grid = this.gridCells();
        const heldStatus = this.heldNumberStatus();
        if (heldStatus.size === 0) return;

        const ackMap = this.acknowledgedOverLimits();
        const heldMap = this.heldOverLimits();

        let needsUpdate = false;
        const newHeldAmounts = new Map(heldMap);

        for (const number of heldStatus) {
            const cell = grid.find(c => c.number === number);
            if (cell && cell.isOverLimit) {
                const ack = ackMap.get(number) || 0;
                // FIX: Cast `held` to a number. Values from maps of persisted data can be inferred as `unknown`.
                const held = Number(newHeldAmounts.get(number) || 0);
                
                const forwardableAmount = cell.overLimitAmount - (ack + held);

                if (forwardableAmount > 0) {
                    newHeldAmounts.set(number, held + forwardableAmount);
                    needsUpdate = true;
                }
            }
        }

        if (needsUpdate) {
            this.heldOverLimits.set(newHeldAmounts);
        }
    }, { allowSignalWrites: true });
  }

  async ngOnInit() {
      // Restore last active mode if exists to prevent resetting settings on reload
      const lastMode = await this.persistenceService.get<string>('last_active_mode');
      if (lastMode && this.modes.includes(lastMode)) {
          this.activeMode.set(lastMode);
      }
      await this.loadState();
  }

  // --- Computed: Core Data Aggregation ---
  aggregatedBets = computed(() => {
    const hist = this.history();
    const totals = new Map<string, number>();
    const breakdown = new Map<string, BetDetail[]>();

    for (const entry of hist) {
        if (entry.bets && Array.isArray(entry.bets)) {
            for (const b of entry.bets) {
                const num = b.number; 
                if (num) {
                    const currentTotal = totals.get(num) || 0;
                    totals.set(num, currentTotal + b.amount);
                    
                    const list = breakdown.get(num);
                    if(list) {
                        list.push(b);
                    } else {
                        breakdown.set(num, [b]);
                    }
                }
            }
        }
    }

    return { totals, breakdown };
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
        const sorted = Array.from(allNumbers).sort((a,b) => a.localeCompare(b));
        
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
      // Reverse to show newest first
      return this.history().slice(-20).reverse();
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

  totalHeldVoucherAmount = computed(() => {
    return this.heldOverLimitNumbers().reduce((sum, item) => sum + item.overLimitAmount, 0);
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
      const heldValues = Array.from(this.heldOverLimits().values());
      // FIX(2024-07-29): The value `b` could be of an unknown type. Safely cast to a number before summation.
      const explicitHeld = heldValues.reduce((a: number, b) => a + Number(b || 0), 0);
      return baseHeld + explicitHeld;
  });

  payableCommissionAmount = computed(() => {
      return this.totalBetAmount() * (this.commissionToPay() / 100);
  });

  receivableCommissionAmount = computed(() => {
      return this.totalHeldAmount() * (this.commissionFromUpperBookie() / 100);
  });

  netAmount = computed(() => {
      return this.totalBetAmount() - this.payableCommissionAmount() - this.totalOverLimitAmount(); 
  });

  pendingForwardableAmount = computed(() => {
      return this.forwardableOverLimitNumbers().reduce((sum, item) => sum + item.overLimitAmount, 0);
  });

  pendingSubmissions = computed(() => {
      return this.history().map(h => h.input);
  });

  // --- Real-time Risk Analysis (Updated to prioritize Total Amount display but Held Amount calculation) ---
  worstCaseScenario = computed(() => {
      const cells = this.gridCells();
      const rate = this.payoutRate();
      const currentNet = this.netAmount();

      // 1. Find the Max TOTAL Bet amount (Popularity)
      let maxTotalBet = 0;
      for (const cell of cells) {
          if (cell.amount > maxTotalBet) {
              maxTotalBet = cell.amount;
          }
      }

      if (maxTotalBet === 0) return null;

      // 2. Identify ALL numbers that have this Max Total Bet
      const popularNumbers: string[] = [];
      // Also find the max held amount AMONG these popular numbers to calculate the worst case scenario for THEM
      let maxHeldAmongPopular = 0;

      for (const cell of cells) {
          if (cell.amount === maxTotalBet) {
              popularNumbers.push(cell.number);
              const held = cell.amount - cell.overLimitAmount;
              if (held > maxHeldAmongPopular) {
                  maxHeldAmongPopular = held;
              }
          }
      }

      // 3. Calculate liabilities based ONLY on Held Amount of the most popular number(s)
      const potentialPayout = maxHeldAmongPopular * rate;
      const projectedNet = currentNet - potentialPayout;

      return {
          numbers: popularNumbers,
          totalAmount: maxTotalBet,
          heldAmount: maxHeldAmongPopular,
          potentialPayout: potentialPayout,
          projectedNet: projectedNet,
          isRisk: projectedNet < 0
      };
  });

  riskAnalysis = computed(() => {
     const totalIncome = this.totalHeldAmount(); 
     const rate = this.payoutRate();
     
     // Calculate global max total bet for highlighting
     let maxTotalBet = 0;
     const cells = this.gridCells();
     cells.forEach(c => {
         if (c.amount > maxTotalBet) maxTotalBet = c.amount;
     });

     const risks = cells
        .filter(c => c.amount > 0)
        .map(cell => {
            const heldBetOnThis = cell.amount - cell.overLimitAmount; 
            const payout = heldBetOnThis * rate;
            const net = totalIncome - payout;
            
            return {
                number: cell.number,
                totalAmount: cell.amount, // Include Total for display
                isMaxTotalBet: cell.amount === maxTotalBet && maxTotalBet > 0, // Flag for Red Color
                totalHeld: heldBetOnThis,
                estimatedPayout: payout,
                netProfitLoss: net
            };
        });
     
     // Sort by Financial Loss (Net Profit Loss Ascending)
     return risks.sort((a,b) => a.netProfitLoss - b.netProfitLoss).slice(0, 15);
  });
  
  agentsWithPerformance = computed(() => {
      const hist = this.history();
      const agentsList = this.agents();

      return agentsList.map(agent => {
          let total = 0;
          for (const entry of hist) {
              if (entry.bets) {
                  for (const bet of entry.bets) {
                      if (bet.source && agent.name && 
                          bet.source.toLowerCase().includes(agent.name.toLowerCase())) { 
                          total += bet.amount;
                      }
                  }
              }
          }
          return {
              name: agent.name,
              commission: agent.commission,
              totalSales: total
          };
      });
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
      if (key === 'commissionToPay') this.commissionToPay.set(value);
      if (key === 'commissionFromUpperBookie') this.commissionFromUpperBookie.set(value);
      if (key === 'currencySymbol') this.currencySymbol.set(value); 
      
      // Auto-save changes to settings immediately
      this.saveToStorage();
  }

  async setLotteryType(type: '2D' | '3D') {
      // Save current state before switching
      this.saveToStorage();
      
      this.lotteryType.set(type);
      
      // Reset signals to avoid showing stale data while loading
      this.history.set([]); 
      this.limitGroups.set([]); 
      this.acknowledgedOverLimits.set(new Map());
      this.heldOverLimits.set(new Map());
      this.heldNumberStatus.set(new Set());
      this.userInput.set('');
      
      // Load state for the new type
      await this.loadState();
  }

  setSession(s: 'morning' | 'evening') {
      this.session.set(s);
  }

  async setActiveMode(m: string) {
      this.saveToStorage();
      this.activeMode.set(m);
      this.persistenceService.set('last_active_mode', m); 
      this.history.set([]);
      this.limitGroups.set([]);
      this.acknowledgedOverLimits.set(new Map());
      this.heldOverLimits.set(new Map());
      this.heldNumberStatus.set(new Set());
      this.userInput.set('');
      await this.loadState();
  }

  updateBookieName(name: string) {
      this.bookieName.set(name);
      this.saveToStorage();
  }

  updateDefaultLimit(val: number) {
      this.defaultLimit.set(val);
      this.sanitizeOverLimitMaps();
      this.saveToStorage();
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
              number: b.number 
          }))
      };

      this.history.update(h => [...h, newEntry]);
      this.saveToStorage();
      this.statusMessage.set('စာရင်းသွင်းပြီးပါပြီ');
      setTimeout(() => this.statusMessage.set(''), 2000);
  }

  undoLastBet() {
      this.history.update(h => h.slice(0, -1));
      this.saveToStorage();
      this.sanitizeOverLimitMaps(); 
  }

  clearAllBets() {
      this.showClearAllConfirmation.set(true);
  }

  confirmClearAll() {
      this.history.set([]);
      this.acknowledgedOverLimits.set(new Map());
      this.heldOverLimits.set(new Map());
      this.heldNumberStatus.set(new Set());
      this.userInput.set('');
      this.saveToStorage();
      this.showClearAllConfirmation.set(false);
      this.statusMessage.set('စာရင်းအားလုံးကို ဖျက်ပြီးပါပြီ');
      setTimeout(() => this.statusMessage.set(''), 2000);
  }
  
  editHistoryEntry(entry: HistoryEntry) {
      this.userInput.set(entry.input);
      this.deleteHistoryEntry(entry.id);
  }
  
  deleteHistoryEntry(id: string) {
      this.history.update(h => h.filter(x => x.id !== id));
      this.saveToStorage();
      this.sanitizeOverLimitMaps();
  }

  // --- Helper: Ensure acknowledged amounts don't exceed current actual over-limit ---
  sanitizeOverLimitMaps() {
      if (this.overLimitCells().length === 0 && this.acknowledgedOverLimits().size === 0 && this.heldOverLimits().size === 0) {
          return;
      }

      const grid = this.gridCells();
      
      this.acknowledgedOverLimits.update(map => {
          const newMap = new Map(map);
          let changed = false;
          for (const [num, ackAmt] of newMap.entries()) {
              const cell = grid.find(c => c.number === num);
              const currentOver = cell ? cell.overLimitAmount : 0;
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
          this.heldNumberStatus.update(set => {
              const newSet = new Set(set);
              newSet.add(number);
              return newSet;
          });
      }
  }

  reforwardOverLimit(number: string) {
      this.heldOverLimits.update(map => {
          const newMap = new Map(map);
          newMap.delete(number);
          return newMap;
      });
      this.heldNumberStatus.update(set => {
          const newSet = new Set(set);
          newSet.delete(number);
          return newSet;
      });
  }

  // --- Helper: Generate Voucher Text ---
  private generateCopyText(items: {number: string, overLimitAmount: number}[]): string {
      const name = this.bookieName();
      const now = new Date();
      const date = this.datePipe.transform(now, 'dd/MM/yyyy (h:mm a)');

      let text = `--- ${name} ---\n`;
      text += `နေ့စွဲ - ${date}\n`;
      
      const separator = '--------------------';
      text += `${separator}\n`;

      let total = 0;
      items.forEach((item, index) => {
          text += `${item.number} = ${item.overLimitAmount}\n`;
          total += item.overLimitAmount;
          if ((index + 1) % 10 === 0 && (index + 1) < items.length) {
              text += `${separator}\n`;
          }
      });

      text += `${separator}\n`;
      text += `စုစုပေါင်း: (${items.length}) ကွက် - ${total.toLocaleString()} ${this.currencySymbol()}`;
      return text;
  }

  async acknowledgeAllForwardableOverLimits() {
      const list = this.forwardableOverLimitNumbers();
      if (list.length === 0) return;

      const text = this.generateCopyText(list);
      try {
          await navigator.clipboard.writeText(text);
          this.statusMessage.set('Forward List (စာ) Copy ကူးပြီးပါပြီ။');
          this.updateAcknowledgedMap(list);
      } catch (err) {
          console.error(err);
          this.statusMessage.set('Copy Error: HTTPS required');
      }
      setTimeout(() => this.statusMessage.set(''), 2000);
  }

  async acknowledgeAllHeldOverLimits() {
     const list = this.heldOverLimitNumbers();
     if (list.length === 0) return;

     const text = this.generateCopyText(list);
     try {
         await navigator.clipboard.writeText(text);
         this.statusMessage.set('Held List (စာ) Copy ကူးပြီးပါပြီ။');

         // After copying, move from held to acknowledged.
         this.acknowledgedOverLimits.update(ackMap => {
            const newAckMap = new Map(ackMap);
            list.forEach(item => {
                const currentAck = newAckMap.get(item.number) || 0;
                newAckMap.set(item.number, currentAck + item.overLimitAmount);
            });
            return newAckMap;
         });

         this.heldOverLimits.update(heldMap => {
            const newHeldMap = new Map(heldMap);
            list.forEach(item => {
                newHeldMap.delete(item.number);
            });
            return newHeldMap;
         });
         this.saveToStorage();

     } catch (err) {
         console.error(err);
         this.statusMessage.set('Copy Error: HTTPS required');
     }
     setTimeout(() => this.statusMessage.set(''), 2000);
  }

  async acknowledgeMainBookieOverLimits() {
      const list = this.displayedOverLimitNumbers();
      if (list.length === 0) return;

      const text = this.generateCopyText(list);
      try {
          await navigator.clipboard.writeText(text);
          this.statusMessage.set('Over Limit (စာ) Copy ကူးပြီးပါပြီ။');
          this.updateAcknowledgedMap(list);
      } catch (err) {
          console.error(err);
          this.statusMessage.set('Copy Error: HTTPS required');
      }
      setTimeout(() => this.statusMessage.set(''), 2000);
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
      this.saveToStorage();
  }

  // --- Methods: Image Generation ---
  private async prepareVoucherWithQr(
      list: { number: string, overLimitAmount: number }[]
  ): Promise<void> {
      // Increased safety limit to 400 because of new compression
      if (list.length === 0 || list.length > 400) {
          this.voucherQrCodeUrl.set('');
          return;
      }
      const data: QrBetData = {
          v: 1,
          d: list.map(item => [item.number, item.overLimitAmount]),
          a: this.bookieName()
      };
      const qrUrl = await this.qrService.generateQrCode(data);
      this.voucherQrCodeUrl.set(qrUrl);
  }

  closeImagePreview() {
      if (this.previewImageUrl()) {
          URL.revokeObjectURL(this.previewImageUrl());
      }
      this.previewImageUrl.set('');
      this.showImagePreview.set(false);
  }

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
      this.imageGenerationTime.set(this.datePipe.transform(new Date(), 'dd/MM/yyyy, h:mm:ss a') || '');
      
      await this.prepareVoucherWithQr(list.map(i => ({number: i.number, overLimitAmount: i.overLimitAmount})));
      
      setTimeout(async () => {
          const element = document.getElementById('forward-voucher-capture');
          if (!element) {
              this.isGeneratingImage.set(false);
              return;
          }

          try {
              const canvas = await html2canvas(element, {
                  scale: 3, // Increased scale for clearer QR
                  backgroundColor: '#ffffff', 
                  logging: false,
                  useCORS: true
              });

              canvas.toBlob(async (blob: Blob | null) => {
                  if(!blob) {
                      this.statusMessage.set('Image generation failed.');
                      this.isGeneratingImage.set(false);
                      return;
                  }

                  const handleSuccess = (msg: string) => {
                      this.statusMessage.set(msg);
                      const fullOverLimitMap = new Map(this.overLimitCells().map(c => [c.number, c.overLimitAmount]));
                      this.acknowledgedOverLimits.update(currentMap => {
                        const newMap = new Map(currentMap);
                        list.forEach(item => {
                          const totalOverLimit = fullOverLimitMap.get(item.number) || 0;
                          newMap.set(item.number, totalOverLimit);
                        });
                        return newMap;
                      });
                      this.isGeneratingImage.set(false);
                      this.voucherQrCodeUrl.set('');
                      setTimeout(() => this.statusMessage.set(''), 4000);
                  };

                  try {
                      await navigator.clipboard.write([
                          new ClipboardItem({ 'image/png': blob })
                      ]);
                      handleSuccess('Img Copy ကူးပြီးပါပြီ! Messenger တွင် Paste (Ctrl+V) ချနိုင်ပါပြီ။');
                  } catch (err) {
                      console.warn('Clipboard write failed, showing preview...', err);
                      // Fallback: Show Image Preview Modal
                      const url = URL.createObjectURL(blob);
                      this.previewImageUrl.set(url);
                      this.showImagePreview.set(true);
                      handleSuccess('အလိုအလျောက် Copy မရပါ။ ပုံကို ဖိနှိပ်ပြီး Copy ယူပေးပါ။');
                  }
              }, 'image/png');
          } catch (e) {
              console.error(e);
              this.isGeneratingImage.set(false);
              this.statusMessage.set('Error generating image.');
              this.voucherQrCodeUrl.set(''); // Clean up
          }
      }, 100);
  }

  async copyHeldListAsImage() {
      if (typeof html2canvas === 'undefined') {
          alert('Error: Image generation library not loaded.');
          return;
      }
      const list = this.heldOverLimitNumbers();
      if (list.length === 0) {
          this.statusMessage.set('ထုတ်ရန် စာရင်းမရှိပါ။');
          setTimeout(() => this.statusMessage.set(''), 2000);
          return;
      }

      this.isGeneratingImage.set(true);
      this.imageGenerationTime.set(this.datePipe.transform(new Date(), 'dd/MM/yyyy, h:mm:ss a') || '');
      
      await this.prepareVoucherWithQr(list);
      
      setTimeout(async () => {
          const element = document.getElementById('held-voucher-capture');
          if (!element) {
              this.isGeneratingImage.set(false);
              return;
          }

          try {
              const canvas = await html2canvas(element, {
                  scale: 3, // Increased scale for clearer QR
                  backgroundColor: '#ffffff', 
                  logging: false,
                  useCORS: true
              });

              canvas.toBlob(async (blob: Blob | null) => {
                  if(!blob) {
                      this.statusMessage.set('Image generation failed.');
                      this.isGeneratingImage.set(false);
                      return;
                  }

                  const handleSuccess = (msg: string) => {
                      this.statusMessage.set(msg);
                      // After copying, move from held to acknowledged.
                      this.acknowledgedOverLimits.update(ackMap => {
                         const newAckMap = new Map(ackMap);
                         list.forEach(item => {
                             const currentAck = newAckMap.get(item.number) || 0;
                             newAckMap.set(item.number, currentAck + item.overLimitAmount);
                         });
                         return newAckMap;
                      });

                      this.heldOverLimits.update(heldMap => {
                         const newHeldMap = new Map(heldMap);
                         list.forEach(item => {
                             newHeldMap.delete(item.number);
                         });
                         return newHeldMap;
                      });
                      this.isGeneratingImage.set(false);
                      this.voucherQrCodeUrl.set('');
                      setTimeout(() => this.statusMessage.set(''), 4000);
                  };

                  try {
                      await navigator.clipboard.write([
                          new ClipboardItem({ 'image/png': blob })
                      ]);
                      handleSuccess('Held Img Copy ကူးပြီးပါပြီ! Messenger တွင် Paste (Ctrl+V) ချနိုင်ပါပြီ။');
                  } catch (err) {
                      console.warn('Clipboard write failed, showing preview...', err);
                      // Fallback: Show Image Preview Modal
                      const url = URL.createObjectURL(blob);
                      this.previewImageUrl.set(url);
                      this.showImagePreview.set(true);
                      handleSuccess('အလိုအလျောက် Copy မရပါ။ ပုံကို ဖိနှိပ်ပြီး Copy ယူပေးပါ။');
                  }
                  
              }, 'image/png');
          } catch (e) {
              console.error(e);
              this.isGeneratingImage.set(false);
              this.statusMessage.set('Error generating image.');
              this.voucherQrCodeUrl.set(''); // Clean up
          }
      }, 100);
  }

  // --- Methods: Paste Handling ---
  async handlePaste(event: ClipboardEvent, target: 'main' | 'inbox') {
    const clipboardData = event.clipboardData;
    if (!clipboardData) {
      return;
    }

    // Prioritize text paste. If plain text is available, let the browser handle it.
    // The default browser action is the most reliable way to paste text.
    if (clipboardData.types.includes('text/plain')) {
      return;
    }

    // If no text, check for an image file for QR code scanning.
    if (clipboardData.files && clipboardData.files.length > 0) {
      const file = clipboardData.files[0];
      if (file.type.startsWith('image/')) {
        event.preventDefault(); // We are handling this paste.

        this.statusMessage.set('ပုံကို စစ်ဆေးနေသည်...');
        const qrDataString = await this.qrService.scanQrCodeFromBlob(file);

        if (qrDataString) {
          try {
            const qrData: QrBetData = JSON.parse(qrDataString);
            if (qrData.v === 1 && Array.isArray(qrData.d)) {
              const formattedText = qrData.d.map(bet => `${bet[0]} ${bet[1]}`).join('\n');
              
              if (target === 'main') {
                this.userInput.set(formattedText);
                this.statusMessage.set('QR မှ စာရင်းသွင်းပြီးပါပြီ။');
              } else { // target === 'inbox'
                this.updateInboxInput(formattedText); // Sets the text area
                
                if (qrData.a && typeof qrData.a === 'string') {
                    const agentName = qrData.a;
                    this.selectedAgentForInbox.set(agentName);
                    
                    const existing = this.agents().find(a => a.name.toLowerCase() === agentName.toLowerCase());
                    if (!existing) {
                        const newAgent = { name: agentName, commission: 15 }; // Default commission
                        this.agents.update(a => [...a, newAgent]);
                        this.persistenceService.set('lottery_agents', this.agents());
                        this.statusMessage.set(`QR မှ Agent '${agentName}' အသစ်ကိုတွေ့ရှိပြီး အလိုအလျောက် ရွေးချယ်လိုက်သည်။`);
                    } else {
                        this.statusMessage.set(`QR မှ Agent '${agentName}' ၏ စာရင်းကို အလိုအလျောက် ရွေးချယ်ပြီးပါပြီ။`);
                    }
                } else {
                    this.statusMessage.set('QR မှ စာရင်းသွင်းပြီးပါပြီ။ Agent ကို ရွေးချယ်ပေးပါ။');
                }
              }
            } else {
              throw new Error('Invalid QR data format');
            }
          } catch (e) {
            console.error("QR parse error", e);
            this.statusMessage.set('QR Code မှ အချက်အလက်များ မှားယွင်းနေပါသည်။');
          }
        } else {
          this.statusMessage.set('QR Code မတွေ့ရှိပါ');
        }

        setTimeout(() => this.statusMessage.set(''), 3000);
      }
    }
  }

  // --- Methods: Persistence ---
  saveToStorage() {
      const key = `app_state_${this.lotteryType()}_${this.activeMode()}`;
      const data = {
          history: this.history(),
          limitGroups: this.limitGroups(),
          bookieName: this.bookieName(),
          payoutRate: this.payoutRate(),
          defaultLimit: this.defaultLimit(),
          commissionToPay: this.commissionToPay(),
          commissionFromUpperBookie: this.commissionFromUpperBookie(),
          currencySymbol: this.currencySymbol(),
          heldNumberStatus: Array.from(this.heldNumberStatus()),
          acknowledgedOverLimits: Array.from(this.acknowledgedOverLimits().entries()),
          heldOverLimits: Array.from(this.heldOverLimits().entries())
      };
      this.persistenceService.set(key, data);
  }
  
  async loadState() {
      const key = `app_state_${this.lotteryType()}_${this.activeMode()}`;
      const data = await this.persistenceService.get<any>(key);
      if (data) {
          if (data.history) this.history.set(data.history);
          if (data.limitGroups) {
              this.limitGroups.set(data.limitGroups);
          } else {
              this.limitGroups.set([]);
          }
          
          if (data.bookieName) this.bookieName.set(data.bookieName);
          if (data.payoutRate !== undefined) this.payoutRate.set(data.payoutRate);
          if (data.defaultLimit !== undefined) this.defaultLimit.set(data.defaultLimit);
          if (data.commissionToPay !== undefined) this.commissionToPay.set(data.commissionToPay);
          if (data.commissionFromUpperBookie !== undefined) this.commissionFromUpperBookie.set(data.commissionFromUpperBookie);
          if (data.currencySymbol) this.currencySymbol.set(data.currencySymbol);
          
          if (data.heldNumberStatus && Array.isArray(data.heldNumberStatus)) {
              this.heldNumberStatus.set(new Set(data.heldNumberStatus));
          } else {
              this.heldNumberStatus.set(new Set());
          }

          if (data.acknowledgedOverLimits && Array.isArray(data.acknowledgedOverLimits)) {
              this.acknowledgedOverLimits.set(new Map(data.acknowledgedOverLimits));
          } else {
              this.acknowledgedOverLimits.set(new Map());
          }

          if (data.heldOverLimits && Array.isArray(data.heldOverLimits)) {
              this.heldOverLimits.set(new Map(data.heldOverLimits));
          } else {
              this.heldOverLimits.set(new Map());
          }

      } else {
          this.history.set([]);
          this.limitGroups.set([]);
          this.bookieName.set('My Shop');
          this.acknowledgedOverLimits.set(new Map());
          this.heldOverLimits.set(new Map());
          this.heldNumberStatus.set(new Set());
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
  
  clearAllCustomLimits() { 
      this.limitGroups.set([]);
      this.saveToStorage();
      this.sanitizeOverLimitMaps();
  }
  
  openLimitModal(num?: string) { 
      if(num) {
          this.limitManageNumber.set(num);
          // Check if this number has a specific limit in the computed map
          const existingLimit = this.customLimits().get(num);
          if (existingLimit !== undefined) {
              this.limitManageAmount.set(existingLimit);
          } else {
              // If no custom limit, show the default limit
              this.limitManageAmount.set(this.defaultLimit());
          }
      } else {
          // New/General entry
          this.limitManageNumber.set('');
          this.limitManageAmount.set(this.defaultLimit());
      }
      this.showLimitManagementModal.set(true); 
  }
  closeLimitModal() { this.showLimitManagementModal.set(false); }
  
  saveIndividualLimit() {
      const name = this.limitManageNumber();
      const amt = this.limitManageAmount();
      
      if (name) {
          const dummyInput = `${name} 1`; 
          const results = this.betParsingService.parseRaw(dummyInput, this.lotteryType());
          
          if (results.length > 0) {
              const numbers = Array.from(new Set(results.map(r => r.number))).sort();
              
              const newGroup: LimitGroup = {
                  id: Date.now().toString(),
                  name: name,
                  amount: amt,
                  numbers: numbers,
                  isOpen: false
              };

              this.limitGroups.update(groups => [newGroup, ...groups]);
          }
      } else if (!name && amt > 0) {
          this.defaultLimit.set(amt);
      }
      
      this.saveToStorage();
      this.sanitizeOverLimitMaps();
      this.closeLimitModal();
  }
  
  removeLimitGroup(id: string) {
      this.limitGroups.update(groups => groups.filter(g => g.id !== id));
      this.saveToStorage();
      this.sanitizeOverLimitMaps();
  }

  updateGroupAmount(id: string, newAmount: number) {
      this.limitGroups.update(groups => groups.map(g => {
          if (g.id === id) return { ...g, amount: newAmount };
          return g;
      }));
      this.saveToStorage();
      this.sanitizeOverLimitMaps();
  }

  toggleGroup(id: string) {
      this.limitGroups.update(groups => groups.map(g => {
          if (g.id === id) return { ...g, isOpen: !g.isOpen };
          return g;
      }));
  }

  applyBatchLimitChange(type: 'add' | 'sub' | 'set') {
      const val = this.batchLimitAmount();
      if (val <= 0 && type !== 'set') return;
      if (val < 0) return;

      this.limitGroups.update(groups => groups.map(g => {
          let newAmount = g.amount;
          if (type === 'add') newAmount += val;
          if (type === 'sub') newAmount = Math.max(0, newAmount - val);
          if (type === 'set') newAmount = val;
          
          return { ...g, amount: newAmount };
      }));
      
      this.saveToStorage();
      this.sanitizeOverLimitMaps();
  }

  // --- Inbox / Chat Import ---
  handleChatImport(data: {text: string, agentName: string}) {
      this.showChat.set(false);
      this.inboxInput.set(data.text);
      this.selectedAgentForInbox.set(data.agentName); 
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
  
  isInboxSubmitDisabled() { return !this.inboxInput() || !this.selectedAgentForInbox(); }

  updateInboxInput(val: string) {
      this.inboxInput.set(val);
      
      const lines = val.split('\n');
      for (const line of lines) {
          const trimmed = line.trim();
          const match = trimmed.match(/^[-=_]{3,}\s*(.+?)\s*[-=_]{3,}$/);
          if (match) {
              const detectedName = match[1].trim();
              if (detectedName) {
                  const existing = this.agents().find(a => a.name.toLowerCase() === detectedName.toLowerCase());
                  if (existing) {
                      this.selectedAgentForInbox.set(existing.name);
                  } else {
                      const newAgent = { name: detectedName, commission: 15 };
                      this.agents.update(a => [...a, newAgent]);
                      this.persistenceService.set('lottery_agents', this.agents());
                      this.selectedAgentForInbox.set(detectedName);
                      
                      this.statusMessage.set(`Agent '${detectedName}' အသစ်တွေ့ရှိပြီး ထည့်သွင်းလိုက်သည်။`);
                      setTimeout(() => this.statusMessage.set(''), 2000);
                  }
              }
              break; 
          }
      }
  }
  
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
      
      // Global totals from Grid
      const cellAmount = winCell ? winCell.amount : 0; 
      const limit = this.customLimits().get(win) ?? this.defaultLimit();
      const payoutRate = this.payoutRate();
      const agents = this.agents();
      const hist = this.history(); // Chronological order is guaranteed by array push

      // Tracking stats per source
      const stats = new Map<string, {
          isAgent: boolean,
          commissionRate: number,
          totalSales: number,
          winBetTotal: number, // Total bet on winning number by this source
          winBetHeld: number,  // Portion of bet within limit
          winBetOver: number,  // Portion of bet over limit
          betsOnWin: string[] // List of "amount" strings for display
      }>();

      // Helper to get or init stats object
      const getStats = (sourceName: string, isAgent: boolean, comm: number) => {
          if (!stats.has(sourceName)) {
              stats.set(sourceName, {
                  isAgent,
                  commissionRate: comm,
                  totalSales: 0,
                  winBetTotal: 0,
                  winBetHeld: 0,
                  winBetOver: 0,
                  betsOnWin: []
              });
          }
          return stats.get(sourceName)!;
      };

      let runningWinTotal = 0;

      // 1. Process History Chronologically to determine Hold vs Over-Limit logic (FIFO)
      for (const entry of hist) {
          if (entry.bets) {
              for (const bet of entry.bets) {
                  // Determine Source & Commission
                  let sourceName = bet.source;
                  let isAgent = false;
                  let comm = this.commissionToPay(); // Default for direct inputs

                  // Clean source string to match agent names
                  const cleanSource = sourceName.replace('Inbox: ', '').trim();
                  
                  const agent = agents.find(a => a.name.toLowerCase() === cleanSource.toLowerCase());
                  if (agent) {
                      sourceName = agent.name; 
                      isAgent = true;
                      comm = agent.commission;
                  } else {
                      // Normalize 'Inbox: Name' to just 'Name' if not in agent list, or keep as is?
                      // Keeping distinct allows ad-hoc sources.
                      if (sourceName.startsWith('Inbox: ')) {
                          sourceName = sourceName.replace('Inbox: ', '');
                      }
                  }

                  const stat = getStats(sourceName, isAgent, comm);
                  
                  // Accumulate Sales
                  stat.totalSales += bet.amount;

                  // Check if this bet is on the winning number
                  if (bet.number === win) {
                      stat.winBetTotal += bet.amount;
                      stat.betsOnWin.push(bet.amount.toLocaleString());

                      // Calculate Held vs Over (FIFO logic based on running total)
                      const spaceRemaining = Math.max(0, limit - runningWinTotal);
                      const heldPortion = Math.min(bet.amount, spaceRemaining);
                      const overPortion = bet.amount - heldPortion;

                      stat.winBetHeld += heldPortion;
                      stat.winBetOver += overPortion;

                      runningWinTotal += bet.amount;
                  }
              }
          }
      }

      // 2. Transform stats into Payout Objects for the UI
      const agentPayouts: any[] = [];
      const otherPayouts: any[] = [];

      stats.forEach((s, name) => {
          const commissionAmount = s.totalSales * (s.commissionRate / 100);
          const netSales = s.totalSales - commissionAmount;
          
          const totalWinAmount = s.winBetTotal * payoutRate; // Theoretical win if no limit
          const overLimitWinAmount = s.winBetOver * payoutRate; // Win amount that was cut
          const heldWinAmount = s.winBetHeld * payoutRate; // Actual Payout to be made
          
          const finalBalance = netSales - heldWinAmount; // Positive = Receive from Agent, Negative = Pay to Agent

          const dto = {
              name: name,
              totalSales: s.totalSales,
              commissionAmount: commissionAmount,
              netSales: netSales,
              individualBets: s.betsOnWin,
              
              totalWinBetAmount: s.winBetTotal,
              totalWinAmount: totalWinAmount,
              
              overLimitWinBetAmount: s.winBetOver,
              overLimitWinAmount: overLimitWinAmount,
              
              heldWinBetAmount: s.winBetHeld,
              payout: heldWinAmount,
              
              finalBalance: finalBalance
          };

          if (s.isAgent) {
              agentPayouts.push(dto);
          } else {
              otherPayouts.push(dto);
          }
      });

      // Calculate totals for the summary header based on actual grid limits
      const winCellAmount = winCell ? winCell.amount : 0;
      const winCellOver = Math.max(0, winCellAmount - limit);
      const totalHeldWin = winCellAmount - winCellOver; 

      this.payoutDetails.set({
          winningNumber: win,
          totalBet: this.totalBetAmount(),
          totalOverLimitBet: this.totalOverLimitAmount(),
          totalHeldBet: this.totalHeldAmount(),
          totalHeldPayout: totalHeldWin * payoutRate,
          agentPayouts: agentPayouts.sort((a,b) => b.totalSales - a.totalSales), 
          otherPayouts: otherPayouts.sort((a,b) => b.totalSales - a.totalSales)
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
      const num = bet.number || (bet as any).number;
      if (num) {
        this.userInput.set(`${num} ${bet.amount}`);
      }
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
      this.sanitizeOverLimitMaps();
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

  // --- Agents Management ---
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

  // --- Reports ---
  saveReport() {
      const report: AppReport = {
          id: `report_${Date.now()}`,
          lotteryType: this.lotteryType(),
          date: new Date().toISOString(),
          session: this.session(), 
          mode: this.activeMode(),
          totalBetAmount: this.totalBetAmount(),
          totalOverLimitAmount: this.totalOverLimitAmount(),
          totalHeldAmount: this.totalHeldAmount(),
          payableCommissionAmount: this.payableCommissionAmount(),
          receivableCommissionAmount: this.receivableCommissionAmount(),
          agentCommissionEarned: 0, // No longer applicable
          netAmount: this.netAmount(),
          lotteryData: this.gridCells().filter(c => c.amount > 0).map(c => [c.number, c.amount] as [string, number]),
          betHistory: this.history().map(h => h.input),
          bookieName: this.bookieName(),
          defaultLimit: this.defaultLimit(),
          payoutRate: this.payoutRate(),
          commissionToPay: this.commissionToPay(),
          agentCommissionFromBookie: 0,
          commissionFromUpperBookie: this.commissionFromUpperBookie(),
          individualLimits: [] as [string, number][],
          upperBookies: this.upperBookies(),
          agents: this.agents(),
          currencySymbol: this.currencySymbol()
      };
      
      this.persistenceService.saveReport(report);
      this.statusMessage.set('Report saved.');
      setTimeout(() => this.statusMessage.set(''), 2000);
  }
  
  handleReportRestore(r: AppReport) {
    this.history.set([]);
    // FIX(2024-07-29): The property r.betHistory comes from persisted data and may not be a string array.
    // Safely handle this by checking if it's an array and if each item is a string before processing.
    const betHistory: unknown = r.betHistory;
    if (Array.isArray(betHistory)) {
      betHistory.forEach(input => {
        if (typeof input === 'string') {
          const bets = this.betParsingService.parseRaw(input, r.lotteryType);
          this.processNewBets(bets, 'Restored', input);
        }
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