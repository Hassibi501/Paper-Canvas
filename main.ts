import { Plugin, WorkspaceLeaf, TFile, Notice, App, PluginSettingTab } from 'obsidian'; // Removed debounce
import { PaperCanvasSettings, PaperCanvasPluginInterface, CanvasView, PageData, NodeState } from './types'; // Added PageData, NodeState here if needed, CanvasView is important
import { DEFAULT_SETTINGS, PaperCanvasSettingTab } from './settings';
import { StateManager } from './stateManager';
import { ViewManager } from './viewManager';
import { PdfExporter } from './pdfExporter';
import { PAGE_GAP } from './constants';

export default class PaperCanvasPlugin extends Plugin implements PaperCanvasPluginInterface {
    // ... properties ...
    settings: PaperCanvasSettings;
    stateManager: StateManager;
    viewManager: ViewManager;
    pdfExporter: PdfExporter;
    currentCanvasFile: TFile | null = null;

    constructor(app: App, manifest: any) {
        super(app, manifest);
        // Initialize managers here, passing 'this' which implements the interface
        this.stateManager = new StateManager(this);
        this.viewManager = new ViewManager(this);
        this.pdfExporter = new PdfExporter(this);
    }

    async onload() {
        console.log('Loading Paper Canvas Plugin (v12 - Refactored)');
        await this.loadSettings(); // Load global settings first

        this.addSettingTab(new PaperCanvasSettingTab(this.app, this));

        // Initialize managers/styles
        this.viewManager.initializeStyles(); // Add styles needed by view manager
        this.stateManager.resetLocalState(); // Start with fresh state

        // Register Events (use arrow functions to maintain 'this' context)
        this.registerEvent(this.app.workspace.on('layout-change', this.handleLayoutChange));
        this.registerEvent(this.app.workspace.on('active-leaf-change', this.handleActiveLeafChange));
        this.app.workspace.onLayoutReady(this.handleLayoutChange); // Initial check

        // --- Register Commands ---
        this.addCommand({ id: 'paper-canvas-add-new-page', name: 'Paper Canvas: Add New Page', callback: this.addNewPage });
        this.addCommand({ id: 'paper-canvas-next-page', name: 'Paper Canvas: Go to Next Page', callback: () => this.goToPage(this.stateManager.getCurrentPageIndex() + 1) });
        this.addCommand({ id: 'paper-canvas-previous-page', name: 'Paper Canvas: Go to Previous Page', callback: () => this.goToPage(this.stateManager.getCurrentPageIndex() - 1) });
        // Commented out single page export command
        // this.addCommand({ id: 'paper-canvas-export-current-page', name: 'Paper Canvas: Export Current Page as PDF', checkCallback: this.checkExportCallback(() => this.pdfExporter.exportSinglePageAsPDF(this.stateManager.getCurrentPageIndex(), this.stateManager.getAllNodeStates(), this.viewManager.getObservedCanvasElement(), this.currentCanvasFile)) });
        this.addCommand({ id: 'paper-canvas-export-all-pages', name: 'Paper Canvas: Export All Pages as PDF', checkCallback: this.checkExportCallback(
            () => this.pdfExporter.exportAllPagesAsPDF(
                this.stateManager.getPages(),
                this.stateManager.getAllNodeStates(),
                this.viewManager.getObservedCanvasElement(), // Pass current element
                this.currentCanvasFile
            )
        )});
    }

    async onunload() {
        console.log('Unloading Paper Canvas Plugin');
        // Ensure final save if needed
        if (this.currentCanvasFile) {
            // Clear timeout explicitly if using internal setTimeout in StateManager
            if (this.stateManager['saveTimeout']) { // Access private-like property if needed
                 clearTimeout(this.stateManager['saveTimeout']);
                 this.stateManager['saveTimeout'] = null;
             }
            console.log("Performing final save on unload...");
            await this.stateManager.saveCanvasData(this.currentCanvasFile, true); // Force save via StateManager
        }
        this.viewManager.cleanup(); // Cleanup view resources
        this.currentCanvasFile = null;
    }

    // --- Settings Management ---
    async loadSettings(): Promise<void> {
        const allData = await this.loadData() || {};
        this.settings = {
            pageWidthPx: allData.pageWidthPx ?? DEFAULT_SETTINGS.pageWidthPx,
            pageHeightPx: allData.pageHeightPx ?? DEFAULT_SETTINGS.pageHeightPx
        };
        console.log("Global Settings loaded/initialized:", this.settings);
    }

