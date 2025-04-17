import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { PaperCanvasView, PAPER_CANVAS_VIEW_TYPE } from './paper-canvas-view';


interface PaperCanvasSettings {
	paperSize: string;
	customWidth: number;
	customHeight: number;
	paperUnit: string; // mm, cm, in
}

const DEFAULT_SETTINGS: PaperCanvasSettings = {
	paperSize: 'a4',
	customWidth: 210,
	customHeight: 297,
	paperUnit: 'mm'
}

const PAPER_SIZES: Record<'a4' | 'a5' | 'letter' | 'legal' | 'custom', { width: number; height: number }> = {

	'a4': { width: 210, height: 297 }, // mm
	'a5': { width: 148, height: 210 }, // mm
	'letter': { width: 216, height: 279 }, // mm (8.5 x 11 inches)
	'legal': { width: 216, height: 356 }, // mm (8.5 x 14 inches)
	'custom': { width: 0, height: 0 } // Will be replaced with customWidth and customHeight
};

export default class PaperCanvasPlugin extends Plugin {
	settings: PaperCanvasSettings;

	async onload() {
		await this.loadSettings();

		// Register the custom view type
		this.registerView(
			PAPER_CANVAS_VIEW_TYPE,
			(leaf) => new PaperCanvasView(leaf, this)
		);

		// Add a command to create a new paper canvas
		this.addCommand({
			id: 'create-paper-canvas',
			name: 'Create new Paper Canvas',
			callback: () => {
				this.createNewPaperCanvas();
			}
		});

		// Add settings tab
		this.addSettingTab(new PaperCanvasSettingTab(this.app, this));
	}

	onunload() {
		// Unregister the view when the plugin is disabled
		this.app.workspace.detachLeavesOfType(PAPER_CANVAS_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async createNewPaperCanvas() {
		console.log("📄 Creating a new paper canvas...");
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({
			type: PAPER_CANVAS_VIEW_TYPE,
			state: { 
				paperSize: this.settings.paperSize,
				customWidth: this.settings.customWidth,
				customHeight: this.settings.customHeight,
				paperUnit: this.settings.paperUnit,
				pages: [{ id: '1', nodes: [] }]
			}
		});
	}
	

	getPaperDimensions(): { width: number, height: number } {
		if (this.settings.paperSize === 'custom') {
			return {
				width: this.settings.customWidth,
				height: this.settings.customHeight
			};
		} else {
			return PAPER_SIZES[this.settings.paperSize as keyof typeof PAPER_SIZES];

		}
	}
}

class PaperCanvasSettingTab extends PluginSettingTab {
	plugin: PaperCanvasPlugin;

	constructor(app: App, plugin: PaperCanvasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Paper Canvas Settings' });

		new Setting(containerEl)
			.setName('Paper Size')
			.setDesc('Choose a predefined paper size or select custom to specify dimensions')
			.addDropdown(dropdown => dropdown
				.addOption('a4', 'A4')
				.addOption('a5', 'A5')
				.addOption('letter', 'Letter')
				.addOption('legal', 'Legal')
				.addOption('custom', 'Custom')
				.setValue(this.plugin.settings.paperSize)
				.onChange(async (value) => {
					this.plugin.settings.paperSize = value;
					await this.plugin.saveSettings();
					// Refresh the display to show/hide custom size inputs
					this.display();
				}));

		if (this.plugin.settings.paperSize === 'custom') {
			new Setting(containerEl)
				.setName('Custom Width')
				.setDesc('Width of the paper')
				.addText(text => text
					.setValue(this.plugin.settings.customWidth.toString())
					.onChange(async (value) => {
						const numValue = parseFloat(value);
						if (!isNaN(numValue) && numValue > 0) {
							this.plugin.settings.customWidth = numValue;
							await this.plugin.saveSettings();
						}
					}));

			new Setting(containerEl)
				.setName('Custom Height')
				.setDesc('Height of the paper')
				.addText(text => text
					.setValue(this.plugin.settings.customHeight.toString())
					.onChange(async (value) => {
						const numValue = parseFloat(value);
						if (!isNaN(numValue) && numValue > 0) {
							this.plugin.settings.customHeight = numValue;
							await this.plugin.saveSettings();
						}
					}));

			new Setting(containerEl)
				.setName('Unit')
				.setDesc('Unit of measurement')
				.addDropdown(dropdown => dropdown
					.addOption('mm', 'Millimeters (mm)')
					.addOption('cm', 'Centimeters (cm)')
					.addOption('in', 'Inches (in)')
					.setValue(this.plugin.settings.paperUnit)
					.onChange(async (value) => {
						this.plugin.settings.paperUnit = value;
						await this.plugin.saveSettings();
					}));
		}
	}
}