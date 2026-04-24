import { ItemView, WorkspaceLeaf, Menu, TFile, setIcon } from 'obsidian';
import PuffsReaderPlugin from './main';
import { Chapter, SearchMatch, SUPPORTED_ENCODINGS } from './types';

export const READER_VIEW_TYPE = 'puffs-reader-view';

interface ReaderPosition {
  paraIndex: number;
  charOffset: number;
}

/**
 * Puffs Reader 阅读器核心视图
 *
 * 这版不再依赖滚动条模拟翻页，而是只渲染当前页可见内容：
 * - 页首位置用「段落索引 + 字符偏移」记录，搜索返回和进度恢复会更精确。
 * - 翻页时通过真实 DOM 测量找到最后一条完整可见行，下一页从它之后继续。
 * - 搜索面板和目录共用同一个左侧栏，避免额外浮层干扰阅读区域。
 */
export class ReaderView extends ItemView {
  plugin: PuffsReaderPlugin;

  private filePath = '';
  private currentFile: TFile | null = null;
  private fileBuffer: ArrayBuffer | null = null;
  private currentEncoding = 'utf-8';

  private rootEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private tocSidebar!: HTMLElement;
  private tocTitleEl!: HTMLElement;
  private tocListEl!: HTMLElement;
  private searchPaneEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchInfoEl!: HTMLElement;
  private searchResultsEl!: HTMLElement;
  private readingArea!: HTMLElement;
  private contentContainer!: HTMLElement;
  private floatingControls!: HTMLElement;
  private typographyPanel!: HTMLElement;
  private encodingBtn!: HTMLElement;
  private chapterTitleEl!: HTMLElement;
  private progressTitleEl!: HTMLElement;
  private searchBackBtn!: HTMLElement;

  private paragraphs: string[] = [];
  private chapters: Chapter[] = [];
  private searchQuery = '';
  private searchResults: SearchMatch[] = [];

  private currentPageStart: ReaderPosition = { paraIndex: 0, charOffset: 0 };
  private currentPageEnd: ReaderPosition = { paraIndex: 0, charOffset: 0 };
  private pageBackStack: ReaderPosition[] = [];
  private searchJumpBackPos: ReaderPosition | null = null;

  private isTocOpen = false;
  private isSearchMode = false;
  private isTypographyOpen = false;
  private isRenderingPage = false;

