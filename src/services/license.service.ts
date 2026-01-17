import { Injectable, signal, inject } from '@angular/core';
import { CryptoService } from './crypto.service';
import { PersistenceService } from './persistence.service';

type LicenseState = 'UNINITIALIZED' | 'NO_LICENSE' | 'VALID' | 'INVALID' | 'EXPIRED' | 'EXPIRING_SOON';

export interface LicenseDetails {
  deviceId: string;
  expiryDate: string; // ISO 8601 format
}

// Internal interface for shorter JSON to produce shorter keys
interface MinifiedLicenseData {
  d: string; // deviceId
  e: string; // expiryDate
}

@Injectable({ providedIn: 'root' })
export class LicenseService {
  private cryptoService = inject(CryptoService);
  private persistenceService = inject(PersistenceService);
  private readonly DEVICE_ID_KEY = 'app_device_id';
  private readonly LICENSE_KEY = 'app_license_key'; // License key remains in sessionStorage for session check
  private readonly ADMIN_DEFAULT_PASSWORD = 'MasterSaiYan';
  private readonly LICENSE_ENCRYPTION_KEY = 'MasterSaiYan';
  private readonly ADMIN_PASSWORD_HASH_KEY = 'admin_password_hash';

  licenseState = signal<LicenseState>('UNINITIALIZED');
  deviceId = signal<string | null>(null);
  licenseDetails = signal<LicenseDetails | null>(null);
  isAdmin = signal(false);
  formattedExpiryDate = signal('');

  async init(): Promise<void> {
    const navigationEntries = performance.getEntriesByType("navigation");

    if (navigationEntries.length > 0) {
        const navigation = navigationEntries[0] as PerformanceNavigationTiming;
        if (navigation.type !== 'reload') {
            // It's a new navigation. Clear session.
            sessionStorage.removeItem(this.LICENSE_KEY);
        }
    } else {
        sessionStorage.removeItem(this.LICENSE_KEY);
    }
    
    // Ensure Admin Hash exists
    let adminHash = await this.persistenceService.get<string>(this.ADMIN_PASSWORD_HASH_KEY);
    if (!adminHash) {
      adminHash = await this.cryptoService.hashPassword(this.ADMIN_DEFAULT_PASSWORD);
      await this.persistenceService.set(this.ADMIN_PASSWORD_HASH_KEY, adminHash);
    }
    
    // Always load the REAL Device ID first. Do not overwrite it with admin temp IDs.
    let stableDeviceId = await this.persistenceService.get<string>(this.DEVICE_ID_KEY);
    if (!stableDeviceId || stableDeviceId === 'ADMIN_DEVICE_TEMP_SESSION') {
        stableDeviceId = crypto.randomUUID();
        await this.persistenceService.set(this.DEVICE_ID_KEY, stableDeviceId);
    }
    this.deviceId.set(stableDeviceId);

    // Check if Admin Session is active
    if (sessionStorage.getItem(this.LICENSE_KEY) === 'ADMIN_SESSION_ACTIVE') {
      this.isAdmin.set(true);
      this.licenseState.set('VALID');
      return;
    }
    
    await this.validateLicenseOnLoad();
  }

  private async validateLicenseOnLoad(): Promise<void> {
    const licenseKey = sessionStorage.getItem(this.LICENSE_KEY);
    if (!licenseKey) {
        this.licenseState.set('NO_LICENSE');
        return;
    }

    if (licenseKey === 'ADMIN_SESSION_ACTIVE') {
        this.isAdmin.set(true);
        this.licenseState.set('VALID');
        return;
    }

    // Try decrypting with short format first (v2), if fail, try legacy (v1)
    let details: LicenseDetails | null = null;
    
    const minified = await this.cryptoService.decrypt<MinifiedLicenseData>(licenseKey, this.LICENSE_ENCRYPTION_KEY);
    if (minified && minified.d && minified.e) {
        details = { deviceId: minified.d, expiryDate: minified.e };
    } else {
        // Fallback for older keys
        details = await this.cryptoService.decrypt<LicenseDetails>(licenseKey, this.LICENSE_ENCRYPTION_KEY);
    }

    if (!details || details.deviceId !== this.deviceId()) {
        this.licenseState.set('INVALID');
        sessionStorage.removeItem(this.LICENSE_KEY);
        return;
    }

    const expiryDate = new Date(details.expiryDate);
    if (expiryDate < new Date()) {
        this.licenseState.set('EXPIRED');
        return;
    }

    this.licenseDetails.set(details);
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    if (expiryDate < sevenDaysFromNow) {
        this.licenseState.set('EXPIRING_SOON');
        const diffTime = expiryDate.getTime() - new Date().getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        this.formattedExpiryDate.set(`${diffDays} ရက်`);
    } else {
        this.licenseState.set('VALID');
    }
    this.isAdmin.set(false);
  }

