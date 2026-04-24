var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PuffsReaderPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/ReaderView.ts
var import_obsidian = require("obsidian");

// src/types.ts
var SUPPORTED_ENCODINGS = [
  { value: "utf-8", label: "UTF-8" },
  { value: "gbk", label: "GBK" },
  { value: "gb18030", label: "GB18030" },
  { value: "big5", label: "Big5" },
  { value: "utf-16le", label: "UTF-16 LE" },
  { value: "utf-16be", label: "UTF-16 BE" },
  { value: "shift_jis", label: "Shift_JIS" },
  { value: "euc-kr", label: "EUC-KR" }
];
var DEFAULT_TOC_REGEX = "^\\s*\u7B2C[\u96F6\u3007\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u4EBF\u4E24\\d]+[\u7AE0\u8282\u56DE\u5377\u96C6\u90E8\u7BC7].*$";
var DEFAULT_CHAPTER_TITLE_REGEX = "^\\s*\u7B2C([\u96F6\u3007\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u4EBF\u4E24\\d]+)([\u7AE0\u8282\u56DE\u5377\u96C6\u90E8\u7BC7])\\s*(.*)$";
var DEFAULT_SETTINGS = {
  fontSize: 18,
  lineHeight: 1.8,
  paragraphSpacing: 10,
  firstLineIndent: 2,
  contentWidth: 800,
  letterSpacing: 0,
  paddingTop: 40,
  paddingBottom: 40,
  fontColor: "",
  backgroundColor: "",
  floatingButtonColor: "",
  chapterMetaFontSize: 12,
  chapterMetaColor: "",
  chapterMetaTop: 10,
  progressMetaFontSize: 12,
  progressMetaColor: "",
  progressMetaBottom: 10,
  sidebarWidth: 272,
  sidebarTransitionMs: 180,
  tocFontSize: 13,
  showProgress: true,
  removeExtraBlankLines: true,
  tocRegex: DEFAULT_TOC_REGEX,
  defaultEncoding: "utf-8",
  searchHotkey: "Ctrl+F"
};

