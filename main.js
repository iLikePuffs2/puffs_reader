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
var BLOCK_SIZE = 80;
var RENDER_BUFFER = 2;
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
  showProgress: true,
  removeExtraBlankLines: true,
  tocRegex: "^\\s*\u7B2C[\u96F6\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u4EBF\\d]+[\u7AE0\u8282\u56DE\u5377\u96C6\u90E8\u7BC7].*$",
  defaultEncoding: "utf-8",
  searchHotkey: "Ctrl+F"
};

// src/ReaderView.ts
var READER_VIEW_TYPE = "puffs-reader-view";
var ReaderView = class extends import_obsidian.ItemView {
  // ═══════════════════════════════════════════════════════════════════
  //  生命周期
  // ═══════════════════════════════════════════════════════════════════
  constructor(leaf, plugin) {
    super(leaf);
    // ── 当前文件 ──
    this.filePath = "";
    this.currentFile = null;
    // ── 数据 ──
    this.paragraphs = [];
    this.blocks = [];
    this.chapters = [];
    this.currentEncoding = "utf-8";
    this.fileBuffer = null;
    // ── 搜索 ──
    this.searchQuery = "";
    this.searchResults = [];
    this.currentSearchIdx = -1;
    this.searchJumpBackPara = null;
    // ── UI 状态 ──
    this.isTocOpen = false;
    this.isSearchOpen = false;
    this.isTypographyOpen = false;
    // ── 性能 ──
    this.scrollRAF = 0;
    this.progressSaveTimer = 0;
    this.boundGlobalKeydown = null;
    this.plugin = plugin;
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
    this.saveProgressNow();
    cancelAnimationFrame(this.scrollRAF);
    window.clearTimeout(this.progressSaveTimer);
    if (this.boundGlobalKeydown) {
      document.removeEventListener("keydown", this.boundGlobalKeydown, true);
      this.boundGlobalKeydown = null;
    }
  }
  // ── 状态序列化：通过 state.file 传递文件路径 ──
  getState() {
    return { file: this.filePath };
  }
  async setState(state, result) {
    const path = state == null ? void 0 : state.file;
    if (path && path !== this.filePath) {
      this.filePath = path;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof import_obsidian.TFile) {
        this.currentFile = file;
        this.leaf.updateHeader();
        await this.loadContent();
      }
    }
    await super.setState(state, result);
  }
  // ═══════════════════════════════════════════════════════════════════
  //  UI 构建
  // ═══════════════════════════════════════════════════════════════════
  buildUI() {
    const ce = this.contentEl;
    ce.empty();
    ce.addClass("puffs-reader-root");
    this.rootEl = ce.createDiv({ cls: "puffs-reader-wrapper" });
    this.buildToolbar();
    this.buildSearchPanel();
    this.buildTypographyPanel();
    const body = this.rootEl.createDiv({ cls: "puffs-body" });
    this.buildTocSidebar(body);
    this.buildReadingArea(body);
    this.bindGlobalKeys();
  }
  // ── 顶部工具栏 ──
  buildToolbar() {
    this.toolbar = this.rootEl.createDiv({ cls: "puffs-toolbar" });
    this.makeToolbarBtn("list", "\u76EE\u5F55", () => this.toggleToc());
    this.makeToolbarBtn("settings", "\u6392\u7248", () => this.toggleTypography());
  }
  makeToolbarBtn(icon, label, onClick) {
    const btn = this.toolbar.createEl("button", {
      cls: "puffs-toolbar-btn",
      attr: { "aria-label": label }
    });
    (0, import_obsidian.setIcon)(btn, icon);
    btn.addEventListener("click", onClick);
    return btn;
  }
  // ── 搜索面板（默认隐藏） ──
  buildSearchPanel() {
    this.searchPanel = this.rootEl.createDiv({ cls: "puffs-search-panel puffs-hidden" });
    const header = this.searchPanel.createDiv({ cls: "puffs-search-header" });
    this.searchInput = this.searchPanel.createEl("input", {
      cls: "puffs-search-input",
      attr: { type: "text", placeholder: "\u5728\u5F53\u524D\u4E66\u5185\u641C\u7D22..." }
    });
    header.appendChild(this.searchInput);
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) this.navigateSearch("prev");
        else this.navigateSearch("next");
      }
      if (e.key === "Escape") this.toggleSearch();
    });
    this.searchInput.addEventListener("input", () => this.performSearch(this.searchInput.value));
    const prevBtn = this.searchPanel.createEl("button", {
      cls: "puffs-toolbar-btn",
      attr: { "aria-label": "\u4E0A\u4E00\u4E2A" }
    });
    (0, import_obsidian.setIcon)(prevBtn, "chevron-up");
    prevBtn.addEventListener("click", () => this.navigateSearch("prev"));
    header.appendChild(prevBtn);
    const nextBtn = this.searchPanel.createEl("button", {
      cls: "puffs-toolbar-btn",
      attr: { "aria-label": "\u4E0B\u4E00\u4E2A" }
    });
    (0, import_obsidian.setIcon)(nextBtn, "chevron-down");
    nextBtn.addEventListener("click", () => this.navigateSearch("next"));
    header.appendChild(nextBtn);
    this.searchInfo = this.searchPanel.createSpan({ cls: "puffs-search-info" });
    header.appendChild(this.searchInfo);
    const closeBtn = this.searchPanel.createEl("button", {
      cls: "puffs-toolbar-btn",
      attr: { "aria-label": "\u5173\u95ED" }
    });
    (0, import_obsidian.setIcon)(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.toggleSearch());
    header.appendChild(closeBtn);
    this.searchResultsEl = this.searchPanel.createDiv({ cls: "puffs-search-results" });
  }
  // ── 排版面板（默认隐藏） ──
  buildTypographyPanel() {
    this.typographyPanel = this.rootEl.createDiv({ cls: "puffs-typo-panel puffs-hidden" });
    this.refreshTypographyPanel();
  }
  refreshTypographyPanel() {
    const p = this.typographyPanel;
    p.empty();
    const s = this.plugin.settings;
    const title = p.createDiv({ cls: "puffs-typo-title" });
    title.createSpan({ text: "\u6392\u7248\u8BBE\u7F6E" });
    this.encodingBtn = title.createEl("button", {
      cls: "puffs-toolbar-btn puffs-encoding-btn",
      text: this.currentEncoding.toUpperCase(),
      attr: { "aria-label": "\u5207\u6362\u7F16\u7801" }
    });
    this.encodingBtn.addEventListener("click", (e) => this.showEncodingMenu(e));
    this.addSliderRow(p, "\u5B57\u4F53\u5927\u5C0F", s.fontSize, 12, 32, 1, "px", (v) => {
      this.plugin.settings.fontSize = v;
      this.applyTypography();
    });
    this.addSliderRow(p, "\u884C\u95F4\u8DDD", s.lineHeight, 1, 3, 0.1, "x", (v) => {
      this.plugin.settings.lineHeight = v;
      this.applyTypography();
    });
    this.addSliderRow(p, "\u6BB5\u843D\u95F4\u8DDD", s.paragraphSpacing, 0, 40, 2, "px", (v) => {
      this.plugin.settings.paragraphSpacing = v;
      this.applyTypography();
    });
    this.addSliderRow(p, "\u9996\u884C\u7F29\u8FDB", s.firstLineIndent, 0, 4, 0.5, "em", (v) => {
      this.plugin.settings.firstLineIndent = v;
      this.applyTypography();
    });
    this.addSliderRow(p, "\u9605\u8BFB\u533A\u5BBD\u5EA6", s.contentWidth, 400, 1400, 50, "px", (v) => {
      this.plugin.settings.contentWidth = v;
      this.applyTypography();
    });
    this.addSliderRow(p, "\u5B57\u95F4\u8DDD", s.letterSpacing, 0, 6, 0.5, "px", (v) => {
      this.plugin.settings.letterSpacing = v;
      this.applyTypography();
    });
    this.addSliderRow(p, "\u9876\u90E8\u95F4\u8DDD", s.paddingTop, 0, 160, 4, "px", (v) => {
      this.plugin.settings.paddingTop = v;
      this.applyTypography();
    });
    this.addSliderRow(p, "\u5E95\u90E8\u95F4\u8DDD", s.paddingBottom, 0, 200, 4, "px", (v) => {
      this.plugin.settings.paddingBottom = v;
      this.applyTypography();
    });
    this.addColorRow(p, "\u5B57\u4F53\u989C\u8272", s.fontColor, (v) => {
      this.plugin.settings.fontColor = v;
      this.applyTypography();
    });
    this.addColorRow(p, "\u80CC\u666F\u989C\u8272", s.backgroundColor, (v) => {
      this.plugin.settings.backgroundColor = v;
      this.applyTypography();
    });
    this.addToggleRow(p, "\u663E\u793A\u8FDB\u5EA6", s.showProgress, (v) => {
      this.plugin.settings.showProgress = v;
      this.updateStatusBar();
    });
    this.addToggleRow(p, "\u53BB\u9664\u7A7A\u884C", s.removeExtraBlankLines, (v) => {
      this.plugin.settings.removeExtraBlankLines = v;
      this.loadContent();
    });
    this.addTextRow(p, "\u76EE\u5F55\u6B63\u5219", s.tocRegex, (v) => {
      this.plugin.settings.tocRegex = v;
      this.parseChapters();
      this.buildTocList();
    });
    const resetBtn = p.createEl("button", { cls: "puffs-typo-reset", text: "\u6062\u590D\u9ED8\u8BA4" });
    resetBtn.addEventListener("click", async () => {
      Object.assign(this.plugin.settings, {
        fontSize: 18,
        lineHeight: 1.8,
        paragraphSpacing: 10,
        firstLineIndent: 2,
        contentWidth: 800,
        letterSpacing: 0,
        paddingTop: 40,
        paddingBottom: 40,
        fontColor: "",
        backgroundColor: ""
      });
      await this.plugin.savePluginData();
      this.refreshTypographyPanel();
      this.applyTypography();
    });
  }
  // ── 辅助: 面板行 ──
  addSliderRow(parent, label, value, min, max, step, unit, onChange) {
    const row = parent.createDiv({ cls: "puffs-typo-row" });
    row.createSpan({ cls: "puffs-typo-label", text: label });
    const valSpan = row.createSpan({ cls: "puffs-typo-value", text: `${value}${unit}` });
    const numberInput = row.createEl("input", {
      cls: "puffs-typo-number",
      attr: { type: "number", min: String(min), max: String(max), step: String(step) }
    });
    numberInput.value = String(value);
    const slider = row.createEl("input", {
      cls: "puffs-typo-slider",
      attr: { type: "range", min: String(min), max: String(max), step: String(step) }
    });
    slider.value = String(value);
    const updateValue = (v) => {
      if (Number.isNaN(v)) return;
      const clamped = Math.min(max, Math.max(min, v));
      slider.value = String(clamped);
      numberInput.value = String(clamped);
      valSpan.textContent = `${clamped}${unit}`;
      onChange(clamped);
    };
    slider.addEventListener("input", () => {
      updateValue(parseFloat(slider.value));
    });
    numberInput.addEventListener("change", () => {
      updateValue(parseFloat(numberInput.value));
      this.plugin.savePluginData();
    });
    slider.addEventListener("change", () => {
      this.plugin.savePluginData();
    });
  }
  addColorRow(parent, label, value, onChange) {
    const row = parent.createDiv({ cls: "puffs-typo-row" });
    row.createSpan({ cls: "puffs-typo-label", text: label });
    const input = row.createEl("input", {
      cls: "puffs-typo-color-input",
      attr: { type: "text", placeholder: "R,G,B \u6216\u7559\u7A7A" }
    });
    input.value = value;
    input.addEventListener("input", () => onChange(input.value.trim()));
    input.addEventListener("change", () => {
      this.plugin.savePluginData();
    });
  }
  addToggleRow(parent, label, value, onChange) {
    const row = parent.createDiv({ cls: "puffs-typo-row puffs-typo-toggle-row" });
    const lbl = row.createEl("label", { cls: "puffs-typo-toggle-label" });
    const cb = lbl.createEl("input", { attr: { type: "checkbox" } });
    cb.checked = value;
    lbl.appendText(` ${label}`);
    cb.addEventListener("change", () => {
      onChange(cb.checked);
      this.plugin.savePluginData();
    });
  }
  addTextRow(parent, label, value, onChange) {
    const row = parent.createDiv({ cls: "puffs-typo-row" });
    row.createSpan({ cls: "puffs-typo-label", text: label });
    const input = row.createEl("input", {
      cls: "puffs-typo-text-input",
      attr: { type: "text" }
    });
    input.value = value;
    input.addEventListener("change", () => onChange(input.value.trim()));
  }
  // ── 目录侧边栏 ──
  buildTocSidebar(parent) {
    this.tocSidebar = parent.createDiv({ cls: "puffs-toc-sidebar puffs-hidden" });
    const header = this.tocSidebar.createDiv({ cls: "puffs-toc-header" });
    header.createSpan({ text: "\u76EE\u5F55" });
    const searchBtn = header.createEl("button", {
      cls: "puffs-toolbar-btn puffs-toc-search-btn",
      attr: { "aria-label": "\u5168\u6587\u641C\u7D22" }
    });
    (0, import_obsidian.setIcon)(searchBtn, "search");
    searchBtn.addEventListener("click", () => this.toggleSearch(true));
    this.tocListEl = this.tocSidebar.createDiv({ cls: "puffs-toc-list" });
  }
  // ── 阅读区 ──
  buildReadingArea(parent) {
    this.readingArea = parent.createDiv({ cls: "puffs-reading-area" });
    this.chapterTitleEl = this.readingArea.createDiv({ cls: "puffs-page-chapter" });
    this.progressTitleEl = this.readingArea.createDiv({ cls: "puffs-page-progress" });
    this.searchBackBtn = this.readingArea.createEl("button", {
      cls: "puffs-search-back puffs-hidden",
      text: "\u8FD4\u56DE",
      attr: { "aria-label": "\u8FD4\u56DE\u641C\u7D22\u524D\u4F4D\u7F6E" }
    });
    this.searchBackBtn.addEventListener("click", () => this.returnFromSearchJump());
    this.scrollContainer = this.readingArea.createDiv({ cls: "puffs-scroll-container" });
    this.scrollContainer.tabIndex = 0;
    this.contentContainer = this.scrollContainer.createDiv({ cls: "puffs-content" });
    this.scrollContainer.addEventListener("scroll", () => this.onScroll());
    this.scrollContainer.addEventListener("keydown", (e) => this.handleKeydown(e));
  }
  // ═══════════════════════════════════════════════════════════════════
  //  编码检测 & 文件加载
  // ═══════════════════════════════════════════════════════════════════
  async loadContent() {
    if (!this.currentFile) return;
    this.fileBuffer = await this.app.vault.readBinary(this.currentFile);
    const saved = this.plugin.getProgress(this.currentFile.path);
    const forcedEncoding = saved == null ? void 0 : saved.encoding;
    const { text, encoding } = this.decodeBuffer(this.fileBuffer, forcedEncoding);
    this.currentEncoding = encoding;
    this.encodingBtn.textContent = encoding.toUpperCase();
    this.paragraphs = this.processText(text);
    this.parseChapters();
    this.buildTocList();
    this.buildBlocks();
    this.applyTypography();
    this.renderInitialBlocks();
    this.restoreProgress();
    this.scrollContainer.focus();
  }
  /** 解码 ArrayBuffer，支持自动检测和手动指定 */
  decodeBuffer(buffer, forceEncoding) {
    if (forceEncoding) {
      try {
        const text = new TextDecoder(forceEncoding, { fatal: false }).decode(buffer);
        return { text, encoding: forceEncoding };
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
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      return { text, encoding: "utf-8" };
    } catch (e) {
    }
    try {
      const text = new TextDecoder("gbk").decode(buffer);
      return { text, encoding: "gbk" };
    } catch (e) {
    }
    const fallback = this.plugin.settings.defaultEncoding;
    return {
      text: new TextDecoder(fallback, { fatal: false }).decode(buffer),
      encoding: fallback
    };
  }
  /** 手动切换编码 */
  switchEncoding(encoding) {
    var _a;
    if (!this.fileBuffer || !this.currentFile) return;
    const { text } = this.decodeBuffer(this.fileBuffer, encoding);
    this.currentEncoding = encoding;
    this.encodingBtn.textContent = encoding.toUpperCase();
    const progress = this.plugin.getProgress(this.currentFile.path);
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: (_a = progress == null ? void 0 : progress.paragraphIndex) != null ? _a : 0,
      lastRead: Date.now(),
      encoding
    });
    this.paragraphs = this.processText(text);
    this.parseChapters();
    this.buildTocList();
    this.buildBlocks();
    this.renderInitialBlocks();
    this.applyTypography();
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
  // ═══════════════════════════════════════════════════════════════════
  //  文本处理
  // ═══════════════════════════════════════════════════════════════════
  /** 原始文本 → 段落数组 */
  processText(text) {
    let lines = text.split(/\r?\n/);
    if (this.plugin.settings.removeExtraBlankLines) {
      lines = this.collapseBlankLines(lines);
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    return lines;
  }
  /** 连续空行压缩为最多一行 */
  collapseBlankLines(lines) {
    const result = [];
    let lastBlank = false;
    for (const line of lines) {
      const isBlank = line.trim() === "";
      if (isBlank && lastBlank) continue;
      result.push(line);
      lastBlank = isBlank;
    }
    return result;
  }
  // ═══════════════════════════════════════════════════════════════════
  //  虚拟滚动
  // ═══════════════════════════════════════════════════════════════════
  /**
   * 将段落划分为固定大小的 Block，每块作为一个 DOM 容器。
   * 初始时每块只是一个空 div（占位高度），进入可视区才填充段落。
   */
  buildBlocks() {
    this.contentContainer.empty();
    this.blocks = [];
    const total = this.paragraphs.length;
    const s = this.plugin.settings;
    const estParaHeight = s.fontSize * s.lineHeight + s.paragraphSpacing;
    for (let i = 0; i < total; i += BLOCK_SIZE) {
      const end = Math.min(i + BLOCK_SIZE, total);
      const el = this.contentContainer.createDiv({ cls: "puffs-block" });
      el.dataset.blockIndex = String(this.blocks.length);
      const block = {
        element: el,
        startPara: i,
        endPara: end,
        rendered: false,
        measuredHeight: -1
      };
      const count = end - i;
      el.style.height = `${count * estParaHeight}px`;
      this.blocks.push(block);
    }
  }
  /** 首次加载：渲染前 N 块 */
  renderInitialBlocks() {
    const count = Math.min(this.blocks.length, RENDER_BUFFER + 1);
    for (let i = 0; i < count; i++) {
      this.renderBlock(i);
    }
  }
  /** 渲染指定块的段落内容 */
  renderBlock(idx) {
    if (idx < 0 || idx >= this.blocks.length) return;
    const block = this.blocks[idx];
    if (block.rendered) return;
    block.element.empty();
    block.element.style.height = "";
    for (let p = block.startPara; p < block.endPara; p++) {
      const text = this.paragraphs[p];
      const el = this.createParagraphEl(text, p);
      block.element.appendChild(el);
    }
    block.rendered = true;
    block.measuredHeight = block.element.offsetHeight;
  }
  /** 卸载指定块（用测量高度占位） */
  unrenderBlock(idx) {
    if (idx < 0 || idx >= this.blocks.length) return;
    const block = this.blocks[idx];
    if (!block.rendered) return;
    block.measuredHeight = block.element.offsetHeight;
    block.element.empty();
    block.element.style.height = `${block.measuredHeight}px`;
    block.rendered = false;
  }
  /** 创建单个段落 DOM 元素 */
  createParagraphEl(text, paraIndex) {
    const p = document.createElement("p");
    p.className = "puffs-para";
    p.dataset.paraIndex = String(paraIndex);
    const trimmed = text.trim();
    if (trimmed === "") {
      p.classList.add("puffs-para-blank");
      p.innerHTML = "&nbsp;";
      return p;
    }
    if (this.searchResults.length > 0) {
      const matches = this.searchResults.filter((m) => m.paraIndex === paraIndex);
      if (matches.length > 0) {
        p.innerHTML = this.buildHighlightedHTML(trimmed, matches);
        return p;
      }
    }
    p.textContent = trimmed;
    return p;
  }
  /** 滚动事件 → 更新可视块 + 进度 */
  onScroll() {
    cancelAnimationFrame(this.scrollRAF);
    this.scrollRAF = requestAnimationFrame(() => {
      this.updateVisibleBlocks();
      this.updateProgress();
      this.scheduleProgressSave();
    });
  }
  /** 根据滚动位置决定渲染/卸载哪些块 */
  updateVisibleBlocks() {
    const scrollTop = this.scrollContainer.scrollTop;
    const viewportH = this.scrollContainer.clientHeight;
    const center = this.getBlockAtPosition(scrollTop + viewportH / 2);
    const lo = Math.max(0, center - RENDER_BUFFER);
    const hi = Math.min(this.blocks.length - 1, center + RENDER_BUFFER);
    for (let i = 0; i < this.blocks.length; i++) {
      if (i >= lo && i <= hi) {
        this.renderBlock(i);
      } else {
        this.unrenderBlock(i);
      }
    }
  }
  /** 根据像素位置找到对应块索引 */
  getBlockAtPosition(pos) {
    let accum = 0;
    const s = this.plugin.settings;
    const estH = BLOCK_SIZE * (s.fontSize * s.lineHeight + s.paragraphSpacing);
    for (let i = 0; i < this.blocks.length; i++) {
      const h = this.blocks[i].rendered ? this.blocks[i].element.offsetHeight : this.blocks[i].measuredHeight > 0 ? this.blocks[i].measuredHeight : estH;
      if (accum + h > pos) return i;
      accum += h;
    }
    return this.blocks.length - 1;
  }
  /** 滚动到指定段落 */
  scrollToParagraph(paraIndex) {
    const blockIdx = Math.floor(paraIndex / BLOCK_SIZE);
    for (let i = Math.max(0, blockIdx - 1); i <= Math.min(this.blocks.length - 1, blockIdx + 1); i++) {
      this.renderBlock(i);
    }
    requestAnimationFrame(() => {
      const el = this.contentContainer.querySelector(
        `[data-para-index="${paraIndex}"]`
      );
      if (el) {
        el.scrollIntoView({ block: "start" });
      }
    });
  }
  // ═══════════════════════════════════════════════════════════════════
  //  目录解析 (TOC)
  // ═══════════════════════════════════════════════════════════════════
  parseChapters() {
    this.chapters = [];
    const pattern = this.plugin.settings.tocRegex;
    if (!pattern) return;
    let regex;
    try {
      regex = new RegExp(pattern);
    } catch (e) {
      return;
    }
    for (let i = 0; i < this.paragraphs.length; i++) {
      const line = this.paragraphs[i].trim();
      if (line && regex.test(line)) {
        this.chapters.push({
          title: line,
          startParaIndex: i,
          level: 1
        });
      }
    }
  }
  buildTocList() {
    if (!this.tocListEl) return;
    this.tocListEl.empty();
    if (this.chapters.length === 0) {
      this.tocListEl.createDiv({ cls: "puffs-toc-empty", text: "\u672A\u68C0\u6D4B\u5230\u7AE0\u8282" });
      return;
    }
    for (let ci = 0; ci < this.chapters.length; ci++) {
      const ch = this.chapters[ci];
      const item = this.tocListEl.createDiv({ cls: "puffs-toc-item" });
      item.textContent = ch.title;
      item.dataset.chapterIndex = String(ci);
      item.addEventListener("click", () => this.jumpToChapter(ci));
    }
  }
  jumpToChapter(chapterIndex) {
    const ch = this.chapters[chapterIndex];
    if (!ch) return;
    this.scrollToParagraph(ch.startParaIndex);
    this.highlightCurrentTocItem(chapterIndex);
  }
  /** 根据当前滚动位置更新 TOC 高亮 */
  updateCurrentChapter() {
    var _a, _b;
    if (this.chapters.length === 0) return;
    const curPara = this.getCurrentParagraphIndex();
    let activeIdx = 0;
    for (let i = 0; i < this.chapters.length; i++) {
      if (this.chapters[i].startParaIndex <= curPara) {
        activeIdx = i;
      } else {
        break;
      }
    }
    this.highlightCurrentTocItem(activeIdx);
    if (this.chapterTitleEl) {
      this.chapterTitleEl.textContent = (_b = (_a = this.chapters[activeIdx]) == null ? void 0 : _a.title) != null ? _b : "";
    }
  }
  highlightCurrentTocItem(idx) {
    this.tocListEl.querySelectorAll(".puffs-toc-item").forEach((el, i) => {
      el.classList.toggle("puffs-toc-active", i === idx);
    });
    const active = this.tocListEl.querySelector(".puffs-toc-active");
    if (active) {
      active.scrollIntoView({ block: "nearest" });
    }
  }
  // ═══════════════════════════════════════════════════════════════════
  //  全文搜索
  // ═══════════════════════════════════════════════════════════════════
  toggleSearch(forceOpen) {
    this.isSearchOpen = forceOpen != null ? forceOpen : !this.isSearchOpen;
    this.searchPanel.classList.toggle("puffs-hidden", !this.isSearchOpen);
    if (this.isSearchOpen) {
      this.searchInput.focus();
      this.searchInput.select();
    } else {
      this.clearSearch();
    }
  }
  /** 执行搜索：遍历段落数组而非 DOM */
  performSearch(query) {
    this.searchQuery = query;
    this.searchResults = [];
    this.currentSearchIdx = -1;
    if (!query) {
      this.searchInfo.textContent = "";
      this.searchResultsEl.empty();
      this.refreshRenderedBlocks();
      return;
    }
    const lowerQ = query.toLowerCase();
    for (let pi = 0; pi < this.paragraphs.length; pi++) {
      const text = this.paragraphs[pi].trim().toLowerCase();
      let pos = 0;
      while (true) {
        const idx = text.indexOf(lowerQ, pos);
        if (idx === -1) break;
        this.searchResults.push({
          paraIndex: pi,
          startOffset: idx,
          length: lowerQ.length
        });
        pos = idx + 1;
      }
    }
    this.searchInfo.textContent = this.searchResults.length > 0 ? `${this.searchResults.length} \u4E2A\u7ED3\u679C` : "\u65E0\u7ED3\u679C";
    this.refreshRenderedBlocks();
    this.renderSearchResultCards();
  }
  navigateSearch(dir) {
    if (this.searchResults.length === 0) return;
    if (dir === "next") {
      this.currentSearchIdx = (this.currentSearchIdx + 1) % this.searchResults.length;
    } else {
      this.currentSearchIdx = (this.currentSearchIdx - 1 + this.searchResults.length) % this.searchResults.length;
    }
    const match = this.searchResults[this.currentSearchIdx];
    this.searchInfo.textContent = `${this.currentSearchIdx + 1}/${this.searchResults.length}`;
    this.jumpToSearchMatch(match, false);
    requestAnimationFrame(() => {
      this.contentContainer.querySelectorAll(".puffs-search-current").forEach((el) => el.classList.remove("puffs-search-current"));
      const paraEl = this.contentContainer.querySelector(
        `[data-para-index="${match.paraIndex}"]`
      );
      if (paraEl) {
        const highlights = paraEl.querySelectorAll(".puffs-search-hl");
        let count = 0;
        for (const m of this.searchResults) {
          if (m.paraIndex === match.paraIndex) {
            if (m === match) {
              const hlEl = highlights[count];
              if (hlEl) hlEl.classList.add("puffs-search-current");
              break;
            }
            count++;
          }
        }
      }
    });
  }
  clearSearch() {
    this.searchQuery = "";
    this.searchResults = [];
    this.currentSearchIdx = -1;
    this.searchInput.value = "";
    this.searchInfo.textContent = "";
    this.searchResultsEl.empty();
    this.refreshRenderedBlocks();
  }
  /** 搜索结果以卡片形式列出，点击卡片后跳转到原文位置。 */
  renderSearchResultCards() {
    this.searchResultsEl.empty();
    if (!this.searchQuery) return;
    if (this.searchResults.length === 0) {
      this.searchResultsEl.createDiv({ cls: "puffs-search-empty", text: "\u6CA1\u6709\u627E\u5230\u5339\u914D\u5185\u5BB9" });
      return;
    }
    const maxCards = Math.min(this.searchResults.length, 200);
    for (let i = 0; i < maxCards; i++) {
      const match = this.searchResults[i];
      const card = this.searchResultsEl.createDiv({ cls: "puffs-search-card" });
      card.dataset.searchIndex = String(i);
      const chapter = this.getChapterTitleForPara(match.paraIndex);
      card.createDiv({ cls: "puffs-search-card-title", text: chapter || `\u7B2C ${match.paraIndex + 1} \u6BB5` });
      const preview = card.createDiv({ cls: "puffs-search-card-preview" });
      preview.innerHTML = this.buildSearchPreview(match);
      card.addEventListener("click", () => {
        this.currentSearchIdx = i;
        this.searchInfo.textContent = `${i + 1}/${this.searchResults.length}`;
        this.jumpToSearchMatch(match, true);
      });
    }
    if (this.searchResults.length > maxCards) {
      this.searchResultsEl.createDiv({
        cls: "puffs-search-more",
        text: `\u4EC5\u663E\u793A\u524D ${maxCards} \u4E2A\u7ED3\u679C\uFF0C\u8BF7\u8F93\u5165\u66F4\u7CBE\u786E\u7684\u5173\u952E\u8BCD`
      });
    }
  }
  jumpToSearchMatch(match, rememberBack) {
    if (rememberBack) {
      this.searchJumpBackPara = this.getCurrentParagraphIndex();
      this.searchBackBtn.classList.remove("puffs-hidden");
    }
    this.scrollToParagraph(match.paraIndex);
    this.highlightCurrentSearchResult(match);
  }
  returnFromSearchJump() {
    if (this.searchJumpBackPara === null) return;
    const backPara = this.searchJumpBackPara;
    this.searchJumpBackPara = null;
    this.searchBackBtn.classList.add("puffs-hidden");
    this.scrollToParagraph(backPara);
  }
  getChapterTitleForPara(paraIndex) {
    let title = "";
    for (const ch of this.chapters) {
      if (ch.startParaIndex <= paraIndex) title = ch.title;
      else break;
    }
    return title;
  }
  buildSearchPreview(match) {
    const raw = this.paragraphs[match.paraIndex].trim();
    const radius = 48;
    const start = Math.max(0, match.startOffset - radius);
    const end = Math.min(raw.length, match.startOffset + match.length + radius);
    const prefix = start > 0 ? "..." : "";
    const suffix = end < raw.length ? "..." : "";
    const visibleStart = match.startOffset - start;
    const visibleEnd = visibleStart + match.length;
    const visible = raw.slice(start, end);
    return `${prefix}${this.escapeHTML(visible.slice(0, visibleStart))}<mark>${this.escapeHTML(visible.slice(visibleStart, visibleEnd))}</mark>${this.escapeHTML(visible.slice(visibleEnd))}${suffix}`;
  }
  highlightCurrentSearchResult(match) {
    requestAnimationFrame(() => {
      this.contentContainer.querySelectorAll(".puffs-search-current").forEach((el) => el.classList.remove("puffs-search-current"));
      const paraEl = this.contentContainer.querySelector(
        `[data-para-index="${match.paraIndex}"]`
      );
      if (!paraEl) return;
      const highlights = paraEl.querySelectorAll(".puffs-search-hl");
      let count = 0;
      for (const m of this.searchResults) {
        if (m.paraIndex === match.paraIndex) {
          if (m === match) {
            const hlEl = highlights[count];
            if (hlEl) hlEl.classList.add("puffs-search-current");
            break;
          }
          count++;
        }
      }
    });
  }
  /** 重新渲染所有已渲染块（用于搜索高亮更新） */
  refreshRenderedBlocks() {
    for (const block of this.blocks) {
      if (block.rendered) {
        block.element.empty();
        for (let p = block.startPara; p < block.endPara; p++) {
          const el = this.createParagraphEl(this.paragraphs[p], p);
          block.element.appendChild(el);
        }
      }
    }
  }
  /** 构建带高亮的 HTML */
  buildHighlightedHTML(text, matches) {
    const sorted = [...matches].sort((a, b) => a.startOffset - b.startOffset);
    let result = "";
    let last = 0;
    for (const m of sorted) {
      if (m.startOffset < last) continue;
      result += this.escapeHTML(text.substring(last, m.startOffset));
      result += `<span class="puffs-search-hl">${this.escapeHTML(text.substring(m.startOffset, m.startOffset + m.length))}</span>`;
      last = m.startOffset + m.length;
    }
    result += this.escapeHTML(text.substring(last));
    return result;
  }
  escapeHTML(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // ═══════════════════════════════════════════════════════════════════
  //  翻页 & 键盘
  // ═══════════════════════════════════════════════════════════════════
  bindGlobalKeys() {
    if (this.boundGlobalKeydown) return;
    this.boundGlobalKeydown = (e) => {
      if (!this.contentEl.isConnected) return;
      if (this.matchesSearchHotkey(e)) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleSearch(true);
      }
    };
    document.addEventListener("keydown", this.boundGlobalKeydown, true);
  }
  matchesSearchHotkey(e) {
    const raw = this.plugin.settings.searchHotkey || "Ctrl+F";
    const parts = raw.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
    const key = parts.find((p) => !["ctrl", "control", "cmd", "meta", "alt", "shift"].includes(p));
    if (!key) return false;
    const wantsCtrl = parts.includes("ctrl") || parts.includes("control");
    const wantsMeta = parts.includes("cmd") || parts.includes("meta");
    const wantsAlt = parts.includes("alt");
    const wantsShift = parts.includes("shift");
    return e.key.toLowerCase() === key && e.ctrlKey === wantsCtrl && e.metaKey === wantsMeta && e.altKey === wantsAlt && e.shiftKey === wantsShift;
  }
  handleKeydown(e) {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        this.pageDown();
        break;
      case "ArrowLeft":
        e.preventDefault();
        this.pageUp();
        break;
      case "Escape":
        if (this.isSearchOpen) {
          e.preventDefault();
          this.toggleSearch(false);
        } else if (this.isTypographyOpen) {
          e.preventDefault();
          this.toggleTypography();
        } else if (this.isTocOpen) {
          e.preventDefault();
          this.toggleToc();
        }
        break;
    }
  }
  pageDown() {
    const lastVisible = this.getLastFullyVisibleParagraphIndex();
    const target = Math.min(this.paragraphs.length - 1, lastVisible + 1);
    this.scrollToParagraph(target);
  }
  pageUp() {
    const firstVisible = this.getCurrentParagraphIndex();
    const visibleCount = Math.max(1, this.getVisibleParagraphIndexes().length);
    const target = Math.max(0, firstVisible - visibleCount);
    this.scrollToParagraph(target);
  }
  // ═══════════════════════════════════════════════════════════════════
  //  阅读进度
  // ═══════════════════════════════════════════════════════════════════
  /** 获取当前可视区域中第一个可见段落的索引 */
  getCurrentParagraphIndex() {
    var _a, _b;
    const visible = this.getVisibleParagraphIndexes();
    if (visible.length > 0) return visible[0];
    const blockIdx = this.getBlockAtPosition(this.scrollContainer.scrollTop);
    return (_b = (_a = this.blocks[blockIdx]) == null ? void 0 : _a.startPara) != null ? _b : 0;
  }
  /** 获取当前视口内完整可见的段落索引，用于无断裂翻页。 */
  getVisibleParagraphIndexes() {
    this.updateVisibleBlocks();
    const containerRect = this.scrollContainer.getBoundingClientRect();
    const topLimit = containerRect.top + 1;
    const bottomLimit = containerRect.bottom - 1;
    const result = [];
    this.contentContainer.querySelectorAll(".puffs-para").forEach((p) => {
      var _a;
      const el = p;
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= topLimit || rect.top >= bottomLimit) return;
      if (rect.top >= topLimit && rect.bottom <= bottomLimit) {
        result.push(parseInt((_a = el.dataset.paraIndex) != null ? _a : "0", 10));
      }
    });
    return result.sort((a, b) => a - b);
  }
  getLastFullyVisibleParagraphIndex() {
    const visible = this.getVisibleParagraphIndexes();
    if (visible.length > 0) return visible[visible.length - 1];
    return this.getCurrentParagraphIndex();
  }
  updateProgress() {
    const total = this.paragraphs.length;
    if (total === 0) return;
    const curPara = this.getCurrentParagraphIndex();
    const pct = (curPara / total * 100).toFixed(1);
    this.updateCurrentChapter();
    this.updateStatusBar(pct);
  }
  updateStatusBar(pct) {
    if (this.progressTitleEl) {
      if (this.plugin.settings.showProgress && pct !== void 0) {
        this.progressTitleEl.textContent = `${pct}%`;
        this.progressTitleEl.classList.remove("puffs-hidden");
      } else if (!this.plugin.settings.showProgress) {
        this.progressTitleEl.classList.add("puffs-hidden");
      }
    }
  }
  /** 延迟保存进度，避免频繁写入 */
  scheduleProgressSave() {
    window.clearTimeout(this.progressSaveTimer);
    this.progressSaveTimer = window.setTimeout(() => this.saveProgressNow(), 2e3);
  }
  saveProgressNow() {
    if (!this.currentFile || this.paragraphs.length === 0) return;
    const paraIdx = this.getCurrentParagraphIndex();
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: paraIdx,
      lastRead: Date.now(),
      encoding: this.currentEncoding !== "utf-8" ? this.currentEncoding : void 0
    });
  }
  /** 恢复上次阅读位置 */
  restoreProgress() {
    if (!this.currentFile) return;
    const saved = this.plugin.getProgress(this.currentFile.path);
    if (saved && saved.paragraphIndex > 0) {
      setTimeout(() => {
        this.scrollToParagraph(saved.paragraphIndex);
      }, 100);
    }
  }
  // ═══════════════════════════════════════════════════════════════════
  //  排版
  // ═══════════════════════════════════════════════════════════════════
  applyTypography() {
    const s = this.plugin.settings;
    const style = this.contentContainer.style;
    const keepPara = this.blocks.length > 0 ? this.getCurrentParagraphIndex() : 0;
    style.setProperty("--puffs-font-size", `${s.fontSize}px`);
    style.setProperty("--puffs-line-height", `${s.lineHeight}`);
    style.setProperty("--puffs-para-spacing", `${s.paragraphSpacing}px`);
    style.setProperty("--puffs-indent", `${s.firstLineIndent}em`);
    style.setProperty("--puffs-content-width", `${s.contentWidth}px`);
    style.setProperty("--puffs-letter-spacing", `${s.letterSpacing}px`);
    style.setProperty("--puffs-padding-top", `${s.paddingTop}px`);
    style.setProperty("--puffs-padding-bottom", `${s.paddingBottom}px`);
    if (s.fontColor) {
      style.setProperty("--puffs-font-color", `rgb(${s.fontColor})`);
    } else {
      style.removeProperty("--puffs-font-color");
    }
    if (s.backgroundColor) {
      this.readingArea.style.setProperty("--puffs-bg-color", `rgb(${s.backgroundColor})`);
      this.rootEl.style.setProperty("--puffs-bg-color", `rgb(${s.backgroundColor})`);
    } else {
      this.readingArea.style.removeProperty("--puffs-bg-color");
      this.rootEl.style.removeProperty("--puffs-bg-color");
    }
    if (this.paragraphs.length > 0) {
      this.buildBlocks();
      this.renderInitialBlocks();
      this.scrollToParagraph(keepPara);
      this.updateVisibleBlocks();
    }
  }
  // ═══════════════════════════════════════════════════════════════════
  //  面板切换
  // ═══════════════════════════════════════════════════════════════════
  toggleToc() {
    this.isTocOpen = !this.isTocOpen;
    this.tocSidebar.classList.toggle("puffs-hidden", !this.isTocOpen);
  }
  toggleTypography() {
    this.isTypographyOpen = !this.isTypographyOpen;
    this.typographyPanel.classList.toggle("puffs-hidden", !this.isTypographyOpen);
    if (this.isTypographyOpen) {
      this.refreshTypographyPanel();
    }
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
    new import_obsidian2.Setting(containerEl).setName("\u5B57\u4F53\u5927\u5C0F").setDesc("\u9605\u8BFB\u533A\u6587\u5B57\u5927\u5C0F (px)").addSlider(
      (slider) => slider.setLimits(12, 32, 1).setValue(this.plugin.settings.fontSize).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.fontSize = v;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u884C\u95F4\u8DDD").setDesc("\u884C\u95F4\u8DDD\u500D\u6570").addSlider(
      (slider) => slider.setLimits(1, 3, 0.1).setValue(this.plugin.settings.lineHeight).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.lineHeight = v;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u6BB5\u843D\u95F4\u8DDD").setDesc("\u6BB5\u843D\u4E4B\u95F4\u7684\u8DDD\u79BB (px)").addSlider(
      (slider) => slider.setLimits(0, 40, 2).setValue(this.plugin.settings.paragraphSpacing).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.paragraphSpacing = v;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u9996\u884C\u7F29\u8FDB").setDesc("\u6BB5\u843D\u9996\u884C\u7F29\u8FDB (em)").addSlider(
      (slider) => slider.setLimits(0, 4, 0.5).setValue(this.plugin.settings.firstLineIndent).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.firstLineIndent = v;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u9605\u8BFB\u533A\u5BBD\u5EA6").setDesc("\u9605\u8BFB\u533A\u6700\u5927\u5BBD\u5EA6 (px)").addSlider(
      (slider) => slider.setLimits(400, 1400, 50).setValue(this.plugin.settings.contentWidth).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.contentWidth = v;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u5B57\u95F4\u8DDD").setDesc("\u6587\u5B57\u4E4B\u95F4\u7684\u8DDD\u79BB (px)").addSlider(
      (slider) => slider.setLimits(0, 6, 0.5).setValue(this.plugin.settings.letterSpacing).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.letterSpacing = v;
        await this.plugin.savePluginData();
      })
    ).addText(
      (text) => text.setValue(String(this.plugin.settings.letterSpacing)).onChange(async (v) => {
        const n = Number(v);
        if (!Number.isNaN(n)) {
          this.plugin.settings.letterSpacing = n;
          await this.plugin.savePluginData();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u9876\u90E8\u95F4\u8DDD").setDesc("\u6700\u4E0A\u65B9\u6587\u5B57\u4E0E\u9875\u9762\u9876\u90E8\u7684\u8DDD\u79BB (px)").addSlider(
      (slider) => slider.setLimits(0, 160, 4).setValue(this.plugin.settings.paddingTop).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.paddingTop = v;
        await this.plugin.savePluginData();
      })
    ).addText(
      (text) => text.setValue(String(this.plugin.settings.paddingTop)).onChange(async (v) => {
        const n = Number(v);
        if (!Number.isNaN(n)) {
          this.plugin.settings.paddingTop = n;
          await this.plugin.savePluginData();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u5E95\u90E8\u95F4\u8DDD").setDesc("\u6700\u4E0B\u65B9\u6587\u5B57\u4E0E\u9875\u9762\u5E95\u90E8\u7684\u8DDD\u79BB (px)").addSlider(
      (slider) => slider.setLimits(0, 200, 4).setValue(this.plugin.settings.paddingBottom).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.paddingBottom = v;
        await this.plugin.savePluginData();
      })
    ).addText(
      (text) => text.setValue(String(this.plugin.settings.paddingBottom)).onChange(async (v) => {
        const n = Number(v);
        if (!Number.isNaN(n)) {
          this.plugin.settings.paddingBottom = n;
          await this.plugin.savePluginData();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u5B57\u4F53\u989C\u8272").setDesc("RGB \u683C\u5F0F\uFF0C\u5982 51,51,51\u3002\u7559\u7A7A\u8DDF\u968F\u4E3B\u9898\u3002").addText(
      (text) => text.setPlaceholder("\u4F8B\u5982 51,51,51").setValue(this.plugin.settings.fontColor).onChange(async (v) => {
        this.plugin.settings.fontColor = v.trim();
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u80CC\u666F\u989C\u8272").setDesc("RGB \u683C\u5F0F\uFF0C\u5982 233,216,188\u3002\u7559\u7A7A\u8DDF\u968F\u4E3B\u9898\u3002").addText(
      (text) => text.setPlaceholder("\u4F8B\u5982 233,216,188").setValue(this.plugin.settings.backgroundColor).onChange(async (v) => {
        this.plugin.settings.backgroundColor = v.trim();
        await this.plugin.savePluginData();
      })
    );
    containerEl.createEl("h3", { text: "\u529F\u80FD\u5F00\u5173" });
    new import_obsidian2.Setting(containerEl).setName("\u663E\u793A\u9605\u8BFB\u8FDB\u5EA6").setDesc("\u5728\u5E95\u90E8\u72B6\u6001\u680F\u663E\u793A\u9605\u8BFB\u767E\u5206\u6BD4").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showProgress).onChange(async (v) => {
        this.plugin.settings.showProgress = v;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u53BB\u9664\u591A\u4F59\u7A7A\u884C").setDesc("\u81EA\u52A8\u6E05\u7406 TXT \u4E2D\u8FDE\u7EED\u7684\u7A7A\u767D\u884C").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.removeExtraBlankLines).onChange(async (v) => {
        this.plugin.settings.removeExtraBlankLines = v;
        await this.plugin.savePluginData();
      })
    );
    containerEl.createEl("h3", { text: "\u76EE\u5F55\u4E0E\u7F16\u7801" });
    new import_obsidian2.Setting(containerEl).setName("\u76EE\u5F55\u5339\u914D\u6B63\u5219").setDesc("\u7528\u4E8E\u81EA\u52A8\u63D0\u53D6\u7AE0\u8282\u6807\u9898\u7684\u6B63\u5219\u8868\u8FBE\u5F0F").addText(
      (text) => text.setPlaceholder(DEFAULT_SETTINGS.tocRegex).setValue(this.plugin.settings.tocRegex).onChange(async (v) => {
        this.plugin.settings.tocRegex = v.trim();
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u9ED8\u8BA4\u7F16\u7801").setDesc("\u6253\u5F00\u6587\u4EF6\u65F6\u7684\u9ED8\u8BA4\u7F16\u7801\uFF08\u81EA\u52A8\u68C0\u6D4B\u5931\u8D25\u65F6\u4F7F\u7528\uFF09").addDropdown(
      (dd) => dd.addOptions({
        "utf-8": "UTF-8",
        gbk: "GBK",
        gb18030: "GB18030",
        big5: "Big5"
      }).setValue(this.plugin.settings.defaultEncoding).onChange(async (v) => {
        this.plugin.settings.defaultEncoding = v;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u5168\u6587\u641C\u7D22\u5FEB\u6377\u952E").setDesc("\u9ED8\u8BA4 Ctrl+F\u3002\u652F\u6301 Ctrl/Alt/Shift \u52A0\u5355\u4E2A\u6309\u952E\uFF0C\u4F8B\u5982 Ctrl+Shift+F\u3002").addText(
      (text) => text.setPlaceholder(DEFAULT_SETTINGS.searchHotkey).setValue(this.plugin.settings.searchHotkey).onChange(async (v) => {
        this.plugin.settings.searchHotkey = v.trim() || DEFAULT_SETTINGS.searchHotkey;
        await this.plugin.savePluginData();
      })
    );
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
  }
  // ═══════════════════════════ 数据持久化 ═══════════════════════════
  async loadPluginData() {
    var _a;
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data == null ? void 0 : data.settings);
    this.progress = (_a = data == null ? void 0 : data.progress) != null ? _a : {};
  }
  async savePluginData() {
    await this.saveData({
      settings: this.settings,
      progress: this.progress
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
};
