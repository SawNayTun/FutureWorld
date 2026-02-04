import { Component, ChangeDetectionStrategy, inject, signal, output, effect, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirebaseService, Contact, FriendRequest, ChatMessage } from '../../services/firebase.service';
import jsQR from 'jsqr';
import QRCode from 'qrcode';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css'],
  providers: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComponent {
  firebaseService = inject(FirebaseService);
  close = output<void>();
  importBets = output<{text: string, agentName: string}>();
  
  // Local State
  activeTab = signal<'contacts' | 'requests'>('contacts');
  selectedContact = signal<Contact | null>(null);
  
  // Inputs
  myDisplayName = signal(localStorage.getItem('my_chat_name') || 'Main User');
  targetIdInput = signal('');
  messageInput = signal('');
  
  statusMessage = signal('');
  
  // QR Generation State
  showQrModal = signal(false);
  myQrCodeUrl = signal('');
  
  @ViewChild('scrollContainer') scrollContainer!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  constructor() {
    // Initialize listeners when component opens
    this.firebaseService.initListeners();
    
    // Auto-scroll to bottom when messages change
    effect(() => {
        const msgs = this.firebaseService.currentMessages();
        if(msgs.length > 0) {
            setTimeout(() => this.scrollToBottom(), 100);
        }
    });
  }

  saveMyName() {
      localStorage.setItem('my_chat_name', this.myDisplayName());
      this.statusMessage.set('အမည်သိမ်းဆည်းပြီးပါပြီ');
      setTimeout(() => this.statusMessage.set(''), 2000);
  }

  async sendRequest() {
      if(!this.targetIdInput().trim()) return;
      this.statusMessage.set('ပို့နေသည်...');
      
      const res = await this.firebaseService.sendFriendRequest(this.myDisplayName(), this.targetIdInput().trim());
      this.statusMessage.set(res.message);
      
      if(res.success) this.targetIdInput.set('');
      setTimeout(() => this.statusMessage.set(''), 3000);
  }

  async acceptRequest(req: FriendRequest) {
      await this.firebaseService.acceptFriendRequest(this.myDisplayName(), req);
      this.activeTab.set('contacts');
  }

  async rejectRequest(senderId: string) {
      if(confirm('Request ကို ပယ်ဖျက်မှာ သေချာလား?')) {
          await this.firebaseService.rejectFriendRequest(senderId);
      }
  }

  selectContact(contact: Contact) {
      this.selectedContact.set(contact);
      this.firebaseService.selectChat(contact.chatId);
      setTimeout(() => this.scrollToBottom(), 100);
  }

  backToContacts() {
      this.selectedContact.set(null);
  }
  
  async deleteContact() {
      const contact = this.selectedContact();
      if(!contact) return;
      
      if(confirm(`'${contact.name}' ကို သူငယ်ချင်းစာရင်းမှ ပယ်ဖျက်ရန် (Unfriend) သေချာပါသလား? \n(စာရင်းနှင့် စကားပြောခန်းများပါ ပျောက်သွားပါမည်)`)) {
          await this.firebaseService.removeContact(contact.userId);
          this.selectedContact.set(null); // Return to list
          this.statusMessage.set('Unfriend လုပ်ပြီးပါပြီ');
          setTimeout(() => this.statusMessage.set(''), 2000);
      }
  }

  async sendMessage() {
      const contact = this.selectedContact();
      // Check if locked
      if (!contact || contact.isLocked) return;
      if (!this.messageInput().trim()) return;
      
      const text = this.messageInput();
      const contactId = contact.userId;
      
      this.messageInput.set(''); // Clear immediately
      await this.firebaseService.sendMessage(text, contactId);
  }

  async toggleLock() {
      const contact = this.selectedContact();
      if (!contact) return;
      
      const currentState = !!contact.isLocked;
      const confirmMsg = currentState 
          ? "စာရင်းပြန်ဖွင့်မှာ သေချာလား?" 
          : "စာရင်းပိတ်လိုက်မှာ သေချာလား? (တစ်ဖက်လူ စာပို့လို့ရတော့မည် မဟုတ်ပါ)";
      
      if(confirm(confirmMsg)) {
          await this.firebaseService.toggleChatLock(contact.userId, currentState);
      }
  }

  copyMyId() {
      navigator.clipboard.writeText(this.firebaseService.myId);
      this.statusMessage.set('ID Copy ကူးပြီးပါပြီ');
      setTimeout(() => this.statusMessage.set(''), 2000);
  }

  // --- QR Generation Logic ---
  async showMyQr() {
      if (this.firebaseService.myId) {
          try {
              const url = await QRCode.toDataURL(this.firebaseService.myId, { width: 256, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
              this.myQrCodeUrl.set(url);
              this.showQrModal.set(true);
          } catch(e) {
              console.error(e);
              this.statusMessage.set('QR ထုတ်မရပါ');
          }
      }
  }

  closeQrModal() {
      this.showQrModal.set(false);
  }

  async triggerImport(msg: ChatMessage) {
      const contact = this.selectedContact();
      if (!contact) return;
      
      // 1. Emit to parent to handle the grid import
      this.importBets.emit({
          text: msg.text,
          agentName: contact.name
      });

      // 2. Mark as accepted in Firebase (so button disappears)
      if (msg.id) {
          await this.firebaseService.markMessageAsAccepted(contact.chatId, msg.id);
      }

      // 3. Send automated reply to sender
      await this.firebaseService.sendMessage("လက်ခံပြီးပါပြီ ✅", contact.userId);
  }

  // Helper to check if a message looks like a bet list
  isBetMessage(text: string): boolean {
      // Basic heuristic: contains digits and some common separators or keywords
      // e.g., "12 500", "12.500", "apu 100", "12=500"
      return /\d{2,}\s*[\s.=r*]\s*\d+|apu|nk|pao|nat/i.test(text);
  }

  // --- QR Scan Logic ---
  triggerQrUpload() {
      this.fileInput.nativeElement.click();
  }

  handleQrImage(event: Event) {
      const input = event.target as HTMLInputElement;
      if (input.files && input.files[0]) {
          const file = input.files[0];
          const reader = new FileReader();
          
          reader.onload = (e: any) => {
              const img = new Image();
              img.onload = () => {
                  const canvas = document.createElement('canvas');
                  const context = canvas.getContext('2d');
                  if (context) {
                      canvas.width = img.width;
                      canvas.height = img.height;
                      context.drawImage(img, 0, 0);
                      
                      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                      // Use jsQR to scan
                      const code = jsQR(imageData.data, imageData.width, imageData.height);
                      
                      if (code) {
                          this.targetIdInput.set(code.data);
                          this.statusMessage.set('QR Code ဖတ်ပြီးပါပြီ');
                      } else {
                          this.statusMessage.set('QR Code မတွေ့ပါ / ဖတ်မရပါ');
                      }
                      setTimeout(() => this.statusMessage.set(''), 3000);
                  }
              };
              img.src = e.target.result;
          };
          reader.readAsDataURL(file);
      }
      input.value = ''; // Reset input
  }

  closePanel() {
      this.close.emit();
  }
  
  scrollToBottom(): void {
    try {
      this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
    } catch(err) { }
  }
}