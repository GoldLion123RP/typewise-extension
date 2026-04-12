// src/utils/storage.ts
import CryptoJS from 'crypto-js';
import { StorageData, Snippet, User, UserSettings } from '../types';

class StorageManager {
  private readonly STORAGE_KEY = 'typewise_data';

  private getEncryptionKey(): string {
    // Browser extensions cannot keep true client-side secrets.
    // Use a deterministic key tied to this extension installation.
    return `typewise:${chrome.runtime.id}:v1`;
  }

  async getAll(): Promise<StorageData> {
    try {
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      if (result[this.STORAGE_KEY]) {
        return this.decrypt(result[this.STORAGE_KEY]);
      }
      return this.getDefaultData();
    } catch (error) {
      console.error('Error getting storage:', error);
      return this.getDefaultData();
    }
  }

  async saveAll(data: StorageData): Promise<void> {
    try {
      const encrypted = this.encrypt(data);

      // Save encrypted full data
      await chrome.storage.local.set({ [this.STORAGE_KEY]: encrypted });

      // Save plaintext snippets for content script (fast access, no decryption needed)
      await chrome.storage.local.set({ snippets: data.snippets });

      // Sync to chrome.storage.sync if enabled
      if (data.user.settings.syncEnabled) {
        await chrome.storage.sync.set({ [this.STORAGE_KEY]: encrypted });
      }
    } catch (error) {
      console.error('Error saving storage:', error);
      throw error;
    }
  }

  async getSnippets(): Promise<Snippet[]> {
    const data = await this.getAll();
    return data.snippets || [];
  }

  async saveSnippet(snippet: Snippet): Promise<void> {
    const data = await this.getAll();
    const index = data.snippets.findIndex(s => s.id === snippet.id);

    if (index >= 0) {
      data.snippets[index] = snippet;
    } else {
      data.snippets.push(snippet);
    }

    await this.saveAll(data);
  }

  async deleteSnippet(id: string): Promise<void> {
    const data = await this.getAll();
    data.snippets = data.snippets.filter(s => s.id !== id);
    await this.saveAll(data);
  }

  async getUser(): Promise<User> {
    const data = await this.getAll();
    return data.user;
  }

  async updateUser(user: Partial<User>): Promise<void> {
    const data = await this.getAll();
    data.user = { ...data.user, ...user };
    await this.saveAll(data);
  }

  async updateSettings(settings: Partial<UserSettings>): Promise<void> {
    const data = await this.getAll();
    data.user.settings = { ...data.user.settings, ...settings };
    await this.saveAll(data);
  }

  private encrypt(data: StorageData): string {
    return CryptoJS.AES.encrypt(JSON.stringify(data), this.getEncryptionKey()).toString();
  }

  private decrypt(encryptedData: string): StorageData {
    try {
      const decrypted = CryptoJS.AES.decrypt(encryptedData, this.getEncryptionKey());
      return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
    } catch (error) {
      console.error('Decryption error:', error);
      return this.getDefaultData();
    }
  }

  private getDefaultData(): StorageData {
    return {
      snippets: this.getDefaultSnippets(),
      user: {
        settings: {
          theme: 'system',
          triggerKey: '/',
          caseSensitive: false,
          showNotifications: true,
          syncEnabled: false,
          autoBackup: true,
          expandDelay: 0
        }
      },
      encryptionEnabled: true
    };
  }

  private getDefaultSnippets(): Snippet[] {
    return [
      {
        id: 'default-1',
        shortcut: '/hello',
        content: 'Hello! How can I help you today?',
        title: 'Greeting',
        category: 'General',
        tags: ['greeting', 'intro'],
        usageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true
      },
      {
        id: 'default-2',
        shortcut: '/thanks',
        content: 'Thank you for your time. Have a great day!',
        title: 'Thank You',
        category: 'General',
        tags: ['thanks', 'closing'],
        usageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true
      },
      {
        id: 'default-3',
        shortcut: '/email',
        content: 'Best regards,\nRahul Pal',
        title: 'Email Signature',
        category: 'Email',
        tags: ['email', 'signature'],
        usageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true
      }
    ];
  }

  async exportData(): Promise<string> {
    const data = await this.getAll();
    return JSON.stringify(data, null, 2);
  }

  async importData(jsonData: string): Promise<void> {
    try {
      const data = JSON.parse(jsonData);
      await this.saveAll(data);
    } catch (error) {
      throw new Error('Invalid import data format');
    }
  }
}

export const storage = new StorageManager();