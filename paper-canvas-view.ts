import { ItemView, WorkspaceLeaf } from 'obsidian';
import PaperCanvasPlugin from './main';

export const PAPER_CANVAS_VIEW_TYPE = 'paper-canvas-view';

interface CanvasNode {
	id: string;
}

interface CanvasPage {
	id: string;
	nodes: CanvasNode[];
}

interface PaperCanvasState {
	paperSize: string;
	customWidth: number;
	customHeight: number;
	paperUnit: string;
	pages: CanvasPage[];
	currentPageIndex: number;
}

export class PaperCanvasView extends ItemView {
	plugin: PaperCanvasPlugin;
	state: PaperCanvasState;
	canvasContainer: HTMLElement;
	pageNavigator: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: PaperCanvasPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.state = {
			paperSize: plugin.settings.paperSize,
			customWidth: plugin.settings.customWidth,
			customHeight: plugin.settings.customHeight,
			paperUnit: plugin.settings.paperUnit,
			pages: [{ id: '1', nodes: [] }],
			currentPageIndex: 0
		};
	}

	getViewType(): string {
		return PAPER_CANVAS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Paper Canvas';
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const container = contentEl.createDiv({ cls: 'paper-canvas-container' });

		const toolbar = container.createDiv({ cls: 'paper-canvas-toolbar' });
		this.createToolbar(toolbar);

		this.pageNavigator = container.createDiv({ cls: 'paper-canvas-page-navigator' });
		this.updatePageNavigator();

		this.canvasContainer = container.createDiv({ cls: 'paper-canvas-canvas-container' });
		this.renderCurrentPage();
	}

	createToolbar(toolbar: HTMLElement) {
		const addPageBtn = toolbar.createEl('button', { text: 'Add Page' });
		addPageBtn.addEventListener('click', () => {
			this.addNewPage();
		});

		const exportBtn = toolbar.createEl('button', { text: 'Export to PDF' });
		exportBtn.addEventListener('click', () => {
			this.exportToPDF();
		});

		const paperSize = this.plugin.getPaperDimensions();
		toolbar.createSpan({
			text: `Paper size: ${this.state.paperSize.toUpperCase()} (${paperSize.width}${this.state.paperUnit} × ${paperSize.height}${this.state.paperUnit})`
		});
	}

	updatePageNavigator() {
		this.pageNavigator.empty();

		this.state.pages.forEach((page, index) => {
			const pageButton = this.pageNavigator.createEl('button', {
				text: `Page ${index + 1}`,
				cls: index === this.state.currentPageIndex ? 'active' : ''
			});

			pageButton.addEventListener('click', () => {
				this.state.currentPageIndex = index;
				this.renderCurrentPage();
				this.updatePageNavigator();
			});
		});
	}

	renderCurrentPage() {
		this.canvasContainer.empty();

		const { width, height } = this.plugin.getPaperDimensions();
		const page = this.canvasContainer.createDiv({ cls: 'paper-canvas-page' });

		page.style.width = `${width}mm`;
		page.style.height = `${height}mm`;

		page.createEl('div', {
			cls: 'paper-canvas-placeholder',
			text: `Canvas Page ${this.state.currentPageIndex + 1}`
		});
	}

	addNewPage() {
		const newPageId = (this.state.pages.length + 1).toString();
		this.state.pages.push({ id: newPageId, nodes: [] });
		this.state.currentPageIndex = this.state.pages.length - 1;
		this.updatePageNavigator();
		this.renderCurrentPage();
	}

	exportToPDF() {
		alert('Export to PDF functionality will be implemented here');
	}

	async onClose() {
		// cleanup
	}
}
