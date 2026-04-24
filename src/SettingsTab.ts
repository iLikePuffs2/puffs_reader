import { App, PluginSettingTab, Setting } from 'obsidian';
import PuffsReaderPlugin from './main';
import { DEFAULT_SETTINGS } from './types';

type NumericSettingKey = {
  [K in keyof PuffsReaderPlugin['settings']]: PuffsReaderPlugin['settings'][K] extends number ? K : never;
}[keyof PuffsReaderPlugin['settings']];

export class SettingsTab extends PluginSettingTab {
  plugin: PuffsReaderPlugin;

  constructor(app: App, plugin: PuffsReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h3', { text: '排版设置' });
    this.addNumberSetting('正文字体大小', '阅读区文字大小 (px)', 'fontSize', 12, 36, 1, 'px');
    this.addNumberSetting('行间距', '正文行间距倍数', 'lineHeight', 1, 3.2, 0.1, '倍');
    this.addNumberSetting('段落间距', '段落之间的距离 (px)', 'paragraphSpacing', 0, 48, 1, 'px');
    this.addNumberSetting('首行缩进', '所有书籍默认首行缩进 (em)，单书设置可覆写', 'firstLineIndent', 0, 4, 0.1, 'em');
    this.addNumberSetting('阅读区宽度', '阅读区最大宽度 (px)', 'contentWidth', 360, 1500, 10, 'px');
    this.addNumberSetting('字间距', '文字之间的距离 (px)', 'letterSpacing', 0, 8, 0.1, 'px');
    this.addNumberSetting('正文顶部间距', '正文内容与页面顶部的距离 (px)', 'paddingTop', 0, 180, 1, 'px');
    this.addNumberSetting('正文底部间距', '正文内容与页面底部的距离 (px)', 'paddingBottom', 0, 200, 1, 'px');
    this.addNumberSetting('左侧栏宽度', '目录和全文搜索侧栏宽度 (px)', 'sidebarWidth', 220, 520, 1, 'px');
    this.addNumberSetting('目录字体大小', '左侧目录条目的字体大小 (px)', 'tocFontSize', 11, 20, 1, 'px');

    this.addTextSetting('字体颜色', 'RGB 格式，如 51,51,51。留空跟随主题。', 'fontColor', '例如 51,51,51');
    this.addTextSetting('书籍背景颜色', 'RGB 格式，如 233,216,188。留空跟随主题。', 'backgroundColor', '例如 233,216,188');

    containerEl.createEl('h3', { text: '顶部章名与底部进度' });
    this.addNumberSetting('章名字号', '页面顶部章名小字大小 (px)', 'chapterMetaFontSize', 9, 20, 1, 'px');
    this.addNumberSetting('章名顶部位置', '章名距离页面顶部的位置 (px)', 'chapterMetaTop', 0, 80, 1, 'px');
    this.addTextSetting('章名颜色', 'RGB 格式；留空使用主题弱化文字颜色。', 'chapterMetaColor', '例如 120,120,120');
    this.addNumberSetting('进度字号', '页面底部百分比小字大小 (px)', 'progressMetaFontSize', 9, 20, 1, 'px');
    this.addNumberSetting('进度底部位置', '百分比距离页面底部的位置 (px)', 'progressMetaBottom', 0, 80, 1, 'px');
    this.addTextSetting('进度颜色', 'RGB 格式；留空使用主题弱化文字颜色。', 'progressMetaColor', '例如 120,120,120');

    containerEl.createEl('h3', { text: '功能开关' });
    new Setting(containerEl)
      .setName('显示阅读进度')
      .setDesc('在页面底部显示阅读百分比')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showProgress).onChange(async (v) => {
          this.plugin.settings.showProgress = v;
          await this.plugin.savePluginData();
        }),
      );

    new Setting(containerEl)
      .setName('去除多余空行')
      .setDesc('自动清理 TXT 中连续的空白行')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.removeExtraBlankLines).onChange(async (v) => {
          this.plugin.settings.removeExtraBlankLines = v;
          await this.plugin.savePluginData();
        }),
      );

    containerEl.createEl('h3', { text: '目录与编码' });
    this.addTextSetting('目录匹配正则', '所有书籍默认章节匹配正则；单书设置可覆写。', 'tocRegex', DEFAULT_SETTINGS.tocRegex);

    new Setting(containerEl)
      .setName('默认编码')
      .setDesc('打开文件时的默认编码（自动检测失败时使用）')
      .addDropdown((dd) =>
        dd
          .addOptions({
            'utf-8': 'UTF-8',
            gbk: 'GBK',
            gb18030: 'GB18030',
            big5: 'Big5',
          })
          .setValue(this.plugin.settings.defaultEncoding)
          .onChange(async (v) => {
            this.plugin.settings.defaultEncoding = v;
            await this.plugin.savePluginData();
          }),
      );

    this.addTextSetting(
      '全文搜索快捷键',
      '默认 Ctrl+F。支持 Ctrl/Alt/Shift 加单个按键，例如 Ctrl+Shift+F。',
      'searchHotkey',
      DEFAULT_SETTINGS.searchHotkey,
    );
  }

  private addNumberSetting(
    name: string,
    desc: string,
    key: NumericSettingKey,
    min: number,
    max: number,
    step: number,
    unit: string,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addSlider((slider) =>
        slider
          .setLimits(min, max, step)
          .setValue(this.plugin.settings[key])
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings[key] = v;
            await this.plugin.savePluginData();
          }),
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings[key]))
          .setPlaceholder(unit)
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isNaN(n)) return;
            this.plugin.settings[key] = Math.min(max, Math.max(min, n));
            await this.plugin.savePluginData();
          }),
      );
  }

  private addTextSetting(
    name: string,
    desc: string,
    key: 'fontColor' | 'backgroundColor' | 'chapterMetaColor' | 'progressMetaColor' | 'tocRegex' | 'searchHotkey',
    placeholder: string,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text
          .setPlaceholder(placeholder)
          .setValue(this.plugin.settings[key])
          .onChange(async (v) => {
            const fallback = key === 'searchHotkey' ? DEFAULT_SETTINGS.searchHotkey : '';
            this.plugin.settings[key] = v.trim() || fallback;
            await this.plugin.savePluginData();
          }),
      );
  }
}
