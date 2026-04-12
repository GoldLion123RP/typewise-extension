// src/utils/storage.ts
import CryptoJS from 'crypto-js';
import { StorageData, Snippet, User, UserSettings } from '../types';

class StorageManager {
  private readonly STORAGE_KEY = 'typewise_data';
  private readonly LEGACY_STORAGE_KEYS = ['typewiseData', 'typewise-data', 'typewise_storage'];
  private readonly LEGACY_SNIPPET_KEYS = [
    'snippets',
    'typewise_snippets',
    'typewiseSnippets',
    'snippet_list',
    'savedSnippets',
    'snippets_v1',
  ];
  private writeQueue: Promise<void> = Promise.resolve();

  private getEncryptionKey(): string {
    // Keep key stable across reinstalls/builds to avoid losing decryptability.
    return 'typewise:stable:v1';
  }

  private getDecryptionKeys(): string[] {
    return Array.from(
      new Set([
        this.getEncryptionKey(),
        `typewise:${chrome.runtime.id}:v1`,
        'typewise:stable:v0',
        'typewise-default-key',
      ]),
    );
  }

  async getAll(): Promise<StorageData> {
    try {
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      const encryptedLocal = result[this.STORAGE_KEY];

      if (typeof encryptedLocal === 'string' && encryptedLocal.length > 0) {
        const decryptedLocal = this.decrypt(encryptedLocal);
        if (decryptedLocal) {
          const normalized = this.normalizeStorageData(decryptedLocal);
          await this.ensurePlaintextMirrors(normalized);
          return normalized;
        }
      }

      const legacyEncryptedResult = await chrome.storage.local.get(this.LEGACY_STORAGE_KEYS);
      for (const key of this.LEGACY_STORAGE_KEYS) {
        const candidate = legacyEncryptedResult[key];

        if (typeof candidate === 'string' && candidate.length > 0) {
          const decryptedLegacy = this.decrypt(candidate);
          if (decryptedLegacy) {
            const normalizedLegacy = this.normalizeStorageData(decryptedLegacy);
            await this.saveAll(normalizedLegacy);
            return normalizedLegacy;
          }
        }

        if (candidate && typeof candidate === 'object') {
          const normalizedLegacy = this.normalizeStorageData(candidate as Partial<StorageData>);
          await this.saveAll(normalizedLegacy);
          return normalizedLegacy;
        }
      }

      const syncResult = await chrome.storage.sync.get(this.STORAGE_KEY);
      const encryptedSync = syncResult[this.STORAGE_KEY];
      if (typeof encryptedSync === 'string' && encryptedSync.length > 0) {
        const decryptedSync = this.decrypt(encryptedSync);
        if (decryptedSync) {
          const normalizedSync = this.normalizeStorageData(decryptedSync);
          await this.saveAll(normalizedSync);
          return normalizedSync;
        }
      }

      const localFallback = await chrome.storage.local.get(['settings']);
      const localSnippets = await this.getLegacySnippetCandidates();
      if (localSnippets.length > 0) {
        const defaults = this.getDefaultData();
        const hydrated = {
          ...defaults,
          snippets: localSnippets,
          user: {
            ...defaults.user,
            settings: {
              ...defaults.user.settings,
              ...(localFallback.settings || {}),
            },
          },
        };

        await this.saveAll(hydrated);
        return hydrated;
      }

      return this.getDefaultData();
    } catch (error) {
      console.error('Error getting storage:', error);
      return this.getDefaultData();
    }
  }

