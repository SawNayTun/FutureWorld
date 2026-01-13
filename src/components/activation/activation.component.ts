import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LicenseService } from '../../services/license.service';

@Component({
  selector: 'app-activation',
  templateUrl: './activation.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule]
})
export class ActivationComponent implements OnInit {
  licenseService = inject(LicenseService);
  private fb = inject(FormBuilder);

  licenseKeyVisible = signal(false);
  hasDownloadedId = signal(false);
  
  activationForm = this.fb.group({
    keyOrPassword: ['', Validators.required],
  });
  
  statusMessage = signal('');
  isActivating = signal(false);

  ngOnInit(): void {
    const downloaded = localStorage.getItem('device_id_downloaded');
    if (downloaded === 'true') {
      this.hasDownloadedId.set(true);
    }
  }

  toggleLicenseKeyVisibility(): void {
    this.licenseKeyVisible.update(v => !v);
  }

  async activate(): Promise<void> {
    if (this.activationForm.invalid) {
      this.statusMessage.set('လိုင်စင်ကီး (သို့မဟုတ်) အက်ဒမင်စကားဝှက်ကို ဖြည့်စွက်ပေးပါ။');
      return;
    }
    
    this.isActivating.set(true);
    this.statusMessage.set('အသက်သွင်းနေသည်...');
    
    const keyOrPassword = this.activationForm.getRawValue().keyOrPassword!;
    
    // First, try to activate as admin.
    let success = await this.licenseService.activateLicense(keyOrPassword, keyOrPassword);
    let attemptType: 'admin' | 'user' = 'admin';

    // If admin activation fails, try as a regular user license key.
    if (!success) {
      attemptType = 'user';
      success = await this.licenseService.activateLicense(keyOrPassword, 'MasterSaiYan');
    }
    
    if (success) {
      this.statusMessage.set('အသက်သွင်းခြင်း အောင်မြင်ပါသည်။ စာမျက်နှာကို ပြန်လည်စတင်နေသည်...');
    } else {
      if (attemptType === 'admin') {
        this.statusMessage.set('အက်ဒမင် စကားဝှက် မှားယွင်းနေပါသည်။');
      } else {
        this.statusMessage.set('အသက်သွင်းခြင်း မအောင်မြင်ပါ။ သင်၏ လိုင်စင်ကီးကို ပြန်လည်စစ်ဆေးပါ။');
      }
      this.isActivating.set(false);
    }
  }

  downloadDeviceId(): void {
    const deviceId = this.licenseService.deviceId();
    if (deviceId) {
      const encodedId = btoa(deviceId); // Obfuscate by encoding to Base64
      const blob = new Blob([encodedId], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'device-id.future2d';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      localStorage.setItem('device_id_downloaded', 'true');
      this.hasDownloadedId.set(true);
      
      this.statusMessage.set('Device ID ဖိုင်ကို ဒေါင်းလုဒ်လုပ်ပြီးပါပြီ။');
      setTimeout(() => this.statusMessage.set(''), 3000);
    }
  }
}