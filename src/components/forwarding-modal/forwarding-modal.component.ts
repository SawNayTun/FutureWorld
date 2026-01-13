import { Component, ChangeDetectionStrategy, input, output, signal, OnInit, computed, effect } from '@angular/core';
import { UpperBookie } from '../../models/app.models';

// FIX: Export Bet and Assignments types so they can be imported by other components.
export type Bet = { number: string; amount: number; originalId: string; };
export type Assignments = Record<string, Bet[]>; // Key is bookie name or 'unassigned'

@Component({
  selector: 'app-forwarding-modal',
  templateUrl: './forwarding-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForwardingModalComponent implements OnInit {
  overLimitNumbers = input.required<{ number: string, amount: number }[]>();
  upperBookies = input.required<UpperBookie[]>();
  close = output<Assignments | null>();

  assignments = signal<Assignments>({});
  draggedBet = signal<{ from: string, bet: Bet } | null>(null);
  dragOverBookie = signal<string | null>(null);
  copiedMessage = signal('');

  bookieKeys = computed(() => Object.keys(this.assignments()));

  ngOnInit(): void {
    this.initializeAssignments();
  }

  private initializeAssignments(): void {
    const initialAssignments: Assignments = { unassigned: [] };
    const bookies = this.upperBookies();
    
    if (bookies.length === 0) {
      initialAssignments['unassigned'] = this.overLimitNumbers().map((bet, index) => ({ ...bet, originalId: `${bet.number}-${index}` }));
      this.assignments.set(initialAssignments);
      return;
    }

    bookies.forEach(b => initialAssignments[b.name] = []);

    this.overLimitNumbers().forEach((bet, index) => {
      const amountPerBookie = Math.floor(bet.amount / bookies.length);
      let remainder = bet.amount % bookies.length;

      bookies.forEach((bookie, bookieIndex) => {
        let finalAmount = amountPerBookie;
        if (remainder > 0) {
          finalAmount++;
          remainder--;
        }
        if (finalAmount > 0) {
           initialAssignments[bookie.name].push({ ...bet, amount: finalAmount, originalId: `${bet.number}-${index}-${bookieIndex}` });
        }
      });
    });

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
      const newAssignments = JSON.parse(JSON.stringify(current));
      
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
    const originalAmount = bet.amount;

    if (isNaN(newAmount) || newAmount < 0) {
      inputElement.value = originalAmount.toString();
      return;
    }
    
    const remainder = originalAmount - newAmount;
    
    if (remainder < 0) { // Can't increase amount, only decrease to split
       inputElement.value = originalAmount.toString();
       return;
    }

    if (remainder > 0) {
      this.assignments.update(current => {
        const newAssignments = JSON.parse(JSON.stringify(current));
        
        // Update current bet
        if (newAmount > 0) {
            const betToUpdate = newAssignments[bookieName].find((b: Bet) => b.originalId === bet.originalId);
            if(betToUpdate) betToUpdate.amount = newAmount;
        } else {
            // Remove if amount is zero
            newAssignments[bookieName] = newAssignments[bookieName].filter((b: Bet) => b.originalId !== bet.originalId);
        }

        // Add remainder to unassigned (merge if exists)
        if (!newAssignments['unassigned']) newAssignments['unassigned'] = [];
        const existingIndex = newAssignments['unassigned'].findIndex((b: Bet) => b.number === bet.number);
        if(existingIndex > -1) {
          newAssignments['unassigned'][existingIndex].amount += remainder;
        } else {
          newAssignments['unassigned'].push({ number: bet.number, amount: remainder, originalId: `${bet.number}-split-${Date.now()}` });
        }

        return newAssignments;
      });
    }
  }

  getBookieTotal(bookieName: string): number {
    return (this.assignments()[bookieName] || []).reduce((sum, bet) => sum + bet.amount, 0);
  }

  getFormattedListForCopy(bookieName: string): string {
    const bets = this.assignments()[bookieName] || [];
    return bets.map(b => `${b.number} ${b.amount}`).join(', ');
  }

  copyToClipboard(text: string): void {
    if (text) {
      navigator.clipboard.writeText(text);
      this.copiedMessage.set('ကူးယူပြီးပါပြီ!');
      setTimeout(() => this.copiedMessage.set(''), 2000);
    }
  }

  closePanel(save: boolean): void {
    if (save) {
      this.close.emit(this.assignments());
    } else {
      this.close.emit(null); // Indicate cancellation
    }
  }
}
