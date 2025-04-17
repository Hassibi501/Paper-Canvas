import { WorkspaceLeaf, TFile, Notice, Menu, View } from 'obsidian';
import { PaperCanvasPluginInterface, PageData, NodeState, CanvasView } from './types';
import { HIDDEN_NODE_CLASS, PAGE_GAP, EXPORT_BUTTON_CLASS, EXPORT_ALL_BUTTON_CLASS } from './constants';

export class ViewManager {
    plugin: PaperCanvasPluginInterface;
    private styleEl: HTMLStyleElement | null = null;
    private observedCanvasElement: HTMLElement | null = null;
    private pageMarkerElement: HTMLElement | null = null;
    private pageControlsElement: HTMLElement | null = null;
    private pageIndicatorElement: HTMLElement | null = null;
    private observer: MutationObserver | null = null;
    isUpdatingNodePosition: boolean = false;

    constructor(plugin: PaperCanvasPluginInterface) {
        this.plugin = plugin;
    }

    // Call this when plugin loads
    initializeStyles(): void {
        this.addHideStyle();
    }

    // Call this when plugin unloads
    cleanup(): void {
        console.log("ViewManager: Cleaning up...");
        this.disconnectObserver();
        this.removePageMarker();
        this.removePageControls();
        this.removeActionButtons(); // Remove buttons from all potential leaves
        this.removeHideStyle();
        this.observedCanvasElement = null;
    }

    addHideStyle(): void {
        this.removeHideStyle(); // Ensure no duplicates
        this.styleEl = document.createElement('style');
        this.styleEl.textContent = `.${HIDDEN_NODE_CLASS} { opacity: 0 !important; pointer-events: none !important; user-select: none !important; }`;
        document.head.appendChild(this.styleEl);
    }
    removeHideStyle(): void { this.styleEl?.remove(); this.styleEl = null; }

    getObservedCanvasElement(): HTMLElement | null { return this.observedCanvasElement; }
    disconnectObserver(): void { if (this.observer) { this.observer.disconnect(); this.observer = null; console.log("ViewManager: Observer disconnected."); } }

    // --- Observer Setup ---
    setupCanvasObserver(
        canvasElement: HTMLElement,
        stateManager: { // Interface for needed StateManager methods
            handleNodeStyleChange(nodeEl: HTMLElement, rect: { x: number, y: number, width: number, height: number }): void;
            assignStateToNewNode(nodeEl: HTMLElement, rect: { x: number, y: number, width: number, height: number }): void;
            getNodeState(nodeId: string): NodeState | undefined;
            ensureNodeId(nodeEl: HTMLElement): string;
        }
    ): void {
        if (this.observer) this.disconnectObserver();
        this.observedCanvasElement = canvasElement;

        this.observer = new MutationObserver((mutations) => {
             if (this.isUpdatingNodePosition) return;
             let stateMightHaveChanged = false;

             mutations.forEach((mutation) => {
                 if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                     if (mutation.target instanceof HTMLElement && mutation.target.classList.contains('canvas-node')) {
                         const rect = this.getNodeRectFromElement(mutation.target);
                         if (rect) {
                             // Delegate state update logic to StateManager
                            stateManager.handleNodeStyleChange(mutation.target, rect);
                            stateMightHaveChanged = true;
                         }
                     }
                 } else if (mutation.type === 'childList') {
                     mutation.removedNodes.forEach(node => { /* ... log removal ... */ });
                     mutation.addedNodes.forEach(node => {
                          if (node instanceof HTMLElement && node.classList.contains('canvas-node')) {
                              const nodeId = stateManager.ensureNodeId(node);
                              const rect = this.getNodeRectFromElement(node);
                              if (rect) {
                                  if (stateManager.getNodeState(nodeId)) { // Check if state exists
                                      console.log(`ViewManager: Node ${nodeId} re-added. Applying state.`);
                                      this.applyStateToSingleNode(node, stateManager.getNodeState(nodeId) as NodeState);
                                  } else {
                                      console.log(`ViewManager: Detected new node ${nodeId}. Assigning state.`);
                                      stateManager.assignStateToNewNode(node, rect);
                                      // Re-apply after assignment to ensure visibility/position
                                      const newState = stateManager.getNodeState(nodeId);
                                      if (newState) this.applyStateToSingleNode(node, newState);
                                  }
                                  stateMightHaveChanged = true;
                              } else { console.warn(`Could not get rect for added node ${nodeId}`); }
                          }
                     });
                 }
             });
             if (stateMightHaveChanged) { this.plugin.requestSave(); } // Trigger save via plugin
        });

