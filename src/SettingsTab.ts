import { App, PluginSettingTab, Setting } from 'obsidian';
import PuffsReaderPlugin from './main';
import { DEFAULT_SETTINGS } from './types';

export class SettingsTab extends PluginSettingTab {
  plugin: PuffsReaderPlugin;

  constructor(app: App, plugin: PuffsReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── 排版设置 ──
    containerEl.createEl('h3', { text: '排版设置' });

    new Setting(containerEl)
      .setName('字体大小')
      .setDesc('阅读区文字大小 (px)')
      .addSlider((slider) =>
        slider
          .setLimits(12, 32, 1)
          .setValue(this.plugin.settings.fontSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.fontSize = v;
            await this.plugin.savePluginData();
          }),
      );

    new Setting(containerEl)
      .setName('行间距')
      .setDesc('行间距倍数')
      .addSlider((slider) =>
        slider
          .setLimits(1, 3, 0.1)
          .setValue(this.plugin.settings.lineHeight)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.lineHeight = v;
            await this.plugin.savePluginData();
          }),
      );

    new Setting(containerEl)
      .setName('段落间距')
      .setDesc('段落之间的距离 (px)')
      .addSlider((slider) =>
        slider
          .setLimits(0, 40, 2)
          .setValue(this.plugin.settings.paragraphSpacing)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.paragraphSpacing = v;
            await this.plugin.savePluginData();
          }),
      );

    new Setting(containerEl)
      .setName('首行缩进')
      .setDesc('段落首行缩进 (em)')
      .addSlider((slider) =>
        slider
          .setLimits(0, 4, 0.5)
          .setValue(this.plugin.settings.firstLineIndent)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.firstLineIndent = v;
            await this.plugin.savePluginData();
          }),
      );

    new Setting(containerEl)
      .setName('阅读区宽度')
      .setDesc('阅读区最大宽度 (px)')
      .addSlider((slider) =>
        slider
          .setLimits(400, 1400, 50)
          .setValue(this.plugin.settings.contentWidth)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.contentWidth = v;
            await this.plugin.savePluginData();
          }),
      );

    new Setting(containerEl)
      .setName('字间距')
      .setDesc('文字之间的距离 (px)')
      .addSlider((slider) =>
        slider
          .setLimits(0, 6, 0.5)
          .setValue(this.plugin.settings.letterSpacing)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.letterSpacing = v;
            await this.plugin.savePluginData();
          }),
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.letterSpacing))
          .onChange(async (v) => {
            const n = Number(v);
            if (!Number.isNaN(n)) {
              this.plugin.settings.letterSpacing = n;
              await this.plugin.savePluginData();
            }
          }),
      );

    new Setting(containerEl)
      .setName('顶部间距')
      .setDesc('最上方文字与页面顶部的距离 (px)')
      .addSlider((slider) =>
        slider
          .setLimits(0, 160, 4)
          .setValue(this.plugin.settings.paddingTop)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.paddingTop = v;
            await this.plugin.savePluginData();
          }),
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.paddingTop))
          .onChange(async (v) => {
            const n = Number(v);
            if (!Number.isNaN(n)) {
              this.plugin.settings.paddingTop = n;
              await this.plugin.savePluginData();
            }
          }),
      );

    new Setting(containerEl)
      .setName('底部间距')
      .setDesc('最下方文字与页面底部的距离 (px)')
      .addSlider((slider) =>
        slider
          .setLimits(0, 200, 4)
          .setValue(this.plugin.settings.paddingBottom)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.paddingBottom = v;
            await this.plugin.savePluginData();
          }),
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.paddingBottom))
          .onChange(async (v) => {
            const n = Number(v);
            if (!Number.isNaN(n)) {
              this.plugin.settings.paddingBottom = n;
              await this.plugin.savePluginData();
            }
          }),
      );

    new Setting(containerEl)
      .setName('字体颜色')
      .setDesc('RGB 格式，如 51,51,51。留空跟随主题。')
      .addText((text) =>
        text
          .setPlaceholder('例如 51,51,51')
          .setValue(this.plugin.settings.fontColor)
          .onChange(async (v) => {
            this.plugin.settings.fontColor = v.trim();
            await this.plugin.savePluginData();
          }),
      );

    new Setting(containerEl)
      .setName('背景颜色')
      .setDesc('RGB 格式，如 233,216,188。留空跟随主题。')
      .addText((text) =>
        text
          .setPlaceholder('例如 233,216,188')
          .setValue(this.plugin.settings.backgroundColor)
          .onChange(async (v) => {
            this.plugin.settings.backgroundColor = v.trim();
            await this.plugin.savePluginData();
          }),
      );

    // ── 功能开关 ──
    containerEl.createEl('h3', { text: '功能开关' });

    new Setting(containerEl)
      .setName('显示阅读进度')
      .setDesc('在底部状态栏显示阅读百分比')
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

    // ── 目录与编码 ──
    containerEl.createEl('h3', { text: '目录与编码' });

    new Setting(containerEl)
      .setName('目录匹配正则')
      .setDesc('用于自动提取章节标题的正则表达式')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.tocRegex)
          .setValue(this.plugin.settings.tocRegex)
          .onChange(async (v) => {
            this.plugin.settings.tocRegex = v.trim();
            await this.plugin.savePluginData();
          }),
      );

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

    new Setting(containerEl)
      .setName('全文搜索快捷键')
      .setDesc('默认 Ctrl+F。支持 Ctrl/Alt/Shift 加单个按键，例如 Ctrl+Shift+F。')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.searchHotkey)
          .setValue(this.plugin.settings.searchHotkey)
          .onChange(async (v) => {
            this.plugin.settings.searchHotkey = v.trim() || DEFAULT_SETTINGS.searchHotkey;
            await this.plugin.savePluginData();
          }),
      );
  }
}
