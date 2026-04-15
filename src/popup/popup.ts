// src/popup/popup.ts
import { Snippet } from '../types';
import { storage } from '../utils/storage';

class PopupManager {
  private snippets: Snippet[] = [];
  private currentEditId: string | null = null;
  
  constructor() {
    void this.init();
  }
  
  async init() {
    this.attachEventListeners();

    try {
      await this.loadSnippets();
      await this.updateStats();
    } catch (error) {
      console.error('Popup initialization error:', error);
      this.snippets = [];
      this.renderSnippets();
      this.showToast('Recovered from a data error. Try opening settings once.', 'warning');
    }
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
  }
  
  renderSnippets(filter: string = '') {
    const container = document.getElementById('snippetsList');
    if (!container) return;
    
    const query = filter.toLowerCase();
    const filteredSnippets = this.snippets.filter(s => 
      (s.title || '').toLowerCase().includes(query) ||
      (s.shortcut || '').toLowerCase().includes(query) ||
      (s.content || '').toLowerCase().includes(query) ||
      s.tags?.some(t => (t || '').toLowerCase().includes(query))
    );
    
    container.replaceChildren();

    if (filteredSnippets.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';

      const icon = document.createElement('div');
      icon.className = 'empty-state-icon';
      icon.textContent = '📝';

      const title = document.createElement('div');
      title.className = 'empty-state-title';
      title.textContent = 'No snippets found';

      const text = document.createElement('div');
      text.className = 'empty-state-text';
      text.textContent = filter ? 'Try a different search term' : 'Create your first snippet to get started';

      emptyState.appendChild(icon);
      emptyState.appendChild(title);
      emptyState.appendChild(text);
      container.appendChild(emptyState);
      return;
    }

    for (const snippet of filteredSnippets) {
      const item = document.createElement('div');
      item.className = 'snippet-item';
      item.dataset.id = snippet.id;

      const header = document.createElement('div');
      header.className = 'snippet-header';

      const snippetTitle = document.createElement('span');
      snippetTitle.className = 'snippet-title';
      snippetTitle.textContent = snippet.title || 'Untitled';

      const snippetShortcut = document.createElement('span');
      snippetShortcut.className = 'snippet-shortcut';
      snippetShortcut.textContent = snippet.shortcut || '';

      header.appendChild(snippetTitle);
      header.appendChild(snippetShortcut);

      const content = document.createElement('div');
      content.className = 'snippet-content';
      content.textContent = snippet.content || '';

      const footer = document.createElement('div');
      footer.className = 'snippet-footer';

      const tags = document.createElement('div');
      tags.className = 'snippet-tags';
      for (const tagText of snippet.tags || []) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = tagText;
        tags.appendChild(tag);
      }

      const actions = document.createElement('div');
      actions.className = 'snippet-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'snippet-action edit-snippet';
      editBtn.dataset.id = snippet.id;
      editBtn.title = 'Edit';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.editSnippet(snippet.id);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'snippet-action delete-snippet';
      deleteBtn.dataset.id = snippet.id;
      deleteBtn.title = 'Delete';
      deleteBtn.textContent = '🗑️';
      deleteBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (confirm('Delete this snippet?')) {
          await this.deleteSnippet(snippet.id);
        }
      });

      const copyBtn = document.createElement('button');
      copyBtn.className = 'snippet-action copy-snippet';
      copyBtn.dataset.id = snippet.id;
      copyBtn.title = 'Copy';
      copyBtn.textContent = '📋';
      copyBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.copySnippet(snippet.id);
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      actions.appendChild(copyBtn);
      footer.appendChild(tags);
      footer.appendChild(actions);

      item.appendChild(header);
      item.appendChild(content);
      item.appendChild(footer);

      item.addEventListener('click', () => {
        this.insertSnippet(snippet.id);
      });

      container.appendChild(item);
    }
  }
  
  attachEventListeners() {
    // Search
    const searchInput = document.getElementById('searchInput') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      this.renderSnippets((e.target as HTMLInputElement).value);
    });
    
    // Add snippet
    document.getElementById('addSnippetBtn')?.addEventListener('click', () => {
      this.showModal();
    });
    
    // Modal controls
    document.getElementById('closeModalBtn')?.addEventListener('click', () => {
      this.hideModal();
    });
    
    document.getElementById('cancelBtn')?.addEventListener('click', () => {
      this.hideModal();
    });
    
    document.getElementById('saveSnippetBtn')?.addEventListener('click', async () => {
      await this.saveSnippet();
    });

    document.getElementById('snippetModal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'snippetModal') {
        this.hideModal();
      }
    });
    
    // Settings
    document.getElementById('settingsBtn')?.addEventListener('click', () => {
      this.openSettingsPage();
    });
    
    // Quick actions
    document.getElementById('syncBtn')?.addEventListener('click', async () => {
      await this.syncWithGitHub();
    });
    
    document.getElementById('importBtn')?.addEventListener('click', () => {
      this.importSnippets();
    });
    
    document.getElementById('exportBtn')?.addEventListener('click', async () => {
      await this.exportSnippets();
    });
  }
  
  showModal(snippet?: Snippet) {
    const modal = document.getElementById('snippetModal');
    const modalTitle = document.getElementById('modalTitle');
    
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
      
      if (snippet) {
        this.currentEditId = snippet.id;
        if (modalTitle) modalTitle.textContent = 'Edit Snippet';
        
        (document.getElementById('snippetTitle') as HTMLInputElement).value = snippet.title;
        (document.getElementById('snippetShortcut') as HTMLInputElement).value = snippet.shortcut;
        (document.getElementById('snippetContent') as HTMLTextAreaElement).value = snippet.content;
        (document.getElementById('snippetCategory') as HTMLSelectElement).value = snippet.category || 'General';
        (document.getElementById('snippetTags') as HTMLInputElement).value = snippet.tags?.join(', ') || '';
      } else {
        this.currentEditId = null;
        if (modalTitle) modalTitle.textContent = 'Add New Snippet';
        
        (document.getElementById('snippetTitle') as HTMLInputElement).value = '';
        (document.getElementById('snippetShortcut') as HTMLInputElement).value = '';
        (document.getElementById('snippetContent') as HTMLTextAreaElement).value = '';
        (document.getElementById('snippetCategory') as HTMLSelectElement).value = 'General';
        (document.getElementById('snippetTags') as HTMLInputElement).value = '';
      }
    }
  }
  
  hideModal() {
    const modal = document.getElementById('snippetModal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
    }
  }
  
  async saveSnippet() {
    const title = (document.getElementById('snippetTitle') as HTMLInputElement).value.trim();
    const shortcut = (document.getElementById('snippetShortcut') as HTMLInputElement).value.trim();
    const content = (document.getElementById('snippetContent') as HTMLTextAreaElement).value.trim();
    const category = (document.getElementById('snippetCategory') as HTMLSelectElement).value;
    const tags = (document.getElementById('snippetTags') as HTMLInputElement).value
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);
    
    if (!title || !shortcut || !content) {
      alert('Please fill in all required fields');
      return;
    }
    
    const snippet: Snippet = {
      id: this.currentEditId || `snippet-${Date.now()}`,
      title,
      shortcut,
      content,
      category,
      tags,
      usageCount: this.currentEditId ? 
        (this.snippets.find(s => s.id === this.currentEditId)?.usageCount || 0) : 0,
      createdAt: this.currentEditId ? 
        (this.snippets.find(s => s.id === this.currentEditId)?.createdAt || new Date().toISOString()) : 
        new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true
    };

    try {
      const result = await chrome.runtime.sendMessage({ type: 'SAVE_SNIPPET', snippet });

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to save snippet');
      }

      await this.loadSnippets();
      await this.updateStats();
      this.hideModal();
      this.showToast('Snippet saved successfully', 'success');
    } catch (_error) {
      // Fallback to direct storage in case background messaging fails.
      try {
        await storage.saveSnippet(snippet);
        await this.loadSnippets();
        await this.updateStats();
        this.hideModal();
        this.showToast('Snippet saved successfully', 'success');
      } catch (_fallbackError) {
        console.error('Popup save snippet error:', _fallbackError);
        const message = _fallbackError instanceof Error ? _fallbackError.message : 'Failed to save snippet. Please try again.';
        this.showToast(message, 'error');
      }
    }
  }
  
  editSnippet(id: string) {
    const snippet = this.snippets.find(s => s.id === id);
    if (snippet) {
      this.showModal(snippet);
    }
  }
  
  async deleteSnippet(id: string) {
    await storage.deleteSnippet(id);
    await this.loadSnippets();
    this.showToast('Snippet deleted', 'success');
  }
  
  copySnippet(id: string) {
    const snippet = this.snippets.find(s => s.id === id);
    if (snippet) {
      navigator.clipboard.writeText(snippet.content);
      this.showToast('Copied to clipboard', 'success');
    }
  }
  
  async insertSnippet(id: string) {
    const snippet = this.snippets.find(s => s.id === id);
    if (snippet) {
      // Send to active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'INSERT_SNIPPET',
            snippet
          });
          window.close();
        }
      });
    }
  }
  
  async updateStats() {
    const totalSnippets = this.snippets.length;
    const todayUsage = this.snippets.reduce((sum, s) => sum + s.usageCount, 0);
    
    const totalEl = document.getElementById('totalSnippets');
    const usageEl = document.getElementById('todayUsage');
    
    if (totalEl) totalEl.textContent = totalSnippets.toString();
    if (usageEl) usageEl.textContent = todayUsage.toString();
    
    // Update sync status
    const user = await storage.getUser();
    const syncEl = document.getElementById('syncStatus');
    if (syncEl) {
      syncEl.textContent = user.githubToken ? '●' : '○';
      syncEl.style.color = user.githubToken ? '#4caf50' : '#999';
    }
  }
  
  async syncWithGitHub() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SYNC_WITH_GITHUB' });
      if (result.success) {
        this.showToast('Synced with GitHub', 'success');
      } else {
        throw new Error(result.error);
      }
    } catch (_error: any) {
      this.showToast(_error.message || 'Sync failed', 'error');
    }
  }
  
  importSnippets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const text = await file.text();
        try {
          const result = await chrome.runtime.sendMessage({ 
            type: 'IMPORT_DATA', 
            data: text 
          });

          if (!result?.success) {
            throw new Error(result?.error || 'Import failed');
          }

          await this.loadSnippets();
          this.showToast('Snippets imported successfully', 'success');
        } catch (_error) {
          this.showToast('Invalid import file', 'error');
        }
      }
    };
    
    input.click();
  }
  
  async exportSnippets() {
    const result = await chrome.runtime.sendMessage({ type: 'EXPORT_DATA' });
    if (result.success) {
      const blob = new Blob([result.data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `typewise-snippets-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Snippets exported', 'success');
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

  openSettingsPage() {
    try {
      chrome.runtime.openOptionsPage(() => {
        if (chrome.runtime.lastError) {
          this.openSettingsFallback();
        }
      });
    } catch {
      this.openSettingsFallback();
    }
  }

  openSettingsFallback() {
    const optionsUrl = chrome.runtime.getURL('options/options.html');
    chrome.tabs.create({ url: optionsUrl });
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});