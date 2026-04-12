// src/background/background.ts
import { storage } from '../utils/storage';
import { gistManager } from '../api/gistManager';

class BackgroundService {
  constructor() {
    this.init();
  }

  async init() {
    // Extension installed or updated
    chrome.runtime.onInstalled.addListener(this.handleInstalled.bind(this));

    // Message handling
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

    // Keyboard commands
    chrome.commands.onCommand.addListener(this.handleCommand.bind(this));

    // Auto-sync timer (every 30 minutes)
    this.setupAutoSync();
  }

  async handleInstalled(details: chrome.runtime.InstalledDetails) {
    // Clear all context menus first
    await chrome.contextMenus.removeAll();

    // Create context menus
    chrome.contextMenus.create({
      id: 'typewise-insert',
      title: 'TypeWise: Insert Snippet',
      contexts: ['editable']
    });

    chrome.contextMenus.create({
      id: 'typewise-create',
      title: 'TypeWise: Create Snippet from Selection',
      contexts: ['selection']
    });

    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === 'typewise-insert' && tab?.id) {
        this.showQuickSearch(tab.id);
      } else if (info.menuItemId === 'typewise-create' && info.selectionText) {
        this.createSnippetFromSelection(info.selectionText);
      }
    });
  }

  async handleMessage(request: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
    try {
      switch (request.type) {
        case 'GET_SNIPPETS':
          const snippets = await storage.getSnippets();
          sendResponse({ success: true, data: snippets });
          break;

        case 'SAVE_SNIPPET':
          await storage.saveSnippet(request.snippet);
          this.notifyContentScripts('UPDATE_SNIPPETS');
          sendResponse({ success: true });
          break;

        case 'DELETE_SNIPPET':
          await storage.deleteSnippet(request.id);
          this.notifyContentScripts('UPDATE_SNIPPETS');
          sendResponse({ success: true });
          break;

        case 'UPDATE_USAGE_COUNT':
          await this.updateUsageCount(request.snippetId);
          sendResponse({ success: true });
          break;

        case 'SYNC_WITH_GITHUB':
          await this.syncWithGitHub();
          sendResponse({ success: true });
          break;

        case 'AUTHENTICATE_GITHUB':
          const token = await gistManager.authenticate();
          await storage.updateUser({ githubToken: token });
          sendResponse({ success: true, token });
          break;

        case 'EXPORT_DATA':
          const exportData = await storage.exportData();
          sendResponse({ success: true, data: exportData });
          break;

        case 'IMPORT_DATA':
          await storage.importData(request.data);
          this.notifyContentScripts('UPDATE_SNIPPETS');
          sendResponse({ success: true });
          break;

        case 'UPDATE_SETTINGS':
          await storage.updateSettings(request.settings);
          this.notifyContentScripts('UPDATE_SETTINGS');
          sendResponse({ success: true });
          break;

        case 'SHOW_QUICK_SEARCH':
          this.showQuickSearch(sender.tab?.id);
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error: any) {
      console.error('Background message error:', error);
      sendResponse({ success: false, error: error.message });
    }

    return true;
  }

  handleCommand(command: string) {
    if (command === 'quick-search') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          this.showQuickSearch(tabs[0].id);
        }
      });
    }
  }

  async updateUsageCount(snippetId: string) {
    const snippets = await storage.getSnippets();
    const snippet = snippets.find(s => s.id === snippetId);

    if (snippet) {
      snippet.usageCount++;
      snippet.updatedAt = new Date().toISOString();
      await storage.saveSnippet(snippet);
    }
  }

  async syncWithGitHub() {
    try {
      const user = await storage.getUser();

      if (!user.settings.syncEnabled || !user.githubToken) {
        throw new Error('GitHub sync not enabled or not authenticated');
      }

      await gistManager.syncWithGist();
      this.showNotification('Sync Complete', 'Your snippets have been synced with GitHub');
    } catch (error: any) {
      console.error('Sync error:', error);
      this.showNotification('Sync Failed', error.message);
    }
  }

  setupAutoSync() {
    setInterval(async () => {
      const user = await storage.getUser();

      if (user.settings.autoBackup && user.settings.syncEnabled && user.githubToken) {
        await this.syncWithGitHub();
      }
    }, 30 * 60 * 1000);
  }

  notifyContentScripts(type: string, data?: any) {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type, ...data }).catch(() => {
            // Ignore errors for tabs without content script
          });
        }
      });
    });
  }

  showQuickSearch(tabId?: number) {
    if (!tabId) return;

    const injectQuickSearch = () => {
      const existing = document.getElementById('typewise-quick-search');
      if (existing) {
        existing.remove();
        return;
      }

      const modal = document.createElement('div');
      modal.id = 'typewise-quick-search';
      modal.innerHTML = `
        <div style="
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.2);
          z-index: 999999;
          min-width: 400px;
        ">
          <input type="text" placeholder="Search snippets..." style="
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 16px;
          " autofocus>
          <div id="typewise-results"></div>
        </div>
      `;
      document.body.appendChild(modal);

      const input = modal.querySelector('input');
      input?.focus();

      const closeModal = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          modal.remove();
          document.removeEventListener('keydown', closeModal);
        }
      };

      document.addEventListener('keydown', closeModal);
    };

    if (chrome.scripting?.executeScript) {
      chrome.scripting.executeScript({
        target: { tabId },
        func: injectQuickSearch
      });
      return;
    }

    if (chrome.tabs.executeScript) {
      chrome.tabs.executeScript(tabId, {
        code: `(${injectQuickSearch.toString()})();`
      });
      return;
    }

    console.warn('No script injection API is available in this browser runtime.');
  }

  createSnippetFromSelection(text: string) {
    const url = chrome.runtime.getURL(`options/options.html?new=true&content=${encodeURIComponent(text)}`);
    chrome.tabs.create({ url });
  }

  showNotification(title: string, message: string) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
      title,
      message,
      priority: 1
    });
  }
}

// Initialize
new BackgroundService();