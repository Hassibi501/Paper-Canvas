import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { PaperCanvasSettings } from './types';
// Import the interface, NOT the concrete class to avoid circular dependency issues
import type { PaperCanvasPluginInterface } from './types';

export const DEFAULT_SETTINGS: PaperCanvasSettings = {
    pageWidthPx: 794,  // A4 width @ 96 DPI
    pageHeightPx: 1123, // A4 height @ 96 DPI
}

export class PaperCanvasSettingTab extends PluginSettingTab {
    // Use the interface which extends Plugin
    plugin: PaperCanvasPluginInterface;

    // Constructor still expects App and the plugin instance
    constructor(app: App, plugin: PaperCanvasPluginInterface) {
        super(app, plugin); // Pass the plugin instance to super
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Paper Canvas Settings' });

        new Setting(containerEl)
            .setName('Page Width (px)')
            .setDesc('Default width for pages in pixels (e.g., A4 @ 96 DPI is 794). Reload canvas for changes to apply fully.')
            .addText(text => text
                .setPlaceholder(String(DEFAULT_SETTINGS.pageWidthPx))
                .setValue(String(this.plugin.settings.pageWidthPx))
                .onChange(async (value) => {
                    const width = parseInt(value.trim(), 10);
                    if (!isNaN(width) && width > 50) {
                        this.plugin.settings.pageWidthPx = width;
                        // Call saveSettings on the plugin instance
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Page Height (px)')
            .setDesc('Default height for pages in pixels (e.g., A4 @ 96 DPI is 1123). Reload canvas for changes to apply fully.')
            .addText(text => text
                .setPlaceholder(String(DEFAULT_SETTINGS.pageHeightPx))
                .setValue(String(this.plugin.settings.pageHeightPx))
                .onChange(async (value) => {
                    const height = parseInt(value.trim(), 10);
                    if (!isNaN(height) && height > 50) {
                        this.plugin.settings.pageHeightPx = height;
                        await this.plugin.saveSettings();
                    }
                }));
    }
}