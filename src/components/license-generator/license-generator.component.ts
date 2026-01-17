import { Component, ChangeDetectionStrategy, inject, signal, OnInit, computed, output } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { CryptoService } from '../../services/crypto.service';
import { LicenseService } from '../../services/license.service';
import { PersistenceService } from '../../services/persistence.service';

interface ManagedUser {
  name: string;
  deviceId: string;
  licenseKey: string;
  expiryDate: string;
}

@Component({
  selector: 'app-license-generator',
  templateUrl: './license-generator.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormsModule]
})
export class LicenseGeneratorComponent implements OnInit {
  private fb = inject(FormBuilder);
  private licenseService = inject(LicenseService);
  private persistenceService = inject(PersistenceService);
  private readonly USERS_KEY = 'managed_users';

  close = output<void>();

  generatedLicense = signal('');
  isGenerating = signal(false);
  
  managedUsers = signal<ManagedUser[]>([]);
  searchTerm = signal('');

  currentMasterKey = signal('');
  newMasterKey = signal('');
  confirmNewMasterKey = signal('');
  changeKeyStatus = signal('');
  isChangingKey = signal(false);

  filteredUsers = computed(() => {
    const term = this.searchTerm().toLowerCase();
    if (!term) return this.managedUsers();
    return this.managedUsers().filter(user => user.name.toLowerCase().includes(term));
  });

  generatorForm = this.fb.group({
    name: ['', Validators.required],
    deviceId: ['', Validators.required],
    expiryDate: [this.getDefaultExpiry(), Validators.required]
  });

  async ngOnInit(): Promise<void> {
    const storedUsers = await this.persistenceService.get<ManagedUser[]>(this.USERS_KEY);
    if (storedUsers) {
      this.managedUsers.set(storedUsers);
    }
  }

  private getDefaultExpiry(): string {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().split('T')[0];
  }

  async generateLicense(): Promise<void> {
    if (this.generatorForm.invalid) {
      this.generatedLicense.set('အမှား: အကွက်အားလုံးကို ဖြည့်စွက်ပေးပါ။');
      return;
    }
    this.isGenerating.set(true);
    this.generatedLicense.set('ထုတ်လုပ်နေသည်...');

    const { deviceId, expiryDate, name } = this.generatorForm.value;
    const licenseData = {
      deviceId: deviceId,
      expiryDate: new Date(expiryDate!).toISOString()
    };

    const license = await this.licenseService.encryptLicenseData(licenseData);
    this.generatedLicense.set(license);
    
    const newUser: ManagedUser = {
      name: name!,
      deviceId: deviceId!,
      licenseKey: license,
      expiryDate: expiryDate!
    };
    await this.saveUser(newUser);

    this.isGenerating.set(false);
  }

  async changeMasterKey(): Promise<void> {
    if (!this.currentMasterKey() || !this.newMasterKey() || !this.confirmNewMasterKey()) {
      this.changeKeyStatus.set('အမှား: အကွက်အားလုံးကို ဖြည့်စွက်ပေးပါ။');
      return;
    }
    if (this.newMasterKey() !== this.confirmNewMasterKey()) {
      this.changeKeyStatus.set('အမှား: စကားဝှက်အသစ်နှင့် အတည်ပြုစကားဝှက်တို့ မတူညီပါ။');
      return;
    }
    if (this.newMasterKey().length < 6) {
      this.changeKeyStatus.set('အမှား: စကားဝှက်အသစ်သည် အနည်းဆုံး စာလုံး ၆ လုံးရှိရပါမည်။');
      return;
    }
    this.isChangingKey.set(true);
    this.changeKeyStatus.set('ပြောင်းလဲနေသည်...');

    const result = await this.licenseService.changeAdminPassword(this.currentMasterKey(), this.newMasterKey());
    this.changeKeyStatus.set(result.message);

    if (result.success) {
      this.currentMasterKey.set('');
      this.newMasterKey.set('');
      this.confirmNewMasterKey.set('');
    }
    
    this.isChangingKey.set(false);
  }

  private async saveUser(newUser: ManagedUser): Promise<void> {
    this.managedUsers.update(users => {
      const existingIndex = users.findIndex(u => u.deviceId === newUser.deviceId);
      if (existingIndex > -1) {
        users[existingIndex] = newUser;
        return [...users];
      }
      return [...users, newUser];
    });
    await this.persistenceService.set(this.USERS_KEY, this.managedUsers());
  }

  async removeUser(deviceId: string): Promise<void> {
    if (confirm('ဤအသုံးပြုသူကို အမှန်တကယ် ဖျက်လိုပါသလား?')) {
      this.managedUsers.update(users => users.filter(u => u.deviceId !== deviceId));
      await this.persistenceService.set(this.USERS_KEY, this.managedUsers());
    }
  }

  copyForUser(text: string): void {
    if (text) {
      navigator.clipboard.writeText(text);
      this.generatedLicense.set('ကူးယူပြီးပါပြီ!');
      setTimeout(() => {
        if (this.generatedLicense() === 'ကူးယူပြီးပါပြီ!') {
          this.generatedLicense.set('');
        }
      }, 2000);
    }
  }

  handleIdFileUpload(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        // Basic check to see if content exists
        if (!content || !content.trim()) {
             this.generatedLicense.set('အမှား: Device ID ဖိုင်ထဲတွင် အချက်အလက်မရှိပါ။');
             return;
        }

        const decodedId = atob(content.trim());
        
        // Relaxed validation: Just check if decoded string is not empty
        if (decodedId && decodedId.length > 0) {
          this.generatorForm.patchValue({ deviceId: decodedId });
          this.generatedLicense.set('Device ID ဖိုင်ကို အောင်မြင်စွာတင်ပြီးပါပြီ။');
        } else {
          this.generatedLicense.set('အမှား: Device ID ဖိုင်ထဲတွင် အချက်အလက်မရှိပါ။');
        }
      } catch (err) {
        this.generatedLicense.set('အမှား: Device ID ဖိုင်ကို ဖတ်မရပါ။ (Base64 Error)');
        console.error('Failed to read Device ID file', err);
      }
    };
    reader.onerror = () => {
        this.generatedLicense.set('အမှား: Device ID ဖိုင်ကို ဖတ်မရပါ။');
    };
    reader.readAsText(file);
    (event.target as HTMLInputElement).value = '';
  }
  
  onSearchInput(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  closePanel(): void {
    this.close.emit();
  }
}