    async saveSettings(): Promise<void> {
         const settingsToSave: PaperCanvasSettings = {
             pageWidthPx: this.settings.pageWidthPx,
             pageHeightPx: this.settings.pageHeightPx
         };
         let allData = await this.loadData() || {};
         // Ensure only settings properties are merged, preserving canvas data keys
         allData.pageWidthPx = settingsToSave.pageWidthPx;
         allData.pageHeightPx = settingsToSave.pageHeightPx;
        await this.saveData(allData);
        console.log("Global Settings saved via interface method:", settingsToSave);

        const observedElement = this.viewManager.getObservedCanvasElement();
        if (this.currentCanvasFile && observedElement) {
             this.viewManager.updatePageMarker(this.stateManager.getCurrentPageIndex(), this.stateManager.getPages().length);
             this.viewManager.applyNodeVisibilityAndPosition(
                 observedElement,
                 this.stateManager.getCurrentPageIndex(),
                 this.stateManager.getAllNodeStates() // Call function
             );
        }
    }

    // --- Event Handlers --- (Arrow functions for correct 'this')
    private handleLayoutChange = async (): Promise<void> => {
        await this.updatePluginStateForLeaf(this.app.workspace.activeLeaf);
    }
    private handleActiveLeafChange = async (leaf: WorkspaceLeaf | null): Promise<void> => {
         await this.updatePluginStateForLeaf(leaf);
    }

    // Central logic for handling leaf changes
    private async updatePluginStateForLeaf(activeLeaf: WorkspaceLeaf | null): Promise<void> {
        if (this.isCanvasView(activeLeaf)) {
            const canvasFile = activeLeaf.view.file; // file is guaranteed by isCanvasView check now
            if (!this.currentCanvasFile || this.currentCanvasFile.path !== canvasFile?.path) {
                // Switched to a new/different canvas
                console.log(`Plugin: Switched to canvas ${canvasFile?.path}`);
                if (this.currentCanvasFile) {
                     // Clear timeout explicitly if needed
                     if (this.stateManager['saveTimeout']) clearTimeout(this.stateManager['saveTimeout']); this.stateManager['saveTimeout'] = null;
                    await this.stateManager.saveCanvasData(this.currentCanvasFile, true); // Save previous immediately
                }
                this.currentCanvasFile = canvasFile;
                await this.stateManager.loadCanvasData(this.currentCanvasFile); // Load or reset state for the new one
                this.initializeCanvasView(activeLeaf); // Initialize view for new state
            } else if (!this.viewManager.getObservedCanvasElement() && this.currentCanvasFile) {
                // Re-initializing view for the *same* canvas
                console.log("Plugin: Re-initializing view for current canvas.");
                this.initializeCanvasView(activeLeaf); // State exists, setup view
            }
        } else {
            // Left canvas view
            if (this.currentCanvasFile) {
                console.log(`Plugin: Left canvas ${this.currentCanvasFile.path}`);
                 // Clear timeout explicitly if needed
                 if (this.stateManager['saveTimeout']) clearTimeout(this.stateManager['saveTimeout']); this.stateManager['saveTimeout'] = null;
                await this.stateManager.saveCanvasData(this.currentCanvasFile, true); // Save immediately
                this.viewManager.cleanup(); // Cleanup view manager resources
                this.currentCanvasFile = null;
            }
        }
    }

    // Initialize ViewManager for a specific canvas leaf
    private initializeCanvasView(leaf: WorkspaceLeaf): void {
        if (!this.isCanvasView(leaf)) return;
        const canvasElement = this.viewManager.getCanvasElement(leaf);
        if (!canvasElement) { this.showNotice("Paper Canvas could not find the canvas element."); return; }

        // Check if ViewManager already observes this exact element
        if (this.viewManager.getObservedCanvasElement() === canvasElement) {
             console.log("Plugin: View already initialized for this element.");
             // Ensure UI is up-to-date in case state was reloaded without full re-init
             this.viewManager.updatePageIndicator(this.stateManager.getCurrentPageIndex(), this.stateManager.getPages().length);
             this.viewManager.applyNodeVisibilityAndPosition(canvasElement, this.stateManager.getCurrentPageIndex(), this.stateManager.getAllNodeStates());
             return;
        }

        console.log("Plugin: Initializing canvas view via ViewManager...");
        this.viewManager.cleanup(); // Clean up any previous view first

        // Setup observer via ViewManager, passing StateManager methods bound correctly or via wrapper
        // *** FIX HERE: Remove removeNodeState from this object literal ***
        this.viewManager.setupCanvasObserver(canvasElement, {
            handleNodeStyleChange: (nodeEl, rect) => {
                const nodeId = this.stateManager.ensureNodeId(nodeEl);
                const state = this.stateManager.getNodeState(nodeId);
                if (state) {
                   const { stateChanged, clampedResult } = this.stateManager.updateNodeStateFromStyleChange(nodeId, state, rect);
                   if (clampedResult.changed) {
                        this.viewManager.isUpdatingNodePosition = true;
                        const pageDimensions = this.getPageDimensions();
                        const absoluteY = clampedResult.y + state.pageIndex * (pageDimensions.height + PAGE_GAP);
                        this.viewManager.updateNodeTransform(nodeEl, clampedResult.x, absoluteY);
                        setTimeout(() => this.viewManager.isUpdatingNodePosition = false, 0);
                   }
                } else { console.warn(`Style change on node ${nodeId} without state?`); }
            },
            assignStateToNewNode: (nodeEl, rect) => this.stateManager.assignStateToNewNode(nodeEl, rect),
            // removeNodeState: (nodeId: string) => { /* console.log(`Node ${nodeId} removed from DOM, state kept.`); */ }, // <-- REMOVE THIS LINE
            getNodeState: (nodeId) => this.stateManager.getNodeState(nodeId),
            ensureNodeId: (nodeEl) => this.stateManager.ensureNodeId(nodeEl)
        });

        // Setup UI elements via ViewManager, getting current state AFTER load/reset
        const currentPageIndex = this.stateManager.getCurrentPageIndex();
        const pages = this.stateManager.getPages();
        const nodeStates = this.stateManager.getAllNodeStates(); // Get current map

        this.viewManager.updatePageMarker(currentPageIndex, pages.length);
        this.viewManager.setupPageControls(leaf, currentPageIndex, pages.length, this.goToPage, this.addNewPage);
        this.viewManager.addActionButtons(leaf,
             () => this.pdfExporter.exportAllPagesAsPDF(pages, nodeStates, canvasElement, this.currentCanvasFile) // Pass current canvas element
        );
        this.viewManager.applyNodeVisibilityAndPosition(canvasElement, currentPageIndex, nodeStates);
        this.viewManager.positionCamera(leaf, currentPageIndex);
    }