// src/ReaderView.ts
var READER_VIEW_TYPE = "puffs-reader-view";
var ReaderView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.filePath = "";
    this.currentFile = null;
    this.fileBuffer = null;
    this.currentEncoding = "utf-8";
    this.paragraphs = [];
    this.chapters = [];
    this.searchQuery = "";
    this.searchResults = [];
    this.currentPageStart = { paraIndex: 0, charOffset: 0 };
    this.currentPageEnd = { paraIndex: 0, charOffset: 0 };
    this.pageBackStack = [];
    this.searchJumpBackPos = null;
    this.searchJumpPageTurns = 0;
    this.isTocOpen = false;
    this.isSearchMode = false;
    this.isTypographyOpen = false;
    this.isRenderingPage = false;
    this.progressSaveTimer = 0;
    this.searchTimer = 0;
    this.resizeObserver = null;
    this.boundGlobalKeydown = null;
    this.plugin = plugin;
    this.scope = new import_obsidian.Scope(this.app.scope);
    this.scope.register(null, "Escape", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      return false;
    });
  }
  getViewType() {
    return READER_VIEW_TYPE;
  }
  getDisplayText() {
    var _a, _b;
    return (_b = (_a = this.currentFile) == null ? void 0 : _a.basename) != null ? _b : "Puffs Reader";
  }
  getIcon() {
    return "book-open";
  }
  async onOpen() {
    this.buildUI();
  }
  async onClose() {
    var _a;
    this.saveProgressNow();
    window.clearTimeout(this.progressSaveTimer);
    window.clearTimeout(this.searchTimer);
    (_a = this.resizeObserver) == null ? void 0 : _a.disconnect();
    if (this.boundGlobalKeydown) {
      document.removeEventListener("keydown", this.boundGlobalKeydown, true);
      window.removeEventListener("keydown", this.boundGlobalKeydown, true);
      this.boundGlobalKeydown = null;
    }
  }
  getState() {
    return { file: this.filePath };
  }
  async setState(state, result) {
    const viewState = state;
    const path = viewState == null ? void 0 : viewState.file;
    if (path && path !== this.filePath) {
      this.filePath = path;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof import_obsidian.TFile) {
        this.currentFile = file;
        await this.loadContent();
      }
    }
    await super.setState(state, result);
    this.focusReader();
  }
  /** 供插件命令调用，打开当前阅读器的全文搜索。 */
  openSearch() {
    this.openSidebar("search");
  }
  /** 全局设置面板保存后调用，让已打开阅读器立即使用新排版。 */
  refreshSettingsFromGlobal() {
    this.applyTypography();
    this.renderCurrentPage();
  }
  /** 供外部打开/切换书籍后调用，把键盘焦点稳定交给阅读区。 */
  focusReader() {
    this.focusReadingAreaSoon();
  }
  buildUI() {
    const ce = this.contentEl;
    ce.empty();
    ce.addClass("puffs-reader-root");
    this.rootEl = ce.createDiv({ cls: "puffs-reader-wrapper" });
    this.bodyEl = this.rootEl.createDiv({ cls: "puffs-body" });
    this.buildTocSidebar();
    this.buildReadingArea();
    this.buildTypographyPanel();
    this.bindGlobalKeys();
    this.applyTypography();
  }
  buildTocSidebar() {
    this.tocSidebar = this.bodyEl.createDiv({ cls: "puffs-toc-sidebar puffs-hidden" });
    const header = this.tocSidebar.createDiv({ cls: "puffs-toc-header" });
    this.tocTitleEl = header.createSpan({ text: "\u76EE\u5F55" });
    this.tocModeBtn = header.createEl("button", {
      cls: "puffs-icon-btn puffs-toc-search-btn",
      attr: { "aria-label": "\u5168\u4E66\u641C\u7D22" }
    });
    (0, import_obsidian.setIcon)(this.tocModeBtn, "search");
    this.tocModeBtn.addEventListener("click", () => this.toggleSearchMode());
    this.tocListEl = this.tocSidebar.createDiv({ cls: "puffs-toc-list" });
    this.searchPaneEl = this.tocSidebar.createDiv({ cls: "puffs-sidebar-search puffs-hidden" });
    const searchHeader = this.searchPaneEl.createDiv({ cls: "puffs-search-header" });
    this.searchInput = searchHeader.createEl("input", {
      cls: "puffs-search-input",
      attr: { type: "text", placeholder: "" }
    });
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.searchInput.addEventListener("input", () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.performSearch(this.searchInput.value), 160);
    });
    this.searchInfoEl = this.searchPaneEl.createDiv({ cls: "puffs-search-info" });
    this.searchResultsEl = this.searchPaneEl.createDiv({ cls: "puffs-search-results" });
  }
  buildReadingArea() {
    this.readingArea = this.bodyEl.createDiv({ cls: "puffs-reading-area" });
    this.readingArea.tabIndex = 0;
    this.chapterTitleEl = this.readingArea.createDiv({ cls: "puffs-page-chapter" });
    this.progressTitleEl = this.readingArea.createDiv({ cls: "puffs-page-progress" });
    this.floatingControls = this.readingArea.createDiv({ cls: "puffs-floating-controls" });
    const tocBtn = this.floatingControls.createEl("button", {
      cls: "puffs-icon-btn puffs-floating-btn",
      attr: { "aria-label": "\u76EE\u5F55\u4FA7\u8FB9\u680F" }
    });
    (0, import_obsidian.setIcon)(tocBtn, "list");
    tocBtn.addEventListener("click", () => this.toggleToc());
    this.settingsBtn = this.floatingControls.createEl("button", {
      cls: "puffs-icon-btn puffs-floating-btn",
      attr: { "aria-label": "\u4E66\u7C4D\u8BBE\u7F6E" }
    });
    (0, import_obsidian.setIcon)(this.settingsBtn, "settings");
    this.settingsBtn.addEventListener("click", () => this.toggleTypography());
    this.searchBackBtn = this.readingArea.createEl("button", {
      cls: "puffs-search-back puffs-hidden",
      text: "\u8FD4\u56DE",
      attr: { "aria-label": "\u8FD4\u56DE\u641C\u7D22\u524D\u4F4D\u7F6E" }
    });
    this.searchBackBtn.addEventListener("click", () => this.returnFromSearchJump());
    this.contentContainer = this.readingArea.createDiv({ cls: "puffs-page-content" });
    this.readingArea.addEventListener("keydown", (e) => this.handleKeydown(e));
    this.readingArea.addEventListener("pointerdown", (e) => this.closePanelsOnOutsideClick(e));
    this.readingArea.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (Math.abs(e.deltaY) < 10) return;
      if (e.deltaY > 0) this.pageDown();
      else this.pageUp();
    }, { passive: false });
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.isRenderingPage && this.paragraphs.length > 0) {
        this.renderCurrentPage();
      }
    });
    this.resizeObserver.observe(this.readingArea);
  }
  buildTypographyPanel() {
    this.typographyPanel = this.readingArea.createDiv({ cls: "puffs-typo-panel puffs-hidden" });
    this.refreshTypographyPanel();
  }
  async loadContent() {
    var _a, _b, _c;
    if (!this.currentFile) return;
    this.fileBuffer = await this.app.vault.readBinary(this.currentFile);
    const saved = this.plugin.getProgress(this.currentFile.path);
    const bookSettings = this.getBookSettings();
    const { text, encoding } = this.decodeBuffer(this.fileBuffer, (_a = bookSettings.encoding) != null ? _a : saved == null ? void 0 : saved.encoding);
    this.currentEncoding = encoding;
    this.paragraphs = this.processText(text);
    this.parseChapters();
    this.buildTocList();
    this.applyTypography();
    this.currentPageStart = this.clampPosition({
      paraIndex: (_b = saved == null ? void 0 : saved.paragraphIndex) != null ? _b : 0,
      charOffset: (_c = saved == null ? void 0 : saved.charOffset) != null ? _c : 0
    });
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.focusReadingAreaSoon();
  }
  focusReadingAreaSoon() {
    if (!this.readingArea || !this.readingArea.isConnected) return;
    this.readingArea.focus();
    requestAnimationFrame(() => {
      if (!this.readingArea.isConnected) return;
      this.readingArea.focus();
      window.setTimeout(() => {
        if (this.readingArea.isConnected) this.readingArea.focus();
      }, 0);
    });
  }
  decodeBuffer(buffer, forceEncoding) {
    if (forceEncoding) {
      try {
        return {
          text: new TextDecoder(forceEncoding, { fatal: false }).decode(buffer),
          encoding: forceEncoding
        };
      } catch (e) {
      }
    }
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
      return { text: new TextDecoder("utf-8").decode(buffer), encoding: "utf-8" };
    }
    if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 254) {
      return { text: new TextDecoder("utf-16le").decode(buffer), encoding: "utf-16le" };
    }
    if (bytes.length >= 2 && bytes[0] === 254 && bytes[1] === 255) {
      return { text: new TextDecoder("utf-16be").decode(buffer), encoding: "utf-16be" };
    }
    try {
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
        encoding: "utf-8"
      };
    } catch (e) {
    }
    try {
      return { text: new TextDecoder("gbk").decode(buffer), encoding: "gbk" };
    } catch (e) {
      const fallback = this.plugin.settings.defaultEncoding;
      return { text: new TextDecoder(fallback, { fatal: false }).decode(buffer), encoding: fallback };
    }
  }
  switchEncoding(encoding) {
    if (!this.fileBuffer || !this.currentFile) return;
    const { text } = this.decodeBuffer(this.fileBuffer, encoding);
    this.currentEncoding = encoding;
    this.paragraphs = this.processText(text);
    this.updateBookSettings({ encoding });
    this.parseChapters();
    this.buildTocList();
    this.currentPageStart = { paraIndex: 0, charOffset: 0 };
    this.pageBackStack = [];
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: 0,
      charOffset: 0,
      lastRead: Date.now()
    });
    this.refreshTypographyPanel();
    this.renderCurrentPage();
  }
  showEncodingMenu(e) {
    const menu = new import_obsidian.Menu();
    for (const enc of SUPPORTED_ENCODINGS) {
      menu.addItem(
        (item) => item.setTitle(enc.label).setChecked(this.currentEncoding === enc.value).onClick(() => this.switchEncoding(enc.value))
      );
    }
    menu.showAtMouseEvent(e);
  }
  processText(text) {
    let lines = text.split(/\r?\n/);
    if (this.plugin.settings.removeExtraBlankLines) {
      const collapsed = [];
      let lastBlank = false;
      for (const line of lines) {
        const isBlank = line.trim() === "";
        if (isBlank && lastBlank) continue;
        collapsed.push(line);
        lastBlank = isBlank;
      }
      lines = collapsed;
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    return lines;
  }
  renderCurrentPage() {
    if (this.paragraphs.length === 0) {
      this.contentContainer.empty();
      this.chapterTitleEl.textContent = "";
      this.progressTitleEl.textContent = "";
      return;
    }
    if (this.contentContainer.clientHeight < 40) {
      requestAnimationFrame(() => {
        if (this.contentContainer.clientHeight >= 40) this.renderCurrentPage();
      });
      return;
    }
    this.isRenderingPage = true;
    this.currentPageStart = this.clampPosition(this.currentPageStart);
    this.currentPageEnd = this.measurePageEnd(this.currentPageStart);
    this.paintPage(this.currentPageStart, this.currentPageEnd);
    this.trimPaintedPageToFit();
    this.updatePageMeta();
    this.scheduleProgressSave();
    this.isRenderingPage = false;
  }
  /** 在真实容器内临时排版，找出当前页可以容纳到哪个字符位置。 */
  measurePageEnd(start) {
    this.contentContainer.empty();
    let offset = start.charOffset;
    let lastFit = start;
    const chapterEndPara = this.getChapterEndPara(start.paraIndex);
    for (let pi = start.paraIndex; pi < this.paragraphs.length; pi++) {
      if (chapterEndPara !== null && pi >= chapterEndPara) {
        return this.clampPosition({ paraIndex: chapterEndPara, charOffset: 0 });
      }
      const text = this.paragraphs[pi];
      const slice = text.slice(offset);
      const para = this.createParagraphEl(slice, pi, offset, false);
      this.contentContainer.appendChild(para);
      if (this.isContentOverflowing()) {
        const cut = this.findLastCompleteLineOffset(para, slice);
        if (cut > 0) {
          return this.clampPosition({ paraIndex: pi, charOffset: offset + cut });
        }
        return lastFit;
      }
      lastFit = this.clampPosition({ paraIndex: pi, charOffset: text.length });
      offset = 0;
    }
    return { paraIndex: this.paragraphs.length, charOffset: 0 };
  }
  paintPage(start, end) {
    this.contentContainer.empty();
    const from = this.clampPosition(start);
    const to = this.clampPosition(end);
    for (let pi = from.paraIndex; pi < Math.min(to.paraIndex + 1, this.paragraphs.length); pi++) {
      const fullText = this.paragraphs[pi];
      const begin = pi === from.paraIndex ? from.charOffset : 0;
      const finish = pi === to.paraIndex ? to.charOffset : fullText.length;
      if (pi === to.paraIndex && finish <= begin) continue;
      if (pi > to.paraIndex) continue;
      const visible = fullText.slice(begin, finish);
      const continuesAfterPage = finish < fullText.length;
      this.contentContainer.appendChild(this.createParagraphEl(visible, pi, begin, true, continuesAfterPage));
    }
  }
  createParagraphEl(text, paraIndex, charOffset, withHighlight, continuesAfterPage = false) {
    const p = document.createElement("p");
    p.className = "puffs-para";
    p.dataset.paraIndex = String(paraIndex);
    p.dataset.charOffset = String(charOffset);
    const chapter = charOffset === 0 ? this.getChapterStartingAt(paraIndex) : null;
    if (chapter) {
      p.classList.add("puffs-para-chapter");
      p.textContent = chapter.title;
      return p;
    }
    if (text.trim() === "") {
      p.classList.add("puffs-para-blank");
      p.innerHTML = "&nbsp;";
      return p;
    }
    if (continuesAfterPage) {
      p.classList.add("puffs-para-continued");
    }
    if (withHighlight && this.searchResults.length > 0) {
      const end = charOffset + text.length;
      const matches = this.searchResults.filter((m) => m.paraIndex === paraIndex && m.startOffset < end && m.startOffset + m.length > charOffset).map((m) => ({
        paraIndex,
        startOffset: Math.max(0, m.startOffset - charOffset),
        length: Math.min(m.startOffset + m.length, end) - Math.max(m.startOffset, charOffset)
      }));
      if (matches.length > 0) {
        p.innerHTML = this.buildHighlightedHTML(text, matches);
        return p;
      }
    }
    p.textContent = text;
    return p;
  }
  isContentOverflowing() {
    return this.contentContainer.scrollHeight > this.contentContainer.clientHeight;
  }
  /** 最终以真实绘制结果兜底，尽量只截短最后一段，减少页底空白。 */
  trimPaintedPageToFit() {
    var _a, _b;
    let guard = 0;
    while (this.isContentOverflowing() && guard < 20) {
      const last = this.contentContainer.lastElementChild;
      if (!last) return;
      const paraIndex = Number(last.dataset.paraIndex);
      const charOffset = Number(last.dataset.charOffset);
      if (!Number.isFinite(paraIndex) || !Number.isFinite(charOffset)) return;
      const paragraphEnd = paraIndex === this.currentPageEnd.paraIndex ? this.currentPageEnd.charOffset : (_b = (_a = this.paragraphs[paraIndex]) == null ? void 0 : _a.length) != null ? _b : charOffset;
      const visibleLength = Math.max(0, paragraphEnd - charOffset);
      if (visibleLength <= 1) {
        const nextEnd = this.clampPosition({ paraIndex, charOffset });
        if (this.comparePositions(nextEnd, this.currentPageStart) <= 0) return;
        this.currentPageEnd = nextEnd;
        this.paintPage(this.currentPageStart, this.currentPageEnd);
        guard++;
        continue;
      }
      let low = 1;
      let high = visibleLength;
      let best = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = this.clampPosition({ paraIndex, charOffset: charOffset + mid });
        this.paintPage(this.currentPageStart, candidate);
        if (this.isContentOverflowing()) {
          high = mid - 1;
        } else {
          best = mid;
          low = mid + 1;
        }
      }
      if (best <= 0) {
        const nextEnd = this.clampPosition({ paraIndex, charOffset });
        if (this.comparePositions(nextEnd, this.currentPageStart) <= 0) return;
        this.currentPageEnd = nextEnd;
        this.paintPage(this.currentPageStart, this.currentPageEnd);
        guard++;
        continue;
      }
      this.currentPageEnd = this.clampPosition({ paraIndex, charOffset: charOffset + best });
      this.paintPage(this.currentPageStart, this.currentPageEnd);
      guard++;
    }
  }
  /**
   * 返回当前溢出段落中最后一条「完整可见行」结束的字符偏移。
   * 通过 Range 读取浏览器实际换行后的矩形，避免使用估算行高造成翻页漂移。
   */
  findLastCompleteLineOffset(para, text) {
    var _a, _b;
    const node = para.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || text.length === 0) return 0;
    const measurableLength = Math.min(text.length, (_b = (_a = node.textContent) == null ? void 0 : _a.length) != null ? _b : 0);
    if (measurableLength <= 0) return 0;
    const style = getComputedStyle(this.contentContainer);
    const bottomPadding = parseFloat(style.paddingBottom || "0") || 0;
    const bottomGuard = 1;
    const bottomLimit = this.contentContainer.getBoundingClientRect().bottom - bottomPadding - bottomGuard;
    const range = document.createRange();
    let lastLineTop = Number.NaN;
    let lastLineBottom = 0;
    let lastCompleteOffset = 0;
    for (let i = 0; i < measurableLength; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const top = Math.round(rect.top);
      if (!Number.isNaN(lastLineTop) && Math.abs(top - lastLineTop) > 1) {
        if (lastLineBottom <= bottomLimit) lastCompleteOffset = i;
      }
      if (rect.top > bottomLimit) break;
      lastLineTop = top;
      lastLineBottom = rect.bottom;
    }
    if (lastLineBottom <= bottomLimit) lastCompleteOffset = measurableLength;
    range.detach();
    return lastCompleteOffset;
  }
  pageDown() {
    if (this.comparePositions(this.currentPageEnd, this.currentPageStart) <= 0) return;
    if (this.currentPageEnd.paraIndex >= this.paragraphs.length) return;
    this.pageBackStack.push({ ...this.currentPageStart });
    this.currentPageStart = this.clampPosition(this.currentPageEnd);
    this.recordPageTurnAfterSearchJump();
    this.renderCurrentPage();
    this.readingArea.focus();
  }
  pageUp() {
    var _a;
    if (this.currentPageStart.paraIndex === 0 && this.currentPageStart.charOffset === 0) return;
    this.currentPageStart = (_a = this.pageBackStack.pop()) != null ? _a : this.findPreviousPageStart(this.currentPageStart);
    this.recordPageTurnAfterSearchJump();
    this.renderCurrentPage();
    this.readingArea.focus();
  }
  /** 反向翻页用前向测量逼近，保证上一页结束位置正好衔接当前页首。 */
  findPreviousPageStart(target) {
    let windowStart = Math.max(0, target.paraIndex - 160);
    let bestStart = { paraIndex: 0, charOffset: 0 };
    while (true) {
      let pos = { paraIndex: windowStart, charOffset: 0 };
      let previous = pos;
      let guard = 0;
      while (this.comparePositions(pos, target) < 0 && guard < 2e3) {
        previous = pos;
        const end = this.measurePageEnd(pos);
        if (this.comparePositions(end, target) >= 0) return previous;
        pos = end;
        guard++;
      }
      bestStart = previous;
      if (windowStart === 0) return bestStart;
      windowStart = Math.max(0, windowStart - 320);
    }
  }
  jumpToPosition(pos) {
    this.currentPageStart = this.clampPosition(pos);
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.readingArea.focus();
  }
  clampPosition(pos) {
    if (this.paragraphs.length === 0) return { paraIndex: 0, charOffset: 0 };
    let paraIndex = Math.max(0, Math.min(pos.paraIndex, this.paragraphs.length));
    let charOffset = Math.max(0, pos.charOffset);
    while (paraIndex < this.paragraphs.length && charOffset >= this.paragraphs[paraIndex].length) {
      if (this.paragraphs[paraIndex].length === 0 && charOffset === 0) break;
      charOffset = 0;
      paraIndex++;
    }
    if (paraIndex >= this.paragraphs.length) return { paraIndex: this.paragraphs.length, charOffset: 0 };
    return { paraIndex, charOffset: Math.min(charOffset, this.paragraphs[paraIndex].length) };
  }
  comparePositions(a, b) {
    if (a.paraIndex !== b.paraIndex) return a.paraIndex - b.paraIndex;
    return a.charOffset - b.charOffset;
  }
  parseChapters() {
    this.chapters = [];
    const tocRegexText = this.getEffectiveTocRegex();
    if (!tocRegexText) return;
    let regex;
    try {
      regex = new RegExp(tocRegexText);
    } catch (e) {
      return;
    }
    for (let i = 0; i < this.paragraphs.length; i++) {
      const line = this.paragraphs[i].trim();
      if (line && regex.test(line)) {
        this.chapters.push({
          title: this.extractChapterTitle(line),
          rawTitle: line,
          startParaIndex: i,
          level: 1
        });
      }
    }
  }
  extractChapterTitle(line) {
    var _a, _b, _c;
    const customRegex = (_a = this.getBookSettings().chapterTitleRegex) != null ? _a : DEFAULT_CHAPTER_TITLE_REGEX;
    try {
      const match = line.match(new RegExp(customRegex));
      if ((match == null ? void 0 : match[1]) && (match == null ? void 0 : match[2]) && /^[章节回卷集部篇]$/.test(match[2])) {
        const numberText = this.normalizeChapterNumber(match[1]);
        const titleText = ((_b = match[3]) != null ? _b : "").trim();
        return titleText ? `\u7B2C${numberText}${match[2]} ${titleText}` : `\u7B2C${numberText}${match[2]}`;
      }
      const captured = (_c = match == null ? void 0 : match.slice(1).find((part) => part && part.trim().length > 0)) == null ? void 0 : _c.trim();
      if (captured) return captured;
    } catch (e) {
    }
    return line;
  }
  getChapterEndPara(paraIndex) {
    var _a, _b;
    const active = this.getActiveChapterIndex(paraIndex);
    if (active < 0) return null;
    return (_b = (_a = this.chapters[active + 1]) == null ? void 0 : _a.startParaIndex) != null ? _b : null;
  }
  buildTocList() {
    if (!this.tocListEl) return;
    this.tocListEl.empty();
    if (this.chapters.length === 0) {
      this.tocListEl.createDiv({ cls: "puffs-toc-empty", text: "\u672A\u68C0\u6D4B\u5230\u7AE0\u8282" });
      return;
    }
    this.chapters.forEach((ch) => {
      const item = this.tocListEl.createDiv({ cls: "puffs-toc-item", text: ch.title });
      item.addEventListener("click", () => {
        this.jumpToPosition({ paraIndex: ch.startParaIndex, charOffset: 0 });
        this.setSearchMode(false);
      });
    });
  }
  updatePageMeta() {
    const activeChapter = this.getActiveChapterIndex(this.currentPageStart.paraIndex);
    this.chapterTitleEl.textContent = activeChapter >= 0 ? this.chapters[activeChapter].title : "";
    this.highlightCurrentTocItem(activeChapter);
    if (this.plugin.settings.showProgress) {
      const current = Math.min(this.currentPageStart.paraIndex, this.paragraphs.length);
      const pct = this.paragraphs.length > 0 ? (current / this.paragraphs.length * 100).toFixed(1) : "0.0";
      this.progressTitleEl.textContent = `${pct}%`;
      this.progressTitleEl.classList.remove("puffs-hidden");
    } else {
      this.progressTitleEl.classList.add("puffs-hidden");
    }
  }
  getActiveChapterIndex(paraIndex) {
    let active = -1;
    for (let i = 0; i < this.chapters.length; i++) {
      if (this.chapters[i].startParaIndex <= paraIndex) active = i;
      else break;
    }
    return active;
  }
  highlightCurrentTocItem(idx) {
    var _a;
    (_a = this.tocListEl) == null ? void 0 : _a.querySelectorAll(".puffs-toc-item").forEach((el, i) => {
      el.classList.toggle("puffs-toc-active", i === idx);
    });
  }
  toggleToc() {
    if (this.isTocOpen) {
      this.closeSidebar();
    } else {
      this.openSidebar("toc");
    }
  }
  closeSidebar() {
    this.isTocOpen = false;
    this.setSearchMode(false);
    this.tocSidebar.classList.add("puffs-hidden");
  }
  openSidebar(mode) {
    this.isTocOpen = true;
    this.tocSidebar.classList.remove("puffs-hidden");
    this.setSearchMode(mode === "search");
    if (mode === "search") {
      this.clearSearchInput();
      requestAnimationFrame(() => {
        this.searchInput.focus();
      });
    }
  }
  toggleSearchMode() {
    this.openSidebar(this.isSearchMode ? "toc" : "search");
  }
  setSearchMode(enabled) {
    this.isSearchMode = enabled;
    this.tocTitleEl.textContent = enabled ? "\u5168\u4E66\u641C\u7D22" : "\u76EE\u5F55";
    (0, import_obsidian.setIcon)(this.tocModeBtn, enabled ? "list" : "search");
    this.tocModeBtn.setAttribute("aria-label", enabled ? "\u8FD4\u56DE\u76EE\u5F55" : "\u5168\u4E66\u641C\u7D22");
    this.tocModeBtn.removeAttribute("title");
    this.tocListEl.classList.toggle("puffs-hidden", enabled);
    this.searchPaneEl.classList.toggle("puffs-hidden", !enabled);
    if (!enabled) {
      this.readingArea.focus();
    }
  }
  clearSearchInput() {
    this.searchQuery = "";
    this.searchResults = [];
    this.searchInput.value = "";
    this.searchInfoEl.textContent = "";
    this.searchResultsEl.empty();
    this.renderCurrentPage();
  }
  performSearch(query) {
    this.searchQuery = query.trim();
    this.searchResults = [];
    if (!this.searchQuery) {
      this.searchInfoEl.textContent = "";
      this.searchResultsEl.empty();
      this.renderCurrentPage();
      return;
    }
    const needle = this.searchQuery.toLowerCase();
    for (let pi = 0; pi < this.paragraphs.length; pi++) {
      const text = this.paragraphs[pi].toLowerCase();
      let offset = 0;
      while (true) {
        const found = text.indexOf(needle, offset);
        if (found === -1) break;
        this.searchResults.push({ paraIndex: pi, startOffset: found, length: needle.length });
        offset = found + Math.max(needle.length, 1);
      }
    }
    this.searchInfoEl.textContent = this.searchResults.length > 0 ? `${this.searchResults.length} \u4E2A\u7ED3\u679C` : "\u65E0\u7ED3\u679C";
    this.renderSearchResults();
    this.renderCurrentPage();
  }
  renderSearchResults() {
    this.searchResultsEl.empty();
    if (this.searchResults.length === 0) {
      this.searchResultsEl.createDiv({ cls: "puffs-search-empty", text: "\u6CA1\u6709\u627E\u5230\u5339\u914D\u5185\u5BB9" });
      return;
    }
    const seen = /* @__PURE__ */ new Set();
    const grouped = this.searchResults.filter((match) => {
      if (seen.has(match.paraIndex)) return false;
      seen.add(match.paraIndex);
      return true;
    }).slice(0, 200);
    grouped.forEach((match) => {
      const card = this.searchResultsEl.createDiv({ cls: "puffs-search-card" });
      const chapter = this.getActiveChapterIndex(match.paraIndex);
      card.createDiv({
        cls: "puffs-search-card-title",
        text: chapter >= 0 ? this.chapters[chapter].title : `\u7B2C ${match.paraIndex + 1} \u6BB5`
      });
      const preview = card.createDiv({ cls: "puffs-search-card-preview" });
      preview.innerHTML = this.buildSearchPreview(match);
      card.addEventListener("click", () => {
        this.searchJumpBackPos = { ...this.currentPageStart };
        this.searchJumpPageTurns = 0;
        this.searchBackBtn.classList.remove("puffs-hidden");
        this.jumpToPosition({ paraIndex: match.paraIndex, charOffset: match.startOffset });
      });
    });
  }
  buildSearchPreview(match) {
    const text = this.paragraphs[match.paraIndex];
    const start = Math.max(0, match.startOffset - 56);
    const end = Math.min(text.length, match.startOffset + match.length + 56);
    const localStart = match.startOffset - start;
    const localEnd = localStart + match.length;
    const visible = text.slice(start, end);
    return `${start > 0 ? "..." : ""}${this.escapeHTML(visible.slice(0, localStart))}<mark>${this.escapeHTML(visible.slice(localStart, localEnd))}</mark>${this.escapeHTML(visible.slice(localEnd))}${end < text.length ? "..." : ""}`;
  }
  returnFromSearchJump() {
    if (!this.searchJumpBackPos) return;
    const target = this.searchJumpBackPos;
    this.searchJumpBackPos = null;
    this.searchJumpPageTurns = 0;
    this.searchBackBtn.classList.add("puffs-hidden");
    this.currentPageStart = this.clampPosition(target);
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.readingArea.focus();
  }
  recordPageTurnAfterSearchJump() {
    if (!this.searchJumpBackPos) return;
    this.searchJumpPageTurns += 1;
    if (this.searchJumpPageTurns >= 5) {
      this.clearSearchJumpAndHighlights();
    }
  }
  clearSearchJumpAndHighlights() {
    this.searchJumpBackPos = null;
    this.searchJumpPageTurns = 0;
    this.searchBackBtn.classList.add("puffs-hidden");
    this.clearSearchInput();
  }
  refreshTypographyPanel() {
    var _a;
    const p = this.typographyPanel;
    p.empty();
    const bookSettings = this.getBookSettings();
    const title = p.createDiv({ cls: "puffs-typo-title" });
    title.createSpan({ text: "\u4E66\u7C4D\u8BBE\u7F6E" });
    const encodingRow = p.createDiv({ cls: "puffs-typo-row" });
    encodingRow.createSpan({ cls: "puffs-typo-label", text: "\u7F16\u7801\u65B9\u5F0F" });
    this.encodingBtn = encodingRow.createEl("button", {
      cls: "puffs-icon-btn puffs-encoding-btn",
      text: this.currentEncoding.toUpperCase(),
      attr: { "aria-label": "\u5207\u6362\u7F16\u7801" }
    });
    this.encodingBtn.addEventListener("click", (e) => this.showEncodingMenu(e));
    this.addNumberRow(
      p,
      "\u9996\u884C\u7F29\u8FDB",
      this.getEffectiveFirstLineIndent(),
      0,
      4,
      0.1,
      "em",
      (v) => {
        this.updateBookSettings({ firstLineIndent: v });
        this.applyTypography();
        this.renderCurrentPage();
      }
    );
    this.addTextRow(p, "\u76EE\u5F55\u6B63\u5219", this.getEffectiveTocRegex(), (v) => {
      this.updateBookSettings({ tocRegex: v || void 0 });
      this.parseChapters();
      this.buildTocList();
      this.renderCurrentPage();
    });
    this.addTextRow(p, "\u7AE0\u540D\u6B63\u5219", (_a = bookSettings.chapterTitleRegex) != null ? _a : DEFAULT_CHAPTER_TITLE_REGEX, (v) => {
      this.updateBookSettings({ chapterTitleRegex: v || void 0 });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
  }
  addNumberRow(parent, label, value, min, max, step, unit, onChange) {
    const row = parent.createDiv({ cls: "puffs-typo-row" });
    row.createSpan({ cls: "puffs-typo-label", text: label });
    const input = row.createEl("input", {
      cls: "puffs-typo-number",
      attr: { type: "number", min: String(min), max: String(max), step: String(step) }
    });
    input.value = String(value);
    row.createSpan({ cls: "puffs-typo-unit", text: unit });
    input.addEventListener("change", () => {
      const parsed = Number(input.value);
      if (Number.isNaN(parsed)) return;
      const next = Math.min(max, Math.max(min, parsed));
      input.value = String(next);
      onChange(next);
    });
  }
  addTextRow(parent, label, value, onChange) {
    const row = parent.createDiv({ cls: "puffs-typo-row" });
    row.createSpan({ cls: "puffs-typo-label", text: label });
    const input = row.createEl("input", { cls: "puffs-typo-text-input", attr: { type: "text" } });
    input.value = value;
    input.addEventListener("change", () => onChange(input.value.trim()));
  }
  applyTypography() {
    if (!this.rootEl || !this.contentContainer) return;
    const s = this.plugin.settings;
    const rgbBg = s.backgroundColor ? `rgb(${s.backgroundColor})` : "";
    const rgbFont = s.fontColor ? `rgb(${s.fontColor})` : "";
    const floatingButtonColor = s.floatingButtonColor ? `rgb(${s.floatingButtonColor})` : "";
    const chapterColor = s.chapterMetaColor ? `rgb(${s.chapterMetaColor})` : "";
    const progressColor = s.progressMetaColor ? `rgb(${s.progressMetaColor})` : "";
    this.rootEl.style.setProperty("--puffs-bg-color", rgbBg || "var(--background-primary)");
    this.readingArea.style.setProperty("--puffs-bg-color", rgbBg || "var(--background-primary)");
    this.contentContainer.style.setProperty("--puffs-font-size", `${s.fontSize}px`);
    this.contentContainer.style.setProperty("--puffs-line-height", String(s.lineHeight));
    this.contentContainer.style.setProperty("--puffs-para-spacing", `${s.paragraphSpacing}px`);
    this.contentContainer.style.setProperty("--puffs-indent", `${this.getEffectiveFirstLineIndent()}em`);
    this.contentContainer.style.setProperty("--puffs-content-width", `${s.contentWidth}px`);
    this.contentContainer.style.setProperty("--puffs-letter-spacing", `${s.letterSpacing}px`);
    this.contentContainer.style.setProperty("--puffs-padding-top", `${s.paddingTop}px`);
    this.contentContainer.style.setProperty("--puffs-padding-bottom", `${s.paddingBottom}px`);
    this.rootEl.style.setProperty("--puffs-sidebar-width", `${s.sidebarWidth}px`);
    this.rootEl.style.setProperty("--puffs-sidebar-transition", `${s.sidebarTransitionMs}ms`);
    this.rootEl.style.setProperty("--puffs-toc-font-size", `${s.tocFontSize}px`);
    if (floatingButtonColor) this.rootEl.style.setProperty("--puffs-floating-button-color", floatingButtonColor);
    else this.rootEl.style.removeProperty("--puffs-floating-button-color");
    this.rootEl.style.setProperty("--puffs-chapter-meta-size", `${s.chapterMetaFontSize}px`);
    this.rootEl.style.setProperty("--puffs-chapter-meta-top", `${s.chapterMetaTop}px`);
    this.rootEl.style.setProperty("--puffs-progress-meta-size", `${s.progressMetaFontSize}px`);
    this.rootEl.style.setProperty("--puffs-progress-meta-bottom", `${s.progressMetaBottom}px`);
    if (rgbFont) this.contentContainer.style.setProperty("--puffs-font-color", rgbFont);
    else this.contentContainer.style.removeProperty("--puffs-font-color");
    if (chapterColor) this.rootEl.style.setProperty("--puffs-chapter-meta-color", chapterColor);
    else this.rootEl.style.removeProperty("--puffs-chapter-meta-color");
    if (progressColor) this.rootEl.style.setProperty("--puffs-progress-meta-color", progressColor);
    else this.rootEl.style.removeProperty("--puffs-progress-meta-color");
  }
  toggleTypography() {
    if (this.isTypographyOpen) this.closeTypography();
    else {
      this.isTypographyOpen = true;
      this.refreshTypographyPanel();
      this.typographyPanel.classList.remove("puffs-hidden");
    }
  }
  closeTypography() {
    this.isTypographyOpen = false;
    this.typographyPanel.classList.add("puffs-hidden");
  }
  closePanelsOnOutsideClick(e) {
    const target = e.target;
    if (!target) return;
    if (this.isTypographyOpen && !this.typographyPanel.contains(target) && !this.settingsBtn.contains(target)) {
      this.closeTypography();
    }
    if (this.isTocOpen && !this.tocSidebar.contains(target) && !this.floatingControls.contains(target)) {
      this.closeSidebar();
    }
  }
  getBookSettings() {
    if (!this.currentFile) return {};
    return this.plugin.getBookSettings(this.currentFile.path);
  }
  getEffectiveFirstLineIndent() {
    var _a;
    return (_a = this.getBookSettings().firstLineIndent) != null ? _a : this.plugin.settings.firstLineIndent;
  }
  getEffectiveTocRegex() {
    var _a;
    return (_a = this.getBookSettings().tocRegex) != null ? _a : this.plugin.settings.tocRegex;
  }
  normalizeChapterNumber(raw) {
    if (/^\d+$/.test(raw)) return String(Number(raw));
    const parsed = this.parseChineseNumber(raw);
    return parsed > 0 ? String(parsed) : raw;
  }
  getChapterStartingAt(paraIndex) {
    var _a;
    return (_a = this.chapters.find((chapter) => chapter.startParaIndex === paraIndex)) != null ? _a : null;
  }
  parseChineseNumber(raw) {
    const digits = {
      \u96F6: 0,
      "\u3007": 0,
      \u4E00: 1,
      \u4E8C: 2,
      \u4E24: 2,
      \u4E09: 3,
      \u56DB: 4,
      \u4E94: 5,
      \u516D: 6,
      \u4E03: 7,
      \u516B: 8,
      \u4E5D: 9
    };
    const smallUnits = { \u5341: 10, \u767E: 100, \u5343: 1e3 };
    const largeUnits = { \u4E07: 1e4, \u4EBF: 1e8 };
    let total = 0;
    let section = 0;
    let number = 0;
    for (const char of raw) {
      if (char in digits) {
        number = digits[char];
      } else if (char in smallUnits) {
        section += (number || 1) * smallUnits[char];
        number = 0;
      } else if (char in largeUnits) {
        section += number;
        total += (section || 1) * largeUnits[char];
        section = 0;
        number = 0;
      } else {
        return 0;
      }
    }
    return total + section + number;
  }
  updateBookSettings(partial) {
    if (!this.currentFile) return;
    const next = {
      ...this.getBookSettings(),
      ...partial
    };
    this.plugin.saveBookSettings(this.currentFile.path, next);
  }
  bindGlobalKeys() {
    this.boundGlobalKeydown = (e) => {
      if (!this.contentEl.isConnected) return;
      if (e.key === "Escape") {
        if (!this.isReaderKeyboardActive()) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      if (!this.matchesSearchHotkey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.openSearch();
    };
    document.addEventListener("keydown", this.boundGlobalKeydown, true);
    window.addEventListener("keydown", this.boundGlobalKeydown, true);
  }
  matchesSearchHotkey(e) {
    const raw = this.plugin.settings.searchHotkey || "Ctrl+F";
    const parts = raw.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
    const key = parts.find((p) => !["ctrl", "control", "cmd", "meta", "alt", "shift"].includes(p));
    if (!key) return false;
    const eventKey = e.key.toLowerCase();
    const eventCode = e.code.toLowerCase().replace(/^key/, "");
    return (eventKey === key || eventCode === key) && e.ctrlKey === (parts.includes("ctrl") || parts.includes("control")) && e.metaKey === (parts.includes("cmd") || parts.includes("meta")) && e.altKey === parts.includes("alt") && e.shiftKey === parts.includes("shift");
  }
  handleKeydown(e) {
    if (this.matchesSearchHotkey(e)) {
      e.preventDefault();
      this.openSearch();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      this.pageDown();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      this.pageUp();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }
  isReaderKeyboardActive() {
    const active = document.activeElement;
    return this.app.workspace.activeLeaf === this.leaf || !!active && this.contentEl.contains(active);
  }
  scheduleProgressSave() {
    window.clearTimeout(this.progressSaveTimer);
    this.progressSaveTimer = window.setTimeout(() => this.saveProgressNow(), 800);
  }
  saveProgressNow() {
    if (!this.currentFile || this.paragraphs.length === 0) return;
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: this.currentPageStart.paraIndex,
      charOffset: this.currentPageStart.charOffset,
      lastRead: Date.now()
    });
  }
  buildHighlightedHTML(text, matches) {
    const sorted = [...matches].sort((a, b) => a.startOffset - b.startOffset);
    let result = "";
    let last = 0;
    for (const m of sorted) {
      if (m.startOffset < last) continue;
      result += this.escapeHTML(text.slice(last, m.startOffset));
      result += `<span class="puffs-search-hl">${this.escapeHTML(text.slice(m.startOffset, m.startOffset + m.length))}</span>`;
      last = m.startOffset + m.length;
    }
    result += this.escapeHTML(text.slice(last));
    return result;
  }
  escapeHTML(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
};

// src/SettingsTab.ts
var import_obsidian2 = require("obsidian");
var SettingsTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "\u6392\u7248\u8BBE\u7F6E" });
    this.addNumberSetting("\u6B63\u6587\u5B57\u4F53\u5927\u5C0F", "\u9605\u8BFB\u533A\u6587\u5B57\u5927\u5C0F (px)", "fontSize", 12, 36, 1, "px");
    this.addNumberSetting("\u884C\u95F4\u8DDD", "\u6B63\u6587\u884C\u95F4\u8DDD\u500D\u6570", "lineHeight", 1, 3.2, 0.1, "\u500D");
    this.addNumberSetting("\u6BB5\u843D\u95F4\u8DDD", "\u6BB5\u843D\u4E4B\u95F4\u7684\u8DDD\u79BB (px)", "paragraphSpacing", 0, 48, 1, "px");
    this.addNumberSetting("\u9996\u884C\u7F29\u8FDB", "\u6240\u6709\u4E66\u7C4D\u9ED8\u8BA4\u9996\u884C\u7F29\u8FDB (em)\uFF0C\u5355\u4E66\u8BBE\u7F6E\u53EF\u8986\u5199", "firstLineIndent", 0, 4, 0.1, "em");
    this.addNumberSetting("\u9605\u8BFB\u533A\u5BBD\u5EA6", "\u9605\u8BFB\u533A\u6700\u5927\u5BBD\u5EA6 (px)", "contentWidth", 360, 1500, 10, "px");
    this.addNumberSetting("\u5B57\u95F4\u8DDD", "\u6587\u5B57\u4E4B\u95F4\u7684\u8DDD\u79BB (px)", "letterSpacing", 0, 8, 0.1, "px");
    this.addNumberSetting("\u6B63\u6587\u9876\u90E8\u95F4\u8DDD", "\u6B63\u6587\u5185\u5BB9\u4E0E\u9875\u9762\u9876\u90E8\u7684\u8DDD\u79BB (px)", "paddingTop", 0, 180, 1, "px");
    this.addNumberSetting("\u6B63\u6587\u5E95\u90E8\u95F4\u8DDD", "\u6B63\u6587\u5185\u5BB9\u4E0E\u9875\u9762\u5E95\u90E8\u7684\u8DDD\u79BB (px)", "paddingBottom", 0, 200, 1, "px");
    this.addNumberSetting("\u5DE6\u4FA7\u680F\u5BBD\u5EA6", "\u76EE\u5F55\u548C\u5168\u6587\u641C\u7D22\u4FA7\u680F\u5BBD\u5EA6 (px)", "sidebarWidth", 220, 520, 1, "px");
    this.addNumberSetting("\u4FA7\u680F\u8FC7\u6E21\u901F\u5EA6", "\u76EE\u5F55\u548C\u5168\u6587\u641C\u7D22\u4FA7\u680F\u5C55\u5F00/\u6536\u8D77\u52A8\u753B\u65F6\u957F (ms)", "sidebarTransitionMs", 0, 800, 10, "ms");
    this.addNumberSetting("\u76EE\u5F55\u5B57\u4F53\u5927\u5C0F", "\u5DE6\u4FA7\u76EE\u5F55\u6761\u76EE\u7684\u5B57\u4F53\u5927\u5C0F (px)", "tocFontSize", 11, 20, 1, "px");
    this.addTextSetting("\u5B57\u4F53\u989C\u8272", "RGB \u683C\u5F0F\uFF0C\u5982 51,51,51\u3002\u7559\u7A7A\u8DDF\u968F\u4E3B\u9898\u3002", "fontColor", "\u4F8B\u5982 51,51,51");
    this.addTextSetting("\u4E66\u7C4D\u80CC\u666F\u989C\u8272", "RGB \u683C\u5F0F\uFF0C\u5982 233,216,188\u3002\u7559\u7A7A\u8DDF\u968F\u4E3B\u9898\u3002", "backgroundColor", "\u4F8B\u5982 233,216,188");
    this.addTextSetting("\u53F3\u4E0A\u89D2\u6309\u94AE\u989C\u8272", "RGB \u683C\u5F0F\uFF1B\u63A7\u5236\u9605\u8BFB\u533A\u53F3\u4E0A\u89D2\u4E24\u4E2A\u6D6E\u52A8\u6309\u94AE\u7684\u56FE\u6807\u989C\u8272\u3002", "floatingButtonColor", "\u4F8B\u5982 120,120,120");
    containerEl.createEl("h3", { text: "\u9876\u90E8\u7AE0\u540D\u4E0E\u5E95\u90E8\u8FDB\u5EA6" });
    this.addNumberSetting("\u7AE0\u540D\u5B57\u53F7", "\u9875\u9762\u9876\u90E8\u7AE0\u540D\u5C0F\u5B57\u5927\u5C0F (px)", "chapterMetaFontSize", 9, 20, 1, "px");
    this.addNumberSetting("\u7AE0\u540D\u9876\u90E8\u4F4D\u7F6E", "\u7AE0\u540D\u8DDD\u79BB\u9875\u9762\u9876\u90E8\u7684\u4F4D\u7F6E (px)", "chapterMetaTop", 0, 80, 1, "px");
    this.addTextSetting("\u7AE0\u540D\u989C\u8272", "RGB \u683C\u5F0F\uFF1B\u7559\u7A7A\u4F7F\u7528\u4E3B\u9898\u5F31\u5316\u6587\u5B57\u989C\u8272\u3002", "chapterMetaColor", "\u4F8B\u5982 120,120,120");
    this.addNumberSetting("\u8FDB\u5EA6\u5B57\u53F7", "\u9875\u9762\u5E95\u90E8\u767E\u5206\u6BD4\u5C0F\u5B57\u5927\u5C0F (px)", "progressMetaFontSize", 9, 20, 1, "px");
    this.addNumberSetting("\u8FDB\u5EA6\u5E95\u90E8\u4F4D\u7F6E", "\u767E\u5206\u6BD4\u8DDD\u79BB\u9875\u9762\u5E95\u90E8\u7684\u4F4D\u7F6E (px)", "progressMetaBottom", 0, 80, 1, "px");
    this.addTextSetting("\u8FDB\u5EA6\u989C\u8272", "RGB \u683C\u5F0F\uFF1B\u7559\u7A7A\u4F7F\u7528\u4E3B\u9898\u5F31\u5316\u6587\u5B57\u989C\u8272\u3002", "progressMetaColor", "\u4F8B\u5982 120,120,120");
    containerEl.createEl("h3", { text: "\u529F\u80FD\u5F00\u5173" });
    new import_obsidian2.Setting(containerEl).setName("\u663E\u793A\u9605\u8BFB\u8FDB\u5EA6").setDesc("\u5728\u9875\u9762\u5E95\u90E8\u663E\u793A\u9605\u8BFB\u767E\u5206\u6BD4").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showProgress).onChange(async (v) => {
        this.plugin.settings.showProgress = v;
        await this.plugin.savePluginData();
        this.refreshOpenReaders();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u53BB\u9664\u591A\u4F59\u7A7A\u884C").setDesc("\u81EA\u52A8\u6E05\u7406 TXT \u4E2D\u8FDE\u7EED\u7684\u7A7A\u767D\u884C").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.removeExtraBlankLines).onChange(async (v) => {
        this.plugin.settings.removeExtraBlankLines = v;
        await this.plugin.savePluginData();
        this.refreshOpenReaders();
      })
    );
    containerEl.createEl("h3", { text: "\u76EE\u5F55\u4E0E\u7F16\u7801" });
    this.addTextSetting("\u76EE\u5F55\u5339\u914D\u6B63\u5219", "\u6240\u6709\u4E66\u7C4D\u9ED8\u8BA4\u7AE0\u8282\u5339\u914D\u6B63\u5219\uFF1B\u5355\u4E66\u8BBE\u7F6E\u53EF\u8986\u5199\u3002", "tocRegex", DEFAULT_SETTINGS.tocRegex);
    new import_obsidian2.Setting(containerEl).setName("\u9ED8\u8BA4\u7F16\u7801").setDesc("\u6253\u5F00\u6587\u4EF6\u65F6\u7684\u9ED8\u8BA4\u7F16\u7801\uFF08\u81EA\u52A8\u68C0\u6D4B\u5931\u8D25\u65F6\u4F7F\u7528\uFF09").addDropdown(
      (dd) => dd.addOptions({
        "utf-8": "UTF-8",
        gbk: "GBK",
        gb18030: "GB18030",
        big5: "Big5"
      }).setValue(this.plugin.settings.defaultEncoding).onChange(async (v) => {
        this.plugin.settings.defaultEncoding = v;
        await this.plugin.savePluginData();
        this.refreshOpenReaders();
      })
    );
    this.addTextSetting(
      "\u5168\u6587\u641C\u7D22\u5FEB\u6377\u952E",
      "\u9ED8\u8BA4 Ctrl+F\u3002\u652F\u6301 Ctrl/Alt/Shift \u52A0\u5355\u4E2A\u6309\u952E\uFF0C\u4F8B\u5982 Ctrl+Shift+F\u3002",
      "searchHotkey",
      DEFAULT_SETTINGS.searchHotkey
    );
  }
  addNumberSetting(name, desc, key, min, max, step, unit) {
    let sliderControl = null;
    let textControl = null;
    let isSyncing = false;
    const clamp = (value) => Math.min(max, Math.max(min, value));
    const format = (value) => String(value);
    const save = async (value, syncText) => {
      const next = clamp(value);
      this.plugin.settings[key] = next;
      isSyncing = true;
      sliderControl == null ? void 0 : sliderControl.setValue(next);
      if (syncText) textControl == null ? void 0 : textControl.setValue(format(next));
      isSyncing = false;
      await this.plugin.savePluginData();
      this.refreshOpenReaders();
    };
    new import_obsidian2.Setting(this.containerEl).setName(name).setDesc(desc).addSlider(
      (slider) => (sliderControl = slider).setLimits(min, max, step).setValue(this.plugin.settings[key]).setDynamicTooltip().onChange((v) => {
        if (isSyncing) return;
        save(v, true);
      })
    ).addText(
      (text) => (textControl = text).setValue(String(this.plugin.settings[key])).setPlaceholder(unit).onChange((v) => {
        if (isSyncing) return;
        const n = Number(v);
        if (Number.isNaN(n)) return;
        save(n, false);
      })
    );
  }
  addTextSetting(name, desc, key, placeholder) {
    new import_obsidian2.Setting(this.containerEl).setName(name).setDesc(desc).addText(
      (text) => text.setPlaceholder(placeholder).setValue(this.plugin.settings[key]).onChange(async (v) => {
        const fallback = key === "searchHotkey" ? DEFAULT_SETTINGS.searchHotkey : "";
        this.plugin.settings[key] = v.trim() || fallback;
        await this.plugin.savePluginData();
        this.refreshOpenReaders();
      })
    );
  }
  refreshOpenReaders() {
    var _a;
    for (const leaf of this.app.workspace.getLeavesOfType("puffs-reader-view")) {
      const view = leaf.view;
      (_a = view.refreshSettingsFromGlobal) == null ? void 0 : _a.call(view);
    }
  }
};

