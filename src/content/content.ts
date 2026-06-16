// src/content/content.ts
import { Snippet } from "../types";

const KEY_BUFFER_RESET_MS = 1000;
const FALLBACK_EXPANSION_DELAY_MS = 10;
const QUICK_SEARCH_MODAL_ID = "typewise-quick-search";
const QUICK_SEARCH_RESULTS_LIMIT = 8;

class ContentScriptManager {
  private snippets: Snippet[] = [];
  private shortcutIndex = new Map<string, Snippet>();
  private triggerKey = "/";
  private caseSensitive = false;
  private showNotificationsEnabled = true;
  private expandDelay = 0;
  private playSounds = true;
  private soundVolume = 30;
  private lastKeyTime = 0;
  private keyBuffer = "";
  private activeInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  private activeFormModal: HTMLElement | null = null;

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  }

  private async localGet(
    keys: string | string[],
  ): Promise<Record<string, unknown>> {
    const area = chrome?.storage?.local;
    if (!area || typeof area.get !== "function") {
      return {};
    }

    const getAny = chrome.storage.local.get as unknown as (
      keys: string | string[],
      callback?: (items: Record<string, unknown>) => void,
    ) => unknown;

    try {
      const maybePromise = getAny.call(area, keys);
      if (
        maybePromise &&
        typeof (maybePromise as Promise<unknown>).then === "function"
      ) {
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
    console.log("TypeWise: Initializing content script...");
    await this.loadSettings();
    await this.loadSnippets();
    this.attachListeners();

    // Listen for updates from background
    chrome.runtime.onMessage.addListener(
      (
        request: { type?: string; [key: string]: unknown },
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response?: {
          success: boolean;
          [key: string]: unknown;
        }) => void,
      ) => {
        console.log("TypeWise: Received message", request.type);
        if (request.type === "UPDATE_SNIPPETS") {
          void this.loadSnippets();
        } else if (request.type === "UPDATE_SETTINGS") {
          void this.loadSettings();
        } else if (request.type === "SHOW_QUICK_SEARCH") {
          this.toggleQuickSearchModal();
        } else if (request.type === "INSERT_SNIPPET" && request.snippet) {
          const target =
            this.activeInput || (document.activeElement as HTMLElement) || null;
          if (target && this.isTextInput(target)) {
            void this.insertTextAtCaret(
              target,
              (request.snippet as Snippet).content,
              0,
            );
          }
        }
        sendResponse({ success: true });
      },
    );

    // Real-time synchronization via storage changes
    chrome.storage.onChanged.addListener(
      (changes: { [key: string]: any }, areaName: string) => {
        if (areaName === "local") {
          if (changes.snippets) {
            console.log("TypeWise: Snippets updated in storage, reloading...");
            void this.loadSnippets();
          }
          if (changes.settings) {
            console.log("TypeWise: Settings updated in storage, reloading...");
            void this.loadSettings();
          }
        }
      },
    );
  }

  async loadSettings() {
    try {
      const result = await this.localGet(["settings"]);
      if (result.settings) {
        const settings = result.settings as Record<string, unknown>;
        this.triggerKey =
          (typeof settings.triggerKey === "string" && settings.triggerKey) ||
          "/";
        this.caseSensitive = Boolean(settings.caseSensitive);
        this.showNotificationsEnabled = settings.showNotifications !== false;
        this.expandDelay =
          typeof settings.expandDelay === "number" &&
          Number.isFinite(settings.expandDelay)
            ? Math.max(0, settings.expandDelay)
            : 0;
        this.playSounds = settings.playSounds !== false;
        this.soundVolume =
          typeof settings.soundVolume === "number" ? settings.soundVolume : 30;
        console.log("TypeWise: Settings loaded", settings);
      }
    } catch (e) {
      console.error("TypeWise: Error loading settings", e);
    }
  }

  async loadSnippets() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_SNIPPETS",
      });
      if (response?.success && Array.isArray(response.data)) {
        this.snippets = response.data.filter(
          (snippet: unknown): snippet is Snippet => {
            if (!snippet || typeof snippet !== "object") {
              return false;
            }

            const candidate = snippet as Partial<Snippet>;
            return (
              typeof candidate.shortcut === "string" &&
              candidate.shortcut.trim().length > 0
            );
          },
        );
      } else {
        const result = await this.localGet(["snippets"]);
        this.snippets = Array.isArray(result.snippets)
          ? (result.snippets as Snippet[])
          : [];
      }
      this.rebuildShortcutIndex();
      console.log(`TypeWise: Loaded ${this.snippets.length} snippets`);
    } catch (e) {
      console.error("TypeWise: Error loading snippets", e);
    }
  }

  attachListeners() {
    document.addEventListener("keydown", this.handleKeyDown.bind(this), true);
    document.addEventListener("input", this.handleInput.bind(this), true);

    // Monitor focus changes to reset buffer if needed
    document.addEventListener("focusin", () => {
      this.keyBuffer = "";
    });

    // Context menu support
    document.addEventListener("contextmenu", (e) => {
      const target = (e.composedPath()[0] || e.target) as HTMLElement;
      if (this.isTextInput(target)) {
        chrome.runtime.sendMessage({
          type: "CONTEXT_MENU_TARGET",
          targetId: this.generateTargetId(target),
        });
      }
    });
  }

  handleKeyDown(e: KeyboardEvent) {
    const target = (e.composedPath()[0] || e.target) as HTMLElement;

    if (!this.isTextInput(target)) {
      return;
    }

    this.activeInput = target;

    // Handle Ctrl+Space for quick search
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      this.toggleQuickSearchModal();
      return;
    }

    // Track typing speed/buffer if needed for more complex triggers later
    const now = Date.now();
    if (now - this.lastKeyTime > KEY_BUFFER_RESET_MS) {
      this.keyBuffer = "";
    }
    this.lastKeyTime = now;
    if (e.key.length === 1) {
      this.keyBuffer += e.key;
    }
  }

  handleInput(e: Event) {
    const target = (e.composedPath()[0] || e.target) as HTMLElement;

    if (!this.isTextInput(target)) {
      return;
    }

    this.activeInput = target as HTMLInputElement | HTMLTextAreaElement;

    let textBeforeCursor = "";

    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      const input = target as HTMLInputElement | HTMLTextAreaElement;
      const value = input.value;
      const cursorPos = input.selectionStart || 0;
      textBeforeCursor = value.substring(0, cursorPos);
    } else {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          const text = range.startContainer.nodeValue || "";
          textBeforeCursor = text.substring(0, range.startOffset);
        }
      }
    }

    const token = this.extractCurrentToken(textBeforeCursor);
    if (!token) {
      return;
    }

    const snippet = this.shortcutIndex.get(this.normalizeMatchKey(token));
    if (snippet) {
      console.log(`TypeWise: Match found for ${snippet.shortcut}`);
      setTimeout(
        () => {
          void this.expandSnippet(target, snippet, token);
        },
        Math.max(this.expandDelay * 1000, FALLBACK_EXPANSION_DELAY_MS),
      );
    }
  }

  private rebuildShortcutIndex() {
    this.shortcutIndex.clear();

    for (const snippet of this.snippets) {
      if (!snippet?.isActive || !snippet.shortcut) {
        continue;
      }

      const key = this.normalizeMatchKey(
        this.buildTriggerString(snippet.shortcut),
      );
      if (!this.shortcutIndex.has(key)) {
        this.shortcutIndex.set(key, snippet);
      }
    }
  }

  private buildTriggerString(shortcut: string): string {
    const normalized = shortcut.trim();
    if (!this.triggerKey) {
      return normalized;
    }
    return normalized.startsWith(this.triggerKey)
      ? normalized
      : `${this.triggerKey}${normalized}`;
  }

  private normalizeMatchKey(value: string): string {
    return this.caseSensitive ? value : value.toLowerCase();
  }

  private extractCurrentToken(textBeforeCursor: string): string {
    const tokenMatch = textBeforeCursor.match(/(?:^|\s)(\S+)$/);
    return tokenMatch?.[1] || "";
  }

  async expandSnippet(
    target: HTMLElement,
    snippet: Snippet,
    typedToken: string,
  ) {
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      const input = target as HTMLInputElement | HTMLTextAreaElement;
      const value = input.value;
      const cursorPos = input.selectionStart || 0;
      const before = value.substring(0, cursorPos);
      if (!before.endsWith(typedToken)) {
        console.log(
          "TypeWise: Trigger string no longer present, aborting expansion",
        );
        return;
      }
    } else {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        const text = range.startContainer.nodeValue || "";
        const before = text.substring(0, range.startOffset);
        if (!before.endsWith(typedToken)) {
          console.log(
            "TypeWise: Trigger string no longer present, aborting expansion",
          );
          return;
        }
      }
    }

    // Adjust casing dynamically (Smart Case)
    const adjustedContent = this.adjustCasing(typedToken, snippet.content);

    // Insert expanded text at caret (this handles inputs and contenteditable)
    await this.insertTextAtCaret(target, adjustedContent, typedToken.length);

    // Play sound if enabled
    if (this.playSounds) {
      this.playClickSound();
    }

    // Update usage count
    this.updateUsageCount(snippet.id);

    // Show notification if enabled
    if (this.showNotificationsEnabled) {
      this.showNotification(`Expanded: ${snippet.title}`);
    }
  }

  private adjustCasing(typedToken: string, expansion: string): string {
    let cleanTyped = typedToken;
    if (this.triggerKey && typedToken.startsWith(this.triggerKey)) {
      cleanTyped = typedToken.substring(this.triggerKey.length);
    }

    if (!cleanTyped) {
      return expansion;
    }

    const isAllUpper =
      cleanTyped === cleanTyped.toUpperCase() &&
      cleanTyped !== cleanTyped.toLowerCase();
    if (isAllUpper) {
      return expansion.toUpperCase();
    }

    const isFirstUpper =
      cleanTyped[0] === cleanTyped[0].toUpperCase() &&
      cleanTyped[0] !== cleanTyped[0].toLowerCase();
    if (isFirstUpper && expansion.length > 0) {
      return expansion[0].toUpperCase() + expansion.substring(1);
    }

    return expansion;
  }

  private isContentEditableElement(element: HTMLElement): boolean {
    return (
      element.isContentEditable ||
      element.getAttribute("contenteditable") === "true"
    );
  }

  private async insertTextAtCaret(
    target: HTMLElement,
    rawContent: string,
    triggerLength: number = 0,
  ) {
    const customVars = this.parseCustomVariables(rawContent);

    if (customVars.length > 0) {
      // Prompt user with modal form
      this.showVariableFormModal(target, rawContent, customVars, triggerLength);
      return;
    }

    // No custom variables, proceed with standard insertion
    await this.executeTextInsertion(target, rawContent, triggerLength);
  }

  private async executeTextInsertion(
    target: HTMLElement,
    rawContent: string,
    triggerLength: number,
  ) {
    const expandedContent = await this.expandVariables(rawContent);

    // Parse caret/cursor placeholder
    const cursorPlaceholder = "{{cursor}}";
    const caretPlaceholder = "{{caret}}";
    let cursorOffset = -1;
    let cleanContent = expandedContent;

    const placeholderIdx = expandedContent.indexOf(cursorPlaceholder);
    if (placeholderIdx !== -1) {
      cursorOffset = placeholderIdx;
      cleanContent =
        expandedContent.substring(0, placeholderIdx) +
        expandedContent.substring(placeholderIdx + cursorPlaceholder.length);
    } else {
      const caretIdx = expandedContent.indexOf(caretPlaceholder);
      if (caretIdx !== -1) {
        cursorOffset = caretIdx;
        cleanContent =
          expandedContent.substring(0, caretIdx) +
          expandedContent.substring(caretIdx + caretPlaceholder.length);
      }
    }

    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      const input = target as HTMLInputElement | HTMLTextAreaElement;
      const value = input.value;
      const cursorPos = input.selectionStart || 0;
      const selectionEnd = input.selectionEnd || 0;

      // Calculate placement
      const beforePos =
        triggerLength > 0 ? cursorPos - triggerLength : cursorPos;
      const before = value.substring(0, beforePos);
      const after = value.substring(selectionEnd);

      // Strip HTML for plain text inputs
      const cleanText = this.stripHtml(cleanContent);
      input.value = before + cleanText + after;

      const newCursorPos =
        before.length + (cursorOffset !== -1 ? cursorOffset : cleanText.length);
      input.setSelectionRange(newCursorPos, newCursorPos);

      // Dispatch change/input events
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (this.isContentEditableElement(target)) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);

      // Select the trigger string to replace it
      if (
        triggerLength > 0 &&
        range.startContainer.nodeType === Node.TEXT_NODE
      ) {
        const textNode = range.startContainer as Text;
        const offset = range.startOffset;
        range.setStart(textNode, Math.max(0, offset - triggerLength));
        range.setEnd(textNode, offset);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // Convert newlines to HTML breaks if content doesn't look like rich HTML
      const isRichHtml = /<[a-z][\s\S]*>/i.test(cleanContent);
      const htmlContent = isRichHtml
        ? cleanContent
        : cleanContent.replace(/\n/g, "<br>");

      if (cursorOffset === -1) {
        document.execCommand("insertHTML", false, htmlContent);
      } else {
        // Dual-insert to position the caret
        const part1 = cleanContent.substring(0, cursorOffset);
        const part2 = cleanContent.substring(cursorOffset);

        const htmlPart1 = isRichHtml ? part1 : part1.replace(/\n/g, "<br>");
        const htmlPart2 = isRichHtml ? part2 : part2.replace(/\n/g, "<br>");

        document.execCommand("insertHTML", false, htmlPart1);
        const bookmark = selection.getRangeAt(0).cloneRange();
        document.execCommand("insertHTML", false, htmlPart2);

        // Restore selection to bookmark
        selection.removeAllRanges();
        selection.addRange(bookmark);
      }

      // Dispatch events on target contenteditable
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  private stripHtml(html: string): string {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return doc.body.textContent || doc.body.innerText || "";
    } catch {
      return html.replace(/<\/?[^>]+(>|$)/g, "");
    }
  }

  private parseCustomVariables(
    content: string,
  ): { raw: string; name: string; type: string; options: string[] }[] {
    const variableRegex =
      /\{\{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_]+))?(?::([^}]+))?\}\}/g;
    const matches: {
      raw: string;
      name: string;
      type: string;
      options: string[];
    }[] = [];
    const seen = new Set<string>();

    const systemVars = [
      "date",
      "time",
      "datetime",
      "year",
      "month",
      "day",
      "timestamp",
      "clipboard",
      "cursor",
      "caret",
    ];

    let match;
    variableRegex.lastIndex = 0;
    while ((match = variableRegex.exec(content)) !== null) {
      const raw = match[0];
      const name = match[1];
      const type = match[2] || "text";
      const optionsStr = match[3] || "";

      if (systemVars.includes(name.toLowerCase())) {
        continue;
      }

      if (!seen.has(raw)) {
        seen.add(raw);
        const options = optionsStr
          ? optionsStr
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : [];
        matches.push({ raw, name, type, options });
      }
    }
    return matches;
  }

  private showVariableFormModal(
    target: HTMLElement,
    rawContent: string,
    customVars: {
      raw: string;
      name: string;
      type: string;
      options: string[];
    }[],
    triggerLength: number,
  ) {
    this.removeVariableFormModal();

    let savedRange: Range | null = null;
    let savedSelectionStart = 0;
    let savedSelectionEnd = 0;

    const isContentEditable = this.isContentEditableElement(target);

    if (isContentEditable) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        savedRange = selection.getRangeAt(0).cloneRange();
      }
    } else {
      const input = target as HTMLInputElement | HTMLTextAreaElement;
      savedSelectionStart = input.selectionStart || 0;
      savedSelectionEnd = input.selectionEnd || 0;
    }

    const modalOverlay = document.createElement("div");
    modalOverlay.id = "typewise-variables-modal";
    modalOverlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(8, 10, 15, 0.65);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      z-index: 10000000;
      display: flex;
      justify-content: center;
      align-items: center;
      font-family: 'Inter', system-ui, sans-serif;
      animation: typewiseFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    const modalPanel = document.createElement("div");
    modalPanel.style.cssText = `
      width: min(440px, 90vw);
      background: rgba(18, 22, 31, 0.94);
      border: 1px solid rgba(20, 255, 236, 0.3);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 24px 50px rgba(0, 0, 0, 0.5), 0 0 20px rgba(20, 255, 236, 0.1);
      display: flex;
      flex-direction: column;
      gap: 18px;
      color: #ffffff;
      transform: scale(0.96);
      animation: typewiseScaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 12px;
    `;

    const title = document.createElement("div");
    title.textContent = "TypeWise: Variable Fields";
    title.style.cssText = `
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #14ffec;
    `;

    header.appendChild(title);
    modalPanel.appendChild(header);

    const fieldsContainer = document.createElement("div");
    fieldsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-height: 50vh;
      overflow-y: auto;
    `;

    const inputElements: {
      [key: string]: HTMLInputElement | HTMLSelectElement;
    } = {};

    customVars.forEach((v, index) => {
      const fieldGroup = document.createElement("div");
      fieldGroup.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 6px;
      `;

      const label = document.createElement("label");
      const cleanLabel = v.name
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      label.textContent = cleanLabel;
      label.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #a1a1a9;
      `;

      fieldGroup.appendChild(label);

      let input: HTMLInputElement | HTMLSelectElement;

      if (v.type === "choice" && v.options.length > 0) {
        input = document.createElement("select");
        input.style.cssText = `
          background: rgba(10, 12, 18, 0.9);
          border: 1px solid rgba(20, 255, 236, 0.2);
          border-radius: 8px;
          color: #ffffff;
          padding: 10px 12px;
          font-size: 14px;
          outline: none;
          cursor: pointer;
        `;
        v.options.forEach((opt) => {
          const option = document.createElement("option");
          option.value = opt;
          option.textContent = opt;
          input.appendChild(option);
        });
      } else {
        input = document.createElement("input");
        input.type = "text";
        input.placeholder = `Enter ${cleanLabel.toLowerCase()}...`;
        input.style.cssText = `
          background: rgba(10, 12, 18, 0.9);
          border: 1px solid rgba(20, 255, 236, 0.2);
          border-radius: 8px;
          color: #ffffff;
          padding: 10px 12px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
        `;
        input.addEventListener("focus", () => {
          input.style.borderColor = "#14ffec";
        });
        input.addEventListener("blur", () => {
          input.style.borderColor = "rgba(20, 255, 236, 0.2)";
        });
      }

      inputElements[v.raw] = input;
      fieldGroup.appendChild(input);
      fieldsContainer.appendChild(fieldGroup);

      if (index === 0) {
        setTimeout(() => input.focus(), 50);
      }
    });

    modalPanel.appendChild(fieldsContainer);

    const footer = document.createElement("div");
    footer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 14px;
    `;

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = `
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      color: #a1a1a9;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, color 0.2s;
    `;
    cancelBtn.addEventListener("mouseenter", () => {
      cancelBtn.style.background = "rgba(255, 255, 255, 0.1)";
      cancelBtn.style.color = "#ffffff";
    });
    cancelBtn.addEventListener("mouseleave", () => {
      cancelBtn.style.background = "rgba(255, 255, 255, 0.05)";
      cancelBtn.style.color = "#a1a1a9";
    });

    const insertBtn = document.createElement("button");
    insertBtn.textContent = "Insert";
    insertBtn.style.cssText = `
      background: linear-gradient(135deg, #0070f3 0%, #14ffec 100%);
      border: none;
      border-radius: 8px;
      color: #ffffff;
      padding: 8px 18px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(20, 255, 236, 0.25);
      transition: transform 0.2s, box-shadow 0.2s;
    `;
    insertBtn.addEventListener("mouseenter", () => {
      insertBtn.style.transform = "translateY(-1px)";
      insertBtn.style.boxShadow = "0 6px 18px rgba(20, 255, 236, 0.35)";
    });
    insertBtn.addEventListener("mouseleave", () => {
      insertBtn.style.transform = "none";
      insertBtn.style.boxShadow = "0 4px 14px rgba(20, 255, 236, 0.25)";
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(insertBtn);
    modalPanel.appendChild(footer);
    modalOverlay.appendChild(modalPanel);
    document.body.appendChild(modalOverlay);
    this.activeFormModal = modalOverlay;

    const doInsertion = async () => {
      let finalContent = rawContent;
      for (const [rawPlaceholder, input] of Object.entries(inputElements)) {
        const val = input.value;
        finalContent = finalContent.replace(
          new RegExp(this.escapeRegExp(rawPlaceholder), "g"),
          val,
        );
      }

      this.removeVariableFormModal();

      target.focus();
      if (isContentEditable && savedRange) {
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(savedRange);
        }
      } else if (!isContentEditable) {
        const input = target as HTMLInputElement | HTMLTextAreaElement;
        input.setSelectionRange(savedSelectionStart, savedSelectionEnd);
      }

      await this.executeTextInsertion(target, finalContent, triggerLength);
    };

    const doCancel = () => {
      this.removeVariableFormModal();
      target.focus();
    };

    insertBtn.addEventListener("click", () => {
      void doInsertion();
    });

    cancelBtn.addEventListener("click", doCancel);

    modalOverlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        doCancel();
      } else if (
        event.key === "Enter" &&
        event.target instanceof HTMLElement &&
        event.target.tagName !== "BUTTON"
      ) {
        event.preventDefault();
        void doInsertion();
      }
    });
  }

  private removeVariableFormModal() {
    if (this.activeFormModal) {
      this.activeFormModal.remove();
      this.activeFormModal = null;
    }
    const old = document.getElementById("typewise-variables-modal");
    if (old) {
      old.remove();
    }
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async expandVariables(content: string): Promise<string> {
    const now = new Date();
    let clipboardContent = "";

    if (content.includes("{{clipboard}}")) {
      try {
        if (navigator?.clipboard?.readText) {
          clipboardContent = await navigator.clipboard.readText();
        }
      } catch {
        clipboardContent = "";
      }
    }

    const variables: { [key: string]: string } = {
      "{{date}}": now.toLocaleDateString(),
      "{{time}}": now.toLocaleTimeString(),
      "{{datetime}}": now.toLocaleString(),
      "{{year}}": now.getFullYear().toString(),
      "{{month}}": (now.getMonth() + 1).toString().padStart(2, "0"),
      "{{day}}": now.getDate().toString().padStart(2, "0"),
      "{{timestamp}}": now.getTime().toString(),
      "{{clipboard}}": clipboardContent,
    };

    let result = content;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(key, "g"), value);
    }

    return result;
  }

  private toggleQuickSearchModal() {
    const existing = document.getElementById(QUICK_SEARCH_MODAL_ID);
    if (existing) {
      existing.remove();
      return;
    }

    const modal = document.createElement("div");
    modal.id = QUICK_SEARCH_MODAL_ID;
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(8, 10, 15, 0.65);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      z-index: 10000000;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 15vh;
      font-family: 'Inter', system-ui, sans-serif;
      animation: typewiseFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    const panel = document.createElement("div");
    panel.style.cssText = `
      width: min(600px, 92vw);
      background: rgba(18, 22, 31, 0.95);
      border: 1px solid rgba(20, 255, 236, 0.25);
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 24px 50px rgba(0, 0, 0, 0.5), 0 0 20px rgba(20, 255, 236, 0.08);
      display: flex;
      flex-direction: column;
      gap: 12px;
      color: #ffffff;
      transform: translateY(-20px);
      animation: typewiseScaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    `;

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder =
      "Type to search all snippets... (Use ↑↓ arrows, Enter to expand)";
    input.style.cssText = `
      width: 100%;
      box-sizing: border-box;
      background: rgba(10, 12, 18, 0.9);
      border: 1px solid rgba(20, 255, 236, 0.3);
      border-radius: 10px;
      color: #ffffff;
      padding: 14px 16px;
      font-size: 15px;
      outline: none;
      box-shadow: 0 0 10px rgba(20, 255, 236, 0.05);
      transition: border-color 0.2s, box-shadow 0.2s;
    `;
    input.addEventListener("focus", () => {
      input.style.borderColor = "#14ffec";
      input.style.boxShadow = "0 0 15px rgba(20, 255, 236, 0.15)";
    });

    const results = document.createElement("div");
    results.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 45vh;
      overflow-y: auto;
      padding-right: 4px;
    `;

    let matchedSnippets: Snippet[] = [];
    let selectedIndex = 0;

    const renderResults = () => {
      results.replaceChildren();
      const query = input.value.trim().toLowerCase();

      matchedSnippets = this.snippets
        .filter((snippet) => {
          if (!snippet.isActive) {
            return false;
          }
          if (!query) {
            return true;
          }
          return (
            (snippet.title || "").toLowerCase().includes(query) ||
            (snippet.shortcut || "").toLowerCase().includes(query) ||
            (snippet.content || "").toLowerCase().includes(query)
          );
        })
        .slice(0, QUICK_SEARCH_RESULTS_LIMIT);

      if (matchedSnippets.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "No matching snippets found";
        empty.style.cssText = `
          padding: 16px;
          text-align: center;
          color: #a1a1a9;
          font-size: 13px;
          border: 1px dashed rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        `;
        results.appendChild(empty);
        selectedIndex = -1;
        return;
      }

      // Constrain selectedIndex to valid bounds
      if (selectedIndex >= matchedSnippets.length) {
        selectedIndex = matchedSnippets.length - 1;
      }
      if (selectedIndex < 0 && matchedSnippets.length > 0) {
        selectedIndex = 0;
      }

      matchedSnippets.forEach((snippet, index) => {
        const item = document.createElement("div");
        item.style.cssText = `
          text-align: left;
          padding: 12px 14px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.02);
          color: #e6edf5;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 4px;
          transition: background 0.2s, border-color 0.2s, transform 0.2s;
        `;

        const headerRow = document.createElement("div");
        headerRow.style.cssText = `
          display: flex;
          justify-content: space-between;
          align-items: center;
        `;

        const titleText = document.createElement("div");
        titleText.textContent = snippet.title || "Untitled";
        titleText.style.cssText = `
          font-weight: 600;
          font-size: 14px;
          color: #ffffff;
        `;

        const shortcutTag = document.createElement("div");
        shortcutTag.textContent = snippet.shortcut;
        shortcutTag.style.cssText = `
          font-size: 11px;
          color: #14ffec;
          background: rgba(20, 255, 236, 0.1);
          border: 1px solid rgba(20, 255, 236, 0.3);
          border-radius: 6px;
          padding: 2px 6px;
        `;

        const actions = document.createElement("div");
        actions.className = "snippet-actions-overlay";
        actions.style.cssText = `
          display: flex;
          gap: 6px;
          opacity: 0.6;
        `;

        const editBtn = document.createElement("button");
        editBtn.textContent = "✏️";
        editBtn.title = "Edit snippet";
        editBtn.style.cssText = `
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 12px;
          padding: 2px;
          outline: none;
        `;
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          chrome.runtime.sendMessage({
            type: "OPEN_OPTIONS",
            hash: `#edit-${snippet.id}`,
          });
          modal.remove();
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "🗑️";
        deleteBtn.title = "Delete snippet";
        deleteBtn.style.cssText = `
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 12px;
          padding: 2px;
          outline: none;
        `;
        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (
            confirm(
              `Are you sure you want to delete "${snippet.title || snippet.shortcut}"?`,
            )
          ) {
            await chrome.runtime.sendMessage({
              type: "DELETE_SNIPPET",
              id: snippet.id,
            });
            await this.loadSnippets();
            renderResults();
          }
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        const rightSide = document.createElement("div");
        rightSide.style.cssText = `
          display: flex;
          align-items: center;
          gap: 8px;
        `;
        rightSide.appendChild(shortcutTag);
        rightSide.appendChild(actions);

        headerRow.appendChild(titleText);
        headerRow.appendChild(rightSide);

        const previewText = document.createElement("div");
        previewText.textContent = this.stripHtml(snippet.content || "").slice(
          0,
          100,
        );
        previewText.style.cssText = `
          color: #a1a1a9;
          font-size: 12px;
          line-height: 1.4;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        `;

        item.appendChild(headerRow);
        item.appendChild(previewText);

        // Highlight selected item
        if (index === selectedIndex) {
          item.style.background =
            "linear-gradient(135deg, rgba(0, 112, 243, 0.2) 0%, rgba(20, 255, 236, 0.1) 100%)";
          item.style.borderColor = "#14ffec";
          item.style.transform = "translateX(2px)";
        }

        item.addEventListener("click", () => {
          void this.insertSnippetFromQuickSearch(snippet, modal);
        });

        results.appendChild(item);
      });
    };

    input.addEventListener("input", () => {
      selectedIndex = 0;
      renderResults();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        modal.remove();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (matchedSnippets.length > 0) {
          selectedIndex = (selectedIndex + 1) % matchedSnippets.length;
          renderResults();
          const activeItem = results.children[selectedIndex] as
            | HTMLElement
            | undefined;
          if (activeItem) {
            activeItem.scrollIntoView({ block: "nearest" });
          }
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (matchedSnippets.length > 0) {
          selectedIndex =
            (selectedIndex - 1 + matchedSnippets.length) %
            matchedSnippets.length;
          renderResults();
          const activeItem = results.children[selectedIndex] as
            | HTMLElement
            | undefined;
          if (activeItem) {
            activeItem.scrollIntoView({ block: "nearest" });
          }
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < matchedSnippets.length) {
          const selectedSnippet = matchedSnippets[selectedIndex];
          void this.insertSnippetFromQuickSearch(selectedSnippet, modal);
        }
      }
    });

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.remove();
      }
    });

    const searchHeader = document.createElement("div");
    searchHeader.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      box-sizing: border-box;
    `;
    input.style.flex = "1";

    const addBtn = document.createElement("button");
    addBtn.textContent = "＋";
    addBtn.title = "Add New Snippet";
    addBtn.style.cssText = `
      background: rgba(10, 12, 18, 0.9);
      border: 1px solid rgba(20, 255, 236, 0.3);
      border-radius: 10px;
      color: #ffffff;
      height: 48px;
      width: 48px;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
      flex-shrink: 0;
      box-sizing: border-box;
    `;
    addBtn.addEventListener("mouseenter", () => {
      addBtn.style.borderColor = "#14ffec";
      addBtn.style.background = "rgba(20, 255, 236, 0.05)";
    });
    addBtn.addEventListener("mouseleave", () => {
      addBtn.style.borderColor = "rgba(20, 255, 236, 0.3)";
      addBtn.style.background = "rgba(10, 12, 18, 0.9)";
    });
    addBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", hash: "#add" });
      modal.remove();
    });

    const settingsBtn = document.createElement("button");
    settingsBtn.textContent = "⚙️";
    settingsBtn.title = "Open Settings";
    settingsBtn.style.cssText = `
      background: rgba(10, 12, 18, 0.9);
      border: 1px solid rgba(20, 255, 236, 0.3);
      border-radius: 10px;
      color: #ffffff;
      height: 48px;
      width: 48px;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
      flex-shrink: 0;
      box-sizing: border-box;
    `;
    settingsBtn.addEventListener("mouseenter", () => {
      settingsBtn.style.borderColor = "#14ffec";
      settingsBtn.style.background = "rgba(20, 255, 236, 0.05)";
    });
    settingsBtn.addEventListener("mouseleave", () => {
      settingsBtn.style.borderColor = "rgba(20, 255, 236, 0.3)";
      settingsBtn.style.background = "rgba(10, 12, 18, 0.9)";
    });
    settingsBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", hash: "" });
      modal.remove();
    });

    searchHeader.appendChild(input);
    searchHeader.appendChild(addBtn);
    searchHeader.appendChild(settingsBtn);
    panel.appendChild(searchHeader);
    panel.appendChild(results);
    modal.appendChild(panel);
    document.body.appendChild(modal);

    renderResults();
    input.focus();
  }

  private async insertSnippetFromQuickSearch(
    snippet: Snippet,
    modal: HTMLElement,
  ) {
    const activeElement = document.activeElement as HTMLElement | null;
    const target =
      this.activeInput ||
      (activeElement && this.isTextInput(activeElement) ? activeElement : null);

    if (!target) {
      modal.remove();
      return;
    }

    await this.insertTextAtCaret(target, snippet.content, 0);

    this.updateUsageCount(snippet.id);
    if (this.showNotificationsEnabled) {
      this.showNotification(`Inserted: ${snippet.title}`);
    }

    modal.remove();
    target.focus();
  }

  showQuickSearch(target: HTMLElement) {
    chrome.runtime.sendMessage({
      type: "SHOW_QUICK_SEARCH",
      targetId: this.generateTargetId(target),
    });
  }

  showNotification(message: string) {
    const toast = document.createElement("div");
    toast.className = "typewise-toast";
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
      toast.style.animation = "slideOut 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  updateUsageCount(snippetId: string) {
    chrome.runtime.sendMessage({
      type: "UPDATE_USAGE_COUNT",
      snippetId,
    });
  }

  playClickSound() {
    try {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.05);

      const volumePercent = this.soundVolume / 100;
      gain.gain.setValueAtTime(volumePercent, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch (error) {
      console.error("Failed to play synthesized sound:", error);
    }
  }

  isTextInput(
    element: HTMLElement,
  ): element is HTMLInputElement | HTMLTextAreaElement {
    if (!element) return false;

    const tagName = element.tagName.toLowerCase();

    if (tagName === "textarea") return true;

    if (tagName === "input") {
      const type = (element as HTMLInputElement).type.toLowerCase() || "text";
      const excludedTypes = [
        "checkbox",
        "radio",
        "file",
        "submit",
        "button",
        "reset",
        "range",
        "color",
        "hidden",
        "date",
        "time",
        "datetime-local",
        "month",
        "week",
      ];
      return !excludedTypes.includes(type);
    }

    // Check for contenteditable
    if (element.isContentEditable) return true;

    // Check for role="textbox" or role="combobox"
    const role = element.getAttribute("role");
    if (role === "textbox" || role === "combobox") return true;

    return false;
  }

  generateTargetId(_element: HTMLElement): string {
    return Math.random().toString(36).substring(2, 9);
  }
}

// Initialize content script
new ContentScriptManager();

// Add CSS for toast notifications and modals
const style = document.createElement("style");
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(120%) scale(0.9); opacity: 0; }
    to { transform: translateX(0) scale(1); opacity: 1; }
  }
  
  @keyframes slideOut {
    from { transform: translateX(0) scale(1); opacity: 1; }
    to { transform: translateX(120%) scale(0.9); opacity: 0; }
  }

  @keyframes typewiseFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes typewiseScaleIn {
    from { transform: scale(0.96); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
`;
document.head.appendChild(style);
