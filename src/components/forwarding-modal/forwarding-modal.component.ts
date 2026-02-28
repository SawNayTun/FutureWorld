
import { Component, ChangeDetectionStrategy, input, output, signal, OnInit, computed, effect, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { UpperBookie } from '../../models/app.models';

// FIX: Export Bet and Assignments types so they can be imported by other components.
export type Bet = { number: string; amount: number; originalId: string; };
export type Assignments = Record<string, Bet[]>; // Key is bookie name or 'unassigned'

declare var html2canvas: any;

@Component({
  selector: 'app-forwarding-modal',
  templateUrl: './forwarding-modal.component.html',
  styleUrls: ['./forwarding-modal.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule],
  providers: [DatePipe]
})
export class ForwardingModalComponent implements OnInit {
  private datePipe = inject(DatePipe);

  overLimitNumbers = input.required<{ number: string, amount: number }[]>();
  upperBookies = input.required<UpperBookie[]>();
  bookieName = input.required<string>();
  session = input.required<'morning' | 'evening'>();
  drawDate = input.required<string>();
  lotteryType = input.required<'2D' | '3D'>();
  currencySymbol = input.required<'K' | '฿' | '¥'>();
  close = output<Assignments | null>();

  assignments = signal<Assignments>({});
  draggedBet = signal<{ from: string, bet: Bet } | null>(null);
  dragOverBookie = signal<string | null>(null);
  copiedMessage = signal('');
  captureTime = signal('');
  
  // Image Preview Modal State
  showImagePreview = signal(false);
  previewImageUrl = signal('');

  bookieKeys = computed(() => Object.keys(this.assignments()));

  ngOnInit(): void {
    this.initializeAssignments();
  }

  private initializeAssignments(): void {
    const initialAssignments: Assignments = { unassigned: [] };
    const bookies = this.upperBookies();
    
    bookies.forEach(b => initialAssignments[b.name] = []);
    initialAssignments['unassigned'] = this.overLimitNumbers().map((bet, index) => ({ ...bet, originalId: `${bet.number}-${index}` }));
    
    this.assignments.set(initialAssignments);
  }

  onDragStart(event: DragEvent, fromBookie: string, bet: Bet): void {
    this.draggedBet.set({ from: fromBookie, bet });
    event.dataTransfer!.effectAllowed = 'move';
    event.dataTransfer!.setData('text/plain', bet.originalId); // Necessary for Firefox
  }

  onDragOver(event: DragEvent, bookieName: string): void {
    event.preventDefault();
    this.dragOverBookie.set(bookieName);
  }

  onDragLeave(event: DragEvent): void {
    this.dragOverBookie.set(null);
  }

  onDrop(event: DragEvent, toBookie: string): void {
    event.preventDefault();
    const draggedItem = this.draggedBet();
    if (!draggedItem || draggedItem.from === toBookie) {
      this.dragOverBookie.set(null);
      return;
    }
    
    this.assignments.update(current => {
      const newAssignments = JSON.parse(JSON.stringify(current)) as Assignments;
      
      // Remove from source
      newAssignments[draggedItem.from] = newAssignments[draggedItem.from].filter((b: Bet) => b.originalId !== draggedItem.bet.originalId);
      
      // Add to destination (and merge)
      if (!newAssignments[toBookie]) newAssignments[toBookie] = [];
      const existingBetIndex = newAssignments[toBookie].findIndex((b: Bet) => b.number === draggedItem.bet.number);
      if(existingBetIndex > -1) {
        newAssignments[toBookie][existingBetIndex].amount += draggedItem.bet.amount;
      } else {
         newAssignments[toBookie].push(draggedItem.bet);
      }

      return newAssignments;
    });

    this.draggedBet.set(null);
    this.dragOverBookie.set(null);
  }

  onAmountChange(event: Event, bookieName: string, bet: Bet): void {
    const inputElement = event.target as HTMLInputElement;
    const newAmount = parseInt(inputElement.value, 10);
    
    if (isNaN(newAmount) || newAmount < 0) {
      inputElement.value = bet.amount.toString();
      return;
    }

    this.assignments.update(current => {
        // Explicitly cast to Assignments to prevent 'any' type inference
        const newAssignments = JSON.parse(JSON.stringify(current)) as Assignments;
        
        const originalBetList = newAssignments[bookieName];
        if (!originalBetList) return current;

        const betToUpdateIndex = originalBetList.findIndex((b: Bet) => b.originalId === bet.originalId);
        if (betToUpdateIndex === -1) return current;

        const originalAmount = originalBetList[betToUpdateIndex].amount;
        const remainder = originalAmount - newAmount;

        // Update current bet
        if (newAmount > 0) {
            originalBetList[betToUpdateIndex].amount = newAmount;
        } else {
            // Remove if amount is zero or less
            originalBetList.splice(betToUpdateIndex, 1);
        }

        // Add remainder back to unassigned (merge if exists)
        if (remainder > 0) {
          if (!newAssignments['unassigned']) newAssignments['unassigned'] = [];
          const existingIndex = newAssignments['unassigned'].findIndex((b: Bet) => b.number === bet.number);
          if(existingIndex > -1) {
            newAssignments['unassigned'][existingIndex].amount += remainder;
          } else {
            newAssignments['unassigned'].push({ number: bet.number, amount: remainder, originalId: `${bet.number}-split-${Date.now()}` });
          }
        } else if (remainder < 0) {
            // If newAmount > originalAmount, we need to pull from unassigned
            let deficit = -remainder;
            
            if (!newAssignments['unassigned']) newAssignments['unassigned'] = [];
            const unassignedBetIndex = newAssignments['unassigned'].findIndex((b: Bet) => b.number === bet.number);
            
            if (unassignedBetIndex > -1) {
                const availableAmount = newAssignments['unassigned'][unassignedBetIndex].amount;
                // FIX: Cast availableAmount to a number for comparison to prevent type errors.
                if (Number(availableAmount) >= deficit) {
                    newAssignments['unassigned'][unassignedBetIndex].amount -= deficit;
                    if (newAssignments['unassigned'][unassignedBetIndex].amount === 0) {
                        newAssignments['unassigned'].splice(unassignedBetIndex, 1);
                    }
                } else {
                    // Not enough in unassigned, revert change
                    originalBetList[betToUpdateIndex].amount = originalAmount;
                }
            } else {
                 // Not enough in unassigned, revert change
                 if (betToUpdateIndex > -1) {
                     originalBetList[betToUpdateIndex].amount = originalAmount;
                 } else if (newAmount > 0) {
                     originalBetList.push({ number: bet.number, amount: originalAmount, originalId: bet.originalId });
                 }
            }
        }

        return newAssignments;
      });
  }

  getBookieTotal(bookieName: string): number {
    return (this.assignments()[bookieName] || []).reduce((sum, bet) => sum + bet.amount, 0);
  }

  private formatListForCopy(bookieNameToFormat: string): string {
    const bets = this.assignments()[bookieNameToFormat] || [];
    if (bets.length === 0) return 'စာရင်းမရှိပါ';

    const header = `--- ${bookieNameToFormat} ---`;
    
    // Date
    let dateLine = '';
    if (this.lotteryType() === '2D') {
        const d = new Date();
        const dateStr = this.datePipe.transform(d, 'dd/MM/yyyy');
        const sessionText = this.session() === 'morning' ? 'မနက်ပိုင်း' : 'ညနေပိုင်း';
        dateLine = `နေ့စွဲ - ${dateStr} (${sessionText})`;
    } else {
        const d = new Date(this.drawDate());
        const dateStr = !isNaN(d.getTime()) ? this.datePipe.transform(d, 'dd/MM/yyyy') : this.drawDate();
        dateLine = `နေ့စွဲ - ${dateStr}`;
    }

    const separator = '--------------------';
    const totalAmount = this.getBookieTotal(bookieNameToFormat);
    const totalCount = bets.length;
    const sortedBets = [...bets].sort((a, b) => a.number.localeCompare(b.number));
    
    let body = `${separator}\n`;
    
    sortedBets.forEach((bet, index) => {
        body += `${bet.number} = ${bet.amount.toLocaleString()}\n`;
        // Add separator after every 10 items (but not after the last one)
        if ((index + 1) % 10 === 0 && (index + 1) < sortedBets.length) {
            body += `${separator}\n`;
        }
    });
    
    body += `${separator}\n`;
    
    const footer = `စုစုပေါင်း: (${totalCount}) ကွက် - ${totalAmount.toLocaleString()} ${this.currencySymbol()}`;

    return `${header}\n${dateLine}\n${body}${footer}`;
  }

  copyBookieList(bookieName: string): void {
    const textToCopy = this.formatListForCopy(bookieName);
    this.copyToClipboard(textToCopy);
  }

  closeImagePreview() {
      if (this.previewImageUrl()) {
          URL.revokeObjectURL(this.previewImageUrl());
      }
      this.previewImageUrl.set('');
      this.showImagePreview.set(false);
  }

  async copyAsImage(bookieName: string, index: number) {
      if (typeof html2canvas === 'undefined') {
          alert('Error: Image generation library not loaded.');
          return;
      }

      // Changed target to the hidden white grid template
      const element = document.getElementById(`hidden-voucher-${index}`);
      if(!element) {
          console.error(`Element hidden-voucher-${index} not found`);
          return;
      }

      this.copiedMessage.set('ပုံထုတ်နေသည်... (Generating Image)');
      this.captureTime.set(this.formatDateForVoucher(new Date()));

      setTimeout(async () => {
        try {
            // 1. Generate Canvas from DOM
            const canvas = await html2canvas(element, {
                scale: 1.5, // Reduced scale for speed (was 2)
                backgroundColor: '#ffffff', // White Background as requested
                logging: false,
                useCORS: true
            });

            // 2. Convert to Blob
            canvas.toBlob(async (blob: Blob | null) => {
                if(!blob) {
                    this.copiedMessage.set('Image generation failed.');
                    return;
                }

                // 3. Try Copy or Fallback to Download
                try {
                    // This requires Secure Context (HTTPS or Localhost)
                    await navigator.clipboard.write([
                        new ClipboardItem({ 'image/png': blob })
                    ]);
                    this.copiedMessage.set('ပုံ Copy ကူးပြီးပါပြီ! Messenger တွင် Paste (Ctrl+V) ချနိုင်ပါပြီ။');
                } catch (err) {
                    console.warn('Clipboard write failed, falling back to download', err);
                    
                    // Fallback: Show Image Preview Modal
                    const url = URL.createObjectURL(blob);
                    this.previewImageUrl.set(url);
                    this.showImagePreview.set(true);
                    
                    this.copiedMessage.set('အလိုအလျောက် Copy မရပါ။ ပုံကို ဖိနှိပ်ပြီး Copy ယူပေးပါ။');
                }
                
                setTimeout(() => this.copiedMessage.set(''), 4000);
            }, 'image/png');

        } catch (e) {
            console.error(e);
            this.copiedMessage.set('Error generating image.');
        }
      }, 50); // Slight delay for rendering
  }

  private copyToClipboard(text: string): void {
    if (text) {
      navigator.clipboard.writeText(text);
      this.copiedMessage.set('စာ Copy ကူးပြီးပါပြီ!');
      setTimeout(() => this.copiedMessage.set(''), 2000);
    }
  }
  
  formatDate(isoString: string): string {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString('en-CA');
  }

  formatDateForVoucher(date: Date): string {
      return date.toLocaleString('en-GB', { 
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true 
      });
  }

  closePanel(save: boolean): void {
    if (save) {
      this.close.emit(this.assignments());
    } else {
      this.close.emit(null); // Indicate cancellation
    }
  }
}