// src/main.ts
var TxtFileSuggestModal = class extends import_obsidian3.FuzzySuggestModal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder("\u9009\u62E9\u8981\u9605\u8BFB\u7684 TXT \u6587\u4EF6...");
  }
  /** 获取仓库中全部 .txt 文件 */
  getItems() {
    return this.app.vault.getFiles().filter((f) => f.extension === "txt");
  }
  /** 显示文件路径作为选项文本 */
  getItemText(item) {
    return item.path;
  }
  /** 用户选中后，在阅读器中打开该文件 */
  onChooseItem(item) {
    this.plugin.openInReader(item);
  }
};
var PuffsReaderPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.progress = {};
    this.bookSettings = {};
  }
  async onload() {
    await this.loadPluginData();
    this.registerView(READER_VIEW_TYPE, (leaf) => new ReaderView(leaf, this));
    this.addCommand({
      id: "open-txt-in-reader",
      name: "\u5728\u9605\u8BFB\u5668\u4E2D\u6253\u5F00 TXT \u6587\u4EF6",
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === "txt") {
          this.openInReader(activeFile);
        } else {
          new TxtFileSuggestModal(this).open();
        }
      }
    });
    this.addCommand({
      id: "search-current-reader-book",
      name: "Puffs Reader\uFF1A\u5168\u6587\u641C\u7D22",
      hotkeys: [{ modifiers: ["Ctrl"], key: "f" }],
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(ReaderView);
        if (view) view.openSearch();
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian3.TFile && file.extension === "txt") {
          menu.addItem((item) => {
            item.setTitle("\u5728 Puffs Reader \u4E2D\u6253\u5F00").setIcon("book-open").onClick(() => this.openInReader(file));
          });
        }
      })
    );
    this.addSettingTab(new SettingsTab(this.app, this));
  }
  // ═══════════════════════════ 打开阅读器 ═══════════════════════════
  /**
   * 在新标签页中打开指定 TXT 文件的阅读器视图。
   * 通过 setViewState 将文件路径传递给 ReaderView。
   */
  async openInReader(file) {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: READER_VIEW_TYPE,
      state: { file: file.path }
    });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view;
    if (view instanceof ReaderView) {
      view.focusReader();
    }
  }
  // ═══════════════════════════ 数据持久化 ═══════════════════════════
  async loadPluginData() {
    var _a, _b, _c;
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data == null ? void 0 : data.settings);
    this.progress = (_a = data == null ? void 0 : data.progress) != null ? _a : {};
    this.bookSettings = (_b = data == null ? void 0 : data.bookSettings) != null ? _b : {};
    for (const [filePath, progress] of Object.entries(this.progress)) {
      if (progress.encoding && !((_c = this.bookSettings[filePath]) == null ? void 0 : _c.encoding)) {
        this.bookSettings[filePath] = {
          ...this.bookSettings[filePath],
          encoding: progress.encoding
        };
      }
    }
  }
  async savePluginData() {
    await this.saveData({
      settings: this.settings,
      progress: this.progress,
      bookSettings: this.bookSettings
    });
  }
  // ═══════════════════════════ 阅读进度 ═══════════════════════════
  getProgress(filePath) {
    return this.progress[filePath];
  }
  async saveProgress(filePath, progress) {
    this.progress[filePath] = progress;
    await this.savePluginData();
  }
  getBookSettings(filePath) {
    var _a;
    return (_a = this.bookSettings[filePath]) != null ? _a : {};
  }
  async saveBookSettings(filePath, settings) {
    const compact = {};
    if (settings.encoding) compact.encoding = settings.encoding;
    if (settings.firstLineIndent !== void 0) compact.firstLineIndent = settings.firstLineIndent;
    if (settings.tocRegex !== void 0 && settings.tocRegex !== "") compact.tocRegex = settings.tocRegex;
    if (settings.chapterTitleRegex !== void 0 && settings.chapterTitleRegex !== "") {
      compact.chapterTitleRegex = settings.chapterTitleRegex;
    }
    this.bookSettings[filePath] = compact;
    await this.savePluginData();
  }
};
