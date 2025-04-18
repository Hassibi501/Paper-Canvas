import { Plugin, WorkspaceLeaf, TFile, Notice, App, PluginSettingTab } from 'obsidian';
import { PaperCanvasSettings, PaperCanvasPluginInterface, CanvasView, PageData, NodeState } from './types';
import { DEFAULT_SETTINGS, PaperCanvasSettingTab } from './settings';
import { StateManager } from './stateManager';
import { ViewManager } from './viewManager';
import { PdfExporter } from './pdfExporter';
import { PAGE_GAP } from './constants';

export default class PaperCanvasPlugin extends Plugin implements PaperCanvasPluginInterface {
    settings: PaperCanvasSettings;
    // Managers
    stateManager: StateManager;
    viewManager: ViewManager;
    pdfExporter: PdfExporter;
    // Current state
    currentCanvasFile: TFile | null = null;

    constructor(app: App, manifest: any) {
        super(app, manifest);
        // Initialize managers here, passing 'this' which implements the interface
        this.stateManager = new StateManager(this);
        this.viewManager = new ViewManager(this);
        this.pdfExporter = new PdfExporter(this);
    }

    async onload() {
        console.log('Loading Paper Canvas Plugin (v12.2 - Refactored)');
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
        // Single page export command removed for simplicity
        // this.addCommand({ id: 'paper-canvas-export-current-page', name: 'Paper Canvas: Export Current Page as PDF', checkCallback: this.checkExportCallback( ... ) });
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
             if (this.stateManager['saveTimeout']) {
                 clearTimeout(this.stateManager['saveTimeout']);
                 this.stateManager['saveTimeout'] = null;
                 console.log("Cleared pending save timeout on unload.");
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

    // This is the single implementation required by the interface
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
         await this.UpdatePluginStateForLeaf(leaf);
    }



    // Central logic for handling leaf changes
    private async updatePluginStateForLeaf(activeLeaf: WorkspaceLeaf | null): Promise<void> {
        // Check if the leaf is a canvas view using the type predicate
        if (this.isCanvasView(activeLeaf)) {
            // Now activeLeaf.view is narrowed to CanvasView which has .file
            const canvasFile = activeLeaf.view.file;
            // Check if the file exists (might be null for new unsaved canvas initially)
            if (!canvasFile) {
                 console.log("Plugin: Ignoring canvas view without a file (likely new/unsaved).");
                 // Clean up previous state if necessary
                 if (this.currentCanvasFile) {
                    await this.stateManager.saveCanvasData(this.currentCanvasFile, true);
                    this.viewManager.cleanup();
                    this.currentCanvasFile = null;
                 }
                 return;
            }

            // Proceed if it's a different file or if the view needs re-initialization
            if (!this.currentCanvasFile || this.currentCanvasFile.path !== canvasFile.path) {
                // Switched to a new/different canvas
                console.log(`Plugin: Switched to canvas ${canvasFile.path}`);
                if (this.currentCanvasFile) {
                     // Clear timeout explicitly if needed
                     if (this.stateManager['saveTimeout']) clearTimeout(this.stateManager['saveTimeout']); this.stateManager['saveTimeout'] = null;
                    await this.stateManager.saveCanvasData(this.currentCanvasFile, true); // Save previous immediately
                }
                this.currentCanvasFile = canvasFile;
                // *** Await loading state BEFORE initializing view ***
                await this.stateManager.loadCanvasData(this.currentCanvasFile);
                // *** Now initialize view with potentially updated state ***
                this.initializeCanvasView(activeLeaf);
            } else if (!this.viewManager.getObservedCanvasElement() && this.currentCanvasFile) {
                // Re-initializing view for the *same* canvas
                console.log("Plugin: Re-initializing view for current canvas.");
                this.initializeCanvasView(activeLeaf); // State exists, setup view
            }
             // Else: Still on the same canvas, view already initialized - do nothing.
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
        // Double check type guard and get element
        if (!this.isCanvasView(leaf)) return;
        const canvasElement = this.viewManager.getCanvasElement(leaf);
        if (!canvasElement) { this.showNotice("Paper Canvas could not find the canvas element."); return; }

        // Avoid re-initializing if ViewManager already attached to this element
        if (this.viewManager.getObservedCanvasElement() === canvasElement) {
            console.log("Plugin: View already initialized for this element.");
             // Just ensure UI reflects current state
             this.viewManager.updatePageIndicator(this.stateManager.getCurrentPageIndex(), this.stateManager.getPages().length);
             this.viewManager.applyNodeVisibilityAndPosition(canvasElement, this.stateManager.getCurrentPageIndex(), this.stateManager.getAllNodeStates());
             return;
        }

        console.log("Plugin: Initializing canvas view via ViewManager...");
        this.viewManager.cleanup(); // Clean up any previous view first

        // Setup observer via ViewManager, passing StateManager methods
        this.viewManager.setupCanvasObserver(canvasElement, {
            // Pass arrow functions to preserve 'this' context for stateManager calls
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
                } else { console.warn(`Style change on node ${nodeId} without state? Should be handled by addNode.`); }
            },
            assignStateToNewNode: (nodeEl, rect) => this.stateManager.assignStateToNewNode(nodeEl, rect),
            // Explicitly don't pass removeNodeState if viewManager doesn't expect it
            // removeNodeState: (nodeId: string) => { /* No-op or call stateManager.removeNodeState(nodeId) */ },
            getNodeState: (nodeId) => this.stateManager.getNodeState(nodeId),
            ensureNodeId: (nodeEl) => this.stateManager.ensureNodeId(nodeEl)
        });

        // Setup UI elements via ViewManager, getting current state AFTER load/reset
        const currentPageIndex = this.stateManager.getCurrentPageIndex();
        const pages = this.stateManager.getPages();
        const nodeStates = this.stateManager.getAllNodeStates();

        this.viewManager.updatePageMarker(currentPageIndex, pages.length);
        this.viewManager.setupPageControls(leaf, currentPageIndex, pages.length, this.goToPage, this.addNewPage);
        // Add only the "Export All" button
        this.viewManager.addActionButtons(leaf,
             () => this.pdfExporter.exportAllPagesAsPDF(pages, nodeStates, canvasElement, this.currentCanvasFile) // Pass current canvas element
        );
        // Apply visibility based on current state
        this.viewManager.applyNodeVisibilityAndPosition(canvasElement, currentPageIndex, nodeStates);
        // Position camera
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
         // Avoid unnecessary state changes if already on the page
         if (targetPageIndex === this.stateManager.getCurrentPageIndex()) {
             console.log(`goToPage: Already on page ${targetPageIndex + 1}`); return;
         }

         const activeLeaf = this.app.workspace.activeLeaf;
         if (!this.isCanvasView(activeLeaf)) return;
         const canvasElement = this.viewManager.getObservedCanvasElement(); // Get element from view manager
         if (!canvasElement) { console.error("goToPage: Cannot find observed canvas element."); return; }

         console.log(`Plugin: Switching to page ${targetPageIndex + 1}`);
         this.stateManager.setCurrentPageIndex(targetPageIndex); // Update state first

         // Get potentially updated state (although only index changed here)
         const nodeStates = this.stateManager.getAllNodeStates();

         // Update view elements via ViewManager
         this.viewManager.updatePageMarker(targetPageIndex, totalPages);
         this.viewManager.updatePageIndicator(targetPageIndex, totalPages);
         this.viewManager.applyNodeVisibilityAndPosition(canvasElement, targetPageIndex, nodeStates);
         this.viewManager.positionCamera(activeLeaf, targetPageIndex);
         this.showNotice(`Switched to ${pages[targetPageIndex].name}`);
    }

    // checkExportCallback implementation (only needs export all)
    private checkExportCallback = (exportAllCallback: () => void) => {
        return (checking: boolean): boolean => {
            const activeLeaf = this.app.workspace.activeLeaf;
            // Check if viewManager has an observed element too
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
    // isCanvasView implementation uses CanvasView type from types.ts
    isCanvasView(leaf: WorkspaceLeaf | null | undefined): leaf is WorkspaceLeaf & { view: CanvasView } { return !!leaf && leaf.view?.getViewType() === 'canvas'; }
    // saveSettings implementation is above

} // --- End of Plugin Class ---