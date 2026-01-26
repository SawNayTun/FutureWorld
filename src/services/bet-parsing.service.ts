
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
    const rawLines = input.split(/\r?\n/);
    const cleanedLines = rawLines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      // Filter out obvious metadata lines, but rely on token skipping for inline headers
      if (/^(agent|session|sub-total|total|နေ့စွဲ|date)/i.test(trimmed)) return false;
      if (trimmed.includes('စုစုပေါင်း')) return false; 
      if (/^total\s*:/i.test(trimmed)) return false;
      return true;
    });

    let processedInput = cleanedLines.join('\n');

    // --- Burmese replacements ---
    const burmeseToEnglishMap: { [key: string]: string } = { 'အပူး': 'apu', 'ညီကို': 'nk', 'ပါဝါ': 'pao', 'နက်ခတ်': 'nat', 'စုံစုံ': 'ss', 'မမ': 'mm', 'စုံမ': 'sm', 'မစုံ': 'ms', 'ဆယ်ပြည့်': 'sp', 'အကုန်': 'all', 'ဘူဘဒိတ်': 'bb', 'ထိပ်': 't', 'ပိတ်': 'p', 'အပါ': 'a', 'ခွေ': 'k', 'ဗြိတ်': 'v', 'ဘဒိတ်': 'b', 'အကပ်': 'ak', 'ပတ်လည်': 'palei' };
    for (const burmese of Object.keys(burmeseToEnglishMap)) {
        processedInput = processedInput.replace(new RegExp(burmese, 'g'), burmeseToEnglishMap[burmese]);
    }
    const burmeseDigits = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'];
    burmeseDigits.forEach((digit, index) => {
        processedInput = processedInput.replace(new RegExp(digit, 'g'), index.toString());
    });
    
    // --- Global Cleaning ---
    // 1. Replace specific currency symbols with space
    processedInput = processedInput.replace(/[¥$£€]/g, ' ');

    // 2. Normalize separators
    processedInput = processedInput.replace(/[=/၊,*\-_:]/g, ' ');

    // --- FEATURE 1: Bulk R Logic ---
    if (lotteryType === '2D') {
        processedInput = processedInput.replace(/((?:\b\d{2}\s+)+)r\s+(\d+(?:k)?)\b/gi, (match, numbersPart, amountPart) => {
            const numbers = numbersPart.trim().split(/\s+/);
            return numbers.map((n: string) => `${n}r ${amountPart}`).join(' ');
        });
    }

    const entries = processedInput.split(/\s+/).map(s => s.trim()).filter(Boolean);

    let i = 0;
    while (i < entries.length) {
        if (i + 1 < entries.length) {
            const potentialKey = entries[i].toLowerCase();
            const amountStr = entries[i+1];
            
            // --- FEATURE 2: Inline Mixed Amounts (e.g., 3r2) ---
            if (lotteryType === '2D' && /^\d+(?:k)?r\d+(?:k)?$/i.test(amountStr)) {
                const [directAmtStr, reverseAmtStr] = amountStr.toLowerCase().split('r');
                const directAmount = this.parseAmount(directAmtStr);
                const reverseAmount = this.parseAmount(reverseAmtStr);

                if (!isNaN(directAmount) && !isNaN(reverseAmount)) {
                    if (/^\d{2}$/.test(potentialKey)) {
                        addBetCallback(potentialKey, directAmount);
                        const reversedKey = potentialKey.split('').reverse().join('');
                        addBetCallback(reversedKey, reverseAmount);
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

  private parseAmount(amountStr: string): number {
      let cleanStr = amountStr.replace(/[¥$£€]/g, '');
      const isK = cleanStr.toLowerCase().endsWith('k');
      cleanStr = cleanStr.replace(/[^0-9.]/g, '');
      
      let amount = parseFloat(cleanStr);
      if (isNaN(amount)) return NaN;
      
      if (isK) amount *= 1000;
      return amount;
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
            if (!matched && numPart.endsWith('ak')) { 
                const digitStr = numPart.replace(/ak/g, ''); 
                if (digitStr.length === 1 && !isNaN(parseInt(digitStr))) { 
                    const digit = parseInt(digitStr); const prev = (digit + 9) % 10; const next = (digit + 1) % 10; 
                    add2D(`${digit}${next}`, amount); add2D(`${digit}${prev}`, amount); add2D(`${next}${digit}`, amount); add2D(`${prev}${digit}`, amount); 
                    matched = true; 
                } 
            }
            if (!matched && numPart.length === 2 && !isNaN(parseInt(numPart))) { add2D(numPart, amount); matched = true; }
        }
    } else if (lotteryType === '3D') {
        if (numPart.endsWith('palei')) {
            const baseNum = numPart.slice(0, -5);
            if (baseNum.length === 3) {
                const d1 = baseNum[0], d2 = baseNum[1], d3 = baseNum[2];
                const perms = new Set<string>();
                perms.add(`${d1}${d2}${d3}`); perms.add(`${d1}${d3}${d2}`);
                perms.add(`${d2}${d1}${d3}`); perms.add(`${d2}${d3}${d1}`);
                perms.add(`${d3}${d1}${d2}`); perms.add(`${d3}${d2}${d1}`);
                
                // Logic: 123 palei 600 => 100 each (Split Total)
                const splitAmount = Math.floor(amount / perms.size);
                if (splitAmount > 0) {
                    perms.forEach(p => add3D(p, splitAmount));
                }
                matched = true;
            }
        } else if (numPart.endsWith('t') && numPart.length === 2 && !isNaN(parseInt(numPart[0]))) {
            const topDigit = numPart[0];
            for (let j = 0; j < 100; j++) {
                add3D(`${topDigit}${j.toString().padStart(2, '0')}`, amount);
            }
            matched = true;
        } else if (numPart === 'apu') {
            for (let j = 0; j < 10; j++) {
                add3D(`${j}${j}${j}`, amount);
            }
            matched = true;
        } else if (numPart.length === 3 && !isNaN(parseInt(numPart))) {
            add3D(numPart, amount);
            matched = true;
        }
    }
    return matched;
  }
}
