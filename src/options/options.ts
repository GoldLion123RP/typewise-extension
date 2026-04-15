// src/options/options.ts
import { Snippet, UserSettings } from '../types';
import { storage } from '../utils/storage';
import { gistManager } from '../api/gistManager';

class OptionsManager {
  private currentTab = 'general';
  private snippets: Snippet[] = [];
  private settingsSaveTimer: number | null = null;

  constructor() {
    void this.init();
  }

  async init() {
    document.body.classList.add('dark');
    this.attachEventListeners();

    try {
      await this.loadSettings();
      await this.loadSnippets();
      await this.updateGitHubStatus();
    } catch (error) {
      console.error('Options initialization error:', error);
      this.showToast('Recovered from a data error. Please review your snippets.', 'warning');
    }

    this.checkWelcomeMode();
  }

  async loadSettings() {
    const user = await storage.getUser();
    const settings = user.settings;

    const triggerKeyEl = document.getElementById('triggerKey') as HTMLInputElement | null;
    const expandDelayEl = document.getElementById('expandDelay') as HTMLInputElement | null;
    const caseSensitiveEl = document.getElementById('caseSensitive') as HTMLInputElement | null;
    const showNotificationsEl = document.getElementById('showNotifications') as HTMLInputElement | null;
    const syncEnabledEl = document.getElementById('syncEnabled') as HTMLInputElement | null;
    const autoBackupEl = document.getElementById('autoBackup') as HTMLInputElement | null;

    if (triggerKeyEl) triggerKeyEl.value = settings.triggerKey;
    if (expandDelayEl) expandDelayEl.value = settings.expandDelay.toString();
    if (caseSensitiveEl) caseSensitiveEl.checked = settings.caseSensitive;
    if (showNotificationsEl) showNotificationsEl.checked = settings.showNotifications;
    if (syncEnabledEl) syncEnabledEl.checked = settings.syncEnabled;
    if (autoBackupEl) autoBackupEl.checked = settings.autoBackup;
  }

