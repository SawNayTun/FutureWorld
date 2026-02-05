import { Injectable } from '@angular/core';

// --- Constants ---
const POWER_NUMBERS = ['05', '16', '27', '38', '49'];
const NAKHAT_NUMBERS = ['07', '18', '35', '69', '24'];
const NYI_KO_NUMBERS = ['01', '12', '23', '34', '45', '56', '67', '78', '89', '90'];
const EVEN_DIGITS = ['0', '2', '4', '6', '8'];
const ODD_DIGITS = ['1', '3', '5', '7', '9'];

export interface RawBet {
    number: string;
    amount: number;
}

@Injectable({ providedIn: 'root' })
export class BetParsingService {

  // Original method: Returns aggregated totals (Map)
  parse(input: string, lotteryType: '2D' | '3D'): Map<string, number> {
    const newAmounts = new Map<string, number>();
    // Callback sums up amounts for the same number
    this.coreParse(input, lotteryType, (number, amount) => {
        newAmounts.set(number, (newAmounts.get(number) || 0) + amount);
    });
    return newAmounts;
  }

  // New method: Returns list of individual bets (Array) preserving sequence
  parseRaw(input: string, lotteryType: '2D' | '3D'): RawBet[] {
      const bets: RawBet[] = [];
      // Callback pushes each bet to array
      this.coreParse(input, lotteryType, (number, amount) => {
          bets.push({ number, amount });
      });
      return bets;
  }

  private coreParse(input: string, lotteryType: '2D' | '3D', addBetCallback: (n: string, a: number) => void): void {
    const rawLines = input.split(/\r?\n/).filter(l => l.trim());
    const standardProcessingBuffer: string[] = [];

    for (let line of rawLines) {
        const trimmed = line.trim();
        // Filter out obvious metadata lines
        if (/^(agent|session|sub-total|total|နေ့စွဲ|date)/i.test(trimmed)) continue;
        if (trimmed.includes('စုစုပေါင်း') || /^total\s*:/i.test(trimmed)) continue;
        // Ignore separator lines (---, ===, ___) commonly used in vouchers
        if (/^[-=_]{3,}/.test(trimmed)) continue;

        // 1. Pre-process specific Burmese chars (Digits & Keywords) but KEEP delimiters like '='
        const processedLine = this.preProcessBurmese(trimmed);
        
        let handled = false;

        // --- FEATURE 1: Batch Equal Syntax (e.g., 11 12 13 = 100) ---
        const equalMatch = processedLine.match(/^(.+?)\s*=\s*(\d+(?:k)?)$/i);
        if (equalMatch) {
            const numbersPart = equalMatch[1];
            const amount = this.parseAmount(equalMatch[2]);
            
            if (!isNaN(amount)) {
                // Clean separators only in the numbers part
                const cleanedNumbers = numbersPart.replace(/[=/၊,*\-_]/g, ' ');
                const tokens = cleanedNumbers.split(/\s+/).filter(t => t);
                
                tokens.forEach(token => {
                    this.processKey(token, amount, lotteryType, addBetCallback);
                });
                handled = true;
            }
        }

        // --- FEATURE 2: Batch Mixed R Syntax (e.g., 54 87 ... 12r3) ---
        // Logic: 54 87 12r3 => 54 gets 12, 45 gets 3; 87 gets 12, 78 gets 3.
        if (!handled && lotteryType === '2D') {
             const mixedRMatch = processedLine.match(/^(.+?)\s+(\d+(?:k)?)r(\d+(?:k)?)$/i);
             if (mixedRMatch) {
                 const numbersPart = mixedRMatch[1];
                 const directAmt = this.parseAmount(mixedRMatch[2]);
                 const reverseAmt = this.parseAmount(mixedRMatch[3]);

                 if (!isNaN(directAmt) && !isNaN(reverseAmt)) {
                     const cleanedNumbers = numbersPart.replace(/[=/၊,*\-_]/g, ' ');
                     const tokens = cleanedNumbers.split(/\s+/).filter(t => t);
                     
                     tokens.forEach(token => {
                         // We use processKey with a dummy amount to "expand" keywords (e.g. 'apu') into numbers
                         this.processKey(token, 0, lotteryType, (n, _) => {
                             // Apply Direct Amount
                             addBetCallback(n, directAmt);
                             
                             // Apply Reverse Amount logic
                             const rev = n.split('').reverse().join('');
                             // Only apply reverse if it's a different number (not pairs like 55)
                             if (rev !== n) {
                                 addBetCallback(rev, reverseAmt);
                             }
                         });
                     });
                     handled = true;
                 }
             }
        }

        if (!handled) {
            standardProcessingBuffer.push(processedLine);
        }
    }

    // Process remaining lines with standard logic
    let remainingInput = standardProcessingBuffer.join('\n');
    
    // Global cleaning for standard processing (remove special chars)
    remainingInput = remainingInput.replace(/[=/၊,*\-_:]/g, ' ');
    remainingInput = remainingInput.replace(/[¥$£€]/g, ' ');

    // --- Standard Logic from here ---

    // Bulk R Logic: "12 34 56 r 100" -> "12r 100 34r 100..."
    if (lotteryType === '2D') {
        remainingInput = remainingInput.replace(/((?:\b\d{2}\s+)+)r\s+(\d+(?:k)?)\b/gi, (match, numbersPart, amountPart) => {
            const numbers = numbersPart.trim().split(/\s+/);
            return numbers.map((n: string) => `${n}r ${amountPart}`).join(' ');
        });
    }

    const entries = remainingInput.split(/\s+/).map(s => s.trim()).filter(Boolean);

    let i = 0;
    while (i < entries.length) {
        if (i + 1 < entries.length) {
            const potentialKey = entries[i].toLowerCase();
            const amountStr = entries[i+1];
            
            // Inline Mixed Amounts (e.g., 3r2 => 3 gets direct, reverse gets 2) - Standard positional
            if (lotteryType === '2D' && /^\d+(?:k)?r\d+(?:k)?$/i.test(amountStr)) {
                const [directAmtStr, reverseAmtStr] = amountStr.toLowerCase().split('r');
                const directAmount = this.parseAmount(directAmtStr);
                const reverseAmount = this.parseAmount(reverseAmtStr);

                if (!isNaN(directAmount) && !isNaN(reverseAmount)) {
                    if (/^\d{2}$/.test(potentialKey)) {
                        addBetCallback(potentialKey, directAmount);
                        const reversedKey = potentialKey.split('').reverse().join('');
                        if (reversedKey !== potentialKey) {
                            addBetCallback(reversedKey, reverseAmount);
                        }
                        i += 2;
                        continue;
                    }
                }
            }

            const amount = this.parseAmount(amountStr);
            
            if (!isNaN(amount)) {
                const handled = this.processKey(potentialKey, amount, lotteryType, addBetCallback);
                if (handled) {
                    i += 2;
                    continue;
                }
            }
        }
        i++;
    }
  }