    // --- Command Implementations --- (Arrow functions for correct 'this')

    private addNewPage = (): void => {
        const newIndex = this.stateManager.addNewPage();
        // Go to the new page, which will trigger UI updates via ViewManager
        this.goToPage(newIndex);
    }

    private goToPage = (targetPageIndex: number): void => {
         const pages = this.stateManager.getPages();
         const totalPages = pages.length;
         // Validate target index
         if (targetPageIndex < 0 || targetPageIndex >= totalPages) {
             console.warn(`goToPage: Invalid target index ${targetPageIndex}`); return;
         }
         if (targetPageIndex === this.stateManager.getCurrentPageIndex()) {
             console.log(`goToPage: Already on page ${targetPageIndex + 1}`); return;
         }

         const activeLeaf = this.app.workspace.activeLeaf;
         if (!this.isCanvasView(activeLeaf)) return;
         const canvasElement = this.viewManager.getObservedCanvasElement();
         if (!canvasElement) return;

         console.log(`Plugin: Switching to page ${targetPageIndex + 1}`);
         this.stateManager.setCurrentPageIndex(targetPageIndex); // Update state first

         // Get potentially updated state
         const nodeStates = this.stateManager.getAllNodeStates();

         // Update view elements via ViewManager
         this.viewManager.updatePageMarker(targetPageIndex, totalPages);
         this.viewManager.updatePageIndicator(targetPageIndex, totalPages);
         this.viewManager.applyNodeVisibilityAndPosition(canvasElement, targetPageIndex, nodeStates);
         this.viewManager.positionCamera(activeLeaf, targetPageIndex);
         this.showNotice(`Switched to ${pages[targetPageIndex].name}`);
    }

    // checkExportCallback implementation (only checks for export all)
    private checkExportCallback = (exportAllCallback: () => void) => {
        return (checking: boolean): boolean => {
            const activeLeaf = this.app.workspace.activeLeaf;
            const canExport = this.isCanvasView(activeLeaf) && this.viewManager.getObservedCanvasElement() != null && this.stateManager.getPages().length > 0;
            if (canExport && !checking) {
                exportAllCallback();
            }
            return canExport;
        };
    }

    // --- Interface Implementations for Managers ---
    showNotice(message: string, duration?: number): void { new Notice(`Paper Canvas: ${message}`, duration ?? 3000); }
    requestSave(): void { this.stateManager.requestSave(); }
    getCurrentFile(): TFile | null { return this.currentCanvasFile; }
    getCurrentPageIndex(): number { return this.stateManager.getCurrentPageIndex(); }
    getPageDimensions(): { width: number; height: number; } { return { width: this.settings.pageWidthPx, height: this.settings.pageHeightPx }; }
    // isCanvasView implementation (Correct type predicate)
    isCanvasView(leaf: WorkspaceLeaf | null | undefined): leaf is WorkspaceLeaf & { view: CanvasView } { return !!leaf && leaf.view?.getViewType() === 'canvas'; }
    // saveSettings implementation is above (needed by interface)

} // --- End of Plugin Class ---