  async loadSnippets() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_SNIPPETS' });
      if (result?.success && Array.isArray(result.data)) {
        this.snippets = result.data;
      } else {
        this.snippets = await storage.getSnippets();
      }
    } catch {
      this.snippets = await storage.getSnippets();
    }

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

    document.getElementById('triggerKey')?.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.value.length > 1) {
        input.value = input.value.slice(0, 1);
      }
      this.scheduleSettingsSave();
    });

    document.getElementById('expandDelay')?.addEventListener('input', () => {
      this.scheduleSettingsSave();
    });

    document.getElementById('caseSensitive')?.addEventListener('change', () => {
      void this.saveSettings();
    });

    document.getElementById('showNotifications')?.addEventListener('change', () => {
      void this.saveSettings();
    });

    document.getElementById('syncEnabled')?.addEventListener('change', () => {
      void this.saveSettings();
    });

    document.getElementById('autoBackup')?.addEventListener('change', () => {
      void this.saveSettings();
    });

    document.getElementById('addSnippetBtn')?.addEventListener('click', () => this.openSnippetModal());
    document.getElementById('heroCreateSnippetBtn')?.addEventListener('click', () => {
      this.switchTab('snippets');
      this.openSnippetModal();
    });
    document.getElementById('heroSyncBtn')?.addEventListener('click', () => {
      void this.syncNow();
    });
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

    document.getElementById('snippetForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.saveSnippetForm();
    });

    document.getElementById('snippetModal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'snippetModal') {
        this.closeSnippetModal();
      }
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
      window.open('https://github.com/GoldLion123RP/typewise-extension/issues/new?labels=bug', '_blank', 'noopener,noreferrer');
    });

    document.getElementById('requestFeatureLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://github.com/GoldLion123RP/typewise-extension/issues/new?labels=enhancement', '_blank', 'noopener,noreferrer');
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

  async saveSettings(showToast = false) {
    if (this.settingsSaveTimer !== null) {
      window.clearTimeout(this.settingsSaveTimer);
      this.settingsSaveTimer = null;
    }

    const triggerKeyRaw = (document.getElementById('triggerKey') as HTMLInputElement | null)?.value.trim() || '/';
    const triggerKey = triggerKeyRaw[0] || '/';

    const settings: UserSettings = {
      theme: 'dark',
      triggerKey,
      expandDelay: parseInt((document.getElementById('expandDelay') as HTMLInputElement | null)?.value || '0', 10) || 0,
      caseSensitive: (document.getElementById('caseSensitive') as HTMLInputElement | null)?.checked || false,
      showNotifications:
        (document.getElementById('showNotifications') as HTMLInputElement | null)?.checked || false,
      syncEnabled: (document.getElementById('syncEnabled') as HTMLInputElement | null)?.checked || false,
      autoBackup: (document.getElementById('autoBackup') as HTMLInputElement | null)?.checked || false,
    };

    await storage.updateSettings(settings);
    chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings }).catch(() => undefined);
    if (showToast) {
      this.showToast('Settings saved successfully', 'success');
    }
  }

  scheduleSettingsSave() {
    if (this.settingsSaveTimer !== null) {
      window.clearTimeout(this.settingsSaveTimer);
    }

    this.settingsSaveTimer = window.setTimeout(() => {
      void this.saveSettings();
    }, 180);
  }

  renderSnippets(searchTerm = '') {
    const container = document.getElementById('snippetsList');
    if (!container) return;

    const term = searchTerm.trim().toLowerCase();
    const filtered = this.snippets.filter(
      (snippet) =>
        (snippet.title || '').toLowerCase().includes(term) ||
        (snippet.shortcut || '').toLowerCase().includes(term) ||
        (snippet.content || '').toLowerCase().includes(term),
    );

    // Clear existing content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    if (filtered.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.textContent = 'No snippets found';
      container.appendChild(emptyState);
      return;
    }

    filtered.forEach((snippet) => {
      const card = document.createElement('div');
      card.className = 'snippet-card';

      const titleContainer = document.createElement('h4');
      const titleText = document.createTextNode(this.escapeHtml(snippet.title || 'Untitled'));
      const shortcutSpan = document.createElement('span');
      shortcutSpan.className = 'snippet-shortcut';
      shortcutSpan.textContent = this.escapeHtml(snippet.shortcut || '');
      titleContainer.appendChild(titleText);
      titleContainer.appendChild(shortcutSpan);

      const contentPreview = document.createElement('div');
      contentPreview.className = 'snippet-content-preview';
      contentPreview.textContent = this.escapeHtml(snippet.content || '');

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'snippet-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'snippet-action-btn edit-btn';
      editBtn.setAttribute('data-id', snippet.id);
      editBtn.textContent = 'Edit';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'snippet-action-btn delete-btn delete';
      deleteBtn.setAttribute('data-id', snippet.id);
      deleteBtn.textContent = 'Delete';

      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);

      card.appendChild(titleContainer);
      card.appendChild(contentPreview);
      card.appendChild(actionsDiv);

      container.appendChild(card);
    });
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
    modal.classList.add('active');
  }

  closeSnippetModal() {
    const modal = document.getElementById('snippetModal');
    modal?.classList.remove('active');
    modal?.classList.add('hidden');
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

    try {
      const result = await chrome.runtime.sendMessage({ type: 'SAVE_SNIPPET', snippet });

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to save snippet');
      }

      await this.loadSnippets();
      this.closeSnippetModal();
      this.showToast('Snippet saved successfully', 'success');
    } catch (_error) {
      // Fallback to local write if background message is temporarily unavailable.
      try {
        await storage.saveSnippet(snippet);
        await this.loadSnippets();
        this.closeSnippetModal();
        this.showToast('Snippet saved successfully', 'success');
      } catch (_fallbackError) {
        console.error('Options save snippet error:', _fallbackError);
        const message = _fallbackError instanceof Error ? _fallbackError.message : 'Failed to save snippet. Please try again.';
        this.showToast(message, 'error');
      }
    }
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

    // Clear existing content
    statusDiv.textContent = '';

    if (user.githubToken) {
      statusDiv.className = 'github-status connected';

      // Create and append elements
      const strong = document.createElement('strong');
      strong.textContent = 'Connected to GitHub';
      statusDiv.appendChild(strong);

      const usernameP = document.createElement('p');
      usernameP.textContent = `Username: ${this.escapeHtml(user.githubUsername || 'Unknown')}`;
      statusDiv.appendChild(usernameP);

      if (user.gistId) {
        const gistP = document.createElement('p');
        gistP.textContent = `Gist ID: ${this.escapeHtml(user.gistId)}`;
        statusDiv.appendChild(gistP);
      }

      if (connectBtn) {
        connectBtn.textContent = 'Disconnect GitHub';
        connectBtn.classList.remove('btn-primary');
        connectBtn.classList.add('btn-danger');
      }
    } else {
      statusDiv.className = 'github-status';

      // Create and append elements
      const strong = document.createElement('strong');
      strong.textContent = 'Not connected to GitHub';
      statusDiv.appendChild(strong);

      const p = document.createElement('p');
      p.textContent = 'Connect to sync your snippets across devices.';
      statusDiv.appendChild(p);

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
    const activeSnippets = this.snippets.filter((snippet) => snippet.isActive).length;

    const totalEl = document.getElementById('totalSnippetsCount');
    const expansionsEl = document.getElementById('totalExpansions');
    const heroTotalEl = document.getElementById('heroSnippetCount');
    const heroActiveEl = document.getElementById('heroActiveCount');
    const heroExpansionEl = document.getElementById('heroExpansionCount');

    if (totalEl) totalEl.textContent = totalSnippets.toString();
    if (expansionsEl) expansionsEl.textContent = totalExpansions.toString();
    if (heroTotalEl) heroTotalEl.textContent = totalSnippets.toString();
    if (heroActiveEl) heroActiveEl.textContent = activeSnippets.toString();
    if (heroExpansionEl) heroExpansionEl.textContent = totalExpansions.toString();
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