  async activateLicense(licenseKey: string, masterKey: string): Promise<boolean> {
    const adminHash = await this.persistenceService.get<string>(this.ADMIN_PASSWORD_HASH_KEY);
    
    // 1. Check Admin Login
    if (licenseKey === masterKey && adminHash) {
        const isPasswordCorrect = await this.cryptoService.verifyPassword(masterKey, adminHash);
        if (isPasswordCorrect) {
            this.isAdmin.set(true);
            this.licenseState.set('VALID');
            // We do NOT change the deviceId here anymore. The hardware ID stays in background.
            // We just set a flag in session storage.
            sessionStorage.setItem(this.LICENSE_KEY, 'ADMIN_SESSION_ACTIVE');
            return true;
        }
    }

    // 2. Check User License Key
    if (masterKey === this.LICENSE_ENCRYPTION_KEY) {
        let details: LicenseDetails | null = null;
        
        // Try short format
        const minified = await this.cryptoService.decrypt<MinifiedLicenseData>(licenseKey, this.LICENSE_ENCRYPTION_KEY);
        if (minified && minified.d && minified.e) {
            details = { deviceId: minified.d, expiryDate: minified.e };
        } else {
            // Try legacy format
            details = await this.cryptoService.decrypt<LicenseDetails>(licenseKey, this.LICENSE_ENCRYPTION_KEY);
        }
        
        if (!details || details.deviceId !== this.deviceId()) {
          this.licenseState.set('INVALID');
          return false;
        }
        
        if (new Date(details.expiryDate) < new Date()) {
          this.licenseState.set('EXPIRED');
          return false;
        }

        sessionStorage.setItem(this.LICENSE_KEY, licenseKey);
        this.licenseDetails.set(details);
        this.licenseState.set('VALID');
        this.isAdmin.set(false);
        await this.validateLicenseOnLoad(); 
        return true;
    }
    
    this.licenseState.set('INVALID');
    return false;
  }
  
  async changeAdminPassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string; }> {
    const adminHash = await this.persistenceService.get<string>(this.ADMIN_PASSWORD_HASH_KEY);
    if (!adminHash) {
      return { success: false, message: 'အက်ဒမင်စကားဝှက်ကို ရှာမတွေ့ပါ။' };
    }

    const isCorrect = await this.cryptoService.verifyPassword(currentPassword, adminHash);
    if (!isCorrect) {
      return { success: false, message: 'လက်ရှိမာစတာကီး မှားယွင်းနေပါသည်။' };
    }

    const newHash = await this.cryptoService.hashPassword(newPassword);
    await this.persistenceService.set(this.ADMIN_PASSWORD_HASH_KEY, newHash);
    return { success: true, message: 'မာစတာကီးကို အောင်မြင်စွာပြောင်းလဲပြီးပါပြီ။' };
  }
  
  async encryptLicenseData(data: LicenseDetails): Promise<string> {
    // Minify data keys to reduce output string length
    const minified: MinifiedLicenseData = {
        d: data.deviceId,
        e: data.expiryDate
    };
    return this.cryptoService.encrypt(minified, this.LICENSE_ENCRYPTION_KEY);
  }

  async logout(): Promise<void> {
    sessionStorage.removeItem(this.LICENSE_KEY);
    this.licenseDetails.set(null);
    this.isAdmin.set(false);
    
    // Just reset state to NO_LICENSE. Do NOT regenerate Device ID.
    // The original Device ID is preserved in IndexedDB.
    this.licenseState.set('NO_LICENSE');
  }

  async getBackupData(): Promise<{ deviceId: string | null; licenseKey: string | null }> {
    return {
      deviceId: await this.persistenceService.get<string>(this.DEVICE_ID_KEY),
      licenseKey: sessionStorage.getItem(this.LICENSE_KEY),
    };
  }

  async restoreFromBackup(data: { deviceId?: string; licenseKey?: string }): Promise<void> {
    if (data.deviceId) {
      await this.persistenceService.set(this.DEVICE_ID_KEY, data.deviceId);
      this.deviceId.set(data.deviceId);
    }
    if (data.licenseKey) {
      sessionStorage.setItem(this.LICENSE_KEY, data.licenseKey);
    } else {
      sessionStorage.removeItem(this.LICENSE_KEY);
    }
    
    this.licenseDetails.set(null);
    this.init();
  }
}