  private preProcessBurmese(input: string): string {
    let processed = input;
    
    // Mapping
    const burmeseToEnglishMap: { [key: string]: string } = { 'အပူး': 'apu', 'ညီကို': 'nk', 'ပါဝါ': 'pao', 'နက်ခတ်': 'nat', 'စုံစုံ': 'ss', 'မမ': 'mm', 'စုံမ': 'sm', 'မစုံ': 'ms', 'ဆယ်ပြည့်': 'sp', 'အကုန်': 'all', 'ဘူဘဒိတ်': 'bb', 'ထိပ်': 't', 'ပိတ်': 'p', 'အပါ': 'a', 'ခွေ': 'k', 'ဗြိတ်': 'v', 'ဘဒိတ်': 'b', 'အကပ်': 'ak', 'ပတ်လည်': 'r' };
    
    for (const burmese of Object.keys(burmeseToEnglishMap)) {
        processed = processed.replace(new RegExp(burmese, 'g'), burmeseToEnglishMap[burmese]);
    }
    
    const burmeseDigits = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'];
    burmeseDigits.forEach((digit, index) => {
        processed = processed.replace(new RegExp(digit, 'g'), index.toString());
    });

    return processed;
  }

  private parseAmount(amountStr: string): number {
      let cleanStr = amountStr.replace(/[¥$£€]/g, '');
      const isK = cleanStr.toLowerCase().endsWith('k');
      cleanStr = cleanStr.replace(/[^0-9.]/g, '');
      
      let amount = parseFloat(cleanStr);
      if (isNaN(amount)) return NaN;
      
      if (isK) amount *= 1000;
      return amount;
  }

  private getUniquePermutations(str: string): string[] {
      if (str.length === 1) return [str];
      const results = new Set<string>();
      
      const permute = (arr: string[], m: string[] = []) => {
          if (arr.length === 0) {
              results.add(m.join(''));
          } else {
              for (let i = 0; i < arr.length; i++) {
                  let curr = arr.slice();
                  let next = curr.splice(i, 1);
                  permute(curr.slice(), m.concat(next));
              }
          }
      }
      permute(str.split(''));
      return Array.from(results);
  }

