import { Injectable } from '@angular/core';

// --- Constants ---
const POWER_NUMBERS = ['05', '16', '27', '38', '49'];
const NAKHAT_NUMBERS = ['07', '18', '35', '69', '24'];
const NYI_KO_NUMBERS = ['01', '12', '23', '34', '45', '56', '67', '78', '89', '90'];
const EVEN_DIGITS = ['0', '2', '4', '6', '8'];
const ODD_DIGITS = ['1', '3', '5', '7', '9'];

@Injectable({ providedIn: 'root' })
export class BetParsingService {

  parse(input: string): Map<string, number> {
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
