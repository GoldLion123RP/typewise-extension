// src/content/content.ts
import { Snippet } from '../types';

class ContentScriptManager {
  private snippets: Snippet[] = [];
  private triggerKey = '/';
  private lastKeyTime = 0;
  private keyBuffer = '';

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private async localGet(keys: string | string[]): Promise<Record<string, unknown>> {
    const getAny = chrome.storage.local.get as unknown as (
      keys: string | string[],
      callback?: (items: Record<string, unknown>) => void,
    ) => unknown;

    try {
      const maybePromise = getAny.call(chrome.storage.local, keys);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        const data = await (maybePromise as Promise<unknown>);
        return this.asRecord(data);
      }
    } catch {
      // Fall back to callback form.
    }

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      try {
        getAny.call(chrome.storage.local, keys, (items: Record<string, unknown>) => {
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
        this.loadSnippets();
      } else if (request.type === 'UPDATE_SETTINGS') {
        this.loadSettings();
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
        this.snippets = response.data;
      } else {
        const result = await this.localGet(['snippets']);
        this.snippets = Array.isArray(result.snippets) ? (result.snippets as Snippet[]) : [];
      }
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

    // Handle Ctrl+Space for quick search
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      this.showQuickSearch(target);
      return;
    }

    // Track typing speed/buffer if needed for more complex triggers later
    const now = Date.now();
    if (now - this.lastKeyTime > 1000) {
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

    const value = target.value;
    const cursorPos = target.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPos);

    // Debug log for development (remove in production if too noisy)
    // console.log('TypeWise: Input detected', { textBeforeCursor, triggerKey: this.triggerKey });

    // Check each snippet for a match
    for (const snippet of this.snippets) {
      if (!snippet.isActive) continue;

      // Determine the full trigger string (triggerKey + shortcut)
      let triggerString = snippet.shortcut;
      if (!triggerString.startsWith(this.triggerKey)) {
        triggerString = this.triggerKey + triggerString;
      }

      // Check if the text ends with this trigger string
      if (textBeforeCursor.endsWith(triggerString)) {
        console.log(`TypeWise: Match found for ${snippet.shortcut}`);
        // Match found - expand immediately
        // Use a small timeout to allow the browser to finish processing the current input event
        setTimeout(() => {
          this.expandSnippet(target, snippet, triggerString);
        }, 10);
        return;
      }
    }
  }

  expandSnippet(target: HTMLInputElement | HTMLTextAreaElement, snippet: Snippet, triggerString: string) {
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
    let expandedContent = this.expandVariables(snippet.content);

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
    this.showNotification(`Expanded: ${snippet.title}`);
  }

  expandVariables(content: string): string {
    const now = new Date();
    const variables: { [key: string]: string } = {
      '{{date}}': now.toLocaleDateString(),
      '{{time}}': now.toLocaleTimeString(),
      '{{datetime}}': now.toLocaleString(),
      '{{year}}': now.getFullYear().toString(),
      '{{month}}': (now.getMonth() + 1).toString().padStart(2, '0'),
      '{{day}}': now.getDate().toString().padStart(2, '0'),
      '{{timestamp}}': now.getTime().toString(),
      '{{clipboard}}': '', // Will be filled async if needed
    };

    let result = content;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(key, 'g'), value);
    }

    return result;
  }

  showQuickSearch(target: HTMLElement) {
    chrome.runtime.sendMessage({
      type: 'SHOW_QUICK_SEARCH',
      targetId: this.generateTargetId(target)
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