        this.observer.observe(canvasElement, { subtree: true, attributes: true, attributeFilter: ['style'], childList: true });
        console.log("ViewManager: MutationObserver attached.");
    }


    // --- DOM Updates & UI ---
    updatePageMarker(currentPageIndex: number, pagesLength: number): void {
        if (!this.observedCanvasElement) return;
        this.removePageMarker();
        const { width: pageW, height: pageH } = this.plugin.getPageDimensions();
        const yOffset = currentPageIndex * (pageH + PAGE_GAP);
        this.pageMarkerElement = document.createElement('div');
        this.pageMarkerElement.addClass('paper-canvas-page-marker');
        this.pageMarkerElement.setCssStyles({ position: 'absolute', left: '0px', top: `${yOffset}px`, width: `${pageW}px`, height: `${pageH}px`, border: '1px dashed var(--text-faint)', pointerEvents: 'none', zIndex: '0' });
        this.observedCanvasElement.prepend(this.pageMarkerElement);
    }
    removePageMarker(): void { this.pageMarkerElement?.remove(); this.pageMarkerElement = null; }

    setupPageControls(leaf: WorkspaceLeaf, currentPageIndex: number, pagesLength: number, goToPageFn: (index: number)=>void, addPageFn: ()=>void): void {
        this.removePageControls(); // Ensure clean slate
        const viewContainer = leaf.view.containerEl;
        this.pageControlsElement = viewContainer.createDiv({ cls: 'paper-canvas-page-controls' });
        this.pageControlsElement.setCssStyles({ position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--background-secondary)', padding: '5px 10px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: '8px', zIndex: '50' });

        const prevButton = this.pageControlsElement.createEl('button', { cls: 'clickable-icon', attr: {'aria-label': 'Previous Page'} }); prevButton.setText('←');
        prevButton.addEventListener('click', () => { console.log(`Prev button clicked. Requesting: ${currentPageIndex - 1}`); goToPageFn(currentPageIndex - 1); });

        this.pageIndicatorElement = this.pageControlsElement.createEl('span', { cls: 'paper-canvas-page-indicator' }); this.pageIndicatorElement.setCssStyles({ fontSize: 'var(--font-ui-small)', color: 'var(--text-muted)' });

        const nextButton = this.pageControlsElement.createEl('button', { cls: 'clickable-icon', attr: {'aria-label': 'Next Page'} }); nextButton.setText('→');
        nextButton.addEventListener('click', () => { console.log(`Next button clicked. Requesting: ${currentPageIndex + 1}`); goToPageFn(currentPageIndex + 1); });

        const addButton = this.pageControlsElement.createEl('button', { cls: 'clickable-icon', attr: {'aria-label': 'Add New Page'} }); addButton.setText('+');
        addButton.addEventListener('click', addPageFn);

        this.updatePageIndicator(currentPageIndex, pagesLength);
    }
    removePageControls(): void { this.pageControlsElement?.remove(); this.pageControlsElement = null; }

    updatePageIndicator(currentPageIndex: number, pagesLength: number): void {
        console.log(`ViewManager: Updating indicator - Current ${currentPageIndex + 1}, Total ${pagesLength}`); // Log input values
        if (this.pageIndicatorElement) {
            this.pageIndicatorElement.setText(`Page ${currentPageIndex + 1} / ${pagesLength}`);
            const controls = this.pageControlsElement;
            if (controls) {
                const prevBtn = controls.querySelector<HTMLButtonElement>('button:first-child');
                const nextBtn = controls.querySelector<HTMLButtonElement>('button:nth-child(3)');
                if (prevBtn) prevBtn.disabled = currentPageIndex === 0;
                if (nextBtn) nextBtn.disabled = currentPageIndex >= pagesLength - 1;
            }
        } else {
            console.warn("ViewManager: pageIndicatorElement not found during update.");
        }
    }

    positionCamera(leaf: WorkspaceLeaf, currentPageIndex: number): void {
        if (!this.plugin.isCanvasView(leaf)) return;
        const { width: pageW, height: pageH } = this.plugin.getPageDimensions();
        const targetY = currentPageIndex * (pageH + PAGE_GAP) + (pageH / 2);
        const targetX = pageW / 2;
        const canvasView = leaf.view; // Already narrowed to CanvasView
        const canvas = canvasView.canvas;
        if (canvas?.panTo) { try { canvas.panTo(targetX, targetY); } catch (e) { console.error("panTo failed:", e); this.fallbackScroll(leaf, targetY); }}
        else if (canvasView.setCameraPos) { try { canvasView.setCameraPos({ x: targetX, y: targetY }); } catch(e) { console.error("setCameraPos failed:", e); this.fallbackScroll(leaf, targetY); }}
        else { console.warn("Cannot access panTo/setCameraPos."); this.fallbackScroll(leaf, targetY - (leaf.view.containerEl.clientHeight / 2)); }
    }
    fallbackScroll(leaf: WorkspaceLeaf, targetScrollTop: number): void { /* ... unchanged ... */ }

    // Updated button handling
    addActionButtons(leaf: WorkspaceLeaf, exportAllFn: ()=>void ): void {
         if (!this.plugin.isCanvasView(leaf)) return;
         const view = leaf.view; // Narrowed type
         if (!view.addAction) { console.warn("View does not support addAction."); return; }
         const header = view.containerEl.querySelector('.view-header .view-actions');
         if (!header) { console.warn("Cannot find view header actions."); return; }
         // Force remove existing first to prevent duplicates
         header.querySelectorAll(`.${EXPORT_ALL_BUTTON_CLASS}`).forEach(btn => btn.remove());
         header.querySelectorAll(`.${EXPORT_BUTTON_CLASS}`).forEach(btn => btn.remove()); // Cleanup old button
         // Add Export All Pages Button
         view.addAction( "lucide-book-down", "Export All Pages as PDF", exportAllFn, { class: EXPORT_ALL_BUTTON_CLASS } );
         console.log("ViewManager: Added export all button.");
    }
    removeActionButtons(): void {
        console.log("ViewManager: Removing action buttons from all canvas leaves...");
        this.plugin.app.workspace.getLeavesOfType('canvas').forEach((leaf: WorkspaceLeaf) => {
             if (this.plugin.isCanvasView(leaf)) {
                 const header = leaf.view.containerEl.querySelector('.view-header .view-actions');
                 header?.querySelector(`.${EXPORT_BUTTON_CLASS}`)?.remove();
                 header?.querySelector(`.${EXPORT_ALL_BUTTON_CLASS}`)?.remove();
             }
         });
    }

    // --- Node Visibility / Positioning ---
    applyNodeVisibilityAndPosition( canvasElement: HTMLElement, currentPageIndex: number, nodeStates: Map<string, NodeState> ): void {
         console.log(`ViewManager: Applying visibility/position for page ${currentPageIndex + 1} using ${nodeStates.size} states.`);
         nodeStates.forEach((state, nodeId) => {
             const nodeEl = canvasElement.querySelector<HTMLElement>(`#${nodeId}`);
             if (nodeEl) { this.applyStateToSingleNode(nodeEl, state, currentPageIndex); }
         });
         canvasElement.querySelectorAll<HTMLElement>('.canvas-node').forEach(nodeEl => {
             if (nodeEl.id && !nodeStates.has(nodeEl.id)) { nodeEl.classList.add(HIDDEN_NODE_CLASS); }
         });
    }
    applyStateToSingleNode(nodeEl: HTMLElement, state: NodeState, currentPageIndex?: number): void {
        if (!state) return;
        const pageDimensions = this.plugin.getPageDimensions();
        const pageIndexToUse = state.pageIndex ?? 0;
        const absoluteY = state.y + pageIndexToUse * (pageDimensions.height + PAGE_GAP);
        this.updateNodeTransform(nodeEl, state.x, absoluteY);
        const currentViewPageIndex = currentPageIndex ?? this.plugin.getCurrentPageIndex();
        this.applyVisibilityToNode(nodeEl, pageIndexToUse, currentViewPageIndex);
    }
    applyVisibilityToNode(nodeEl: HTMLElement, nodePageIndex: number, currentViewPageIndex: number): void {
          if (nodePageIndex === currentViewPageIndex) { nodeEl.classList.remove(HIDDEN_NODE_CLASS); }
          else { nodeEl.classList.add(HIDDEN_NODE_CLASS); }
     }
    updateNodeTransform(nodeEl: HTMLElement, x: number, y: number): void { /* ... unchanged ... */ }
    getCanvasElement(leaf: WorkspaceLeaf): HTMLElement | null {
        if (!this.plugin.isCanvasView(leaf)) return null;
        const canvasElement = leaf.view.containerEl.querySelector('.canvas');
        if (!(canvasElement instanceof HTMLElement)) { console.error("ViewManager: Could not find main canvas element."); return null; }
        return canvasElement;
    }
    getNodeRectFromElement(nodeEl: HTMLElement): { x: number; y: number; width: number; height: number } | null { /* ... unchanged ... */ return null; }
}