  private progressSaveTimer = 0;
  private searchTimer = 0;
  private resizeObserver: ResizeObserver | null = null;
  private boundGlobalKeydown: ((e: KeyboardEvent) => void) | null = null;

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
    window.clearTimeout(this.progressSaveTimer);
    window.clearTimeout(this.searchTimer);
    this.resizeObserver?.disconnect();
    if (this.boundGlobalKeydown) {
      document.removeEventListener('keydown', this.boundGlobalKeydown, true);
      window.removeEventListener('keydown', this.boundGlobalKeydown, true);
      this.boundGlobalKeydown = null;
    }
  }

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
        this.leaf.updateHeader();
        await this.loadContent();
      }
    }
    await super.setState(state, result);
  }

  /** 供插件命令调用，打开当前阅读器的全文搜索。 */
  openSearch(): void {
    this.openSidebar('search');
  }

  private buildUI(): void {
    const ce = this.contentEl;
    ce.empty();
    ce.addClass('puffs-reader-root');

    this.rootEl = ce.createDiv({ cls: 'puffs-reader-wrapper' });
    this.bodyEl = this.rootEl.createDiv({ cls: 'puffs-body' });

    this.buildTocSidebar();
    this.buildReadingArea();
    this.buildTypographyPanel();
    this.bindGlobalKeys();
  }

  private buildTocSidebar(): void {
    this.tocSidebar = this.bodyEl.createDiv({ cls: 'puffs-toc-sidebar puffs-hidden' });

    const header = this.tocSidebar.createDiv({ cls: 'puffs-toc-header' });
    this.tocTitleEl = header.createSpan({ text: '目录' });
    const searchBtn = header.createEl('button', {
      cls: 'puffs-icon-btn puffs-toc-search-btn',
      attr: { 'aria-label': '全文搜索' },
    });
    setIcon(searchBtn, 'search');
    searchBtn.addEventListener('click', () => this.toggleSearchMode());

    this.tocListEl = this.tocSidebar.createDiv({ cls: 'puffs-toc-list' });

    this.searchPaneEl = this.tocSidebar.createDiv({ cls: 'puffs-sidebar-search puffs-hidden' });
    const searchHeader = this.searchPaneEl.createDiv({ cls: 'puffs-search-header' });
    this.searchInput = searchHeader.createEl('input', {
      cls: 'puffs-search-input',
      attr: { type: 'text', placeholder: '搜索当前书籍...' },
    });
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.setSearchMode(false);
      }
    });
    this.searchInput.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.performSearch(this.searchInput.value), 160);
    });

    this.searchInfoEl = this.searchPaneEl.createDiv({ cls: 'puffs-search-info' });
    this.searchResultsEl = this.searchPaneEl.createDiv({ cls: 'puffs-search-results' });
  }

  private buildReadingArea(): void {
    this.readingArea = this.bodyEl.createDiv({ cls: 'puffs-reading-area' });
    this.readingArea.tabIndex = 0;

    this.chapterTitleEl = this.readingArea.createDiv({ cls: 'puffs-page-chapter' });
    this.progressTitleEl = this.readingArea.createDiv({ cls: 'puffs-page-progress' });

    this.floatingControls = this.readingArea.createDiv({ cls: 'puffs-floating-controls' });
    const tocBtn = this.floatingControls.createEl('button', {
      cls: 'puffs-icon-btn',
      attr: { 'aria-label': '目录侧边栏' },
    });
    setIcon(tocBtn, 'list');
    tocBtn.addEventListener('click', () => this.toggleToc());

    const settingsBtn = this.floatingControls.createEl('button', {
      cls: 'puffs-icon-btn',
      attr: { 'aria-label': '排版设置' },
    });
    setIcon(settingsBtn, 'settings');
    settingsBtn.addEventListener('click', () => this.toggleTypography());

    this.searchBackBtn = this.readingArea.createEl('button', {
      cls: 'puffs-search-back puffs-hidden',
      text: '返回',
      attr: { 'aria-label': '返回搜索前位置' },
    });
    this.searchBackBtn.addEventListener('click', () => this.returnFromSearchJump());

    this.contentContainer = this.readingArea.createDiv({ cls: 'puffs-page-content' });

    this.readingArea.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.readingArea.addEventListener('wheel', (e) => {
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

  private buildTypographyPanel(): void {
    this.typographyPanel = this.readingArea.createDiv({ cls: 'puffs-typo-panel puffs-hidden' });
    this.refreshTypographyPanel();
  }

  private async loadContent(): Promise<void> {
    if (!this.currentFile) return;

    this.fileBuffer = await this.app.vault.readBinary(this.currentFile);
    const saved = this.plugin.getProgress(this.currentFile.path);
    const { text, encoding } = this.decodeBuffer(this.fileBuffer, saved?.encoding);

    this.currentEncoding = encoding;
    this.paragraphs = this.processText(text);
    this.parseChapters();
    this.buildTocList();
    this.applyTypography();

    this.currentPageStart = this.clampPosition({
      paraIndex: saved?.paragraphIndex ?? 0,
      charOffset: saved?.charOffset ?? 0,
    });
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.readingArea.focus();
  }

  private decodeBuffer(
    buffer: ArrayBuffer,
    forceEncoding?: string,
  ): { text: string; encoding: string } {
    if (forceEncoding) {
      try {
        return {
          text: new TextDecoder(forceEncoding, { fatal: false }).decode(buffer),
          encoding: forceEncoding,
        };
      } catch {
        // 指定编码不可用时继续走自动检测。
      }
    }

    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { text: new TextDecoder('utf-8').decode(buffer), encoding: 'utf-8' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { text: new TextDecoder('utf-16le').decode(buffer), encoding: 'utf-16le' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { text: new TextDecoder('utf-16be').decode(buffer), encoding: 'utf-16be' };
    }

    try {
      return {
        text: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
        encoding: 'utf-8',
      };
    } catch {
      // 非 UTF-8 时优先尝试中文 TXT 常见编码。
    }

    try {
      return { text: new TextDecoder('gbk').decode(buffer), encoding: 'gbk' };
    } catch {
      const fallback = this.plugin.settings.defaultEncoding;
      return { text: new TextDecoder(fallback, { fatal: false }).decode(buffer), encoding: fallback };
    }
  }

  private switchEncoding(encoding: string): void {
    if (!this.fileBuffer || !this.currentFile) return;

    const { text } = this.decodeBuffer(this.fileBuffer, encoding);
    this.currentEncoding = encoding;
    this.paragraphs = this.processText(text);
    this.parseChapters();
    this.buildTocList();
    this.currentPageStart = { paraIndex: 0, charOffset: 0 };
    this.pageBackStack = [];
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: 0,
      charOffset: 0,
      lastRead: Date.now(),
      encoding,
    });
    this.refreshTypographyPanel();
    this.renderCurrentPage();
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

  private processText(text: string): string[] {
    let lines = text.split(/\r?\n/);
    if (this.plugin.settings.removeExtraBlankLines) {
      const collapsed: string[] = [];
      let lastBlank = false;
      for (const line of lines) {
        const isBlank = line.trim() === '';
        if (isBlank && lastBlank) continue;
        collapsed.push(line);
        lastBlank = isBlank;
      }
      lines = collapsed;
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines;
  }

  private renderCurrentPage(): void {
    if (this.paragraphs.length === 0) {
      this.contentContainer.empty();
      this.chapterTitleEl.textContent = '';
      this.progressTitleEl.textContent = '';
      return;
    }

    // Obsidian 刚创建 leaf 时可能还没完成布局；此时 clientHeight 为 0，
    // 如果立刻测量会误判整本书都能放进一页，所以等下一帧再渲染。
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
    this.updatePageMeta();
    this.scheduleProgressSave();
    this.isRenderingPage = false;
  }

  /** 在真实容器内临时排版，找出当前页可以容纳到哪个字符位置。 */
  private measurePageEnd(start: ReaderPosition): ReaderPosition {
    this.contentContainer.empty();
    let offset = start.charOffset;
    let lastFit = start;

    for (let pi = start.paraIndex; pi < this.paragraphs.length; pi++) {
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

  private paintPage(start: ReaderPosition, end: ReaderPosition): void {
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
      this.contentContainer.appendChild(this.createParagraphEl(visible, pi, begin, true));
    }
  }

  private createParagraphEl(
    text: string,
    paraIndex: number,
    charOffset: number,
    withHighlight: boolean,
  ): HTMLElement {
    const p = document.createElement('p');
    p.className = 'puffs-para';
    p.dataset.paraIndex = String(paraIndex);
    p.dataset.charOffset = String(charOffset);

    if (text.trim() === '') {
      p.classList.add('puffs-para-blank');
      p.innerHTML = '&nbsp;';
      return p;
    }

    if (withHighlight && this.searchResults.length > 0) {
      const end = charOffset + text.length;
      const matches = this.searchResults
        .filter((m) => m.paraIndex === paraIndex && m.startOffset < end && m.startOffset + m.length > charOffset)
        .map((m) => ({
          paraIndex,
          startOffset: Math.max(0, m.startOffset - charOffset),
          length: Math.min(m.startOffset + m.length, end) - Math.max(m.startOffset, charOffset),
        }));
      if (matches.length > 0) {
        p.innerHTML = this.buildHighlightedHTML(text, matches);
        return p;
      }
    }

    p.textContent = text;
    return p;
  }

  private isContentOverflowing(): boolean {
    return this.contentContainer.scrollHeight > this.contentContainer.clientHeight + 1;
  }

  /**
   * 返回当前溢出段落中最后一条「完整可见行」结束的字符偏移。
   * 通过 Range 读取浏览器实际换行后的矩形，避免使用估算行高造成翻页漂移。
   */
  private findLastCompleteLineOffset(para: HTMLElement, text: string): number {
    const node = para.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || text.length === 0) return 0;

    const style = getComputedStyle(this.contentContainer);
    const bottomPadding = parseFloat(style.paddingBottom || '0') || 0;
    const bottomLimit = this.contentContainer.getBoundingClientRect().bottom - bottomPadding;
    const range = document.createRange();
    let lastLineTop = Number.NaN;
    let lastLineBottom = 0;
    let lastCompleteOffset = 0;

    for (let i = 0; i < text.length; i++) {
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

    if (lastLineBottom <= bottomLimit) lastCompleteOffset = text.length;
    range.detach();
    return lastCompleteOffset;
  }

  private pageDown(): void {
    if (this.comparePositions(this.currentPageEnd, this.currentPageStart) <= 0) return;
    if (this.currentPageEnd.paraIndex >= this.paragraphs.length) return;
    this.pageBackStack.push({ ...this.currentPageStart });
    this.currentPageStart = this.clampPosition(this.currentPageEnd);
    this.renderCurrentPage();
    this.readingArea.focus();
  }

  private pageUp(): void {
    if (this.currentPageStart.paraIndex === 0 && this.currentPageStart.charOffset === 0) return;
    this.currentPageStart = this.pageBackStack.pop() ?? this.findPreviousPageStart(this.currentPageStart);
    this.renderCurrentPage();
    this.readingArea.focus();
  }

  /** 反向翻页用前向测量逼近，保证上一页结束位置正好衔接当前页首。 */
  private findPreviousPageStart(target: ReaderPosition): ReaderPosition {
    let windowStart = Math.max(0, target.paraIndex - 160);
    let bestStart: ReaderPosition = { paraIndex: 0, charOffset: 0 };

    while (true) {
      let pos: ReaderPosition = { paraIndex: windowStart, charOffset: 0 };
      let previous = pos;
      let guard = 0;
      while (this.comparePositions(pos, target) < 0 && guard < 2000) {
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

  private jumpToPosition(pos: ReaderPosition): void {
    this.currentPageStart = this.clampPosition(pos);
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.readingArea.focus();
  }

  private clampPosition(pos: ReaderPosition): ReaderPosition {
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

  private comparePositions(a: ReaderPosition, b: ReaderPosition): number {
    if (a.paraIndex !== b.paraIndex) return a.paraIndex - b.paraIndex;
    return a.charOffset - b.charOffset;
  }

  private parseChapters(): void {
    this.chapters = [];
    if (!this.plugin.settings.tocRegex) return;

    let regex: RegExp;
    try {
      regex = new RegExp(this.plugin.settings.tocRegex);
    } catch {
      return;
    }

    for (let i = 0; i < this.paragraphs.length; i++) {
      const line = this.paragraphs[i].trim();
      if (line && regex.test(line)) {
        this.chapters.push({ title: line, startParaIndex: i, level: 1 });
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

    this.chapters.forEach((ch, idx) => {
      const item = this.tocListEl.createDiv({ cls: 'puffs-toc-item', text: ch.title });
      item.addEventListener('click', () => {
        this.jumpToPosition({ paraIndex: ch.startParaIndex, charOffset: 0 });
        this.setSearchMode(false);
      });
    });
  }

  private updatePageMeta(): void {
    const activeChapter = this.getActiveChapterIndex(this.currentPageStart.paraIndex);
    this.chapterTitleEl.textContent = activeChapter >= 0 ? this.chapters[activeChapter].title : '';
    this.highlightCurrentTocItem(activeChapter);

    if (this.plugin.settings.showProgress) {
      const current = Math.min(this.currentPageStart.paraIndex, this.paragraphs.length);
      const pct = this.paragraphs.length > 0 ? ((current / this.paragraphs.length) * 100).toFixed(1) : '0.0';
      this.progressTitleEl.textContent = `${pct}%`;
      this.progressTitleEl.classList.remove('puffs-hidden');
    } else {
      this.progressTitleEl.classList.add('puffs-hidden');
    }
  }

  private getActiveChapterIndex(paraIndex: number): number {
    let active = -1;
    for (let i = 0; i < this.chapters.length; i++) {
      if (this.chapters[i].startParaIndex <= paraIndex) active = i;
      else break;
    }
    return active;
  }

  private highlightCurrentTocItem(idx: number): void {
    this.tocListEl?.querySelectorAll('.puffs-toc-item').forEach((el, i) => {
      el.classList.toggle('puffs-toc-active', i === idx);
    });
  }

  private toggleToc(): void {
    if (this.isTocOpen) {
      this.isTocOpen = false;
      this.setSearchMode(false);
      this.tocSidebar.classList.add('puffs-hidden');
    } else {
      this.openSidebar('toc');
    }
  }

  private openSidebar(mode: 'toc' | 'search'): void {
    this.isTocOpen = true;
    this.tocSidebar.classList.remove('puffs-hidden');
    this.setSearchMode(mode === 'search');
    if (mode === 'search') {
      requestAnimationFrame(() => {
        this.searchInput.focus();
        this.searchInput.select();
      });
    }
  }

  private toggleSearchMode(): void {
    this.openSidebar(this.isSearchMode ? 'toc' : 'search');
  }

  private setSearchMode(enabled: boolean): void {
    this.isSearchMode = enabled;
    this.tocTitleEl.textContent = enabled ? '全文搜索' : '目录';
    this.tocListEl.classList.toggle('puffs-hidden', enabled);
    this.searchPaneEl.classList.toggle('puffs-hidden', !enabled);
    if (!enabled) {
      this.readingArea.focus();
    }
  }

  private performSearch(query: string): void {
    this.searchQuery = query.trim();
    this.searchResults = [];

    if (!this.searchQuery) {
      this.searchInfoEl.textContent = '';
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

    this.searchInfoEl.textContent = this.searchResults.length > 0
      ? `${this.searchResults.length} 个结果`
      : '无结果';
    this.renderSearchResults();
    this.renderCurrentPage();
  }

  private renderSearchResults(): void {
    this.searchResultsEl.empty();
    if (this.searchResults.length === 0) {
      this.searchResultsEl.createDiv({ cls: 'puffs-search-empty', text: '没有找到匹配内容' });
      return;
    }

    const seen = new Set<number>();
    const grouped = this.searchResults.filter((match) => {
      if (seen.has(match.paraIndex)) return false;
      seen.add(match.paraIndex);
      return true;
    }).slice(0, 200);

    grouped.forEach((match) => {
      const card = this.searchResultsEl.createDiv({ cls: 'puffs-search-card' });
      const chapter = this.getActiveChapterIndex(match.paraIndex);
      card.createDiv({
        cls: 'puffs-search-card-title',
        text: chapter >= 0 ? this.chapters[chapter].title : `第 ${match.paraIndex + 1} 段`,
      });
      const preview = card.createDiv({ cls: 'puffs-search-card-preview' });
      preview.innerHTML = this.buildSearchPreview(match);
      card.addEventListener('click', () => {
        this.searchJumpBackPos = { ...this.currentPageStart };
        this.searchBackBtn.classList.remove('puffs-hidden');
        this.jumpToPosition({ paraIndex: match.paraIndex, charOffset: match.startOffset });
      });
    });
  }

  private buildSearchPreview(match: SearchMatch): string {
    const text = this.paragraphs[match.paraIndex].trim();
    const start = Math.max(0, match.startOffset - 56);
    const end = Math.min(text.length, match.startOffset + match.length + 56);
    const localStart = match.startOffset - start;
    const localEnd = localStart + match.length;
    const visible = text.slice(start, end);
    return `${start > 0 ? '...' : ''}${this.escapeHTML(visible.slice(0, localStart))}<mark>${this.escapeHTML(visible.slice(localStart, localEnd))}</mark>${this.escapeHTML(visible.slice(localEnd))}${end < text.length ? '...' : ''}`;
  }

  private returnFromSearchJump(): void {
    if (!this.searchJumpBackPos) return;
    const target = this.searchJumpBackPos;
    this.searchJumpBackPos = null;
    this.searchBackBtn.classList.add('puffs-hidden');
    this.jumpToPosition(target);
  }

  private refreshTypographyPanel(): void {
    const p = this.typographyPanel;
    p.empty();
    const s = this.plugin.settings;

    const title = p.createDiv({ cls: 'puffs-typo-title' });
    title.createSpan({ text: '排版设置' });
    this.encodingBtn = title.createEl('button', {
      cls: 'puffs-icon-btn puffs-encoding-btn',
      text: this.currentEncoding.toUpperCase(),
      attr: { 'aria-label': '切换编码' },
    });
    this.encodingBtn.addEventListener('click', (e) => this.showEncodingMenu(e));

    this.addSliderRow(p, '字体大小', s.fontSize, 12, 36, 1, 'px', (v) => this.updateSetting('fontSize', v));
    this.addSliderRow(p, '字体颜色', Number.NaN, 0, 0, 1, '', null, s.fontColor, (v) => this.updateSetting('fontColor', v));
    this.addSliderRow(p, '背景颜色', Number.NaN, 0, 0, 1, '', null, s.backgroundColor, (v) => this.updateSetting('backgroundColor', v));
    this.addSliderRow(p, '字间距', s.letterSpacing, 0, 8, 0.5, 'px', (v) => this.updateSetting('letterSpacing', v));
    this.addSliderRow(p, '行间距', s.lineHeight, 1, 3.2, 0.1, 'x', (v) => this.updateSetting('lineHeight', v));
    this.addSliderRow(p, '段间距', s.paragraphSpacing, 0, 48, 2, 'px', (v) => this.updateSetting('paragraphSpacing', v));
    this.addSliderRow(p, '首行缩进', s.firstLineIndent, 0, 4, 0.5, 'em', (v) => this.updateSetting('firstLineIndent', v));
    this.addSliderRow(p, '顶部间距', s.paddingTop, 0, 180, 4, 'px', (v) => this.updateSetting('paddingTop', v));
    this.addSliderRow(p, '底部间距', s.paddingBottom, 0, 180, 4, 'px', (v) => this.updateSetting('paddingBottom', v));
    this.addSliderRow(p, '阅读宽度', s.contentWidth, 360, 1500, 20, 'px', (v) => this.updateSetting('contentWidth', v));

    this.addToggleRow(p, '显示进度', s.showProgress, (v) => this.updateSetting('showProgress', v));
    this.addToggleRow(p, '去除空行', s.removeExtraBlankLines, (v) => {
      this.plugin.settings.removeExtraBlankLines = v;
      this.plugin.savePluginData();
      this.loadContent();
    });
    this.addTextRow(p, '目录正则', s.tocRegex, (v) => {
      this.plugin.settings.tocRegex = v;
      this.plugin.savePluginData();
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
    this.addTextRow(p, '搜索快捷键', s.searchHotkey, (v) => {
      this.plugin.settings.searchHotkey = v || 'Ctrl+F';
      this.plugin.savePluginData();
    });
  }

  private updateSetting<K extends keyof PuffsReaderPlugin['settings']>(
    key: K,
    value: PuffsReaderPlugin['settings'][K],
  ): void {
    this.plugin.settings[key] = value;
    this.plugin.savePluginData();
    this.applyTypography();
    this.renderCurrentPage();
  }

  private addSliderRow(
    parent: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    unit: string,
    onNumberChange: ((v: number) => void) | null,
    textValue?: string,
    onTextChange?: (v: string) => void,
  ): void {
    const row = parent.createDiv({ cls: 'puffs-typo-row' });
    row.createSpan({ cls: 'puffs-typo-label', text: label });

    if (onTextChange) {
      const input = row.createEl('input', {
        cls: 'puffs-typo-text-input',
        attr: { type: 'text', placeholder: 'R,G,B 或留空' },
      }) as HTMLInputElement;
      input.value = textValue ?? '';
      input.addEventListener('input', () => onTextChange(input.value.trim()));
      return;
    }

    const slider = row.createEl('input', {
      cls: 'puffs-typo-slider',
      attr: { type: 'range', min: String(min), max: String(max), step: String(step) },
    }) as HTMLInputElement;
    slider.value = String(value);
    const input = row.createEl('input', {
      cls: 'puffs-typo-number',
      attr: { type: 'number', min: String(min), max: String(max), step: String(step) },
    }) as HTMLInputElement;
    input.value = String(value);
    row.createSpan({ cls: 'puffs-typo-unit', text: unit });

    const update = (raw: string): void => {
      const parsed = Number(raw);
      if (Number.isNaN(parsed) || !onNumberChange) return;
      const next = Math.min(max, Math.max(min, parsed));
      slider.value = String(next);
      input.value = String(next);
      onNumberChange(next);
    };
    slider.addEventListener('input', () => update(slider.value));
    input.addEventListener('change', () => update(input.value));
  }

  private addToggleRow(parent: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void): void {
    const row = parent.createDiv({ cls: 'puffs-typo-row' });
    const text = row.createEl('label', { cls: 'puffs-typo-toggle-label' });
    const cb = text.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
    cb.checked = value;
    text.appendText(` ${label}`);
    cb.addEventListener('change', () => onChange(cb.checked));
  }

  private addTextRow(parent: HTMLElement, label: string, value: string, onChange: (v: string) => void): void {
    const row = parent.createDiv({ cls: 'puffs-typo-row' });
    row.createSpan({ cls: 'puffs-typo-label', text: label });
    const input = row.createEl('input', { cls: 'puffs-typo-text-input', attr: { type: 'text' } }) as HTMLInputElement;
    input.value = value;
    input.addEventListener('change', () => onChange(input.value.trim()));
  }

  private applyTypography(): void {
    const s = this.plugin.settings;
    const rgbBg = s.backgroundColor ? `rgb(${s.backgroundColor})` : '';
    const rgbFont = s.fontColor ? `rgb(${s.fontColor})` : '';

    this.rootEl.style.setProperty('--puffs-bg-color', rgbBg || 'var(--background-primary)');
    this.readingArea.style.setProperty('--puffs-bg-color', rgbBg || 'var(--background-primary)');
    this.contentContainer.style.setProperty('--puffs-font-size', `${s.fontSize}px`);
    this.contentContainer.style.setProperty('--puffs-line-height', String(s.lineHeight));
    this.contentContainer.style.setProperty('--puffs-para-spacing', `${s.paragraphSpacing}px`);
    this.contentContainer.style.setProperty('--puffs-indent', `${s.firstLineIndent}em`);
    this.contentContainer.style.setProperty('--puffs-content-width', `${s.contentWidth}px`);
    this.contentContainer.style.setProperty('--puffs-letter-spacing', `${s.letterSpacing}px`);
    this.contentContainer.style.setProperty('--puffs-padding-top', `${s.paddingTop}px`);
    this.contentContainer.style.setProperty('--puffs-padding-bottom', `${s.paddingBottom}px`);
    if (rgbFont) this.contentContainer.style.setProperty('--puffs-font-color', rgbFont);
    else this.contentContainer.style.removeProperty('--puffs-font-color');
  }

  private toggleTypography(): void {
    this.isTypographyOpen = !this.isTypographyOpen;
    this.typographyPanel.classList.toggle('puffs-hidden', !this.isTypographyOpen);
    if (this.isTypographyOpen) this.refreshTypographyPanel();
  }

  private bindGlobalKeys(): void {
    this.boundGlobalKeydown = (e: KeyboardEvent) => {
      if (!this.contentEl.isConnected) return;
      if (!this.matchesSearchHotkey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.openSearch();
    };
    document.addEventListener('keydown', this.boundGlobalKeydown, true);
    window.addEventListener('keydown', this.boundGlobalKeydown, true);
  }

  private matchesSearchHotkey(e: KeyboardEvent): boolean {
    const raw = this.plugin.settings.searchHotkey || 'Ctrl+F';
    const parts = raw.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
    const key = parts.find((p) => !['ctrl', 'control', 'cmd', 'meta', 'alt', 'shift'].includes(p));
    if (!key) return false;
    const eventKey = e.key.toLowerCase();
    const eventCode = e.code.toLowerCase().replace(/^key/, '');
    return (
      (eventKey === key || eventCode === key) &&
      e.ctrlKey === (parts.includes('ctrl') || parts.includes('control')) &&
      e.metaKey === (parts.includes('cmd') || parts.includes('meta')) &&
      e.altKey === parts.includes('alt') &&
      e.shiftKey === parts.includes('shift')
    );
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (this.matchesSearchHotkey(e)) {
      e.preventDefault();
      this.openSearch();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.pageDown();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.pageUp();
    } else if (e.key === 'Escape') {
      if (this.isTypographyOpen) this.toggleTypography();
      else if (this.isSearchMode) this.setSearchMode(false);
      else if (this.isTocOpen) this.toggleToc();
    }
  }

  private scheduleProgressSave(): void {
    window.clearTimeout(this.progressSaveTimer);
    this.progressSaveTimer = window.setTimeout(() => this.saveProgressNow(), 800);
  }

  private saveProgressNow(): void {
    if (!this.currentFile || this.paragraphs.length === 0) return;
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: this.currentPageStart.paraIndex,
      charOffset: this.currentPageStart.charOffset,
      lastRead: Date.now(),
      encoding: this.currentEncoding !== 'utf-8' ? this.currentEncoding : undefined,
    });
  }

  private buildHighlightedHTML(text: string, matches: SearchMatch[]): string {
    const sorted = [...matches].sort((a, b) => a.startOffset - b.startOffset);
    let result = '';
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

  private escapeHTML(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
