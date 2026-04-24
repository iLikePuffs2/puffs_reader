import { ItemView, WorkspaceLeaf, Menu, TFile, setIcon } from 'obsidian';
import PuffsReaderPlugin from './main';
import {
  Chapter,
  SearchMatch,
  Block,
  SUPPORTED_ENCODINGS,
  BLOCK_SIZE,
  RENDER_BUFFER,
} from './types';

export const READER_VIEW_TYPE = 'puffs-reader-view';

/**
 * Puffs Reader 阅读器核心视图
 *
 * 架构说明
 * ─────────────────────────────
 * - 继承 ItemView（不绑定文件扩展名），通过命令 / 右键菜单手动打开
 * - 文件路径通过 setState / getState 传递
 * - 阅读器背景铺满整个视图区域，工具按钮悬浮在阅读背景右上角
 *
 * 功能清单
 * ─────────────────────────────
 * 1. 独立视图              ItemView + 命令唤出
 * 2. 独立阅读 UI           背景铺满视图、文字可选择复制、不可编辑
 * 3. 编码解析              自动检测 + 手动切换
 * 4. 长文本虚拟滚动        块级懒渲染 / 按需卸载
 * 5. 排版调整              字号 / 行距 / 缩进 / 宽度 / 颜色
 * 6. 进度记忆              段落级定位
 * 7. 翻页 ← / →           按完整可见段落连续翻页
 * 8. 目录解析              正则提取 + 侧边栏
 * 9. 全文搜索              结果卡片 + 跳转 + 返回
 * 10. 阅读进度百分比       页面底部居中显示
 * 11. 去除多余空行         可开关
 */
export class ReaderView extends ItemView {
  plugin: PuffsReaderPlugin;

  // ── 当前文件 ──
  private filePath = '';
  private currentFile: TFile | null = null;

  // ── UI 元素 ──
  private rootEl!: HTMLElement;
  private toolbar!: HTMLElement;
  private tocSidebar!: HTMLElement;
  private tocListEl!: HTMLElement;
  private readingArea!: HTMLElement;
  private scrollContainer!: HTMLElement;
  private contentContainer!: HTMLElement;
  private searchPanel!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchInfo!: HTMLElement;
  private searchResultsEl!: HTMLElement;
  private typographyPanel!: HTMLElement;
  private encodingBtn!: HTMLElement;
  private chapterTitleEl!: HTMLElement;
  private progressTitleEl!: HTMLElement;
  private searchBackBtn!: HTMLElement;

  // ── 数据 ──
  private paragraphs: string[] = [];
  private blocks: Block[] = [];
  private chapters: Chapter[] = [];
  private currentEncoding = 'utf-8';
  private fileBuffer: ArrayBuffer | null = null;

  // ── 搜索 ──
  private searchQuery = '';
  private searchResults: SearchMatch[] = [];
  private currentSearchIdx = -1;
  private searchJumpBackPara: number | null = null;

  // ── UI 状态 ──
  private isTocOpen = false;
  private isSearchOpen = false;
  private isTypographyOpen = false;

  // ── 性能 ──
  private scrollRAF = 0;
  private progressSaveTimer = 0;
  private boundGlobalKeydown: ((e: KeyboardEvent) => void) | null = null;

  // ═══════════════════════════════════════════════════════════════════
  //  生命周期
  // ═══════════════════════════════════════════════════════════════════

  constructor(leaf: WorkspaceLeaf, plugin: PuffsReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return READER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.currentFile?.basename ?? 'Puffs Reader';
  }

  getIcon(): string {
    return 'book-open';
  }

  async onOpen(): Promise<void> {
    this.buildUI();
  }

  async onClose(): Promise<void> {
    this.saveProgressNow();
    cancelAnimationFrame(this.scrollRAF);
    window.clearTimeout(this.progressSaveTimer);
    if (this.boundGlobalKeydown) {
      document.removeEventListener('keydown', this.boundGlobalKeydown, true);
      this.boundGlobalKeydown = null;
    }
  }

  // ── 状态序列化：通过 state.file 传递文件路径 ──

  getState(): Record<string, unknown> {
    return { file: this.filePath };
  }

  async setState(state: Record<string, unknown>, result: Record<string, unknown>): Promise<void> {
    const path = state?.file as string | undefined;
    if (path && path !== this.filePath) {
      this.filePath = path;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        this.currentFile = file;
        // 更新标签页标题
        this.leaf.updateHeader();
        await this.loadContent();
      }
    }
    await super.setState(state, result);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UI 构建
  // ═══════════════════════════════════════════════════════════════════

  private buildUI(): void {
    const ce = this.contentEl;
    ce.empty();
    ce.addClass('puffs-reader-root');

    this.rootEl = ce.createDiv({ cls: 'puffs-reader-wrapper' });

    this.buildToolbar();
    this.buildSearchPanel();
    this.buildTypographyPanel();

    const body = this.rootEl.createDiv({ cls: 'puffs-body' });
    this.buildTocSidebar(body);
    this.buildReadingArea(body);
    this.bindGlobalKeys();
  }

