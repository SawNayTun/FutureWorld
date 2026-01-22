import { Injectable } from '@angular/core';
import { Report } from '../models/app.models';

@Injectable({ providedIn: 'root' })
export class PersistenceService {
  private readonly DB_NAME = 'Future2DAppDB';
  private readonly DB_VERSION = 2; // Incremented version to add new stores
  private db: IDBDatabase | null = null;

  private readonly STORES = {
    APP_DATA: 'app_data', // For key-value pairs like deviceId, agents list, etc.
    REPORTS: 'reports',     // For report objects, keyed by report.id
  };

  private async openDb(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject('IndexedDB error: ' + request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORES.APP_DATA)) {
          // Rename old 'app_config' to 'app_data' if it exists from v1, or create it.
          // For simplicity with new versions, we'll just create the new stores.
          // The migration logic will handle moving the data.
          db.createObjectStore(this.STORES.APP_DATA);
        }
        if (!db.objectStoreNames.contains(this.STORES.REPORTS)) {
          db.createObjectStore(this.STORES.REPORTS, { keyPath: 'id' });
        }
      };
    });
  }

  async set<T>(key: string, value: T): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORES.APP_DATA, 'readwrite');
      transaction.objectStore(this.STORES.APP_DATA).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(`Transaction failed for item '${key}': ` + transaction.error);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const db = await this.openDb();
    return new Promise((resolve) => {
      const transaction = db.transaction(this.STORES.APP_DATA, 'readonly');
      const store = transaction.objectStore(this.STORES.APP_DATA);
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as T) || null);
      request.onerror = () => resolve(null);
    });
  }

  async saveReport(report: Report): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORES.REPORTS, 'readwrite');
      transaction.objectStore(this.STORES.REPORTS).put(report);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(`Transaction failed for report '${report.id}': ` + transaction.error);
    });
  }
  
  async getAllReports(): Promise<Report[]> {
    const db = await this.openDb();
    return new Promise((resolve) => {
        const transaction = db.transaction(this.STORES.REPORTS, 'readonly');
        const store = transaction.objectStore(this.STORES.REPORTS);
        const request = store.getAll();
        request.onsuccess = () => resolve((request.result as Report[]) || []);
        request.onerror = () => resolve([]);
    });
  }

  async deleteReport(reportId: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.STORES.REPORTS, 'readwrite');
        transaction.objectStore(this.STORES.REPORTS).delete(reportId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(`Transaction failed for deleting report '${reportId}': ` + transaction.error);
    });
  }
  
  async getAllDataForBackup(): Promise<{ [key: string]: any }> {
    const db = await this.openDb();
    const backupData: { [key: string]: any } = {};

    const dataTx = db.transaction(this.STORES.APP_DATA, 'readonly');
    const dataStore = dataTx.objectStore(this.STORES.APP_DATA);
    const keysRequest = dataStore.getAllKeys();
    const valuesRequest = dataStore.getAll();
    
    await new Promise<void>(resolve => {
        valuesRequest.onsuccess = () => {
            keysRequest.onsuccess = () => {
                keysRequest.result.forEach((key, i) => {
                    backupData[key as string] = valuesRequest.result[i];
                });
                resolve();
            };
        };
    });

    backupData.reports = await this.getAllReports();
    return backupData;
  }
  
  async restoreAllData(data: { [key: string]: any }): Promise<void> {
    const db = await this.openDb();
    
    const clearDataTx = db.transaction(this.STORES.APP_DATA, 'readwrite');
    clearDataTx.objectStore(this.STORES.APP_DATA).clear();
    await new Promise<void>((resolve, reject) => {
        clearDataTx.oncomplete = () => resolve();
        clearDataTx.onerror = () => reject(clearDataTx.error);
    });
    
    const clearReportsTx = db.transaction(this.STORES.REPORTS, 'readwrite');
    clearReportsTx.objectStore(this.STORES.REPORTS).clear();
    await new Promise<void>((resolve, reject) => {
        clearReportsTx.oncomplete = () => resolve();
        clearReportsTx.onerror = () => reject(clearReportsTx.error);
    });

    const writeDataTx = db.transaction(this.STORES.APP_DATA, 'readwrite');
    const dataStore = writeDataTx.objectStore(this.STORES.APP_DATA);
    for (const key in data) {
        if (key !== 'reports') {
            dataStore.put(data[key], key);
        }
    }
    await new Promise<void>((resolve, reject) => {
        writeDataTx.oncomplete = () => resolve();
        writeDataTx.onerror = () => reject(writeDataTx.error);
    });
    
    if (data.reports && Array.isArray(data.reports)) {
        const writeReportsTx = db.transaction(this.STORES.REPORTS, 'readwrite');
        const reportsStore = writeReportsTx.objectStore(this.STORES.REPORTS);
        data.reports.forEach((report: Report) => reportsStore.put(report));
        await new Promise<void>((resolve, reject) => {
            writeReportsTx.oncomplete = () => resolve();
            writeReportsTx.onerror = () => reject(writeReportsTx.error);
        });
    }
  }

  async migrateFromLocalStorage() {
      const migrationFlag = 'v2_db_migration_complete';
      const isMigrated = await this.get<boolean>(migrationFlag);
      if (isMigrated) return;

      console.log("Starting one-time migration from localStorage to IndexedDB...");
      
      const keysToMigrate = [
          'app_device_id', 'admin_password_hash', 'lottery_agents', 
          'lottery_upper_bookies', 'lottery_agent_upper_bookies', 'managed_users'
      ];

      for (const key of keysToMigrate) {
          const value = localStorage.getItem(key);
          if (value) {
              try {
                  const parsed = JSON.parse(value);
                  await this.set(key, parsed);
              } catch {
                  await this.set(key, value);
              }
          }
      }

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('report_')) {
            const value = localStorage.getItem(key);
            if (value) {
                try {
                    const report = JSON.parse(value);
                    await this.saveReport(report);
                } catch (e) { console.error(`Failed to migrate report ${key}`, e); }
            }
        }
      }
      
      await this.set(migrationFlag, true);
      console.log("Migration to IndexedDB complete.");
  }

  async factoryReset(): Promise<void> {
    if (this.db) {
        this.db.close();
        this.db = null;
    }
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(this.DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject('Could not delete database');
        request.onblocked = () => console.warn('Database delete blocked');
    });
  }
}