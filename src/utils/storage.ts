// src/utils/storage.ts
import { StorageData, Snippet, User, UserSettings } from '../types';

const STORAGE_KEY = 'typewise_data';
const ENCRYPTION_KEY_STORAGE_KEY = 'typewise_encryption_key';
const LEGACY_STORAGE_KEYS = ['typewiseData', 'typewise-data', 'typewise_storage'] as const;
const LEGACY_SNIPPET_KEYS = [
  'snippets',
  'typewise_snippets',
  'typewiseSnippets',
  'snippet_list',
  'savedSnippets',
  'snippets_v1',
] as const;
const LEGACY_ENCRYPTION_KEYS = ['typewise:stable:v1', 'typewise:stable:v0', 'typewise-default-key'] as const;
const MAX_SHORTCUT_LENGTH = 64;
const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 12000;
const MAX_TAG_LENGTH = 40;
const MAX_TAG_COUNT = 20;

class StorageManager {
  private writeQueue: Promise<void> = Promise.resolve();
  private encryptionKeyCache: string | null = null;

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private async localGet(keys: string | string[]): Promise<Record<string, unknown>> {
    const area = chrome?.storage?.local;
    if (!area || typeof area.get !== 'function') {
      return {};
    }

    const getAny = area.get as unknown as (
      keys: string | string[],
      callback?: (items: Record<string, unknown>) => void,
    ) => unknown;

    try {
      const maybePromise = getAny.call(area, keys);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        const data = await (maybePromise as Promise<unknown>);
        return this.asRecord(data);
      }
    } catch {
      // Fall back to callback form.
    }

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      try {
        getAny.call(area, keys, (items: Record<string, unknown>) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve(this.asRecord(items));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private async syncGet(keys: string | string[]): Promise<Record<string, unknown>> {
    const area = chrome?.storage?.sync;
    if (!area || typeof area.get !== 'function') {
      return {};
    }

    const getAny = area.get as unknown as (
      keys: string | string[],
      callback?: (items: Record<string, unknown>) => void,
    ) => unknown;

    try {
      const maybePromise = getAny.call(area, keys);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        const data = await (maybePromise as Promise<unknown>);
        return this.asRecord(data);
      }
    } catch {
      // Fall back to callback form.
    }

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      try {
        getAny.call(area, keys, (items: Record<string, unknown>) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve(this.asRecord(items));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private async localSet(items: Record<string, unknown>): Promise<void> {
    const area = chrome?.storage?.local;
    if (!area || typeof area.set !== 'function') {
      return;
    }

    const setAny = area.set as unknown as (
      items: Record<string, unknown>,
      callback?: () => void,
    ) => unknown;

    try {
      const maybePromise = setAny.call(area, items);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        await (maybePromise as Promise<unknown>);
        return;
      }
    } catch {
      // Fall back to callback form.
    }

    await new Promise<void>((resolve, reject) => {
      try {
        setAny.call(area, items, () => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private async syncSet(items: Record<string, unknown>): Promise<void> {
    const area = chrome?.storage?.sync;
    if (!area || typeof area.set !== 'function') {
      return;
    }

    const setAny = area.set as unknown as (
      items: Record<string, unknown>,
      callback?: () => void,
    ) => unknown;

    try {
      const maybePromise = setAny.call(area, items);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        await (maybePromise as Promise<unknown>);
        return;
      }
    } catch {
      // Fall back to callback form.
    }

    await new Promise<void>((resolve, reject) => {
      try {
        setAny.call(area, items, () => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private generateRandomKey(): string {
    const bytes = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    return Array.from(bytes)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }

  private async getOrCreateEncryptionKey(): Promise<string> {
    if (this.encryptionKeyCache) {
      return this.encryptionKeyCache;
    }

    const existing = this.asRecord(await this.localGet(ENCRYPTION_KEY_STORAGE_KEY))[ENCRYPTION_KEY_STORAGE_KEY];
    if (typeof existing === 'string' && existing.length >= 32) {
      this.encryptionKeyCache = existing;
      return existing;
    }

    const generatedKey = this.generateRandomKey();
    this.encryptionKeyCache = generatedKey;

    try {
      await this.localSet({ [ENCRYPTION_KEY_STORAGE_KEY]: generatedKey });
    } catch (error) {
      console.warn('Unable to persist generated encryption key:', error);
    }

    return generatedKey;
  }

  private async getDecryptionKeys(): Promise<string[]> {
    const runtimeLegacyKey = chrome?.runtime?.id ? `typewise:${chrome.runtime.id}:v1` : '';
    return Array.from(
      new Set([
        await this.getOrCreateEncryptionKey(),
        runtimeLegacyKey,
        ...LEGACY_ENCRYPTION_KEYS,
      ]),
    ).filter(Boolean);
  }

  async getAll(): Promise<StorageData> {
    try {
      const result = this.asRecord(await this.localGet(STORAGE_KEY));
      const encryptedLocal = result[STORAGE_KEY];

      if (typeof encryptedLocal === 'string' && encryptedLocal.length > 0) {
        const decryptedLocal = await this.decrypt(encryptedLocal);
        if (decryptedLocal) {
          const normalized = this.normalizeStorageData(decryptedLocal);
          await this.ensurePlaintextMirrors(normalized);
          return normalized;
        }
      }

      const legacyEncryptedResult = this.asRecord(await this.localGet([...LEGACY_STORAGE_KEYS]));
      for (const key of LEGACY_STORAGE_KEYS) {
        const candidate = legacyEncryptedResult[key];

        if (typeof candidate === 'string' && candidate.length > 0) {
          const decryptedLegacy = await this.decrypt(candidate);
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

      const syncResult = this.asRecord(await this.syncGet(STORAGE_KEY));
      const encryptedSync = syncResult[STORAGE_KEY];
      if (typeof encryptedSync === 'string' && encryptedSync.length > 0) {
        const decryptedSync = await this.decrypt(encryptedSync);
        if (decryptedSync) {
          const normalizedSync = this.normalizeStorageData(decryptedSync);
          await this.saveAll(normalizedSync);
          return normalizedSync;
        }
      }

      const localFallback = this.asRecord(await this.localGet(['settings']));
      const fallbackSettings = this.asRecord(localFallback.settings);
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
              ...fallbackSettings,
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
    const encrypted = await this.encrypt(normalized);

    try {
      await this.localSet({
        [STORAGE_KEY]: encrypted,
        snippets: normalized.snippets,
        settings: normalized.user.settings,
      });
    } catch (error) {
      console.error('Error saving local storage:', error);
      throw error;
    }

    if (normalized.user.settings.syncEnabled) {
      try {
        await this.syncSet({ [STORAGE_KEY]: encrypted });
      } catch (error) {
        console.warn('Unable to sync encrypted storage to chrome.storage.sync:', error);
      }
    }
  }

  async getSnippets(): Promise<Snippet[]> {
    const data = await this.getAll();
    const localPrimary = this.asRecord(await this.localGet('snippets'));
    const localPrimarySnippets = this.sanitizeSnippets(localPrimary.snippets);
    const localSnippets = this.mergeSnippets(await this.getLegacySnippetCandidates(), localPrimarySnippets);
    const encryptedSnippets = this.sanitizeSnippets(data.snippets);
    const mergedSnippets = this.mergeSnippets(localSnippets, encryptedSnippets);

    if (mergedSnippets.length > 0) {
      if (this.haveSnippetDifferences(localPrimarySnippets, mergedSnippets)) {
        await this.localSet({ snippets: mergedSnippets });
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
      const normalized = this.normalizeSnippet(snippet, snippets.length);

      if (!normalized) {
        throw new Error('Snippet is invalid. Ensure title, shortcut, and content are valid.');
      }

      const index = snippets.findIndex((s) => s.id === normalized.id);
      if (index >= 0) {
        snippets[index] = normalized;
      } else {
        snippets.push(normalized);
      }

      // Plaintext snippets are the primary runtime store and must always persist.
      await this.localSet({ snippets });

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

      await this.localSet({ snippets });

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

  private async encrypt(data: StorageData): Promise<string> {
    const encryptionKey = await this.getOrCreateEncryptionKey();
    const keyBuffer = this.hexToBuffer(encryptionKey);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedData = new TextEncoder().encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encodedData
    );

    // Combine IV and ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  private async decrypt(encryptedData: string): Promise<StorageData | null> {
    try {
      const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
      const iv = combined.slice(0, 12);
      const ciphertext = combined.slice(12);

      for (const key of await this.getDecryptionKeys()) {
        try {
          const keyBuffer = this.hexToBuffer(key);
          const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBuffer,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
          );

          const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            cryptoKey,
            ciphertext
          );
          const decoded = new TextDecoder().decode(decrypted);
          if (!decoded) {
            continue;
          }

          const parsed = JSON.parse(decoded) as Partial<StorageData>;
          if (parsed && typeof parsed === 'object') {
            return this.normalizeStorageData(parsed);
          }
        } catch {
          // Try next key.
        }
      }
    } catch (error) {
      console.warn('Error during decryption:', error);
    }

    // Try legacy format (plaintext JSON)
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

  private hexToBuffer(hex: string): ArrayBuffer {
    if (hex.length % 2 !== 0) {
      throw new Error('Invalid hex string');
    }
    const buffer = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      buffer[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return buffer.buffer;
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

    const rawShortcut = this.pickString(item.shortcut, item.trigger, item.abbr, item.key, item.keyword, item.code);
    const rawContent = this.pickString(item.content, item.text, item.value, item.body, item.snippet, item.expansion, item.phrase, item.template);
    if (!rawShortcut || !rawContent) return null;

    const shortcut = rawShortcut.trim().slice(0, MAX_SHORTCUT_LENGTH);
    const content = rawContent.slice(0, MAX_CONTENT_LENGTH);
    if (!shortcut || !content || /\s/.test(shortcut)) return null;

    const now = new Date().toISOString();
    const tags = (Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
      : this.pickString(item.tags)
          ?.split(',')
          .map((tag) => tag.trim())
          .filter(Boolean) || [])
      .slice(0, MAX_TAG_COUNT)
      .map((tag) => tag.slice(0, MAX_TAG_LENGTH));

    const title = (this.pickString(item.title, item.name, item.label, item.shortcut) || `Snippet ${index + 1}`).slice(
      0,
      MAX_TITLE_LENGTH,
    );

    return {
      id: this.pickString(item.id, item._id, item.uuid) || `snippet-${Date.now()}-${index}`,
      title,
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
      await this.localSet({
        snippets: data.snippets,
        settings: data.user.settings,
      });
    } catch (error) {
      console.warn('Unable to ensure plaintext mirrors:', error);
    }
  }

  private async getLegacySnippetCandidates(): Promise<Snippet[]> {
    const keys = [...LEGACY_SNIPPET_KEYS];
    if (keys.length === 0) {
      return [];
    }

    const result = this.asRecord(await this.localGet(keys));
    let all: Snippet[] = [];

    for (const key of keys) {
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