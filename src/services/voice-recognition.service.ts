
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class VoiceRecognitionService {
  isListening = signal(false);
  transcript = signal('');
  
  private recognition: any;
  private isSupported = false;

  constructor() {
    if ('webkitSpeechRecognition' in window) {
      this.isSupported = true;
      // @ts-ignore
      this.recognition = new webkitSpeechRecognition();
      // Changed to true to keep listening until manually stopped
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.lang = 'my-MM'; 
    }
  }

  startListening(onResult: (text: string, isFinal: boolean) => void) {
    if (!this.isSupported) {
      alert('သင့် Browser တွင် အသံစနစ် မရရှိနိုင်ပါ။ Google Chrome Browser ကို အသုံးပြုပါ။');
      return;
    }

    if (this.isListening()) {
        console.warn("Already listening");
        return;
    }

    this.isListening.set(true);
    
    try {
      this.recognition.start();
    } catch (e) {
      console.error("Failed to start recognition", e);
      this.isListening.set(false);
    }

    // Reset loop counter
    let resultIndex = 0;

    this.recognition.onresult = (event: any) => {
      let chunk = '';
      
      // We only process the *new* results since the last event
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          chunk += event.results[i][0].transcript;
        }
      }
      
      if (chunk) {
          const processedText = this.processBurmeseNumbers(chunk);
          this.transcript.set(processedText);
          onResult(processedText, true);
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error('Voice error', event.error);
      
      // Ignore 'no-speech' errors as they are common in continuous mode
      if (event.error === 'no-speech') {
          return;
      }

      this.isListening.set(false);
      if (event.error === 'not-allowed') {
          alert('မိုက်ကရိုဖုန်း အသုံးပြုခွင့် ပိတ်ထားပါသည်။ Browser Settings တွင် ဖွင့်ပေးပါ။ (https သို့မဟုတ် localhost တွင်သာ အလုပ်လုပ်ပါသည်)');
      }
    };

    this.recognition.onend = () => {
        // If it stops but we didn't ask it to, check if we should restart? 
        // For now, let the UI reflect it stopped.
        this.isListening.set(false);
    };
  }

  stopListening() {
    if (this.recognition) {
      this.recognition.stop();
      this.isListening.set(false);
    }
  }

  // Convert Spoken words (Burmese & English) to App Syntax
  private processBurmeseNumbers(text: string): string {
    let processed = text.toLowerCase();
    
    const map: {[key:string]: string} = {
      // Burmese Spoken Numbers
      'သုည': '0', '၀': '0', 'zero': '0',
      'တစ်': '1', '၁': '1', 'တိ': '1', 'one': '1',
      'နှစ်': '2', '၂': '2', 'two': '2',
      'သုံး': '3', '၃': '3', 'three': '3',
      'လေး': '4', '၄': '4', 'four': '4',
      'ငါး': '5', '၅': '5', 'five': '5',
      'ခြောက်': '6', '၆': '6', 'six': '6',
      'ခုနှစ်': '7', '၇': '7', 'ခွန်': '7', 'seven': '7',
      'ရှစ်': '8', '၈': '8', 'eight': '8',
      'ကိုး': '9', '၉': '9', 'nine': '9',
      'ten': '10',
      
      // Keywords
      'အာ': 'r', 'အ': 'r', 'are': 'r', 'ar': 'r', 
      'ထောင်': '000', 'thousand': '000',
      'ရာ': '00', 'hundred': '00',
      'ဆယ်': '0', // "500" -> "Five Hundred" context usually handled, but "Five Ten" -> 50
      
      // Basic Commands & Terms
      'start': 't', 'ထိပ်': 't', // Hteik
      'close': 'p', 'ပိတ်': 'p', // Peik
      'power': 'pao', 'ပါဝါ': 'pao',
      'nat': 'nat', 'နက္ခတ်': 'nat', 'နက်ခတ်': 'nat',
      'brother': 'nk', 'ညီအစ်ကို': 'nk', 'ညီကို': 'nk',
      'brake': 'v', 'ဗြိတ်': 'v',
      'apue': 'apu', 'အပူး': 'apu', 'double': 'apu',
      
      // Advanced 2D Terms
      'ခွေ': 'k', 'kway': 'k',
      'အပါ': 'a', 'apa': 'a',
      'စုံစုံ': 'ss',
      'မမ': 'mm',
      'စုံမ': 'sm',
      'မစုံ': 'ms',
      'ဆယ်ပြည့်': 'sp',
      'အကပ်': 'ak',
      'ဘူ': 'bb', 'ဘူဘဒိတ်': 'bb'
    };

    // Replace mapped words
    for (const [key, value] of Object.entries(map)) {
      // Use regex with word boundary where appropriate, or simple replacement for Burmese characters
      // For English words, ensure word boundary to avoid partial replacements (e.g. 'one' inside 'phone')
      if (/^[a-z]+$/.test(key)) {
          processed = processed.replace(new RegExp(`\\b${key}\\b`, 'g'), value);
      } else {
          processed = processed.replace(new RegExp(key, 'g'), value);
      }
    }
    
    // Clean up spaces
    processed = processed.replace(/\s+/g, '');
    
    return processed;
  }
}
