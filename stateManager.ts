import { TFile, Notice } from 'obsidian'; // Notice might not be needed here if handled by main plugin
import { PageData, NodeState, SavedCanvasState, PaperCanvasPluginInterface, PaperCanvasSettings } from './types';
import { CANVAS_DATA_VERSION, PAGE_GAP } from './constants';

export class StateManager {
    plugin: PaperCanvasPluginInterface;
    pages: PageData[] = [];
    nodeStates: Map<string, NodeState> = new Map();
    currentPageIndex: number = 0;
    private saveTimeout: NodeJS.Timeout | null = null;

    constructor(plugin: PaperCanvasPluginInterface) {
        this.plugin = plugin;
        this.resetLocalState(); // Initialize with default
    }

    getCurrentPageIndex(): number {
        return this.currentPageIndex;
    }

    setCurrentPageIndex(index: number): void {
        // Ensure index is within valid bounds
        if (index >= 0 && index < this.pages.length) {
            this.currentPageIndex = index;
             console.log(`StateManager: Set currentPageIndex to ${index}`);
        } else {
            console.error(`StateManager: Attempted to set invalid page index: ${index}. Max is ${this.pages.length - 1}`);
            // Optionally default to 0 or last page if invalid?
             if (this.pages.length > 0) {
                this.currentPageIndex = Math.max(0, Math.min(index, this.pages.length - 1));
                console.warn(`StateManager: Clamped page index to ${this.currentPageIndex}`);
            } else {
                this.currentPageIndex = 0; // Should not happen if pages always has at least one
            }

        }
    }

    getPages(): PageData[] {
        // Ensure pages have correct indices before returning, belt-and-suspenders
        this.pages.forEach((p, i) => p.index = i);
        return this.pages;
    }

    getNodeState(nodeId: string): NodeState | undefined {
        return this.nodeStates.get(nodeId);
    }

    getAllNodeStates(): Map<string, NodeState> {
        return this.nodeStates;
    }

     resetLocalState(): void {
        this.pages = [{ id: this.generatePageId(), index: 0, name: 'Page 1' }];
        this.nodeStates.clear();
        this.currentPageIndex = 0;
        console.log("StateManager: Local state reset.");
    }

    generatePageId(): string {
        return 'page-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7);
    }

    ensureNodeId(nodeEl: HTMLElement): string {
        let nodeId = nodeEl.id || nodeEl.dataset.paperCanvasNodeId;
        if (nodeId && (nodeId.startsWith('node-') || /^[a-zA-Z0-9-_]+$/.test(nodeId))) { // Allow our format or basic valid IDs
             if (!nodeEl.id) nodeEl.id = nodeId;
             if (!nodeEl.dataset.paperCanvasNodeId) nodeEl.dataset.paperCanvasNodeId = nodeId;
            return nodeId;
        }
        // Generate new if needed
        nodeId = 'node-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7);
        nodeEl.id = nodeId;
        nodeEl.dataset.paperCanvasNodeId = nodeId;
        console.log(`StateManager: Generated new ID ${nodeId} for node.`);
        return nodeId;
    }

     // --- Canvas Data Saving/Loading ---

    getCanvasDataKey(file: TFile | null): string | null {
        if (!file) return null;
        return `canvasData_${file.path}`;
    }

    async loadCanvasData(file: TFile | null): Promise<boolean> {
        const key = this.getCanvasDataKey(file);
        if (!key) { this.resetLocalState(); return false; }

        const allPluginData = await this.plugin.loadData();
        const savedState = allPluginData?.[key];

        if (savedState) {
            const state: SavedCanvasState = savedState;
            if (state && state.version === CANVAS_DATA_VERSION && Array.isArray(state.pages) && Array.isArray(state.nodeStates)) {
                try {
                    this.pages = state.pages.length > 0 ? state.pages : [{ id: this.generatePageId(), index: 0, name: 'Page 1' }];
                    this.nodeStates = new Map(state.nodeStates);
                    this.currentPageIndex = 0; // Always start on page 0 after loading
                    console.log(`StateManager: Loaded data for ${file?.path}. Nodes: ${this.nodeStates.size}, Pages: ${this.pages.length}`);
                    this.validateState();
                    return true;
                } catch (error) { console.error(`StateManager: Error processing loaded data for ${file?.path}:`, error); this.resetLocalState(); return false; }
            } else {
                console.log(`StateManager: No valid v${CANVAS_DATA_VERSION} data found for ${file?.path}. Initializing fresh state.`);
                this.resetLocalState(); return false;
            }
        } else {
             console.log(`StateManager: No saved data entry found for ${file?.path}. Initializing fresh state.`);
             this.resetLocalState(); return false;
        }
    }

