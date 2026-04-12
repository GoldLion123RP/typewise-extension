// src/options/options.ts
import { Snippet, UserSettings } from '../types';
import { storage } from '../utils/storage';
import { gistManager } from '../api/gistManager';

class OptionsManager {
  private currentTab = 'general';
  private snippets: Snippet[] = [];

  constructor() {
    void this.init();
  }

  async init() {
    await this.loadSettings();
    await this.loadSnippets();
    this.attachEventListeners();
    this.checkWelcomeMode();
    await this.updateGitHubStatus();
  }

  async loadSettings() {
    const user = await storage.getUser();
    const settings = user.settings;

    (document.getElementById('theme') as HTMLSelectElement | null)?.setAttribute('value', settings.theme);
    const themeEl = document.getElementById('theme') as HTMLSelectElement | null;
    const triggerKeyEl = document.getElementById('triggerKey') as HTMLInputElement | null;
    const expandDelayEl = document.getElementById('expandDelay') as HTMLInputElement | null;
    const caseSensitiveEl = document.getElementById('caseSensitive') as HTMLInputElement | null;
    const showNotificationsEl = document.getElementById('showNotifications') as HTMLInputElement | null;
    const syncEnabledEl = document.getElementById('syncEnabled') as HTMLInputElement | null;
    const autoBackupEl = document.getElementById('autoBackup') as HTMLInputElement | null;

    if (themeEl) themeEl.value = settings.theme;
    if (triggerKeyEl) triggerKeyEl.value = settings.triggerKey;
    if (expandDelayEl) expandDelayEl.value = settings.expandDelay.toString();
    if (caseSensitiveEl) caseSensitiveEl.checked = settings.caseSensitive;
    if (showNotificationsEl) showNotificationsEl.checked = settings.showNotifications;
    if (syncEnabledEl) syncEnabledEl.checked = settings.syncEnabled;
    if (autoBackupEl) autoBackupEl.checked = settings.autoBackup;

    this.applyTheme(settings.theme);
  }

  async loadSnippets() {
    this.snippets = await storage.getSnippets();
    this.renderSnippets();
    await this.updateStats();
  }