  async saveAll(data: StorageData): Promise<void> {
    const normalized = this.normalizeStorageData(data);
    const encrypted = this.encrypt(normalized);

    try {
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: encrypted,
        snippets: normalized.snippets,
        settings: normalized.user.settings,
      });
    } catch (error) {
      console.error('Error saving local storage:', error);
      throw error;
    }

    if (normalized.user.settings.syncEnabled) {
      try {
        await chrome.storage.sync.set({ [this.STORAGE_KEY]: encrypted });
      } catch (error) {
        console.warn('Unable to sync encrypted storage to chrome.storage.sync:', error);
      }
    }
  }

  async getSnippets(): Promise<Snippet[]> {
    const data = await this.getAll();
    const localPrimary = await chrome.storage.local.get('snippets');
    const localPrimarySnippets = this.sanitizeSnippets(localPrimary.snippets);
    const localSnippets = this.mergeSnippets(await this.getLegacySnippetCandidates(), localPrimarySnippets);
    const encryptedSnippets = this.sanitizeSnippets(data.snippets);
    const mergedSnippets = this.mergeSnippets(localSnippets, encryptedSnippets);

    if (mergedSnippets.length > 0) {
      if (this.haveSnippetDifferences(localPrimarySnippets, mergedSnippets)) {
        await chrome.storage.local.set({ snippets: mergedSnippets });
      }

      if (this.haveSnippetDifferences(encryptedSnippets, mergedSnippets)) {
        await this.saveAll({ ...data, snippets: mergedSnippets });
      }

      return mergedSnippets;
    }

    return [];
  }

  async saveSnippet(snippet: Snippet): Promise<void> {
    await this.enqueueWrite(async () => {
      const data = await this.getAll();
      const snippets = this.mergeSnippets(this.sanitizeSnippets(data.snippets), await this.getLegacySnippetCandidates());
      const normalized = this.normalizeSnippet(snippet, snippets.length) || {
        id: snippet.id || `snippet-${Date.now()}-${snippets.length}`,
        title: (snippet.title || '').trim() || `Snippet ${snippets.length + 1}`,
        shortcut: (snippet.shortcut || '').trim(),
        content: (snippet.content || '').trim(),
        category: (snippet.category || 'General').trim(),
        tags: Array.isArray(snippet.tags) ? snippet.tags.filter((tag) => typeof tag === 'string') : [],
        usageCount: typeof snippet.usageCount === 'number' ? Math.max(0, snippet.usageCount) : 0,
        createdAt: snippet.createdAt || new Date().toISOString(),
        updatedAt: snippet.updatedAt || new Date().toISOString(),
        isActive: snippet.isActive !== false,
      };

      if (!normalized.shortcut || !normalized.content) {
        throw new Error('Snippet must include shortcut and content');
      }

      const index = snippets.findIndex((s) => s.id === normalized.id);
      if (index >= 0) {
        snippets[index] = normalized;
      } else {
        snippets.push(normalized);
      }

      // Plaintext snippets are the primary runtime store and must always persist.
      await chrome.storage.local.set({ snippets });

      // Keep encrypted aggregate synchronized best-effort.
      try {
        await this.saveAll({ ...data, snippets });
      } catch (error) {
        console.warn('Unable to sync encrypted storage after saveSnippet:', error);
      }
    });
  }

  async deleteSnippet(id: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const data = await this.getAll();
      const snippets = this.sanitizeSnippets(data.snippets).filter((s) => s.id !== id);

      await chrome.storage.local.set({ snippets });

      try {
        await this.saveAll({ ...data, snippets });
      } catch (error) {
        console.warn('Unable to sync encrypted storage after deleteSnippet:', error);
      }
    });
  }

  async getUser(): Promise<User> {
    const data = await this.getAll();
    return data.user;
  }

  async updateUser(user: Partial<User>): Promise<void> {
    await this.enqueueWrite(async () => {
      const data = await this.getAll();
      data.user = { ...data.user, ...user };
      await this.saveAll(data);
    });
  }

  async updateSettings(settings: Partial<UserSettings>): Promise<void> {
    await this.enqueueWrite(async () => {
      const data = await this.getAll();
      data.user.settings = { ...data.user.settings, ...settings, theme: 'dark' };
      await this.saveAll(data);
    });
  }

  private encrypt(data: StorageData): string {
    return CryptoJS.AES.encrypt(JSON.stringify(data), this.getEncryptionKey()).toString();
  }

  private decrypt(encryptedData: string): StorageData | null {
    for (const key of this.getDecryptionKeys()) {
      try {
        const decrypted = CryptoJS.AES.decrypt(encryptedData, key).toString(CryptoJS.enc.Utf8);
        if (!decrypted) {
          continue;
        }

        const parsed = JSON.parse(decrypted) as Partial<StorageData>;
        if (parsed && typeof parsed === 'object') {
          return this.normalizeStorageData(parsed);
        }
      } catch {
        // Try next key.
      }
    }

    try {
      const parsed = JSON.parse(encryptedData) as Partial<StorageData>;
      if (parsed && typeof parsed === 'object') {
        return this.normalizeStorageData(parsed);
      }
    } catch {
      // Not a plain JSON payload.
    }

    console.warn('Unable to decrypt storage payload with known keys.');
    return null;
  }

  private getDefaultData(): StorageData {
    return {
      snippets: [],
      user: {
        settings: {
          theme: 'dark',
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

    const shortcut = this.pickString(item.shortcut, item.trigger, item.abbr, item.key, item.keyword, item.code);
    const content = this.pickString(item.content, item.text, item.value, item.body, item.snippet, item.expansion, item.phrase, item.template);
    if (!shortcut || !content) return null;

    const now = new Date().toISOString();
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
      : this.pickString(item.tags)
          ?.split(',')
          .map((tag) => tag.trim())
          .filter(Boolean) || [];

    return {
      id: this.pickString(item.id, item._id, item.uuid) || `snippet-${Date.now()}-${index}`,
      title: this.pickString(item.title, item.name, item.label, item.shortcut) || `Snippet ${index + 1}`,
      shortcut,
      content,
      category: this.pickString(item.category, item.group, item.type) || 'General',
      tags,
      usageCount: typeof item.usageCount === 'number' && item.usageCount >= 0 ? item.usageCount : 0,
      createdAt: this.pickString(item.createdAt) || now,
      updatedAt: this.pickString(item.updatedAt) || now,
      isActive:
        typeof item.isActive === 'boolean'
          ? item.isActive
          : typeof item.enabled === 'boolean'
            ? item.enabled
            : true,
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

  private mergeSnippets(localSnippets: Snippet[], encryptedSnippets: Snippet[]): Snippet[] {
    const merged = new Map<string, Snippet>();

    const upsertSnippet = (snippet: Snippet) => {
      const existing = merged.get(snippet.id);
      if (!existing) {
        merged.set(snippet.id, snippet);
        return;
      }

      const existingTime = Date.parse(existing.updatedAt || existing.createdAt || '') || 0;
      const incomingTime = Date.parse(snippet.updatedAt || snippet.createdAt || '') || 0;
      if (incomingTime >= existingTime) {
        merged.set(snippet.id, snippet);
      }
    };

    encryptedSnippets.forEach(upsertSnippet);
    localSnippets.forEach(upsertSnippet);

    return Array.from(merged.values()).sort((a, b) => {
      const aTime = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      const bTime = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      return bTime - aTime;
    });
  }

  private haveSnippetDifferences(a: Snippet[], b: Snippet[]): boolean {
    if (a.length !== b.length) return true;

    const sortById = (items: Snippet[]) =>
      [...items].sort((x, y) => x.id.localeCompare(y.id)).map((item) => JSON.stringify(item));

    const left = sortById(a);
    const right = sortById(b);

    return left.some((value, index) => value !== right[index]);
  }

  private async ensurePlaintextMirrors(data: StorageData): Promise<void> {
    try {
      await chrome.storage.local.set({
        snippets: data.snippets,
        settings: data.user.settings,
      });
    } catch (error) {
      console.warn('Unable to ensure plaintext mirrors:', error);
    }
  }

  private async getLegacySnippetCandidates(): Promise<Snippet[]> {
    const result = await chrome.storage.local.get(this.LEGACY_SNIPPET_KEYS);
    let all: Snippet[] = [];

    for (const key of this.LEGACY_SNIPPET_KEYS) {
      all = all.concat(this.sanitizeSnippets(result[key]));
    }

    return this.mergeSnippets([], all);
  }

  private async enqueueWrite(task: () => Promise<void>): Promise<void> {
    const run = this.writeQueue.then(task);
    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}

export const storage = new StorageManager();