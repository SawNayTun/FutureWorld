
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
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      // Using Burmese as primary, but we'll manually map English words in processBurmeseNumbers
      this.recognition.lang = 'my-MM'; 
    }
  }

  startListening(onResult: (text: string, isFinal: boolean) => void) {
    if (!this.isSupported) {
      alert('သင့် Browser တွင် အသံစနစ် မရရှိနိုင်ပါ။ Google Chrome Browser ကို အသုံးပြုပါ။');
      return;
    }

    this.isListening.set(true);
    try {
      this.recognition.start();
    } catch (e) {
      console.error("Already started", e);
    }

    this.recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      
      const textToProcess = finalTranscript || interimTranscript;
      const processedText = this.processBurmeseNumbers(textToProcess);
      this.transcript.set(processedText);
      onResult(processedText, !!finalTranscript);
    };

    this.recognition.onerror = (event: any) => {
      console.error('Voice error', event.error);
      this.isListening.set(false);
      if (event.error === 'not-allowed') {
          alert('မိုက်ကရိုဖုန်း အသုံးပြုခွင့် ပိတ်ထားပါသည်။ Browser Settings တွင် ဖွင့်ပေးပါ။ (https သို့မဟုတ် localhost တွင်သာ အလုပ်လုပ်ပါသည်)');
      }
    };

    this.recognition.onend = () => {
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