    async saveCanvasData(file: TFile | null, immediate = false): Promise<void> {
        if (!file) {
            if (!immediate) console.log("StateManager: Skipping save, no active file.");
            return;
        }
        const key = this.getCanvasDataKey(file);
        if (!key) { console.error("StateManager: Cannot generate key for saving."); return; }

        this.validateState(); // Ensure state is valid before saving
        const dataToSave: SavedCanvasState = {
            version: CANVAS_DATA_VERSION, pages: this.pages, nodeStates: Array.from(this.nodeStates.entries())
        };

        try {
            const allPluginData = await this.plugin.loadData() || {};
            allPluginData[key] = dataToSave;
            // Ensure global settings are preserved
            allPluginData.pageWidthPx = this.plugin.settings.pageWidthPx;
            allPluginData.pageHeightPx = this.plugin.settings.pageHeightPx;
            await this.plugin.saveData(allPluginData);
            if (!immediate) console.log(`StateManager: Saved data for ${file.path}. Nodes: ${this.nodeStates.size}, Pages: ${this.pages.length}`);
        } catch (error) { console.error(`StateManager: Failed to save data for ${file.path}:`, error); this.plugin.showNotice("Error saving canvas state!"); }
    }

    validateState(): void {
        let maxPageIndex = -1;
        if (!Array.isArray(this.pages)) this.pages = [];
        if (this.pages.length === 0) this.pages.push({ id: this.generatePageId(), index: 0, name: 'Page 1' });
        this.pages.forEach((page, index) => { page.index = index; maxPageIndex = index; });
        if (!(this.nodeStates instanceof Map)) this.nodeStates = new Map();
        this.nodeStates.forEach((nodeState, nodeId) => {
             if (nodeState.pageIndex === undefined || nodeState.pageIndex < 0 || nodeState.pageIndex > maxPageIndex) { nodeState.pageIndex = 0; }
             if (typeof nodeState.x !== 'number') nodeState.x = 0;
             if (typeof nodeState.y !== 'number') nodeState.y = 0;
        });
        if (this.currentPageIndex < 0 || this.currentPageIndex > maxPageIndex) { this.currentPageIndex = 0; }
    }

    requestSave = (): void => {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            this.saveCanvasData(this.plugin.getCurrentFile());
        }, 2500);
    }

    // --- State Modification Logic ---

    addNewPage(): number {
        const newPageIndex = this.pages.length;
        const newPage: PageData = { id: this.generatePageId(), index: newPageIndex, name: `Page ${newPageIndex + 1}` };
        this.pages.push(newPage);
        this.validateState(); // Update indices
        this.requestSave();
        // Main plugin will show notice and trigger view update
        return newPageIndex;
    }

    assignStateToNewNode(nodeEl: HTMLElement, rect: { x: number; y: number; width: number; height: number }): void {
        const nodeId = this.ensureNodeId(nodeEl);
        const pageDimensions = this.plugin.getPageDimensions();
        const targetPageIndex = this.currentPageIndex;
        const relativeX = rect.x;
        const relativeY = rect.y - targetPageIndex * (pageDimensions.height + PAGE_GAP);
        const clampedResult = this.clampToBounds(relativeX, relativeY, rect.width, rect.height, pageDimensions);
        this.nodeStates.set(nodeId, { pageIndex: targetPageIndex, x: clampedResult.x, y: clampedResult.y });
        console.log(`StateManager: Assigned state to ${nodeId} on page ${targetPageIndex + 1}`);
        // ViewManager handles DOM update if needed based on clamping result or visibility change
    }

    updateNodeStateFromStyleChange(nodeId: string, currentState: NodeState, rect: { x: number; y: number; width: number; height: number }): { stateChanged: boolean; clampedResult: { x: number; y: number; changed: boolean; } } {
        const pageDimensions = this.plugin.getPageDimensions();
        const targetPageIndex = currentState.pageIndex;
        const relativeX = rect.x;
        const relativeY = rect.y - targetPageIndex * (pageDimensions.height + PAGE_GAP);
        const clampedResult = this.clampToBounds(relativeX, relativeY, rect.width, rect.height, pageDimensions);
        let stateChanged = false;
        if (clampedResult.x !== currentState.x || clampedResult.y !== currentState.y) {
            this.nodeStates.set(nodeId, { pageIndex: targetPageIndex, x: clampedResult.x, y: clampedResult.y });
            stateChanged = true;
        }
        return { stateChanged, clampedResult };
    }

    removeNodeState(nodeId: string): void {
        if (this.nodeStates.delete(nodeId)) {
             console.log(`StateManager: Removed state for node ${nodeId}`);
             this.requestSave();
        }
    }

    clampToBounds(x: number, y: number, width: number, height: number, pageDimensions: {width: number, height: number}): { x: number; y: number; changed: boolean; } {
        const pageW = pageDimensions.width; const pageH = pageDimensions.height;
        let cX = x; let cY = y; let ch = false;
        const minX = 0; const minY = 0;
        const maxX = pageW - Math.max(1, width); const maxY = pageH - Math.max(1, height);
        if (cX < minX) { cX = minX; ch = true; } if (cY < minY) { cY = minY; ch = true; }
        if (cX > maxX) { cX = maxX; ch = true; } if (cY > maxY) { cY = maxY; ch = true; }
        if (width > pageW && cX < minX) cX = minX; if (height > pageH && cY < minY) cY = minY;
        return { x: cX, y: cY, changed: ch };
    }
}