  // Returns true if the key was valid and bets were generated/added
  private processKey(numPart: string, amount: number, lotteryType: '2D' | '3D', addBet: (n: string, a: number) => void): boolean {
    const add2D = (n: string, a: number) => { if (n && n.length === 2 && !isNaN(parseInt(n))) { addBet(n, a); } };
    const addPair2D = (n: string, a: number) => { add2D(n, a); if (n[0] !== n[1]) { add2D(n.split('').reverse().join(''), a); } };
    const add3D = (n: string, a: number) => { if (n && n.length === 3 && !isNaN(parseInt(n))) { addBet(n, a); } };

    let matched = false;

    if (lotteryType === '2D') {
        if (numPart.endsWith('r')) { 
            const baseNum = numPart.slice(0, -1); 
            if (baseNum.length === 2 && !isNaN(parseInt(baseNum))) { 
                // Logic: 12r 100 => 12=50, 21=50
                const halfAmount = amount / 2;
                add2D(baseNum, halfAmount); 
                add2D(baseNum.split('').reverse().join(''), halfAmount); 
                matched = true; 
            } 
        } else if (['apu'].includes(numPart)) { for (let j = 0; j < 10; j++) add2D(`${j}${j}`, amount); matched = true; }
        else if (['nk'].includes(numPart)) { NYI_KO_NUMBERS.forEach(n => addPair2D(n, amount)); matched = true; }
        else if (['pao'].includes(numPart)) { POWER_NUMBERS.forEach(n => addPair2D(n, amount)); matched = true; }
        else if (['nat'].includes(numPart)) { NAKHAT_NUMBERS.forEach(n => addPair2D(n, amount)); matched = true; }
        
        else if (['ss'].includes(numPart)) { 
            EVEN_DIGITS.forEach(d1 => EVEN_DIGITS.forEach(d2 => {
                if (d1 !== d2) add2D(`${d1}${d2}`, amount);
            })); 
            matched = true; 
        }
        else if (['mm'].includes(numPart)) { 
            ODD_DIGITS.forEach(d1 => ODD_DIGITS.forEach(d2 => {
                if (d1 !== d2) add2D(`${d1}${d2}`, amount);
            })); 
            matched = true; 
        }
        else if (['ssp'].includes(numPart)) {
            EVEN_DIGITS.forEach(d1 => EVEN_DIGITS.forEach(d2 => {
                if (d1 === d2) add2D(`${d1}${d2}`, amount);
            }));
            matched = true;
        }
        else if (['mmp'].includes(numPart)) {
            ODD_DIGITS.forEach(d1 => ODD_DIGITS.forEach(d2 => {
                if (d1 === d2) add2D(`${d1}${d2}`, amount);
            }));
            matched = true;
        }
        
        else if (['sm'].includes(numPart)) { EVEN_DIGITS.forEach(d1 => ODD_DIGITS.forEach(d2 => add2D(`${d1}${d2}`, amount))); matched = true; }
        else if (['ms'].includes(numPart)) { ODD_DIGITS.forEach(d1 => EVEN_DIGITS.forEach(d2 => add2D(`${d1}${d2}`, amount))); matched = true; }
        else if (['sp'].includes(numPart)) { ['19', '28', '37', '46', '55'].forEach(n => addPair2D(n, amount)); matched = true; }
        else if (['all'].includes(numPart)) { for (let j = 0; j < 100; j++) add2D(j.toString().padStart(2, '0'), amount); matched = true; }
        else if (['bb'].includes(numPart)) { for (let j = 0; j < 100; j++) { const numStr = j.toString().padStart(2, '0'); if ((parseInt(numStr[0], 10) + parseInt(numStr[1], 10)) % 10 === 0) add2D(numStr, amount); } matched = true; }
        else {
            const lastChar = numPart.slice(-1); const firstPart = numPart.slice(0, -1);
            if (firstPart.length > 0 && !isNaN(parseInt(firstPart[0]))) {
                if (['t'].includes(lastChar) && firstPart.length === 1) { for (let j = 0; j < 10; j++) add2D(`${firstPart}${j}`, amount); matched = true; }
                else if (['p'].includes(lastChar) && firstPart.length === 1) { for (let j = 0; j < 10; j++) { add2D(`${j}${firstPart}`, amount); } matched = true; }
                else if (['a'].includes(lastChar) && firstPart.length === 1) { for (let j = 0; j < 100; j++) { const numStr = j.toString().padStart(2, '0'); if (numStr.includes(firstPart)) add2D(numStr, amount); } matched = true; }
                else if (['k'].includes(lastChar)) { const digits = Array.from(new Set(firstPart.split(''))); for (let d1 of digits) { for (let d2 of digits) add2D(`${d1}${d2}`, amount); } matched = true; }
                else if (['v', 'b'].includes(lastChar)) { const targetSum = parseInt(firstPart); if (!isNaN(targetSum) && targetSum >= 0 && targetSum <= 9) { for (let j = 0; j < 100; j++) { const numStr = j.toString().padStart(2, '0'); if ((parseInt(numStr[0], 10) + parseInt(numStr[1], 10)) % 10 === targetSum) add2D(numStr, amount); } matched = true; } }
            }
            if (!matched && numPart.length === 2 && !isNaN(parseInt(numPart))) {
                add2D(numPart, amount);
                matched = true;
            }
        }
    } else if (lotteryType === '3D') {
        if (numPart.endsWith('p')) {
            const baseNum = numPart.slice(0, -1);
            if (baseNum.length === 3 && !isNaN(parseInt(baseNum))) {
                const perms = this.getUniquePermutations(baseNum);
                perms.forEach(p => add3D(p, amount));
                matched = true;
            }
        } else if (numPart.length === 3 && !isNaN(parseInt(numPart))) {
            add3D(numPart, amount);
            matched = true;
        }
    }
    
    return matched;
  }
}
