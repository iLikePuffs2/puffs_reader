/** 阅读器全局设置 */
export interface ReaderSettings {
  /** 字体大小 (px) */
  fontSize: number;
  /** 行间距 (倍数) */
  lineHeight: number;
  /** 段落间距 (px) */
  paragraphSpacing: number;
  /** 首行缩进 (em) */
  firstLineIndent: number;
  /** 阅读区宽度 (px) */
  contentWidth: number;
  /** 字间距 (px) */
  letterSpacing: number;
  /** 最上方文字与顶部的间距 (px) */
  paddingTop: number;
  /** 最下方文字与底部的间距 (px) */
  paddingBottom: number;
  /** 字体颜色 (RGB, e.g. "51,51,51"，空字符串跟随主题) */
  fontColor: string;
  /** 背景颜色 (RGB, e.g. "233,216,188"，空字符串跟随主题) */
  backgroundColor: string;
  /** 是否显示阅读进度百分比 */
  showProgress: boolean;
  /** 是否去除多余空行 */
  removeExtraBlankLines: boolean;
  /** 目录匹配正则 */
  tocRegex: string;
  /** 默认编码 */
  defaultEncoding: string;
  /** 全文搜索快捷键 */
  searchHotkey: string;
}

/** 每本书的阅读进度 */
export interface BookProgress {
  /** 上次阅读的段落索引 */
  paragraphIndex: number;
  /** 上次阅读的段内字符偏移，用于页模式精确恢复 */
  charOffset?: number;
  /** 上次阅读时间戳 */
  lastRead: number;
  /** 用户选择的编码（覆写自动检测） */
  encoding?: string;
}

/** 解析出的章节 */
export interface Chapter {
  /** 章节标题 */
  title: string;
  /** 起始段落索引 */
  startParaIndex: number;
  /** 层级 (1=卷, 2=章) */
  level: number;
}

/** 搜索结果 */
export interface SearchMatch {
  /** 所在段落索引 */
  paraIndex: number;
  /** 在段落文本中的起始偏移 */
  startOffset: number;
  /** 匹配长度 */
  length: number;
}

/** 虚拟渲染块 */
export interface Block {
  /** 块对应的 DOM 容器 */
  element: HTMLElement;
  /** 块内第一个段落索引 */
  startPara: number;
  /** 块结束段落索引（不包含） */
  endPara: number;
  /** 当前是否已经挂载真实段落 DOM */
  rendered: boolean;
  /** 卸载前测量到的真实高度，用于维持滚动条长度 */
  measuredHeight: number;
}

/** 每个虚拟块包含的段落数量 */
export const BLOCK_SIZE = 80;

/** 可视区域上下额外保留的块数量 */
export const RENDER_BUFFER = 2;

/** 支持的编码列表 */
export const SUPPORTED_ENCODINGS = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK' },
  { value: 'gb18030', label: 'GB18030' },
  { value: 'big5', label: 'Big5' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'shift_jis', label: 'Shift_JIS' },
  { value: 'euc-kr', label: 'EUC-KR' },
];

/** 默认设置 */
export const DEFAULT_SETTINGS: ReaderSettings = {
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
  showProgress: true,
  removeExtraBlankLines: true,
  tocRegex: '^\\s*第[零一二三四五六七八九十百千万亿\\d]+[章节回卷集部篇].*$',
  defaultEncoding: 'utf-8',
  searchHotkey: 'Ctrl+F',
};
