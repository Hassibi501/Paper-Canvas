// Code remains the same as the previous complete version provided.
// Calls to stateManager/viewManager are correct.
import {
	Plugin,
	WorkspaceLeaf,
	TFile,
	Notice,
	App,
	PluginSettingTab,
} from "obsidian";
import {
	PaperCanvasSettings,
	PaperCanvasPluginInterface,
	CanvasView,
	PageData,
	NodeState,
} from "./types";
import { DEFAULT_SETTINGS, PaperCanvasSettingTab } from "./settings";
import { StateManager } from "./stateManager";
import { ViewManager } from "./viewManager";
import { PdfExporter } from "./pdfExporter";
import { PAGE_GAP } from "./constants";

export default class PaperCanvasPlugin
	extends Plugin
	implements PaperCanvasPluginInterface
{
	settings: PaperCanvasSettings;
	stateManager: StateManager;
	viewManager: ViewManager;
	pdfExporter: PdfExporter;
	currentCanvasFile: TFile | null = null;
	constructor(app: App, manifest: any) {
		super(app, manifest);
		this.stateManager = new StateManager(this);
		this.viewManager = new ViewManager(this);
		this.pdfExporter = new PdfExporter(this);
	}
	async onload() {
		console.log("Loading Paper Canvas Plugin (v14)");
		await this.loadSettings();
		this.addSettingTab(new PaperCanvasSettingTab(this.app, this));
		this.viewManager.initializeStyles();
		this.stateManager.resetLocalState();
		this.registerEvent(
			this.app.workspace.on("layout-change", this.handleLayoutChange)
		);
		this.registerEvent(
			this.app.workspace.on(
				"active-leaf-change",
				this.handleActiveLeafChange
			)
		);
		this.app.workspace.onLayoutReady(this.handleLayoutChange);
		this.addCommand({
			id: "paper-canvas-add-new-page",
			name: "Paper Canvas: Add New Page",
			callback: this.addNewPage,
		});
		this.addCommand({
			id: "paper-canvas-next-page",
			name: "Paper Canvas: Go to Next Page",
			callback: () =>
				this.goToPage(this.stateManager.getCurrentPageIndex() + 1),
		});
		this.addCommand({
			id: "paper-canvas-previous-page",
			name: "Paper Canvas: Go to Previous Page",
			callback: () =>
				this.goToPage(this.stateManager.getCurrentPageIndex() - 1),
		});
		this.addCommand({
			id: "paper-canvas-export-all-pages",
			name: "Paper Canvas: Export All Pages as PDF",
			checkCallback: this.checkExportCallback(() =>
				this.pdfExporter.exportAllPagesAsPDF(
					this.stateManager.getPages(),
					this.stateManager.getAllNodeStates(),
					this.viewManager.getObservedCanvasElement(),
					this.currentCanvasFile
				)
			),
		});
	}
	async onunload() {
		console.log("Unloading Paper Canvas Plugin");
		if (this.currentCanvasFile) {
			if (this.stateManager["saveTimeout"]) {
				clearTimeout(this.stateManager["saveTimeout"]);
				this.stateManager["saveTimeout"] = null;
				console.log("Cleared pending save timeout on unload.");
			}
			console.log("Performing final save on unload...");
			await this.stateManager.saveCanvasData(
				this.currentCanvasFile,
				true
			);
		}
		this.viewManager.cleanup();
		this.currentCanvasFile = null;
	}
	async loadSettings(): Promise<void> {
		const allData = (await this.loadData()) || {};
		this.settings = {
			pageWidthPx: allData.pageWidthPx ?? DEFAULT_SETTINGS.pageWidthPx,
			pageHeightPx: allData.pageHeightPx ?? DEFAULT_SETTINGS.pageHeightPx,
		};
		console.log("Global Settings loaded/initialized:", this.settings);
	}
	async saveSettings(): Promise<void> {
		const settingsToSave: PaperCanvasSettings = {
			pageWidthPx: this.settings.pageWidthPx,
			pageHeightPx: this.settings.pageHeightPx,
		};
		let allData = (await this.loadData()) || {};
		allData.pageWidthPx = settingsToSave.pageWidthPx;
		allData.pageHeightPx = settingsToSave.pageHeightPx;
		await this.saveData(allData);
		console.log(
			"Global Settings saved via interface method:",
			settingsToSave
		);
		const observedElement = this.viewManager.getObservedCanvasElement();
		if (this.currentCanvasFile && observedElement) {
			this.viewManager.updatePageMarker(
				this.stateManager.getCurrentPageIndex(),
				this.stateManager.getPages().length
			);
			this.viewManager.applyNodeVisibilityAndPosition(
				observedElement,
				this.stateManager.getCurrentPageIndex(),
				this.stateManager.getAllNodeStates()
			);
		}
	}
	private handleLayoutChange = async (): Promise<void> => {
		await this.updatePluginStateForLeaf(this.app.workspace.activeLeaf);
	};
	private handleActiveLeafChange = async (
		leaf: WorkspaceLeaf | null
	): Promise<void> => {
		await this.updatePluginStateForLeaf(leaf);
	};
	private async updatePluginStateForLeaf(
		activeLeaf: WorkspaceLeaf | null
	): Promise<void> {
		if (this.isCanvasView(activeLeaf)) {
			const canvasFile = activeLeaf.view.file;
			if (!canvasFile) {
				console.log(
					"Plugin: Ignoring canvas view without a file (likely new/unsaved)."
				);
				if (this.currentCanvasFile) {
					await this.stateManager.saveCanvasData(
						this.currentCanvasFile,
						true
					);
					this.viewManager.cleanup();
					this.currentCanvasFile = null;
				}
				return;
			}
			if (
				!this.currentCanvasFile ||
				this.currentCanvasFile.path !== canvasFile.path
			) {
				console.log(`Plugin: Switched to canvas ${canvasFile.path}`);
				if (this.currentCanvasFile) {
					if (this.stateManager["saveTimeout"])
						clearTimeout(this.stateManager["saveTimeout"]);
					this.stateManager["saveTimeout"] = null;
					await this.stateManager.saveCanvasData(
						this.currentCanvasFile,
						true
					);
				}
				this.currentCanvasFile = canvasFile;
				await this.stateManager.loadCanvasData(this.currentCanvasFile);
				this.initializeCanvasView(activeLeaf);
			} else if (
				!this.viewManager.getObservedCanvasElement() &&
				this.currentCanvasFile
			) {
				console.log("Plugin: Re-initializing view for current canvas.");
				this.initializeCanvasView(activeLeaf);
			}
		} else {
			if (this.currentCanvasFile) {
				console.log(
					`Plugin: Left canvas ${this.currentCanvasFile.path}`
				);
				if (this.stateManager["saveTimeout"])
					clearTimeout(this.stateManager["saveTimeout"]);
				this.stateManager["saveTimeout"] = null;
				await this.stateManager.saveCanvasData(
					this.currentCanvasFile,
					true
				);
				this.viewManager.cleanup();
				this.currentCanvasFile = null;
			}
		}
	}
	private initializeCanvasView(leaf: WorkspaceLeaf): void {
		if (!this.isCanvasView(leaf)) return;
		const canvasElement = this.viewManager.getCanvasElement(leaf);
		if (!canvasElement) {
			this.showNotice("Paper Canvas could not find the canvas element.");
			return;
		}
		if (this.viewManager.getObservedCanvasElement() === canvasElement) {
			console.log("Plugin: View already initialized for this element.");
			this.viewManager.updatePageIndicator(
				this.stateManager.getCurrentPageIndex(),
				this.stateManager.getPages().length
			);
			this.viewManager.applyNodeVisibilityAndPosition(
				canvasElement,
				this.stateManager.getCurrentPageIndex(),
				this.stateManager.getAllNodeStates()
			);
			return;
		}
		console.log("Plugin: Initializing canvas view via ViewManager...");
		this.viewManager.cleanup();
		this.viewManager.setupCanvasObserver(canvasElement, {
			updateNodeStateFromStyleChange: (
				nodeId: string,
				currentState: NodeState,
				rect: { x: number; y: number; width: number; height: number }
			) => {
				// This callback within main.ts now simply calls the corresponding StateManager method.
				// StateManager handles the logic, state updates, and saving.
				// ViewManager handles updating the DOM if clamping occurs (based on the return value).
				return this.stateManager.updateNodeStateFromStyleChange(
					nodeId,
					currentState,
					rect
				);
			},
			// *** The rest remain the same ***
			assignStateToNewNode: (nodeEl, rect) =>
				this.stateManager.assignStateToNewNode(nodeEl, rect),
			getNodeState: (nodeId) => this.stateManager.getNodeState(nodeId),
			ensureNodeId: (nodeEl) => this.stateManager.ensureNodeId(nodeEl),
		}); // End of object passed to setupCanvasObserver
		const currentPageIndex = this.stateManager.getCurrentPageIndex();
		const pages = this.stateManager.getPages();
		const nodeStates = this.stateManager.getAllNodeStates();
		this.viewManager.updatePageMarker(currentPageIndex, pages.length);
		this.viewManager.setupPageControls(
			leaf,
			currentPageIndex,
			pages.length,
			this.goToPage,
			this.addNewPage
		);
		this.viewManager.addActionButtons(leaf, () =>
			this.pdfExporter.exportAllPagesAsPDF(
				pages,
				nodeStates,
				canvasElement,
				this.currentCanvasFile
			)
		);
		this.viewManager.applyNodeVisibilityAndPosition(
			canvasElement,
			currentPageIndex,
			nodeStates
		);
		this.viewManager.positionCamera(leaf, currentPageIndex);
	}
	private addNewPage = (): void => {
		const newIndex = this.stateManager.addNewPage();
		this.goToPage(newIndex);
	};
	private goToPage = (targetPageIndex: number): void => {
		const pages = this.stateManager.getPages();
		const totalPages = pages.length;
		if (targetPageIndex < 0 || targetPageIndex >= totalPages) {
			console.warn(`goToPage: Invalid target index ${targetPageIndex}`);
			return;
		}
		if (targetPageIndex === this.stateManager.getCurrentPageIndex()) {
			console.log(`goToPage: Already on page ${targetPageIndex + 1}`);
			return;
		}
		const activeLeaf = this.app.workspace.activeLeaf;
		if (!this.isCanvasView(activeLeaf)) return;
		const canvasElement = this.viewManager.getObservedCanvasElement();
		if (!canvasElement) {
			console.error("goToPage: Cannot find observed canvas element.");
			return;
		}
		console.log(`Plugin: Switching to page ${targetPageIndex + 1}`);
		this.stateManager.setCurrentPageIndex(targetPageIndex);
		const nodeStates = this.stateManager.getAllNodeStates();
		this.viewManager.updatePageMarker(targetPageIndex, totalPages);
		this.viewManager.updatePageIndicator(targetPageIndex, totalPages);
		this.viewManager.applyNodeVisibilityAndPosition(
			canvasElement,
			targetPageIndex,
			nodeStates
		);
		this.viewManager.positionCamera(activeLeaf, targetPageIndex);
		this.showNotice(`Switched to ${pages[targetPageIndex].name}`);
	};
	private checkExportCallback = (exportAllCallback: () => void) => {
		return (checking: boolean): boolean => {
			const activeLeaf = this.app.workspace.activeLeaf;
			const canExport =
				this.isCanvasView(activeLeaf) &&
				this.viewManager.getObservedCanvasElement() != null &&
				this.stateManager.getPages().length > 0;
			if (canExport && !checking) {
				exportAllCallback();
			}
			return canExport;
		};
	};
	showNotice(message: string, duration?: number): void {
		new Notice(`Paper Canvas: ${message}`, duration ?? 3000);
	}
	requestSave(): void {
		this.stateManager.requestSave();
	}
	getCurrentFile(): TFile | null {
		return this.currentCanvasFile;
	}
	getCurrentPageIndex(): number {
		return this.stateManager.getCurrentPageIndex();
	}
	getPageDimensions(): { width: number; height: number } {
		return {
			width: this.settings.pageWidthPx,
			height: this.settings.pageHeightPx,
		};
	}
	isCanvasView(
		leaf: WorkspaceLeaf | null | undefined
	): leaf is WorkspaceLeaf & { view: CanvasView } {
		return !!leaf && leaf.view?.getViewType() === "canvas";
	}
}
