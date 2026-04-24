import { ItemView, WorkspaceLeaf, Menu, TFile, ViewStateResult, setIcon, Scope } from 'obsidian';
import PuffsReaderPlugin from './main';
import { BookSettings, Chapter, DEFAULT_CHAPTER_TITLE_REGEX, SearchMatch, SUPPORTED_ENCODINGS } from './types';

export const READER_VIEW_TYPE = 'puffs-reader-view';

interface ReaderPosition {
  paraIndex: number;
  charOffset: number;
}

/**
 * Puffs Reader 阅读器核心视图。
 *
 * 只渲染当前页内容，并用「段落索引 + 字符偏移」记录页首/页尾，保证翻页连续。
 * 单书设置只保存真正与当前书相关的覆写项；没有覆写时全部回退到全局设置。
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
  private tocModeBtn!: HTMLElement;
  private tocListEl!: HTMLElement;
  private searchPaneEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchInfoEl!: HTMLElement;
  private searchResultsEl!: HTMLElement;
  private readingArea!: HTMLElement;
  private contentContainer!: HTMLElement;
  private floatingControls!: HTMLElement;
  private settingsBtn!: HTMLElement;
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
  private searchJumpPageTurns = 0;

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
    this.scope = new Scope(this.app.scope);
    this.scope.register(null, 'Escape', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      return false;
    });
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

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const viewState = state as Record<string, unknown> | null;
    const path = viewState?.file as string | undefined;
    if (path && path !== this.filePath) {
      this.filePath = path;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        this.currentFile = file;
        await this.loadContent();
      }
    }
    await super.setState(state, result);
    this.focusReader();
  }

  /** 供插件命令调用，打开当前阅读器的全文搜索。 */
  openSearch(): void {
    this.openSidebar('search');
  }

  /** 搜索快捷键重复触发时，在打开/关闭搜索面板之间切换。 */
  toggleSearchFromHotkey(): void {
    if (this.isTocOpen && this.isSearchMode) {
      this.closeSidebar();
      this.focusReader();
      return;
    }
    this.openSearch();
  }

  /** 全局设置面板保存后调用，让已打开阅读器立即使用新排版。 */
  refreshSettingsFromGlobal(): void {
    this.applyTypography();
    this.renderCurrentPage();
  }

  /** 供外部打开/切换书籍后调用，把键盘焦点稳定交给阅读区。 */
  focusReader(): void {
    this.focusReadingAreaSoon();
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
    this.bindWorkspaceFocusEvents();
    this.bindGlobalKeys();
    this.applyTypography();
  }

  private bindWorkspaceFocusEvents(): void {
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf === this.leaf) {
          this.focusReader();
        }
      }),
    );
  }

  private buildTocSidebar(): void {
    this.tocSidebar = this.bodyEl.createDiv({ cls: 'puffs-toc-sidebar puffs-hidden' });

    const header = this.tocSidebar.createDiv({ cls: 'puffs-toc-header' });
    this.tocTitleEl = header.createSpan({ text: '目录' });
    this.tocModeBtn = header.createEl('button', {
      cls: 'puffs-icon-btn puffs-toc-search-btn',
      attr: { 'aria-label': '全书搜索' },
    });
    setIcon(this.tocModeBtn, 'search');
    this.tocModeBtn.addEventListener('click', () => this.toggleSearchMode());

    this.tocListEl = this.tocSidebar.createDiv({ cls: 'puffs-toc-list' });

    this.searchPaneEl = this.tocSidebar.createDiv({ cls: 'puffs-sidebar-search puffs-hidden' });
    const searchHeader = this.searchPaneEl.createDiv({ cls: 'puffs-search-header' });
    this.searchInput = searchHeader.createEl('input', {
      cls: 'puffs-search-input',
      attr: { type: 'text', placeholder: '' },
    });
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
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
      cls: 'puffs-icon-btn puffs-floating-btn',
      attr: { 'aria-label': '目录侧边栏' },
    });
    setIcon(tocBtn, 'list');
    tocBtn.addEventListener('click', () => this.toggleToc());

    this.settingsBtn = this.floatingControls.createEl('button', {
      cls: 'puffs-icon-btn puffs-floating-btn',
      attr: { 'aria-label': '书籍设置' },
    });
    setIcon(this.settingsBtn, 'settings');
    this.settingsBtn.addEventListener('click', () => this.toggleTypography());

    this.searchBackBtn = this.readingArea.createEl('button', {
      cls: 'puffs-search-back puffs-hidden',
      text: '返回',
      attr: { 'aria-label': '返回搜索前位置' },
    });
    this.searchBackBtn.addEventListener('click', () => this.returnFromSearchJump());

    this.contentContainer = this.readingArea.createDiv({ cls: 'puffs-page-content' });

    this.readingArea.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.readingArea.addEventListener('pointerdown', (e) => this.closePanelsOnOutsideClick(e));
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
    const bookSettings = this.getBookSettings();
    const { text, encoding } = this.decodeBuffer(this.fileBuffer, bookSettings.encoding ?? saved?.encoding);

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
    this.focusReadingAreaSoon();
  }

  private focusReadingAreaSoon(): void {
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

  private decodeBuffer(buffer: ArrayBuffer, forceEncoding?: string): { text: string; encoding: string } {
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
    this.updateBookSettings({ encoding });
    this.parseChapters();
    this.buildTocList();
    this.currentPageStart = { paraIndex: 0, charOffset: 0 };
    this.pageBackStack = [];
    this.plugin.saveProgress(this.currentFile.path, {
      paragraphIndex: 0,
      charOffset: 0,
      lastRead: Date.now(),
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
    lines = this.removeBlankLinesAfterChapter(lines);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines;
  }

  /** 章节标题后面的空行只会拉开章节名和正文第一段，这里直接清理掉。 */
  private removeBlankLinesAfterChapter(lines: string[]): string[] {
    const tocRegexText = this.getEffectiveTocRegex();
    if (!tocRegexText) return lines;

    let tocRegex: RegExp;
    try {
      tocRegex = new RegExp(tocRegexText);
    } catch {
      return lines;
    }

    const cleaned: string[] = [];
    let previousWasChapter = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (previousWasChapter && trimmed === '') continue;

      cleaned.push(line);
      previousWasChapter = trimmed !== '' && tocRegex.test(trimmed);
    }
    return cleaned;
  }

  private renderCurrentPage(): void {
    if (this.paragraphs.length === 0) {
      this.contentContainer.empty();
      this.chapterTitleEl.textContent = '';
      this.progressTitleEl.textContent = '';
      return;
    }

    // Obsidian 刚创建 leaf 时可能还没完成布局；此时 clientHeight 为 0。
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
  private measurePageEnd(start: ReaderPosition): ReaderPosition {
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
      const continuesAfterPage = finish < fullText.length;
      this.contentContainer.appendChild(this.createParagraphEl(visible, pi, begin, true, continuesAfterPage));
    }
  }

  private createParagraphEl(
    text: string,
    paraIndex: number,
    charOffset: number,
    withHighlight: boolean,
    continuesAfterPage = false,
  ): HTMLElement {
    const p = document.createElement('p');
    p.className = 'puffs-para';
    p.dataset.paraIndex = String(paraIndex);
    p.dataset.charOffset = String(charOffset);

    const chapter = charOffset === 0 ? this.getChapterStartingAt(paraIndex) : null;
    if (chapter) {
      p.classList.add('puffs-para-chapter');
      p.textContent = chapter.title;
      return p;
    }

    if (text.trim() === '') {
      p.classList.add('puffs-para-blank');
      p.innerHTML = '&nbsp;';
      return p;
    }

    // 分页截断出的临时段落并不是真正的段尾；让它的末行也参与两端对齐。
    if (continuesAfterPage) {
      p.classList.add('puffs-para-continued');
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
    return this.contentContainer.scrollHeight > this.contentContainer.clientHeight;
  }

  /** 最终以真实绘制结果兜底，尽量只截短最后一段，减少页底空白。 */
  private trimPaintedPageToFit(): void {
    let guard = 0;
    while (this.isContentOverflowing() && guard < 20) {
      const last = this.contentContainer.lastElementChild as HTMLElement | null;
      if (!last) return;

      const paraIndex = Number(last.dataset.paraIndex);
      const charOffset = Number(last.dataset.charOffset);
      if (!Number.isFinite(paraIndex) || !Number.isFinite(charOffset)) return;

      const paragraphEnd = paraIndex === this.currentPageEnd.paraIndex
        ? this.currentPageEnd.charOffset
        : this.paragraphs[paraIndex]?.length ?? charOffset;
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
  private findLastCompleteLineOffset(para: HTMLElement, text: string): number {
    const node = para.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || text.length === 0) return 0;
    const measurableLength = Math.min(text.length, node.textContent?.length ?? 0);
    if (measurableLength <= 0) return 0;

    const style = getComputedStyle(this.contentContainer);
    const bottomPadding = parseFloat(style.paddingBottom || '0') || 0;
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

  private pageDown(): void {
    if (this.comparePositions(this.currentPageEnd, this.currentPageStart) <= 0) return;
    if (this.currentPageEnd.paraIndex >= this.paragraphs.length) return;
    this.pageBackStack.push({ ...this.currentPageStart });
    this.currentPageStart = this.clampPosition(this.currentPageEnd);
    this.recordPageTurnAfterSearchJump();
    this.renderCurrentPage();
    this.readingArea.focus();
  }

  private pageUp(): void {
    if (this.currentPageStart.paraIndex === 0 && this.currentPageStart.charOffset === 0) return;
    this.currentPageStart = this.pageBackStack.pop() ?? this.findPreviousPageStart(this.currentPageStart);
    this.recordPageTurnAfterSearchJump();
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
    const tocRegexText = this.getEffectiveTocRegex();
    if (!tocRegexText) return;

    let regex: RegExp;
    try {
      regex = new RegExp(tocRegexText);
    } catch {
      return;
    }

    for (let i = 0; i < this.paragraphs.length; i++) {
      const line = this.paragraphs[i].trim();
      if (line && regex.test(line)) {
        this.chapters.push({
          title: this.extractChapterTitle(line),
          rawTitle: line,
          startParaIndex: i,
          level: 1,
        });
      }
    }
  }

  private extractChapterTitle(line: string): string {
    const customRegex = this.getBookSettings().chapterTitleRegex ?? DEFAULT_CHAPTER_TITLE_REGEX;
    try {
      const match = line.match(new RegExp(customRegex));
      if (match?.[1] && match?.[2] && /^[章节回卷集部篇]$/.test(match[2])) {
        const numberText = this.normalizeChapterNumber(match[1]);
        const titleText = (match[3] ?? '').trim();
        return titleText ? `第${numberText}${match[2]} ${titleText}` : `第${numberText}${match[2]}`;
      }
      const captured = match?.slice(1).find((part) => part && part.trim().length > 0)?.trim();
      if (captured) return captured;
    } catch {
      // 正则错误时回退原始章节行，避免目录消失。
    }
    return line;
  }

  private getChapterEndPara(paraIndex: number): number | null {
    const active = this.getActiveChapterIndex(paraIndex);
    if (active < 0) return null;
    return this.chapters[active + 1]?.startParaIndex ?? null;
  }

  private buildTocList(): void {
    if (!this.tocListEl) return;
    this.tocListEl.empty();
    if (this.chapters.length === 0) {
      this.tocListEl.createDiv({ cls: 'puffs-toc-empty', text: '未检测到章节' });
      return;
    }

    this.chapters.forEach((ch) => {
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
      this.closeSidebar();
    } else {
      this.openSidebar('toc');
    }
  }

  private closeSidebar(): void {
    this.isTocOpen = false;
    this.setSearchMode(false);
    this.tocSidebar.classList.add('puffs-hidden');
  }

  private openSidebar(mode: 'toc' | 'search'): void {
    this.isTocOpen = true;
    this.tocSidebar.classList.remove('puffs-hidden');
    this.setSearchMode(mode === 'search');
    if (mode === 'toc') {
      requestAnimationFrame(() => this.scrollTocToActiveChapter());
    }
    if (mode === 'search') {
      this.clearSearchInput();
      requestAnimationFrame(() => {
        this.searchInput.focus();
      });
    }
  }

  private toggleSearchMode(): void {
    this.openSidebar(this.isSearchMode ? 'toc' : 'search');
  }

  private setSearchMode(enabled: boolean): void {
    this.isSearchMode = enabled;
    this.tocTitleEl.textContent = enabled ? '全书搜索' : '目录';
    setIcon(this.tocModeBtn, enabled ? 'list' : 'search');
    this.tocModeBtn.setAttribute('aria-label', enabled ? '返回目录' : '全书搜索');
    this.tocModeBtn.removeAttribute('title');
    this.tocListEl.classList.toggle('puffs-hidden', enabled);
    this.searchPaneEl.classList.toggle('puffs-hidden', !enabled);
      if (!enabled) {
      this.readingArea.focus();
    }
  }

  private scrollTocToActiveChapter(): void {
    const activeChapter = this.getActiveChapterIndex(this.currentPageStart.paraIndex);
    if (activeChapter < 0) return;

    const item = this.tocListEl.querySelectorAll<HTMLElement>('.puffs-toc-item')[activeChapter];
    if (!item) return;

    item.scrollIntoView({ block: 'center' });
  }

  private clearSearchInput(): void {
    this.searchQuery = '';
    this.searchResults = [];
    this.searchInput.value = '';
    this.searchInfoEl.textContent = '';
    this.searchResultsEl.empty();
    this.renderCurrentPage();
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
        this.searchJumpPageTurns = 0;
        this.searchBackBtn.classList.remove('puffs-hidden');
        this.jumpToPosition({ paraIndex: match.paraIndex, charOffset: match.startOffset });
      });
    });
  }

  private buildSearchPreview(match: SearchMatch): string {
    const text = this.paragraphs[match.paraIndex];
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
    this.searchJumpPageTurns = 0;
    this.searchBackBtn.classList.add('puffs-hidden');
    this.currentPageStart = this.clampPosition(target);
    this.pageBackStack = [];
    this.renderCurrentPage();
    this.readingArea.focus();
  }

  private recordPageTurnAfterSearchJump(): void {
    if (!this.searchJumpBackPos) return;
    this.searchJumpPageTurns += 1;
    if (this.searchJumpPageTurns >= 5) {
      this.clearSearchJumpAndHighlights();
    }
  }

  private clearSearchJumpAndHighlights(): void {
    this.searchJumpBackPos = null;
    this.searchJumpPageTurns = 0;
    this.searchBackBtn.classList.add('puffs-hidden');
    this.clearSearchInput();
  }

  private refreshTypographyPanel(): void {
    const p = this.typographyPanel;
    p.empty();
    const bookSettings = this.getBookSettings();

    const title = p.createDiv({ cls: 'puffs-typo-title' });
    title.createSpan({ text: '书籍设置' });

    const encodingRow = p.createDiv({ cls: 'puffs-typo-row' });
    encodingRow.createSpan({ cls: 'puffs-typo-label', text: '编码方式' });
    this.encodingBtn = encodingRow.createEl('button', {
      cls: 'puffs-icon-btn puffs-encoding-btn',
      text: this.currentEncoding.toUpperCase(),
      attr: { 'aria-label': '切换编码' },
    });
    this.encodingBtn.addEventListener('click', (e) => this.showEncodingMenu(e));

    this.addNumberRow(
      p,
      '首行缩进',
      this.getEffectiveFirstLineIndent(),
      0,
      4,
      0.1,
      'em',
      (v) => {
        this.updateBookSettings({ firstLineIndent: v });
        this.applyTypography();
        this.renderCurrentPage();
      },
    );
    this.addTextRow(p, '目录正则', this.getEffectiveTocRegex(), (v) => {
      this.updateBookSettings({ tocRegex: v || undefined });
      this.parseChapters();
      this.buildTocList();
      this.renderCurrentPage();
    });
    this.addTextRow(p, '章名正则', bookSettings.chapterTitleRegex ?? DEFAULT_CHAPTER_TITLE_REGEX, (v) => {
      this.updateBookSettings({ chapterTitleRegex: v || undefined });
      this.parseChapters();
      this.buildTocList();
      this.updatePageMeta();
    });
  }

  private addNumberRow(
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
    const input = row.createEl('input', {
      cls: 'puffs-typo-number',
      attr: { type: 'number', min: String(min), max: String(max), step: String(step) },
    }) as HTMLInputElement;
    input.value = String(value);
    row.createSpan({ cls: 'puffs-typo-unit', text: unit });
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      if (Number.isNaN(parsed)) return;
      const next = Math.min(max, Math.max(min, parsed));
      input.value = String(next);
      onChange(next);
    });
  }

  private addTextRow(parent: HTMLElement, label: string, value: string, onChange: (v: string) => void): void {
    const row = parent.createDiv({ cls: 'puffs-typo-row' });
    row.createSpan({ cls: 'puffs-typo-label', text: label });
    const input = row.createEl('input', { cls: 'puffs-typo-text-input', attr: { type: 'text' } }) as HTMLInputElement;
    input.value = value;
    input.addEventListener('change', () => onChange(input.value.trim()));
  }

  private applyTypography(): void {
    if (!this.rootEl || !this.contentContainer) return;

    const s = this.plugin.settings;
    const rgbBg = s.backgroundColor ? `rgb(${s.backgroundColor})` : '';
    const rgbFont = s.fontColor ? `rgb(${s.fontColor})` : '';
    const floatingButtonColor = s.floatingButtonColor ? `rgb(${s.floatingButtonColor})` : '';
    const chapterColor = s.chapterMetaColor ? `rgb(${s.chapterMetaColor})` : '';
    const progressColor = s.progressMetaColor ? `rgb(${s.progressMetaColor})` : '';

    this.rootEl.style.setProperty('--puffs-bg-color', rgbBg || 'var(--background-primary)');
    this.readingArea.style.setProperty('--puffs-bg-color', rgbBg || 'var(--background-primary)');
    this.contentContainer.style.setProperty('--puffs-font-size', `${s.fontSize}px`);
    this.contentContainer.style.setProperty('--puffs-line-height', String(s.lineHeight));
    this.contentContainer.style.setProperty('--puffs-para-spacing', `${s.paragraphSpacing}px`);
    this.contentContainer.style.setProperty('--puffs-indent', `${this.getEffectiveFirstLineIndent()}em`);
    this.contentContainer.style.setProperty('--puffs-content-width', `${s.contentWidth}px`);
    this.contentContainer.style.setProperty('--puffs-letter-spacing', `${s.letterSpacing}px`);
    this.contentContainer.style.setProperty('--puffs-padding-top', `${s.paddingTop}px`);
    this.contentContainer.style.setProperty('--puffs-padding-bottom', `${s.paddingBottom}px`);
    this.rootEl.style.setProperty('--puffs-sidebar-width', `${s.sidebarWidth}px`);
    this.rootEl.style.setProperty('--puffs-sidebar-transition', `${s.sidebarTransitionMs}ms`);
    this.rootEl.style.setProperty('--puffs-toc-font-size', `${s.tocFontSize}px`);
    if (floatingButtonColor) this.rootEl.style.setProperty('--puffs-floating-button-color', floatingButtonColor);
    else this.rootEl.style.removeProperty('--puffs-floating-button-color');
    this.rootEl.style.setProperty('--puffs-chapter-meta-size', `${s.chapterMetaFontSize}px`);
    this.rootEl.style.setProperty('--puffs-chapter-meta-top', `${s.chapterMetaTop}px`);
    this.rootEl.style.setProperty('--puffs-progress-meta-size', `${s.progressMetaFontSize}px`);
    this.rootEl.style.setProperty('--puffs-progress-meta-bottom', `${s.progressMetaBottom}px`);

    if (rgbFont) this.contentContainer.style.setProperty('--puffs-font-color', rgbFont);
    else this.contentContainer.style.removeProperty('--puffs-font-color');
    if (chapterColor) this.rootEl.style.setProperty('--puffs-chapter-meta-color', chapterColor);
    else this.rootEl.style.removeProperty('--puffs-chapter-meta-color');
    if (progressColor) this.rootEl.style.setProperty('--puffs-progress-meta-color', progressColor);
    else this.rootEl.style.removeProperty('--puffs-progress-meta-color');
  }

  private toggleTypography(): void {
    if (this.isTypographyOpen) this.closeTypography();
    else {
      this.isTypographyOpen = true;
      this.refreshTypographyPanel();
      this.typographyPanel.classList.remove('puffs-hidden');
    }
  }

  private closeTypography(): void {
    this.isTypographyOpen = false;
    this.typographyPanel.classList.add('puffs-hidden');
  }

  private closePanelsOnOutsideClick(e: PointerEvent): void {
    const target = e.target as Node | null;
    if (!target) return;
    if (this.isTypographyOpen && !this.typographyPanel.contains(target) && !this.settingsBtn.contains(target)) {
      this.closeTypography();
    }
    if (this.isTocOpen && !this.tocSidebar.contains(target) && !this.floatingControls.contains(target)) {
      this.closeSidebar();
    }
  }

  private getBookSettings(): BookSettings {
    if (!this.currentFile) return {};
    return this.plugin.getBookSettings(this.currentFile.path);
  }

  private getEffectiveFirstLineIndent(): number {
    return this.getBookSettings().firstLineIndent ?? this.plugin.settings.firstLineIndent;
  }

  private getEffectiveTocRegex(): string {
    return this.getBookSettings().tocRegex ?? this.plugin.settings.tocRegex;
  }

  private normalizeChapterNumber(raw: string): string {
    if (/^\d+$/.test(raw)) return String(Number(raw));
    const parsed = this.parseChineseNumber(raw);
    return parsed > 0 ? String(parsed) : raw;
  }

  private getChapterStartingAt(paraIndex: number): Chapter | null {
    return this.chapters.find((chapter) => chapter.startParaIndex === paraIndex) ?? null;
  }

  private parseChineseNumber(raw: string): number {
    const digits: Record<string, number> = {
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };
    const smallUnits: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
    const largeUnits: Record<string, number> = { 万: 10000, 亿: 100000000 };
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

  private updateBookSettings(partial: BookSettings): void {
    if (!this.currentFile) return;
    const next = {
      ...this.getBookSettings(),
      ...partial,
    };
    this.plugin.saveBookSettings(this.currentFile.path, next);
  }

  private bindGlobalKeys(): void {
    this.boundGlobalKeydown = (e: KeyboardEvent) => {
      if (!this.contentEl.isConnected) return;
      if (e.key === 'Escape') {
        if (!this.isReaderKeyboardActive()) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      if (!this.matchesSearchHotkey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.toggleSearchFromHotkey();
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
      this.toggleSearchFromHotkey();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.pageDown();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.pageUp();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }

  private isReaderKeyboardActive(): boolean {
    const active = document.activeElement;
    return this.app.workspace.activeLeaf === this.leaf || !!active && this.contentEl.contains(active);
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
