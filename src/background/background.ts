// src/background/background.ts
import { storage } from '../utils/storage';
import { gistManager } from '../api/gistManager';

const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;

class BackgroundService {
  constructor() {
    this.init();
  }

  async init() {
    await this.repairStorageCache();

    // Extension installed or updated
    chrome.runtime.onInstalled.addListener(this.handleInstalled.bind(this));

    // Message handling
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

    // Keyboard commands
    chrome.commands.onCommand.addListener(this.handleCommand.bind(this));

    // Auto-sync timer (every 30 minutes)
    this.setupAutoSync();
  }

  async handleInstalled(_details: chrome.runtime.InstalledDetails) {
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

    chrome.contextMenus.onClicked.addListener((info: any, tab: chrome.tabs.Tab | undefined) => {
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
    } catch (_error: any) {
      console.error('Background message error:', _error);
      sendResponse({ success: false, error: _error.message });
    }

    return true;
  }

  handleCommand(command: string) {
    if (command === 'quick-search') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
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
    }, AUTO_SYNC_INTERVAL_MS);
  }

  async repairStorageCache() {
    try {
      const snippets = await storage.getSnippets();
      const user = await storage.getUser();

      await chrome.storage.local.set({
        snippets,
        settings: user.settings,
      });
    } catch (error) {
      console.warn('TypeWise: storage cache warmup failed:', error);
    }
  }

  notifyContentScripts(type: string, data?: any) {
    chrome.tabs.query({}, (tabs: chrome.tabs.Tab[]) => {
      tabs.forEach((tab: chrome.tabs.Tab) => {
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

    chrome.tabs.sendMessage(tabId, { type: 'SHOW_QUICK_SEARCH' }).catch(() => {
      console.warn('Unable to open quick search on this tab.');
    });
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