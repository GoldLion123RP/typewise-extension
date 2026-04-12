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
        return this.normalizeStorageData(this.decrypt(result[this.STORAGE_KEY]));
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
      await chrome.storage.local.set({ settings: data.user.settings });

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
    const local = await chrome.storage.local.get('snippets');
    const localSnippets = this.sanitizeSnippets(local.snippets);

    if (localSnippets.length > 0) {
      // Keep plaintext snippet store normalized.
      if (!Array.isArray(local.snippets) || localSnippets.length !== local.snippets.length) {
        await chrome.storage.local.set({ snippets: localSnippets });
      }
      return localSnippets;
    }

    const data = await this.getAll();
    const snippets = this.sanitizeSnippets(data.snippets);

    if (snippets.length === 0) {
      const defaults = this.getDefaultSnippets();
      await this.saveAll({ ...data, snippets: defaults });
      return defaults;
    }

    if (!Array.isArray(data.snippets) || snippets.length !== data.snippets.length) {
      await this.saveAll({ ...data, snippets });
    }

    return snippets;
  }

  async saveSnippet(snippet: Snippet): Promise<void> {
    const snippets = await this.getSnippets();
    const index = snippets.findIndex(s => s.id === snippet.id);

    if (index >= 0) {
      snippets[index] = snippet;
    } else {
      snippets.push(snippet);
    }

    await chrome.storage.local.set({ snippets });

    // Keep encrypted blob synchronized best-effort.
    try {
      const data = await this.getAll();
      await this.saveAll({ ...data, snippets });
    } catch (error) {
      console.warn('Unable to sync encrypted storage after saveSnippet:', error);
    }
  }

  async deleteSnippet(id: string): Promise<void> {
    const snippets = (await this.getSnippets()).filter(s => s.id !== id);
    await chrome.storage.local.set({ snippets });

    try {
      const data = await this.getAll();
      await this.saveAll({ ...data, snippets });
    } catch (error) {
      console.warn('Unable to sync encrypted storage after deleteSnippet:', error);
    }
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

      if (Array.isArray(data)) {
        const snippets = this.sanitizeSnippets(data);
        if (snippets.length === 0) {
          throw new Error('No valid snippets found');
        }

        const current = await this.getAll();
        await this.saveAll({ ...current, snippets });
        return;
      }

      if (data && typeof data === 'object' && Array.isArray(data.snippets)) {
        const snippets = this.sanitizeSnippets(data.snippets);
        if (snippets.length === 0) {
          throw new Error('No valid snippets found');
        }

        const current = await this.getAll();
        const importedSettings = data.user?.settings || {};
        await this.saveAll({
          ...current,
          snippets,
          user: {
            ...current.user,
            settings: {
              ...current.user.settings,
              ...importedSettings,
            },
          },
        });
        return;
      }

      throw new Error('Unsupported import format');
    } catch (error) {
      throw new Error('Invalid import data format');
    }
  }

  private sanitizeSnippets(value: unknown): Snippet[] {
    if (!Array.isArray(value)) return [];

    return value
      .map((item, index) => this.normalizeSnippet(item, index))
      .filter((snippet): snippet is Snippet => snippet !== null);
  }

  private normalizeSnippet(value: unknown, index: number): Snippet | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;

    const shortcut = this.pickString(item.shortcut, item.trigger, item.abbr);
    const content = this.pickString(item.content, item.text, item.value, item.body);
    if (!shortcut || !content) return null;

    const now = new Date().toISOString();
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
      : [];

    return {
      id: this.pickString(item.id) || `snippet-${Date.now()}-${index}`,
      title: this.pickString(item.title, item.name) || `Snippet ${index + 1}`,
      shortcut,
      content,
      category: this.pickString(item.category) || 'General',
      tags,
      usageCount: typeof item.usageCount === 'number' && item.usageCount >= 0 ? item.usageCount : 0,
      createdAt: this.pickString(item.createdAt) || now,
      updatedAt: this.pickString(item.updatedAt) || now,
      isActive: typeof item.isActive === 'boolean' ? item.isActive : true,
    };
  }

  private pickString(...values: unknown[]): string | undefined {
    const found = values.find((value) => typeof value === 'string' && value.trim().length > 0) as string | undefined;
    return found?.trim();
  }

  private normalizeStorageData(value: Partial<StorageData> | undefined): StorageData {
    const defaults = this.getDefaultData();
    const normalizedSnippets = this.sanitizeSnippets(value?.snippets);

    return {
      ...defaults,
      ...value,
      snippets: normalizedSnippets.length > 0 ? normalizedSnippets : defaults.snippets,
      user: {
        ...defaults.user,
        ...value?.user,
        settings: {
          ...defaults.user.settings,
          ...value?.user?.settings,
        },
      },
      encryptionEnabled: typeof value?.encryptionEnabled === 'boolean' ? value.encryptionEnabled : true,
    };
  }
}

export const storage = new StorageManager();