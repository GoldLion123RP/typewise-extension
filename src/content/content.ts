// src/content/content.ts
import { Snippet } from '../types';

const KEY_BUFFER_RESET_MS = 1000;
const FALLBACK_EXPANSION_DELAY_MS = 10;
const QUICK_SEARCH_MODAL_ID = 'typewise-quick-search';
const QUICK_SEARCH_RESULTS_LIMIT = 8;

class ContentScriptManager {
  private snippets: Snippet[] = [];
  private shortcutIndex = new Map<string, Snippet>();
  private triggerKey = '/';
  private caseSensitive = false;
  private showNotificationsEnabled = true;
  private expandDelay = 0;
  private lastKeyTime = 0;
  private keyBuffer = '';
  private activeInput: HTMLInputElement | HTMLTextAreaElement | null = null;

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private async localGet(keys: string | string[]): Promise<Record<string, unknown>> {
    const area = chrome?.storage?.local;
    if (!area || typeof area.get !== 'function') {
      return {};
    }

    const getAny = chrome.storage.local.get as unknown as (
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

  constructor() {
    this.init();
  }

  async init() {
    console.log('TypeWise: Initializing content script...');
    await this.loadSettings();
    await this.loadSnippets();
    this.attachListeners();

    // Listen for updates from background
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      console.log('TypeWise: Received message', request.type);
      if (request.type === 'UPDATE_SNIPPETS') {
        void this.loadSnippets();
      } else if (request.type === 'UPDATE_SETTINGS') {
        void this.loadSettings();
      } else if (request.type === 'SHOW_QUICK_SEARCH') {
        this.toggleQuickSearchModal();
      }
      sendResponse({ success: true });
    });
  }

  async loadSettings() {
    try {
      const result = await this.localGet(['settings']);
      if (result.settings) {
        const settings = result.settings as Record<string, unknown>;
        this.triggerKey = (typeof settings.triggerKey === 'string' && settings.triggerKey) || '/';
        this.caseSensitive = Boolean(settings.caseSensitive);
        this.showNotificationsEnabled = settings.showNotifications !== false;
        this.expandDelay =
          typeof settings.expandDelay === 'number' && Number.isFinite(settings.expandDelay)
            ? Math.max(0, settings.expandDelay)
            : 0;
        console.log('TypeWise: Settings loaded', settings);
      }
    } catch (e) {
      console.error('TypeWise: Error loading settings', e);
    }
  }

