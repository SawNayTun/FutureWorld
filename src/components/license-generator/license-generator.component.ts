import { Component, ChangeDetectionStrategy, inject, signal, OnInit, computed, output } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { CryptoService } from '../../services/crypto.service';
import { LicenseService, LicenseDetails } from '../../services/license.service';
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
  copyStatus = signal('');
  
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
    const licenseData: LicenseDetails = {
      deviceId: deviceId!,
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
  
  async factoryReset(): Promise<void> {
      if (!confirm('သတိပေးချက်: ဤလုပ်ဆောင်ချက်သည် ဒေတာအားလုံးကို အပြီးတိုင်ဖျက်ပစ်ပါမည်။\n\n- အက်ဒမင်စကားဝှက်သည် "MasterSaiYan" သို့ပြန်ပြောင်းသွားမည်။\n- မှတ်တမ်းများ၊ အသုံးပြုသူစာရင်းများအားလုံး ပျက်သွားမည်။\n\nဆက်လုပ်ရန် သေချာပါသလား?')) {
          return;
      }
      
      if (!confirm('နောက်ဆုံးအကြိမ် အတည်ပြုပါသည်: အမှန်တကယ် ဖျက်လိုပါသလား?')) {
          return;
      }
      
      try {
          await this.persistenceService.factoryReset();
          localStorage.clear();
          sessionStorage.clear();
          alert('စက်ရုံထုတ် အတိုင်းပြန်လည်သတ်မှတ်ပြီးပါပြီ။ Application ကို ပြန်လည်စတင်ပါမည်။');
          window.location.reload();
      } catch (e) {
          alert('Reset ပြုလုပ်ရာတွင် အမှားအယွင်းရှိပါသည်။ Browser Cache ကိုရှင်းကြည့်ပါ။');
          console.error(e);
      }
  }

  copyGeneratedLicense(): void {
      this.copyForUser(this.generatedLicense());
  }

  copyForUser(text: string): void {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        this.copyStatus.set('ကူးယူပြီးပါပြီ!');
        setTimeout(() => this.copyStatus.set(''), 2000);
    });
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
          this.copyStatus.set('Device ID ဖိုင်ကို အောင်မြင်စွာတင်ပြီးပါပြီ။');
          setTimeout(() => this.copyStatus.set(''), 2000);
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