  // ── 顶部工具栏 ──

  private buildToolbar(): void {
    this.toolbar = this.rootEl.createDiv({ cls: 'puffs-toolbar' });

    // 顶部右侧悬浮按钮：目录按钮在设置按钮左侧。
    this.makeToolbarBtn('list', '目录', () => this.toggleToc());
    this.makeToolbarBtn('settings', '排版', () => this.toggleTypography());
  }

  private makeToolbarBtn(icon: string, label: string, onClick: () => void): HTMLElement {
    const btn = this.toolbar.createEl('button', {
      cls: 'puffs-toolbar-btn',
      attr: { 'aria-label': label },
    });
    setIcon(btn, icon);
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ── 搜索面板（默认隐藏） ──

  private buildSearchPanel(): void {
    this.searchPanel = this.rootEl.createDiv({ cls: 'puffs-search-panel puffs-hidden' });

    const header = this.searchPanel.createDiv({ cls: 'puffs-search-header' });
    this.searchInput = this.searchPanel.createEl('input', {
      cls: 'puffs-search-input',
      attr: { type: 'text', placeholder: '在当前书内搜索...' },
    });
    header.appendChild(this.searchInput);
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) this.navigateSearch('prev');
        else this.navigateSearch('next');
      }
      if (e.key === 'Escape') this.toggleSearch();
    });
    this.searchInput.addEventListener('input', () => this.performSearch(this.searchInput.value));

    const prevBtn = this.searchPanel.createEl('button', {
      cls: 'puffs-toolbar-btn',
      attr: { 'aria-label': '上一个' },
    });
    setIcon(prevBtn, 'chevron-up');
    prevBtn.addEventListener('click', () => this.navigateSearch('prev'));
    header.appendChild(prevBtn);

    const nextBtn = this.searchPanel.createEl('button', {
      cls: 'puffs-toolbar-btn',
      attr: { 'aria-label': '下一个' },
    });
    setIcon(nextBtn, 'chevron-down');
    nextBtn.addEventListener('click', () => this.navigateSearch('next'));
    header.appendChild(nextBtn);

    this.searchInfo = this.searchPanel.createSpan({ cls: 'puffs-search-info' });
    header.appendChild(this.searchInfo);

    const closeBtn = this.searchPanel.createEl('button', {
      cls: 'puffs-toolbar-btn',
      attr: { 'aria-label': '关闭' },
    });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', () => this.toggleSearch());
    header.appendChild(closeBtn);

    this.searchResultsEl = this.searchPanel.createDiv({ cls: 'puffs-search-results' });
  }

  // ── 排版面板（默认隐藏） ──

  private buildTypographyPanel(): void {
    this.typographyPanel = this.rootEl.createDiv({ cls: 'puffs-typo-panel puffs-hidden' });
    this.refreshTypographyPanel();
  }

  private refreshTypographyPanel(): void {
    const p = this.typographyPanel;
    p.empty();
    const s = this.plugin.settings;

    const title = p.createDiv({ cls: 'puffs-typo-title' });
    title.createSpan({ text: '排版设置' });
    this.encodingBtn = title.createEl('button', {
      cls: 'puffs-toolbar-btn puffs-encoding-btn',
      text: this.currentEncoding.toUpperCase(),
      attr: { 'aria-label': '切换编码' },
    });
    this.encodingBtn.addEventListener('click', (e) => this.showEncodingMenu(e));

    this.addSliderRow(p, '字体大小', s.fontSize, 12, 32, 1, 'px', (v) => {
      this.plugin.settings.fontSize = v;
      this.applyTypography();
    });
    this.addSliderRow(p, '行间距', s.lineHeight, 1, 3, 0.1, 'x', (v) => {
      this.plugin.settings.lineHeight = v;
      this.applyTypography();
    });
    this.addSliderRow(p, '段落间距', s.paragraphSpacing, 0, 40, 2, 'px', (v) => {
      this.plugin.settings.paragraphSpacing = v;
      this.applyTypography();
    });
    this.addSliderRow(p, '首行缩进', s.firstLineIndent, 0, 4, 0.5, 'em', (v) => {
      this.plugin.settings.firstLineIndent = v;
      this.applyTypography();
    });
    this.addSliderRow(p, '阅读区宽度', s.contentWidth, 400, 1400, 50, 'px', (v) => {
      this.plugin.settings.contentWidth = v;
      this.applyTypography();
    });
    this.addSliderRow(p, '字间距', s.letterSpacing, 0, 6, 0.5, 'px', (v) => {
      this.plugin.settings.letterSpacing = v;
      this.applyTypography();
    });
    this.addSliderRow(p, '顶部间距', s.paddingTop, 0, 160, 4, 'px', (v) => {
      this.plugin.settings.paddingTop = v;
      this.applyTypography();
    });
    this.addSliderRow(p, '底部间距', s.paddingBottom, 0, 200, 4, 'px', (v) => {
      this.plugin.settings.paddingBottom = v;
      this.applyTypography();
    });

    this.addColorRow(p, '字体颜色', s.fontColor, (v) => {
      this.plugin.settings.fontColor = v;
      this.applyTypography();
    });
    this.addColorRow(p, '背景颜色', s.backgroundColor, (v) => {
      this.plugin.settings.backgroundColor = v;
      this.applyTypography();
    });

    this.addToggleRow(p, '显示进度', s.showProgress, (v) => {
      this.plugin.settings.showProgress = v;
      this.updateStatusBar();
    });
    this.addToggleRow(p, '去除空行', s.removeExtraBlankLines, (v) => {
      this.plugin.settings.removeExtraBlankLines = v;
      this.loadContent();
    });

    this.addTextRow(p, '目录正则', s.tocRegex, (v) => {
      this.plugin.settings.tocRegex = v;
      this.parseChapters();
      this.buildTocList();
    });

    // 恢复默认按钮
    const resetBtn = p.createEl('button', { cls: 'puffs-typo-reset', text: '恢复默认' });
    resetBtn.addEventListener('click', async () => {
      Object.assign(this.plugin.settings, {
        fontSize: 18,
        lineHeight: 1.8,
        paragraphSpacing: 10,
        firstLineIndent: 2,
        contentWidth: 800,
        letterSpacing: 0,
        paddingTop: 40,
        paddingBottom: 40,
        fontColor: '',
        backgroundColor: '',
      });
      await this.plugin.savePluginData();
      this.refreshTypographyPanel();
      this.applyTypography();
    });
  }

  // ── 辅助: 面板行 ──

  private addSliderRow(
    parent: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    unit: string,
    onChange: (v: number) => void,
  ): void {
    const row = parent.createDiv({ cls: 'puffs-typo-row' });
    row.createSpan({ cls: 'puffs-typo-label', text: label });
    const valSpan = row.createSpan({ cls: 'puffs-typo-value', text: `${value}${unit}` });
    const numberInput = row.createEl('input', {
      cls: 'puffs-typo-number',
      attr: { type: 'number', min: String(min), max: String(max), step: String(step) },
    }) as HTMLInputElement;
    numberInput.value = String(value);
    const slider = row.createEl('input', {
      cls: 'puffs-typo-slider',
      attr: { type: 'range', min: String(min), max: String(max), step: String(step) },
    }) as HTMLInputElement;
    slider.value = String(value);

    const updateValue = (v: number): void => {
      if (Number.isNaN(v)) return;
      const clamped = Math.min(max, Math.max(min, v));
      slider.value = String(clamped);
      numberInput.value = String(clamped);
      valSpan.textContent = `${clamped}${unit}`;
      onChange(clamped);
    };

    slider.addEventListener('input', () => {
      updateValue(parseFloat(slider.value));
    });
    numberInput.addEventListener('change', () => {
      updateValue(parseFloat(numberInput.value));
      this.plugin.savePluginData();
    });
    slider.addEventListener('change', () => {
      this.plugin.savePluginData();
    });
  }

  private addColorRow(
    parent: HTMLElement,
    label: string,
    value: string,
    onChange: (v: string) => void,
  ): void {
    const row = parent.createDiv({ cls: 'puffs-typo-row' });
    row.createSpan({ cls: 'puffs-typo-label', text: label });
    const input = row.createEl('input', {
      cls: 'puffs-typo-color-input',
      attr: { type: 'text', placeholder: 'R,G,B 或留空' },
    }) as HTMLInputElement;
    input.value = value;
    input.addEventListener('input', () => onChange(input.value.trim()));
    input.addEventListener('change', () => {
      this.plugin.savePluginData();
    });
  }

  private addToggleRow(
    parent: HTMLElement,
    label: string,
    value: boolean,
    onChange: (v: boolean) => void,
  ): void {
    const row = parent.createDiv({ cls: 'puffs-typo-row puffs-typo-toggle-row' });
    const lbl = row.createEl('label', { cls: 'puffs-typo-toggle-label' });
    const cb = lbl.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
    cb.checked = value;
    lbl.appendText(` ${label}`);
    cb.addEventListener('change', () => {
      onChange(cb.checked);
      this.plugin.savePluginData();
    });
  }

  private addTextRow(
    parent: HTMLElement,
    label: string,
    value: string,
    onChange: (v: string) => void,
  ): void {
    const row = parent.createDiv({ cls: 'puffs-typo-row' });
    row.createSpan({ cls: 'puffs-typo-label', text: label });
    const input = row.createEl('input', {
      cls: 'puffs-typo-text-input',
      attr: { type: 'text' },
    }) as HTMLInputElement;
    input.value = value;
    input.addEventListener('change', () => onChange(input.value.trim()));
  }

  // ── 目录侧边栏 ──

  private buildTocSidebar(parent: HTMLElement): void {
    this.tocSidebar = parent.createDiv({ cls: 'puffs-toc-sidebar puffs-hidden' });
    const header = this.tocSidebar.createDiv({ cls: 'puffs-toc-header' });
    header.createSpan({ text: '目录' });
    const searchBtn = header.createEl('button', {
      cls: 'puffs-toolbar-btn puffs-toc-search-btn',
      attr: { 'aria-label': '全文搜索' },
    });
    setIcon(searchBtn, 'search');
    searchBtn.addEventListener('click', () => this.toggleSearch(true));
    this.tocListEl = this.tocSidebar.createDiv({ cls: 'puffs-toc-list' });
  }

  // ── 阅读区 ──

  private buildReadingArea(parent: HTMLElement): void {
    this.readingArea = parent.createDiv({ cls: 'puffs-reading-area' });
    this.chapterTitleEl = this.readingArea.createDiv({ cls: 'puffs-page-chapter' });
    this.progressTitleEl = this.readingArea.createDiv({ cls: 'puffs-page-progress' });
    this.searchBackBtn = this.readingArea.createEl('button', {
      cls: 'puffs-search-back puffs-hidden',
      text: '返回',
      attr: { 'aria-label': '返回搜索前位置' },
    });
    this.searchBackBtn.addEventListener('click', () => this.returnFromSearchJump());
    this.scrollContainer = this.readingArea.createDiv({ cls: 'puffs-scroll-container' });
    this.scrollContainer.tabIndex = 0; // 支持键盘事件

    this.contentContainer = this.scrollContainer.createDiv({ cls: 'puffs-content' });

    // 滚动 → 更新可视块 + 进度
    this.scrollContainer.addEventListener('scroll', () => this.onScroll());

    // 键盘事件（翻页 + ESC 关闭阅读器内面板）
    this.scrollContainer.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  // ═══════════════════════════════════════════════════════════════════
  //  编码检测 & 文件加载
  // ═══════════════════════════════════════════════════════════════════

  private async loadContent(): Promise<void> {
    if (!this.currentFile) return;

    // 读取二进制
    this.fileBuffer = await this.app.vault.readBinary(this.currentFile);

    // 检查是否有用户指定编码
    const saved = this.plugin.getProgress(this.currentFile.path);
    const forcedEncoding = saved?.encoding;

    const { text, encoding } = this.decodeBuffer(this.fileBuffer, forcedEncoding);
    this.currentEncoding = encoding;

    // 更新编码指示
    this.encodingBtn.textContent = encoding.toUpperCase();

    // 处理文本 → 段落
    this.paragraphs = this.processText(text);

    // 解析章节
    this.parseChapters();
    this.buildTocList();

    // 构建虚拟滚动块
    this.buildBlocks();

    // 应用排版
    this.applyTypography();

    // 渲染初始可视区域
    this.renderInitialBlocks();

    // 恢复阅读进度
    this.restoreProgress();

    // 聚焦以启用键盘操作
    this.scrollContainer.focus();
  }

  /** 解码 ArrayBuffer，支持自动检测和手动指定 */
  private decodeBuffer(
    buffer: ArrayBuffer,
    forceEncoding?: string,
  ): { text: string; encoding: string } {
    if (forceEncoding) {
      try {
        const text = new TextDecoder(forceEncoding, { fatal: false }).decode(buffer);
        return { text, encoding: forceEncoding };
      } catch {
        // fallthrough
      }
    }

    const bytes = new Uint8Array(buffer);

    // BOM 检测
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { text: new TextDecoder('utf-8').decode(buffer), encoding: 'utf-8' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { text: new TextDecoder('utf-16le').decode(buffer), encoding: 'utf-16le' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { text: new TextDecoder('utf-16be').decode(buffer), encoding: 'utf-16be' };
    }

    // 尝试严格 UTF-8
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      return { text, encoding: 'utf-8' };
    } catch {
      // 非法 UTF-8，尝试中文编码
    }

    // 尝试 GBK
    try {
      const text = new TextDecoder('gbk').decode(buffer);
      return { text, encoding: 'gbk' };
    } catch {
      // fallthrough
    }

    // 最终回退
    const fallback = this.plugin.settings.defaultEncoding;
    return {
      text: new TextDecoder(fallback, { fatal: false }).decode(buffer),
      encoding: fallback,
    };
  }

  /** 手动切换编码 */
  private switchEncoding(encoding: string): void {
    if (!this.fileBuffer || !this.currentFile) return;

    const { text } = this.decodeBuffer(this.fileBuffer, encoding);
    this.currentEncoding = encoding;
    this.encodingBtn.textContent = encoding.toUpperCase();

    // 保存用户选择
    const progress = this.plugin.getProgress(this.currentFile.path);
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: progress?.paragraphIndex ?? 0,
      lastRead: Date.now(),
      encoding,
    });

    // 重新处理
    this.paragraphs = this.processText(text);
    this.parseChapters();
    this.buildTocList();
    this.buildBlocks();
    this.renderInitialBlocks();
    this.applyTypography();
  }

  private showEncodingMenu(e: MouseEvent): void {
    const menu = new Menu();
    for (const enc of SUPPORTED_ENCODINGS) {
      menu.addItem((item) =>
        item
          .setTitle(enc.label)
          .setChecked(this.currentEncoding === enc.value)
          .onClick(() => this.switchEncoding(enc.value)),
      );
    }
    menu.showAtMouseEvent(e);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  文本处理
  // ═══════════════════════════════════════════════════════════════════

  /** 原始文本 → 段落数组 */
  private processText(text: string): string[] {
    let lines = text.split(/\r?\n/);

    if (this.plugin.settings.removeExtraBlankLines) {
      lines = this.collapseBlankLines(lines);
    }

    // 过滤尾部空段落
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }

    return lines;
  }

  /** 连续空行压缩为最多一行 */
  private collapseBlankLines(lines: string[]): string[] {
    const result: string[] = [];
    let lastBlank = false;
    for (const line of lines) {
      const isBlank = line.trim() === '';
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
  private buildBlocks(): void {
    this.contentContainer.empty();
    this.blocks = [];
    const total = this.paragraphs.length;
    const s = this.plugin.settings;
    const estParaHeight = s.fontSize * s.lineHeight + s.paragraphSpacing;

    for (let i = 0; i < total; i += BLOCK_SIZE) {
      const end = Math.min(i + BLOCK_SIZE, total);
      const el = this.contentContainer.createDiv({ cls: 'puffs-block' });
      el.dataset.blockIndex = String(this.blocks.length);

      const block: Block = {
        element: el,
        startPara: i,
        endPara: end,
        rendered: false,
        measuredHeight: -1,
      };

      // 占位高度
      const count = end - i;
      el.style.height = `${count * estParaHeight}px`;

      this.blocks.push(block);
    }
  }

  /** 首次加载：渲染前 N 块 */
  private renderInitialBlocks(): void {
    const count = Math.min(this.blocks.length, RENDER_BUFFER + 1);
    for (let i = 0; i < count; i++) {
      this.renderBlock(i);
    }
  }

  /** 渲染指定块的段落内容 */
  private renderBlock(idx: number): void {
    if (idx < 0 || idx >= this.blocks.length) return;
    const block = this.blocks[idx];
    if (block.rendered) return;

    block.element.empty();
    block.element.style.height = ''; // 清除占位

    for (let p = block.startPara; p < block.endPara; p++) {
      const text = this.paragraphs[p];
      const el = this.createParagraphEl(text, p);
      block.element.appendChild(el);
    }

    block.rendered = true;
    block.measuredHeight = block.element.offsetHeight;
  }

  /** 卸载指定块（用测量高度占位） */
  private unrenderBlock(idx: number): void {
    if (idx < 0 || idx >= this.blocks.length) return;
    const block = this.blocks[idx];
    if (!block.rendered) return;

    // 保存实际高度
    block.measuredHeight = block.element.offsetHeight;
    block.element.empty();
    block.element.style.height = `${block.measuredHeight}px`;
    block.rendered = false;
  }

  /** 创建单个段落 DOM 元素 */
  private createParagraphEl(text: string, paraIndex: number): HTMLElement {
    const p = document.createElement('p');
    p.className = 'puffs-para';
    p.dataset.paraIndex = String(paraIndex);

    const trimmed = text.trim();
    if (trimmed === '') {
      p.classList.add('puffs-para-blank');
      p.innerHTML = '&nbsp;';
      return p;
    }

    // 搜索高亮
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
  private onScroll(): void {
    cancelAnimationFrame(this.scrollRAF);
    this.scrollRAF = requestAnimationFrame(() => {
      this.updateVisibleBlocks();
      this.updateProgress();
      this.scheduleProgressSave();
    });
  }

  /** 根据滚动位置决定渲染/卸载哪些块 */
  private updateVisibleBlocks(): void {
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
  private getBlockAtPosition(pos: number): number {
    let accum = 0;
    const s = this.plugin.settings;
    const estH = BLOCK_SIZE * (s.fontSize * s.lineHeight + s.paragraphSpacing);

    for (let i = 0; i < this.blocks.length; i++) {
      const h = this.blocks[i].rendered
        ? this.blocks[i].element.offsetHeight
        : this.blocks[i].measuredHeight > 0
          ? this.blocks[i].measuredHeight
          : estH;
      if (accum + h > pos) return i;
      accum += h;
    }
    return this.blocks.length - 1;
  }

  /** 滚动到指定段落 */
  private scrollToParagraph(paraIndex: number): void {
    const blockIdx = Math.floor(paraIndex / BLOCK_SIZE);

    // 确保目标块及附近已渲染
    for (
      let i = Math.max(0, blockIdx - 1);
      i <= Math.min(this.blocks.length - 1, blockIdx + 1);
      i++
    ) {
      this.renderBlock(i);
    }

    // 等待浏览器布局完成后定位
    requestAnimationFrame(() => {
      const el = this.contentContainer.querySelector(
        `[data-para-index="${paraIndex}"]`,
      ) as HTMLElement;
      if (el) {
        el.scrollIntoView({ block: 'start' });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  目录解析 (TOC)
  // ═══════════════════════════════════════════════════════════════════

  private parseChapters(): void {
    this.chapters = [];
    const pattern = this.plugin.settings.tocRegex;
    if (!pattern) return;

    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      return; // 无效正则，静默忽略
    }

    for (let i = 0; i < this.paragraphs.length; i++) {
      const line = this.paragraphs[i].trim();
      if (line && regex.test(line)) {
        this.chapters.push({
          title: line,
          startParaIndex: i,
          level: 1,
        });
      }
    }
  }

  private buildTocList(): void {
    if (!this.tocListEl) return;
    this.tocListEl.empty();

    if (this.chapters.length === 0) {
      this.tocListEl.createDiv({ cls: 'puffs-toc-empty', text: '未检测到章节' });
      return;
    }

    for (let ci = 0; ci < this.chapters.length; ci++) {
      const ch = this.chapters[ci];
      const item = this.tocListEl.createDiv({ cls: 'puffs-toc-item' });
      item.textContent = ch.title;
      item.dataset.chapterIndex = String(ci);
      item.addEventListener('click', () => this.jumpToChapter(ci));
    }
  }

  private jumpToChapter(chapterIndex: number): void {
    const ch = this.chapters[chapterIndex];
    if (!ch) return;
    this.scrollToParagraph(ch.startParaIndex);
    this.highlightCurrentTocItem(chapterIndex);
  }

  /** 根据当前滚动位置更新 TOC 高亮 */
  private updateCurrentChapter(): void {
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
      this.chapterTitleEl.textContent = this.chapters[activeIdx]?.title ?? '';
    }
  }

  private highlightCurrentTocItem(idx: number): void {
    this.tocListEl.querySelectorAll('.puffs-toc-item').forEach((el, i) => {
      el.classList.toggle('puffs-toc-active', i === idx);
    });
    // 自动滚动 TOC 到当前章节
    const active = this.tocListEl.querySelector('.puffs-toc-active') as HTMLElement;
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  全文搜索
  // ═══════════════════════════════════════════════════════════════════

  private toggleSearch(forceOpen?: boolean): void {
    this.isSearchOpen = forceOpen ?? !this.isSearchOpen;
    this.searchPanel.classList.toggle('puffs-hidden', !this.isSearchOpen);
    if (this.isSearchOpen) {
      this.searchInput.focus();
      this.searchInput.select();
    } else {
      this.clearSearch();
    }
  }

  /** 执行搜索：遍历段落数组而非 DOM */
  private performSearch(query: string): void {
    this.searchQuery = query;
    this.searchResults = [];
    this.currentSearchIdx = -1;

    if (!query) {
      this.searchInfo.textContent = '';
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
          length: lowerQ.length,
        });
        pos = idx + 1;
      }
    }

    this.searchInfo.textContent =
      this.searchResults.length > 0 ? `${this.searchResults.length} 个结果` : '无结果';

    // 刷新已渲染块以显示高亮
    this.refreshRenderedBlocks();
    this.renderSearchResultCards();
  }

  private navigateSearch(dir: 'next' | 'prev'): void {
    if (this.searchResults.length === 0) return;
    if (dir === 'next') {
      this.currentSearchIdx = (this.currentSearchIdx + 1) % this.searchResults.length;
    } else {
      this.currentSearchIdx =
        (this.currentSearchIdx - 1 + this.searchResults.length) % this.searchResults.length;
    }
    const match = this.searchResults[this.currentSearchIdx];
    this.searchInfo.textContent = `${this.currentSearchIdx + 1}/${this.searchResults.length}`;
    this.jumpToSearchMatch(match, false);

    // 高亮当前搜索结果
    requestAnimationFrame(() => {
      this.contentContainer
        .querySelectorAll('.puffs-search-current')
        .forEach((el) => el.classList.remove('puffs-search-current'));
      const paraEl = this.contentContainer.querySelector(
        `[data-para-index="${match.paraIndex}"]`,
      );
      if (paraEl) {
        const highlights = paraEl.querySelectorAll('.puffs-search-hl');
        let count = 0;
        for (const m of this.searchResults) {
          if (m.paraIndex === match.paraIndex) {
            if (m === match) {
              const hlEl = highlights[count];
              if (hlEl) hlEl.classList.add('puffs-search-current');
              break;
            }
            count++;
          }
        }
      }
    });
  }

  private clearSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
    this.currentSearchIdx = -1;
    this.searchInput.value = '';
    this.searchInfo.textContent = '';
    this.searchResultsEl.empty();
    this.refreshRenderedBlocks();
  }

  /** 搜索结果以卡片形式列出，点击卡片后跳转到原文位置。 */
  private renderSearchResultCards(): void {
    this.searchResultsEl.empty();
    if (!this.searchQuery) return;
    if (this.searchResults.length === 0) {
      this.searchResultsEl.createDiv({ cls: 'puffs-search-empty', text: '没有找到匹配内容' });
      return;
    }

    const maxCards = Math.min(this.searchResults.length, 200);
    for (let i = 0; i < maxCards; i++) {
      const match = this.searchResults[i];
      const card = this.searchResultsEl.createDiv({ cls: 'puffs-search-card' });
      card.dataset.searchIndex = String(i);
      const chapter = this.getChapterTitleForPara(match.paraIndex);
      card.createDiv({ cls: 'puffs-search-card-title', text: chapter || `第 ${match.paraIndex + 1} 段` });
      const preview = card.createDiv({ cls: 'puffs-search-card-preview' });
      preview.innerHTML = this.buildSearchPreview(match);
      card.addEventListener('click', () => {
        this.currentSearchIdx = i;
        this.searchInfo.textContent = `${i + 1}/${this.searchResults.length}`;
        this.jumpToSearchMatch(match, true);
      });
    }

    if (this.searchResults.length > maxCards) {
      this.searchResultsEl.createDiv({
        cls: 'puffs-search-more',
        text: `仅显示前 ${maxCards} 个结果，请输入更精确的关键词`,
      });
    }
  }

  private jumpToSearchMatch(match: SearchMatch, rememberBack: boolean): void {
    if (rememberBack) {
      this.searchJumpBackPara = this.getCurrentParagraphIndex();
      this.searchBackBtn.classList.remove('puffs-hidden');
    }
    this.scrollToParagraph(match.paraIndex);
    this.highlightCurrentSearchResult(match);
  }

  private returnFromSearchJump(): void {
    if (this.searchJumpBackPara === null) return;
    const backPara = this.searchJumpBackPara;
    this.searchJumpBackPara = null;
    this.searchBackBtn.classList.add('puffs-hidden');
    this.scrollToParagraph(backPara);
  }

  private getChapterTitleForPara(paraIndex: number): string {
    let title = '';
    for (const ch of this.chapters) {
      if (ch.startParaIndex <= paraIndex) title = ch.title;
      else break;
    }
    return title;
  }

  private buildSearchPreview(match: SearchMatch): string {
    const raw = this.paragraphs[match.paraIndex].trim();
    const radius = 48;
    const start = Math.max(0, match.startOffset - radius);
    const end = Math.min(raw.length, match.startOffset + match.length + radius);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < raw.length ? '...' : '';
    const visibleStart = match.startOffset - start;
    const visibleEnd = visibleStart + match.length;
    const visible = raw.slice(start, end);
    return `${prefix}${this.escapeHTML(visible.slice(0, visibleStart))}<mark>${this.escapeHTML(visible.slice(visibleStart, visibleEnd))}</mark>${this.escapeHTML(visible.slice(visibleEnd))}${suffix}`;
  }

  private highlightCurrentSearchResult(match: SearchMatch): void {
    requestAnimationFrame(() => {
      this.contentContainer
        .querySelectorAll('.puffs-search-current')
        .forEach((el) => el.classList.remove('puffs-search-current'));
      const paraEl = this.contentContainer.querySelector(
        `[data-para-index="${match.paraIndex}"]`,
      );
      if (!paraEl) return;
      const highlights = paraEl.querySelectorAll('.puffs-search-hl');
      let count = 0;
      for (const m of this.searchResults) {
        if (m.paraIndex === match.paraIndex) {
          if (m === match) {
            const hlEl = highlights[count];
            if (hlEl) hlEl.classList.add('puffs-search-current');
            break;
          }
          count++;
        }
      }
    });
  }

  /** 重新渲染所有已渲染块（用于搜索高亮更新） */
  private refreshRenderedBlocks(): void {
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
  private buildHighlightedHTML(text: string, matches: SearchMatch[]): string {
    const sorted = [...matches].sort((a, b) => a.startOffset - b.startOffset);
    let result = '';
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

  private escapeHTML(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ═══════════════════════════════════════════════════════════════════
  //  翻页 & 键盘
  // ═══════════════════════════════════════════════════════════════════

  private bindGlobalKeys(): void {
    if (this.boundGlobalKeydown) return;
    this.boundGlobalKeydown = (e: KeyboardEvent) => {
      if (!this.contentEl.isConnected) return;
      if (this.matchesSearchHotkey(e)) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleSearch(true);
      }
    };
    document.addEventListener('keydown', this.boundGlobalKeydown, true);
  }

  private matchesSearchHotkey(e: KeyboardEvent): boolean {
    const raw = this.plugin.settings.searchHotkey || 'Ctrl+F';
    const parts = raw
      .split('+')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    const key = parts.find((p) => !['ctrl', 'control', 'cmd', 'meta', 'alt', 'shift'].includes(p));
    if (!key) return false;
    const wantsCtrl = parts.includes('ctrl') || parts.includes('control');
    const wantsMeta = parts.includes('cmd') || parts.includes('meta');
    const wantsAlt = parts.includes('alt');
    const wantsShift = parts.includes('shift');
    return (
      e.key.toLowerCase() === key &&
      e.ctrlKey === wantsCtrl &&
      e.metaKey === wantsMeta &&
      e.altKey === wantsAlt &&
      e.shiftKey === wantsShift
    );
  }

  private handleKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        this.pageDown();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.pageUp();
        break;
      case 'Escape':
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

  private pageDown(): void {
    const lastVisible = this.getLastFullyVisibleParagraphIndex();
    const target = Math.min(this.paragraphs.length - 1, lastVisible + 1);
    this.scrollToParagraph(target);
  }

  private pageUp(): void {
    const firstVisible = this.getCurrentParagraphIndex();
    const visibleCount = Math.max(1, this.getVisibleParagraphIndexes().length);
    const target = Math.max(0, firstVisible - visibleCount);
    this.scrollToParagraph(target);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  阅读进度
  // ═══════════════════════════════════════════════════════════════════

  /** 获取当前可视区域中第一个可见段落的索引 */
  private getCurrentParagraphIndex(): number {
    const visible = this.getVisibleParagraphIndexes();
    if (visible.length > 0) return visible[0];
    const blockIdx = this.getBlockAtPosition(this.scrollContainer.scrollTop);
    return this.blocks[blockIdx]?.startPara ?? 0;
  }

  /** 获取当前视口内完整可见的段落索引，用于无断裂翻页。 */
  private getVisibleParagraphIndexes(): number[] {
    this.updateVisibleBlocks();
    const containerRect = this.scrollContainer.getBoundingClientRect();
    const topLimit = containerRect.top + 1;
    const bottomLimit = containerRect.bottom - 1;
    const result: number[] = [];

    this.contentContainer.querySelectorAll('.puffs-para').forEach((p) => {
      const el = p as HTMLElement;
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= topLimit || rect.top >= bottomLimit) return;
      if (rect.top >= topLimit && rect.bottom <= bottomLimit) {
        result.push(parseInt(el.dataset.paraIndex ?? '0', 10));
      }
    });

    return result.sort((a, b) => a - b);
  }

  private getLastFullyVisibleParagraphIndex(): number {
    const visible = this.getVisibleParagraphIndexes();
    if (visible.length > 0) return visible[visible.length - 1];
    return this.getCurrentParagraphIndex();
  }

  private updateProgress(): void {
    const total = this.paragraphs.length;
    if (total === 0) return;

    const curPara = this.getCurrentParagraphIndex();
    const pct = ((curPara / total) * 100).toFixed(1);

    this.updateCurrentChapter();
    this.updateStatusBar(pct);
  }

  private updateStatusBar(pct?: string): void {
    if (this.progressTitleEl) {
      if (this.plugin.settings.showProgress && pct !== undefined) {
        this.progressTitleEl.textContent = `${pct}%`;
        this.progressTitleEl.classList.remove('puffs-hidden');
      } else if (!this.plugin.settings.showProgress) {
        this.progressTitleEl.classList.add('puffs-hidden');
      }
    }
  }

  /** 延迟保存进度，避免频繁写入 */
  private scheduleProgressSave(): void {
    window.clearTimeout(this.progressSaveTimer);
    this.progressSaveTimer = window.setTimeout(() => this.saveProgressNow(), 2000);
  }

  private saveProgressNow(): void {
    if (!this.currentFile || this.paragraphs.length === 0) return;
    const paraIdx = this.getCurrentParagraphIndex();
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: paraIdx,
      lastRead: Date.now(),
      encoding: this.currentEncoding !== 'utf-8' ? this.currentEncoding : undefined,
    });
  }

  /** 恢复上次阅读位置 */
  private restoreProgress(): void {
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

  private applyTypography(): void {
    const s = this.plugin.settings;
    const style = this.contentContainer.style;
    const keepPara = this.blocks.length > 0 ? this.getCurrentParagraphIndex() : 0;

    style.setProperty('--puffs-font-size', `${s.fontSize}px`);
    style.setProperty('--puffs-line-height', `${s.lineHeight}`);
    style.setProperty('--puffs-para-spacing', `${s.paragraphSpacing}px`);
    style.setProperty('--puffs-indent', `${s.firstLineIndent}em`);
    style.setProperty('--puffs-content-width', `${s.contentWidth}px`);
    style.setProperty('--puffs-letter-spacing', `${s.letterSpacing}px`);
    style.setProperty('--puffs-padding-top', `${s.paddingTop}px`);
    style.setProperty('--puffs-padding-bottom', `${s.paddingBottom}px`);

    if (s.fontColor) {
      style.setProperty('--puffs-font-color', `rgb(${s.fontColor})`);
    } else {
      style.removeProperty('--puffs-font-color');
    }

    if (s.backgroundColor) {
      this.readingArea.style.setProperty('--puffs-bg-color', `rgb(${s.backgroundColor})`);
      this.rootEl.style.setProperty('--puffs-bg-color', `rgb(${s.backgroundColor})`);
    } else {
      this.readingArea.style.removeProperty('--puffs-bg-color');
      this.rootEl.style.removeProperty('--puffs-bg-color');
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

  private toggleToc(): void {
    this.isTocOpen = !this.isTocOpen;
    this.tocSidebar.classList.toggle('puffs-hidden', !this.isTocOpen);
  }

  private toggleTypography(): void {
    this.isTypographyOpen = !this.isTypographyOpen;
    this.typographyPanel.classList.toggle('puffs-hidden', !this.isTypographyOpen);
    if (this.isTypographyOpen) {
      this.refreshTypographyPanel();
    }
  }
}