  async loadSnippets() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SNIPPETS' });
      if (response?.success && Array.isArray(response.data)) {
        this.snippets = response.data.filter((snippet: unknown): snippet is Snippet => {
          if (!snippet || typeof snippet !== 'object') {
            return false;
          }

          const candidate = snippet as Partial<Snippet>;
          return typeof candidate.shortcut === 'string' && candidate.shortcut.trim().length > 0;
        });
      } else {
        const result = await this.localGet(['snippets']);
        this.snippets = Array.isArray(result.snippets) ? (result.snippets as Snippet[]) : [];
      }
      this.rebuildShortcutIndex();
      console.log(`TypeWise: Loaded ${this.snippets.length} snippets`);
    } catch (e) {
      console.error('TypeWise: Error loading snippets', e);
    }
  }

  attachListeners() {
    document.addEventListener('keydown', this.handleKeyDown.bind(this), true);
    document.addEventListener('input', this.handleInput.bind(this), true);

    // Monitor focus changes to reset buffer if needed
    document.addEventListener('focusin', () => {
      this.keyBuffer = '';
    });

    // Context menu support
    document.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement;
      if (this.isTextInput(target)) {
        chrome.runtime.sendMessage({
          type: 'CONTEXT_MENU_TARGET',
          targetId: this.generateTargetId(target)
        });
      }
    });
  }

  handleKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;

    if (!this.isTextInput(target)) {
      return;
    }

    this.activeInput = target;

    // Handle Ctrl+Space for quick search
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      this.toggleQuickSearchModal();
      return;
    }

    // Track typing speed/buffer if needed for more complex triggers later
    const now = Date.now();
    if (now - this.lastKeyTime > KEY_BUFFER_RESET_MS) {
      this.keyBuffer = '';
    }
    this.lastKeyTime = now;
    if (e.key.length === 1) {
      this.keyBuffer += e.key;
    }
  }

  handleInput(e: Event) {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;

    if (!this.isTextInput(target)) {
      return;
    }

    this.activeInput = target;

    const value = target.value;
    const cursorPos = target.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPos);

    const token = this.extractCurrentToken(textBeforeCursor);
    if (!token) {
      return;
    }

    const snippet = this.shortcutIndex.get(this.normalizeMatchKey(token));
    if (snippet) {
      const triggerString = this.buildTriggerString(snippet.shortcut);
      console.log(`TypeWise: Match found for ${snippet.shortcut}`);
      setTimeout(() => {
        void this.expandSnippet(target, snippet, triggerString);
      }, Math.max(this.expandDelay, FALLBACK_EXPANSION_DELAY_MS));
    }
  }

  private rebuildShortcutIndex() {
    this.shortcutIndex.clear();

    for (const snippet of this.snippets) {
      if (!snippet?.isActive || !snippet.shortcut) {
        continue;
      }

      const key = this.normalizeMatchKey(this.buildTriggerString(snippet.shortcut));
      if (!this.shortcutIndex.has(key)) {
        this.shortcutIndex.set(key, snippet);
      }
    }
  }

  private buildTriggerString(shortcut: string): string {
    const normalized = shortcut.trim();
    return normalized.startsWith(this.triggerKey) ? normalized : `${this.triggerKey}${normalized}`;
  }

  private normalizeMatchKey(value: string): string {
    return this.caseSensitive ? value : value.toLowerCase();
  }

  private extractCurrentToken(textBeforeCursor: string): string {
    const tokenMatch = textBeforeCursor.match(/(?:^|\s)(\S+)$/);
    return tokenMatch?.[1] || '';
  }

  async expandSnippet(target: HTMLInputElement | HTMLTextAreaElement, snippet: Snippet, triggerString: string) {
    const value = target.value;
    const cursorPos = target.selectionStart || 0;

    // Verify the trigger is still there (it might have changed in the ms delay)
    const before = value.substring(0, cursorPos);
    if (!before.endsWith(triggerString)) {
      console.log('TypeWise: Trigger string no longer present, aborting expansion');
      return;
    }

    const after = value.substring(cursorPos);
    const textBeforeTrigger = before.substring(0, before.length - triggerString.length);

    // Expand variables in content
    const expandedContent = await this.expandVariables(snippet.content);

    // Update input value
    // For ContentEditable elements, this logic needs to be different, but for now supporting Input/Textarea
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      target.value = textBeforeTrigger + expandedContent + after;

      // Set cursor position
      const newCursorPos = textBeforeTrigger.length + expandedContent.length;
      target.setSelectionRange(newCursorPos, newCursorPos);
    } else if (target.isContentEditable) {
      // Basic ContentEditable support
      document.execCommand('delete', false); // Remove last char (part of trigger) - actually we need to remove the whole trigger
      // This is complex for contentEditable, simplified approach:
      // We might need to select the trigger range and replace it
      // For now, let's stick to standard inputs or implement a robust selection replacement
      console.warn('TypeWise: ContentEditable expansion is experimental');
    }

    // Trigger input event for frameworks (React, Vue, etc.)
    const inputEvent = new Event('input', { bubbles: true });
    target.dispatchEvent(inputEvent);

    // Trigger change event for frameworks that rely on it
    const changeEvent = new Event('change', { bubbles: true });
    target.dispatchEvent(changeEvent);

    // Update usage count
    this.updateUsageCount(snippet.id);

    // Show notification if enabled
    if (this.showNotificationsEnabled) {
      this.showNotification(`Expanded: ${snippet.title}`);
    }
  }

  async expandVariables(content: string): Promise<string> {
    const now = new Date();
    let clipboardContent = '';

    if (content.includes('{{clipboard}}')) {
      try {
        if (navigator?.clipboard?.readText) {
          clipboardContent = await navigator.clipboard.readText();
        }
      } catch {
        clipboardContent = '';
      }
    }

    const variables: { [key: string]: string } = {
      '{{date}}': now.toLocaleDateString(),
      '{{time}}': now.toLocaleTimeString(),
      '{{datetime}}': now.toLocaleString(),
      '{{year}}': now.getFullYear().toString(),
      '{{month}}': (now.getMonth() + 1).toString().padStart(2, '0'),
      '{{day}}': now.getDate().toString().padStart(2, '0'),
      '{{timestamp}}': now.getTime().toString(),
      '{{clipboard}}': clipboardContent,
    };

    let result = content;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(key, 'g'), value);
    }

    return result;
  }

  private toggleQuickSearchModal() {
    const existing = document.getElementById(QUICK_SEARCH_MODAL_ID);
    if (existing) {
      existing.remove();
      return;
    }

    const modal = document.createElement('div');
    modal.id = QUICK_SEARCH_MODAL_ID;
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(13, 17, 23, 0.42)';
    modal.style.zIndex = '999999';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';

    const panel = document.createElement('div');
    panel.style.width = 'min(640px, 92vw)';
    panel.style.maxHeight = '70vh';
    panel.style.overflow = 'auto';
    panel.style.background = '#101722';
    panel.style.border = '1px solid rgba(143, 179, 229, 0.28)';
    panel.style.borderRadius = '12px';
    panel.style.padding = '14px';
    panel.style.boxShadow = '0 20px 45px rgba(0, 0, 0, 0.4)';
    panel.style.color = '#e6edf5';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search snippets...';
    input.style.width = '100%';
    input.style.marginBottom = '10px';
    input.style.padding = '10px 12px';
    input.style.borderRadius = '8px';
    input.style.border = '1px solid rgba(143, 179, 229, 0.36)';
    input.style.background = '#0e1520';
    input.style.color = '#e6edf5';

    const results = document.createElement('div');
    results.style.display = 'flex';
    results.style.flexDirection = 'column';
    results.style.gap = '8px';

    const renderResults = () => {
      results.replaceChildren();
      const query = input.value.trim().toLowerCase();

      const matched = this.snippets
        .filter((snippet) => {
          if (!snippet.isActive) {
            return false;
          }

          if (!query) {
            return true;
          }

          return (
            (snippet.title || '').toLowerCase().includes(query) ||
            (snippet.shortcut || '').toLowerCase().includes(query) ||
            (snippet.content || '').toLowerCase().includes(query)
          );
        })
        .slice(0, QUICK_SEARCH_RESULTS_LIMIT);

      if (matched.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No matching snippets';
        empty.style.opacity = '0.75';
        results.appendChild(empty);
        return;
      }

      for (const snippet of matched) {
        const item = document.createElement('button');
        item.type = 'button';
        item.style.textAlign = 'left';
        item.style.padding = '10px';
        item.style.borderRadius = '8px';
        item.style.border = '1px solid rgba(143, 179, 229, 0.22)';
        item.style.background = '#0f1824';
        item.style.color = '#e6edf5';
        item.style.cursor = 'pointer';

        const title = document.createElement('div');
        title.textContent = `${snippet.title || 'Untitled'} (${snippet.shortcut})`;
        title.style.fontWeight = '600';
        title.style.marginBottom = '4px';

        const preview = document.createElement('div');
        preview.textContent = (snippet.content || '').slice(0, 120);
        preview.style.opacity = '0.85';
        preview.style.fontSize = '12px';

        item.appendChild(title);
        item.appendChild(preview);
        item.addEventListener('click', () => {
          void this.insertSnippetFromQuickSearch(snippet, modal);
        });

        results.appendChild(item);
      }
    };

    input.addEventListener('input', renderResults);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        modal.remove();
      }
    });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        modal.remove();
      }
    });

    panel.appendChild(input);
    panel.appendChild(results);
    modal.appendChild(panel);
    document.body.appendChild(modal);

    renderResults();
    input.focus();
  }

  private async insertSnippetFromQuickSearch(snippet: Snippet, modal: HTMLElement) {
    const activeElement = document.activeElement as HTMLElement | null;
    const target = this.activeInput || (activeElement && this.isTextInput(activeElement) ? activeElement : null);

    if (!target) {
      modal.remove();
      return;
    }

    const value = target.value;
    const selectionStart = target.selectionStart ?? value.length;
    const selectionEnd = target.selectionEnd ?? value.length;

    const before = value.slice(0, selectionStart);
    const after = value.slice(selectionEnd);
    const expandedContent = await this.expandVariables(snippet.content);

    target.value = `${before}${expandedContent}${after}`;
    const caret = before.length + expandedContent.length;
    target.setSelectionRange(caret, caret);

    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));

    this.updateUsageCount(snippet.id);
    if (this.showNotificationsEnabled) {
      this.showNotification(`Inserted: ${snippet.title}`);
    }

    modal.remove();
    target.focus();
  }

  showQuickSearch(target: HTMLElement) {
    chrome.runtime.sendMessage({
      type: 'SHOW_QUICK_SEARCH',
      targetId: this.generateTargetId(target),
    });
  }

  showNotification(message: string) {
    const toast = document.createElement('div');
    toast.className = 'typewise-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 20px;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      z-index: 10000;
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      font-weight: 500;
      animation: slideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.2);
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  updateUsageCount(snippetId: string) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_USAGE_COUNT',
      snippetId
    });
  }

  isTextInput(element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement {
    if (!element) return false;

    const tagName = element.tagName.toLowerCase();

    if (tagName === 'textarea') return true;

    if (tagName === 'input') {
      const type = (element as HTMLInputElement).type.toLowerCase();
      return ['text', 'email', 'password', 'search', 'url', 'tel', 'number'].includes(type);
    }

    // Check for contenteditable
    if (element.isContentEditable) return true;

    // Check for role="textbox"
    if (element.getAttribute('role') === 'textbox') return true;

    return false;
  }

  generateTargetId(_element: HTMLElement): string {
    return Math.random().toString(36).substring(2, 9);
  }
}

// Initialize content script
new ContentScriptManager();

// Add CSS for toast notifications
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(120%) scale(0.9); opacity: 0; }
    to { transform: translateX(0) scale(1); opacity: 1; }
  }
  
  @keyframes slideOut {
    from { transform: translateX(0) scale(1); opacity: 1; }
    to { transform: translateX(120%) scale(0.9); opacity: 0; }
  }
`;
document.head.appendChild(style);