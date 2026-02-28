import { Injectable, inject, signal } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, update, onValue, push, serverTimestamp, Database } from 'firebase/database';
import { LicenseService } from './license.service';

const firebaseConfig = {
  apiKey: "AIzaSyAas8VrbH-tb6FWQRa4JrqEJEZcsOKcwEo",
  authDomain: "d-management-6bd74.firebaseapp.com",
  databaseURL: "https://d-management-6bd74-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "d-management-6bd74",
  storageBucket: "d-management-6bd74.firebasestorage.app",
  messagingSenderId: "881446635711",
  appId: "1:881446635711:web:cf755a10a36adfbd339e0a",
  measurementId: "G-GVF6DEGVJX"
};

export interface ChatMessage {
  id?: string; // Firebase Key
  text: string;
  senderId: string;
  timestamp: number;
  status?: 'accepted' | 'rejected' | 'pending'; // New Status Field
}

export interface Contact {
  userId: string;
  name: string;
  chatId: string;
  lastMessage?: string;
  lastTimestamp?: number;
  isLocked?: boolean; // New Locked Status
}

export interface FriendRequest {
  senderId: string;
  senderName: string;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private db: Database;
  private licenseService = inject(LicenseService);

  // Signals for UI
  friendRequests = signal<FriendRequest[]>([]);
  contacts = signal<Contact[]>([]);
  currentMessages = signal<ChatMessage[]>([]);
  activeChatId = signal<string | null>(null);

  constructor() {
    const app = initializeApp(firebaseConfig);
    this.db = getDatabase(app);
  }

  get myId(): string {
    return this.licenseService.deviceId() || 'unknown';
  }

  // Initialize listeners for the current user
  initListeners() {
    if (!this.myId || this.myId === 'unknown') return;

    // Listen for Requests
    const requestsRef = ref(this.db, `requests/${this.myId}`);
    onValue(requestsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const requests = Object.values(data) as FriendRequest[];
        this.friendRequests.set(requests);
      } else {
        this.friendRequests.set([]);
      }
    });

    // Listen for Contacts
    const contactsRef = ref(this.db, `users/${this.myId}/contacts`);
    onValue(contactsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const contactList = Object.values(data) as Contact[];
        // Sort by last active
        contactList.sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
        this.contacts.set(contactList);
      } else {
        this.contacts.set([]);
      }
    });
  }

  async sendFriendRequest(myName: string, targetId: string): Promise<{success: boolean, message: string}> {
    if (this.myId === targetId) {
      return { success: false, message: "မိမိကိုယ်ကို Add ၍ မရပါ" };
    }

    try {
      const requestRef = ref(this.db, `requests/${targetId}/${this.myId}`);
      await set(requestRef, {
        senderId: this.myId,
        senderName: myName,
        timestamp: Date.now()
      });
      return { success: true, message: "Friend Request ပို့လိုက်ပါပြီ" };
    } catch (e) {
      console.error(e);
      return { success: false, message: "ပို့၍မရပါ (ID မှားနေနိုင်သည်)" };
    }
  }

  async acceptFriendRequest(myName: string, request: FriendRequest) {
    const senderId = request.senderId;
    const senderName = request.senderName;
    const chatId = [this.myId, senderId].sort().join('_');

    const updates: any = {};

    // 1. My Contact List
    updates[`users/${this.myId}/contacts/${senderId}`] = {
      userId: senderId,
      name: senderName,
      chatId: chatId,
      lastTimestamp: Date.now()
    };

    // 2. Their Contact List
    updates[`users/${senderId}/contacts/${this.myId}`] = {
      userId: this.myId,
      name: myName,
      chatId: chatId,
      lastTimestamp: Date.now()
    };

    // 3. Remove Request
    updates[`requests/${this.myId}/${senderId}`] = null;

    await update(ref(this.db), updates);
  }

  async rejectFriendRequest(senderId: string) {
      const requestRef = ref(this.db, `requests/${this.myId}/${senderId}`);
      await set(requestRef, null);
  }
  
  async removeContact(otherId: string) {
      const updates: any = {};
      // Remove from my list
      updates[`users/${this.myId}/contacts/${otherId}`] = null;
      // Remove from their list (Mutual unfriend)
      updates[`users/${otherId}/contacts/${this.myId}`] = null;
      
      await update(ref(this.db), updates);
  }

  selectChat(chatId: string) {
    this.activeChatId.set(chatId);
    const messagesRef = ref(this.db, `messages/${chatId}`);
    
    // Limit to last 50 messages for performance
    onValue(messagesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Map object entries to preserve Key as ID
        const msgs = Object.entries(data).map(([key, value]: [string, any]) => ({
            ...value,
            id: key
        })) as ChatMessage[];
        this.currentMessages.set(msgs);
      } else {
        this.currentMessages.set([]);
      }
    });
  }

  async sendMessage(text: string, otherId: string) {
    if (!text.trim()) return;
    const chatId = [this.myId, otherId].sort().join('_');

    // 1. Push Message
    await push(ref(this.db, `messages/${chatId}`), {
      text: text,
      senderId: this.myId,
      timestamp: serverTimestamp()
    });

    // 2. Update Last Message for both
    const updates: any = {};
    updates[`users/${this.myId}/contacts/${otherId}/lastMessage`] = text;
    updates[`users/${this.myId}/contacts/${otherId}/lastTimestamp`] = serverTimestamp();
    
    updates[`users/${otherId}/contacts/${this.myId}/lastMessage`] = text;
    updates[`users/${otherId}/contacts/${this.myId}/lastTimestamp`] = serverTimestamp();
    
    await update(ref(this.db), updates);
  }

  async markMessageAsAccepted(chatId: string, messageId: string) {
      const updates: any = {};
      updates[`messages/${chatId}/${messageId}/status`] = 'accepted';
      await update(ref(this.db), updates);
  }

  async toggleChatLock(otherId: string, currentStatus: boolean) {
      const newStatus = !currentStatus;
      const updates: any = {};
      
      // Update Lock Status for BOTH sides
      // This allows the Agent's app to check this value and disable the input
      updates[`users/${this.myId}/contacts/${otherId}/isLocked`] = newStatus;
      updates[`users/${otherId}/contacts/${this.myId}/isLocked`] = newStatus;
      
      await update(ref(this.db), updates);

      // Auto send message
      if(newStatus) {
          await this.sendMessage("⛔ စာရင်းပိတ်လိုက်ပါပြီ။", otherId);
      } else {
          await this.sendMessage("✅ စာရင်းပြန်ဖွင့်ပါပြီ။", otherId);
      }
  }
}