  attachEventListeners() {
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        const tab = item.getAttribute('data-tab');
        if (tab) this.switchTab(tab);
      });
    });

    document.getElementById('saveBtn')?.addEventListener('click', () => {
      void this.saveSettings();
    });

    document.getElementById('themeToggle')?.addEventListener('click', () => {
      void this.toggleTheme();
    });

    document.getElementById('theme')?.addEventListener('change', (e) => {
      const theme = (e.target as HTMLSelectElement).value as 'light' | 'dark' | 'system';
      this.applyTheme(theme);
    });

    document.getElementById('addSnippetBtn')?.addEventListener('click', () => this.openSnippetModal());
    document.getElementById('importSnippetsBtn')?.addEventListener('click', () => {
      void this.importSnippets();
    });
    document.getElementById('exportSnippetsBtn')?.addEventListener('click', () => {
      void this.exportSnippets();
    });

    document.getElementById('snippetSearch')?.addEventListener('input', (e) => {
      this.renderSnippets((e.target as HTMLInputElement).value);
    });

    document.getElementById('closeModalBtn')?.addEventListener('click', () => this.closeSnippetModal());
    document.getElementById('cancelSnippetBtn')?.addEventListener('click', () => this.closeSnippetModal());
    document.getElementById('saveSnippetBtn')?.addEventListener('click', () => {
      void this.saveSnippetForm();
    });

    document.getElementById('snippetsList')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest('button');
      if (!button) return;

      const id = button.dataset.id;
      if (!id) return;

      if (button.classList.contains('edit-btn')) {
        this.editSnippet(id);
      } else if (button.classList.contains('delete-btn')) {
        void this.deleteSnippet(id);
      }
    });

    document.getElementById('connectGithubBtn')?.addEventListener('click', () => {
      void this.connectOrDisconnectGitHub();
    });
    document.getElementById('syncNowBtn')?.addEventListener('click', () => {
      void this.syncNow();
    });
    document.getElementById('pullFromGistBtn')?.addEventListener('click', () => {
      void this.pullFromGist();
    });

    document.getElementById('reportBugLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://github.com/GoldLion123RP/typewise-extension/issues/new?labels=bug', '_blank');
    });

    document.getElementById('requestFeatureLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://github.com/GoldLion123RP/typewise-extension/issues/new?labels=enhancement', '_blank');
    });
  }

  switchTab(tabName: string) {
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-tab') === tabName);
    });

    document.querySelectorAll('.tab-pane').forEach((pane) => {
      pane.classList.toggle('active', pane.id === `${tabName}-tab`);
    });

    this.currentTab = tabName;
  }

  async saveSettings() {
    const settings: UserSettings = {
      theme: ((document.getElementById('theme') as HTMLSelectElement | null)?.value || 'system') as
        | 'light'
        | 'dark'
        | 'system',
      triggerKey: (document.getElementById('triggerKey') as HTMLInputElement | null)?.value || '/',
      expandDelay: parseInt((document.getElementById('expandDelay') as HTMLInputElement | null)?.value || '0', 10) || 0,
      caseSensitive: (document.getElementById('caseSensitive') as HTMLInputElement | null)?.checked || false,
      showNotifications:
        (document.getElementById('showNotifications') as HTMLInputElement | null)?.checked || false,
      syncEnabled: (document.getElementById('syncEnabled') as HTMLInputElement | null)?.checked || false,
      autoBackup: (document.getElementById('autoBackup') as HTMLInputElement | null)?.checked || false,
    };

    await storage.updateSettings(settings);
    chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings }).catch(() => undefined);
    this.showToast('Settings saved successfully', 'success');
  }

  renderSnippets(searchTerm = '') {
    const container = document.getElementById('snippetsList');
    if (!container) return;

    const term = searchTerm.trim().toLowerCase();
    const filtered = this.snippets.filter(
      (snippet) =>
        snippet.title.toLowerCase().includes(term) ||
        snippet.shortcut.toLowerCase().includes(term) ||
        snippet.content.toLowerCase().includes(term),
    );

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state">No snippets found</div>';
      return;
    }

    container.innerHTML = filtered
      .map(
        (snippet) => `
        <div class="snippet-card">
          <h4>
            ${this.escapeHtml(snippet.title)}
            <span class="snippet-shortcut">${this.escapeHtml(snippet.shortcut)}</span>
          </h4>
          <div class="snippet-content-preview">${this.escapeHtml(snippet.content)}</div>
          <div class="snippet-actions">
            <button class="snippet-action-btn edit-btn" data-id="${snippet.id}">Edit</button>
            <button class="snippet-action-btn delete-btn delete" data-id="${snippet.id}">Delete</button>
          </div>
        </div>
      `,
      )
      .join('');
  }

  openSnippetModal(snippetId?: string) {
    const modal = document.getElementById('snippetModal');
    const form = document.getElementById('snippetForm') as HTMLFormElement | null;
    const modalTitle = document.getElementById('modalTitle');

    if (!modal || !form || !modalTitle) return;

    form.reset();

    const idEl = document.getElementById('snippetId') as HTMLInputElement | null;
    const titleEl = document.getElementById('snippetTitle') as HTMLInputElement | null;
    const shortcutEl = document.getElementById('snippetShortcut') as HTMLInputElement | null;
    const contentEl = document.getElementById('snippetContent') as HTMLTextAreaElement | null;
    const tagsEl = document.getElementById('snippetTags') as HTMLInputElement | null;

    if (idEl) idEl.value = '';

    if (snippetId) {
      const snippet = this.snippets.find((s) => s.id === snippetId);
      if (snippet) {
        modalTitle.textContent = 'Edit Snippet';
        if (idEl) idEl.value = snippet.id;
        if (titleEl) titleEl.value = snippet.title;
        if (shortcutEl) shortcutEl.value = snippet.shortcut;
        if (contentEl) contentEl.value = snippet.content;
        if (tagsEl) tagsEl.value = (snippet.tags || []).join(', ');
      }
    } else {
      modalTitle.textContent = 'Add Snippet';
    }

    modal.classList.remove('hidden');
  }

  closeSnippetModal() {
    document.getElementById('snippetModal')?.classList.add('hidden');
  }

  async saveSnippetForm() {
    const id = (document.getElementById('snippetId') as HTMLInputElement | null)?.value || '';
    const title = (document.getElementById('snippetTitle') as HTMLInputElement | null)?.value.trim() || '';
    const shortcut =
      (document.getElementById('snippetShortcut') as HTMLInputElement | null)?.value.trim() || '';
    const content =
      (document.getElementById('snippetContent') as HTMLTextAreaElement | null)?.value.trim() || '';
    const tagsStr = (document.getElementById('snippetTags') as HTMLInputElement | null)?.value || '';

    if (!title || !shortcut || !content) {
      this.showToast('Please fill in all required fields', 'error');
      return;
    }

    const existing = this.snippets.find((s) => s.id === id);
    const snippet: Snippet = {
      id: id || this.generateSnippetId(),
      title,
      shortcut,
      content,
      tags: tagsStr
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      usageCount: existing?.usageCount || 0,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
      category: existing?.category || 'General',
    };

    await storage.saveSnippet(snippet);
    await this.loadSnippets();
    this.closeSnippetModal();
    this.showToast('Snippet saved successfully', 'success');

    chrome.runtime.sendMessage({ type: 'SAVE_SNIPPET', snippet }).catch(() => undefined);
  }

  editSnippet(id: string) {
    this.openSnippetModal(id);
  }

  async deleteSnippet(id: string) {
    if (!confirm('Are you sure you want to delete this snippet?')) return;

    await storage.deleteSnippet(id);
    await this.loadSnippets();
    this.showToast('Snippet deleted', 'success');
    chrome.runtime.sendMessage({ type: 'DELETE_SNIPPET', id }).catch(() => undefined);
  }

  async importSnippets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!Array.isArray(data)) {
          throw new Error('Invalid JSON');
        }

        for (const item of data) {
          if (item && typeof item === 'object') {
            await storage.saveSnippet(item as Snippet);
          }
        }

        await this.loadSnippets();
        this.showToast('Snippets imported successfully', 'success');
      } catch {
        this.showToast('Invalid import file', 'error');
      }
    };

    input.click();
  }

  async exportSnippets() {
    const data = JSON.stringify(this.snippets, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `typewise-snippets-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async connectOrDisconnectGitHub() {
    const user = await storage.getUser();

    if (user.githubToken) {
      await storage.updateUser({ githubToken: undefined, gistId: undefined, githubUsername: undefined });
      await this.updateGitHubStatus();
      this.showToast('Disconnected from GitHub', 'success');
      return;
    }

    try {
      const token = await gistManager.authenticate();
      await storage.updateUser({ githubToken: token });
      await this.updateGitHubStatus();
      this.showToast('Connected to GitHub successfully', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to connect to GitHub';
      this.showToast(message, 'error');
    }
  }

  async syncNow() {
    try {
      await gistManager.syncWithGist();
      this.showToast('Synced with GitHub', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      this.showToast(`Sync failed: ${message}`, 'error');
    }
  }

  async pullFromGist() {
    try {
      await gistManager.pullFromGist();
      await this.loadSnippets();
      this.showToast('Pulled snippets from Gist', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Pull failed';
      this.showToast(`Pull failed: ${message}`, 'error');
    }
  }

  async updateGitHubStatus() {
    const user = await storage.getUser();
    const statusDiv = document.getElementById('githubStatus');
    const connectBtn = document.getElementById('connectGithubBtn') as HTMLButtonElement | null;

    if (!statusDiv) return;

    if (user.githubToken) {
      statusDiv.className = 'github-status connected';
      statusDiv.innerHTML = `
        <strong>Connected to GitHub</strong>
        <p>Username: ${this.escapeHtml(user.githubUsername || 'Unknown')}</p>
        ${user.gistId ? `<p>Gist ID: ${this.escapeHtml(user.gistId)}</p>` : ''}
      `;

      if (connectBtn) {
        connectBtn.textContent = 'Disconnect GitHub';
        connectBtn.classList.remove('btn-primary');
        connectBtn.classList.add('btn-danger');
      }
    } else {
      statusDiv.className = 'github-status';
      statusDiv.innerHTML = `
        <strong>Not connected to GitHub</strong>
        <p>Connect to sync your snippets across devices.</p>
      `;

      if (connectBtn) {
        connectBtn.textContent = 'Connect GitHub Account';
        connectBtn.classList.add('btn-primary');
        connectBtn.classList.remove('btn-danger');
      }
    }
  }

  async updateStats() {
    const totalSnippets = this.snippets.length;
    const totalExpansions = this.snippets.reduce((sum, snippet) => sum + snippet.usageCount, 0);

    const totalEl = document.getElementById('totalSnippetsCount');
    const expansionsEl = document.getElementById('totalExpansions');

    if (totalEl) totalEl.textContent = totalSnippets.toString();
    if (expansionsEl) expansionsEl.textContent = totalExpansions.toString();
  }

  checkWelcomeMode() {
    const params = new URLSearchParams(window.location.search);

    if (params.get('welcome') === 'true') {
      this.showToast('Welcome to TypeWise!', 'success');
      this.switchTab('general');
    }

    if (params.get('new') === 'true') {
      const content = params.get('content');
      if (content) {
        this.openSnippetModal();
        const contentInput = document.getElementById('snippetContent') as HTMLTextAreaElement | null;
        if (contentInput) contentInput.value = content;
      }
    }
  }

  applyTheme(theme: 'light' | 'dark' | 'system') {
    const isDark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    document.body.classList.toggle('dark', isDark);

    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
      themeBtn.textContent = isDark ? 'Light' : 'Dark';
    }
  }

  async toggleTheme() {
    const themeSelect = document.getElementById('theme') as HTMLSelectElement | null;
    const currentIsDark = document.body.classList.contains('dark');
    const nextTheme: 'light' | 'dark' = currentIsDark ? 'light' : 'dark';

    if (themeSelect) {
      themeSelect.value = nextTheme;
    }

    this.applyTheme(nextTheme);
    await this.saveSettings();
  }

  showToast(message: string, type: 'success' | 'error' | 'warning' = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  generateSnippetId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OptionsManager();
});
