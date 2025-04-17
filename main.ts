import { Plugin, WorkspaceLeaf, Notice, ItemView, Menu, MenuItem, TFile, addIcon } from 'obsidian';

// --- Configuration ---
const PAGE_WIDTH_PX = 794;  // A4 width in pixels at 96 DPI
const PAGE_HEIGHT_PX = 1123; // A4 height in pixels at 96 DPI
const PAGE_GAP = 50; // Gap between pages vertically

// --- CSS Class for Hiding ---
const HIDDEN_NODE_CLASS = 'paper-canvas-node-hidden';

// --- Data Structures ---
interface PageData {
    id: string;
    index: number;
    name: string;
}
interface NodeState {
    pageIndex: number;
    x: number;
    y: number;
}

// --- Plugin Class ---
export default class PaperCanvasPlugin extends Plugin {
    private observer: MutationObserver | null = null;
    private observedCanvasElement: HTMLElement | null = null;
    private pageMarkerElement: HTMLElement | null = null;
    private pages: PageData[] = [];
    private currentPageIndex: number = 0;
    private pageIndicatorElement: HTMLElement | null = null;
    private pageControlsElement: HTMLElement | null = null;
    private nodeStates: Map<string, NodeState> = new Map();
    private isUpdatingNodePosition = false;
    private currentCanvasFile: TFile | null = null;
    private styleEl: HTMLStyleElement | null = null; // To hold our CSS rule


    async onload() {
        console.log('Loading Paper Canvas Plugin (Multi-page v3 - Opacity Hide)');

        // Inject CSS Rule for hiding nodes
        this.addHideStyle();

        if (this.pages.length === 0) {
            this.pages = [{ id: this.generatePageId(), index: 0, name: 'Page 1' }];
        }
        this.currentPageIndex = 0;

        this.registerEvent(
            this.app.workspace.on('layout-change', this.handleLayoutChange)
        );
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                this.handleLayoutChange();
            })
        );

        this.app.workspace.onLayoutReady(() => {
            this.handleLayoutChange();
        });

        // Commands (remain the same)
        this.addCommand({
            id: 'apply-paper-canvas-bounds',
            name: 'Apply Paper Canvas Bounds (Refresh)',
            callback: () => {
                const activeLeaf = this.app.workspace.activeLeaf;
                if (this.isCanvasView(activeLeaf)) {
                    console.log("Manually applying bounds via command.");
                    this.resetStateForCurrentCanvas(); // Clear state before re-initializing
                    this.initializeCanvasState(activeLeaf);
                } else {
                    this.showNotice("No active canvas view found.");
                }
            }
        });
        this.addCommand({ id: 'add-new-page', name: 'Add New Page', callback: () => this.addNewPage() });
        this.addCommand({ id: 'next-page', name: 'Go to Next Page', callback: () => this.goToPage(this.currentPageIndex + 1) });
        this.addCommand({ id: 'previous-page', name: 'Go to Previous Page', callback: () => this.goToPage(this.currentPageIndex - 1) });

        // --- TODO: Add commands/logic for saving/loading page/node state ---
    }

    onunload() {
        console.log('Unloading Paper Canvas Plugin (Multi-page v3)');
        this.disconnectObserver();
        this.removePageMarker();
        this.removePageControls();
        this.removeHideStyle(); // Clean up injected style
        this.nodeStates.clear();
        this.pages = [];
        this.currentCanvasFile = null;
    }

    // --- CSS Injection ---
    addHideStyle() {
        this.removeHideStyle(); // Remove existing first
        this.styleEl = document.createElement('style');
        this.styleEl.textContent = `
            .${HIDDEN_NODE_CLASS} {
                opacity: 0 !important;
                pointer-events: none !important;
                /* Prevent potential selection/interaction issues */
                user-select: none !important;
            }
        `;
        document.head.appendChild(this.styleEl);
    }

    removeHideStyle() {
        this.styleEl?.remove();
        this.styleEl = null;
    }

    // --- Core Logic ---

    handleLayoutChange = () => {
        const activeLeaf = this.app.workspace.activeLeaf;

        if (this.isCanvasView(activeLeaf)) {
            const canvasFile = activeLeaf.view.file;
            if (this.currentCanvasFile?.path !== canvasFile?.path) {
                console.log(`Paper Canvas: Switched to canvas ${canvasFile?.path}`);
                this.currentCanvasFile = canvasFile;
                this.resetStateForCurrentCanvas(); // Use reset for current canvas
                this.initializeCanvasState(activeLeaf);
            } else if (!this.observedCanvasElement && this.currentCanvasFile) {
                 console.log("Paper Canvas: Re-initializing for current canvas view.");
                 // Don't reset state here, just re-initialize observer etc.
                 this.initializeCanvasState(activeLeaf);
            }
        } else {
            if (this.currentCanvasFile) {
                 console.log(`Paper Canvas: Left canvas ${this.currentCanvasFile.path}`);
                 // Don't clear state here, keep it in case user switches back quickly
                 // State will be reset if they open a *different* canvas.
                 this.disconnectObserver(); // Disconnect observer when leaving canvas view
                 this.removePageMarker();
                 this.removePageControls();
                 this.observedCanvasElement = null;
                 this.currentCanvasFile = null; // Mark that no canvas is active
            }
        }
    }

    // Reset state specifically for the currently tracked canvas file
     resetStateForCurrentCanvas() {
        console.log("Paper Canvas: Resetting state for canvas: ", this.currentCanvasFile?.path);
        this.disconnectObserver();
        this.removePageMarker();
        this.removePageControls();
        this.nodeStates.clear(); // Clear node states
        this.pages = [{ id: this.generatePageId(), index: 0, name: 'Page 1' }]; // Reset pages
        this.currentPageIndex = 0;
        this.observedCanvasElement = null;
        // currentCanvasFile remains the same
    }

    isCanvasView(leaf: WorkspaceLeaf | null | undefined): leaf is WorkspaceLeaf & { view: { file: TFile | null, getViewType: () => 'canvas', containerEl: HTMLElement, [key: string]: any } } {
        return !!leaf && leaf.view?.getViewType() === 'canvas';
    }

    initializeCanvasState(leaf: WorkspaceLeaf) {
        if (!this.isCanvasView(leaf)) return;

        const canvasElement = this.getCanvasElement(leaf);
        if (!canvasElement) return;

        // Avoid re-initializing if already observing the correct element
        if (this.observedCanvasElement === canvasElement && this.observer) {
            console.log("Paper Canvas: Already initialized for this canvas element.");
            // Ensure nodes visibility is correct if returning to this view
            this.applyNodeVisibilityAndPosition(canvasElement);
            return;
        }

        console.log("Paper Canvas: Initializing canvas state...");
        this.disconnectObserver(); // Disconnect previous observer just in case

        this.setupCanvasObserver(canvasElement); // Setup new observer
        this.updatePageMarker(canvasElement);
        this.setupPageControls(leaf);

        // Discover nodes AND apply initial visibility/positioning
        this.discoverNodesAndApplyState(canvasElement);

        this.positionCamera(leaf);
    }

    getCanvasElement(leaf: WorkspaceLeaf): HTMLElement | null {
         if (!this.isCanvasView(leaf)) return null;
         const canvasElement = leaf.view.containerEl.querySelector('.canvas');
         if (!(canvasElement instanceof HTMLElement)) {
             console.error("Paper Canvas: Could not find the main canvas element (div.canvas).");
             return null;
         }
         return canvasElement;
    }

    setupCanvasObserver(canvasElement: HTMLElement) {
        // No need to disconnect here, assuming it's done before calling this
        this.observedCanvasElement = canvasElement;

        this.observer = new MutationObserver((mutations) => {
            if (this.isUpdatingNodePosition) return;

            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (mutation.target instanceof HTMLElement && mutation.target.classList.contains('canvas-node')) {
                        this.handleNodeStyleChange(mutation.target);
                    }
                } else if (mutation.type === 'childList') {
                    // *** MODIFIED ChildList Handling ***
                    mutation.removedNodes.forEach(node => {
                         if (node instanceof HTMLElement && node.classList.contains('canvas-node')) {
                             const nodeId = node.id; // Get ID before it's potentially lost
                             if (nodeId && this.nodeStates.has(nodeId)) {
                                 // ** DON'T DELETE STATE **
                                 console.log(`Paper Canvas: Node ${nodeId} removed from DOM (state retained).`);
                             } else {
                                // console.log("Paper Canvas: Untracked node removed from DOM.", node.id);
                             }
                         }
                    });
                    mutation.addedNodes.forEach(node => {
                         if (node instanceof HTMLElement && node.classList.contains('canvas-node')) {
                             const nodeId = this.ensureNodeId(node); // Ensure it has an ID

                             if (this.nodeStates.has(nodeId)) {
                                 // *** Node Re-added ***
                                 console.log(`Paper Canvas: Node ${nodeId} re-added to DOM. Applying existing state.`);
                                 // Re-apply visibility and position based on stored state
                                 this.applyStateToSingleNode(node);
                             } else {
                                 // *** Genuinely New Node ***
                                 console.log(`Paper Canvas: Detected new node ${nodeId}. Assigning state.`);
                                 this.assignStateToNewNode(node);
                             }
                         }
                    });
                }
            });
        });

        this.observer.observe(canvasElement, {
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
            childList: true
        });

        console.log("Paper Canvas: MutationObserver attached.");
    }

    disconnectObserver() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
           // Keep observedCanvasElement reference until we are sure we left the view
            console.log("Paper Canvas: MutationObserver disconnected.");
        }
    }

    // --- Node State and Position Handling ---

     // NEW: Combines discovery and applying state
     discoverNodesAndApplyState(canvasElement: HTMLElement) {
        console.log("Paper Canvas: Discovering nodes and applying state...");
        const nodesInDom = canvasElement.querySelectorAll<HTMLElement>('.canvas-node');
        const nodesInDomIds = new Set<string>(); // Track nodes currently in DOM

        nodesInDom.forEach(nodeEl => {
            const nodeId = this.ensureNodeId(nodeEl);
            nodesInDomIds.add(nodeId); // Add to set of nodes found in DOM

            if (!this.nodeStates.has(nodeId)) {
                // Node exists in DOM but not in state -> Initialize state
                 console.log(`Paper Canvas: Discovering node ${nodeId} without state.`);
                 this.assignStateToNewNode(nodeEl, false); // Assign state but don't assume it's the current page necessarily
            }
             // Always apply visibility/position based on current state and page
             this.applyStateToSingleNode(nodeEl);
        });

         // Optional: Clean up state for nodes that are no longer in the DOM at all
         const nodesToRemoveFromState: string[] = [];
         this.nodeStates.forEach((state, nodeId) => {
             if (!nodesInDomIds.has(nodeId)) {
                 console.warn(`Paper Canvas: Node ${nodeId} exists in state but not in DOM during discovery. Removing state.`);
                 nodesToRemoveFromState.push(nodeId);
             }
         });
         nodesToRemoveFromState.forEach(nodeId => this.nodeStates.delete(nodeId));


        console.log(`Paper Canvas: Discovery complete. Total nodes in state: ${this.nodeStates.size}`);
    }

     // Assigns state to a node assumed to be new or without state
     assignStateToNewNode(nodeEl: HTMLElement, assignToCurrentPage = true) {
         const nodeId = this.ensureNodeId(nodeEl);
         const rect = this.getNodeRectFromElement(nodeEl);
         if (!rect) {
             console.warn(`Paper Canvas: Cannot assign state to node ${nodeId}, failed to get Rect.`);
             return;
         }

         let targetPageIndex: number;
         let relativeX: number;
         let relativeY: number;

         if (assignToCurrentPage) {
             // Default: Assign to the currently viewed page
             targetPageIndex = this.currentPageIndex;
             relativeY = rect.y - targetPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP);
             relativeX = rect.x;
         } else {
             // During discovery, determine page based on current absolute Y
             targetPageIndex = Math.max(0, Math.floor(rect.y / (PAGE_HEIGHT_PX + PAGE_GAP)));
             // Ensure pageIndex is valid (correct if pages were deleted?)
             if (targetPageIndex >= this.pages.length) {
                 console.warn(`Node ${nodeId} detected at Y=${rect.y} implying page ${targetPageIndex+1}, but only ${this.pages.length} pages exist. Assigning to last page.`);
                 targetPageIndex = Math.max(0, this.pages.length - 1);
             }
             relativeY = rect.y - targetPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP);
             relativeX = rect.x;
         }


         // Clamp relative position within page bounds
         const clampedResult = this.clampToBounds(relativeX, relativeY, rect.width, rect.height);

         this.nodeStates.set(nodeId, {
             pageIndex: targetPageIndex,
             x: clampedResult.x,
             y: clampedResult.y
         });
         console.log(`Paper Canvas: Assigned state to node ${nodeId} on page ${targetPageIndex + 1}: Rel (${clampedResult.x}, ${clampedResult.y})`);

         // Immediately update DOM to match clamped state if necessary
         if (clampedResult.changed) {
             this.isUpdatingNodePosition = true;
             const absoluteY = clampedResult.y + targetPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP);
             this.updateNodeTransform(nodeEl, clampedResult.x, absoluteY);
             setTimeout(() => this.isUpdatingNodePosition = false, 0);
         }
         // Apply visibility based on current page
         this.applyVisibilityToNode(nodeEl, targetPageIndex);
     }

     // Applies visibility (show/hide) and position based on stored state
     applyStateToSingleNode(nodeEl: HTMLElement) {
         const nodeId = nodeEl.id; // Assume ID exists if called here
         if (!nodeId) {
             console.warn("ApplyStateToSingleNode called on element without ID");
             return;
         }
         const state = this.nodeStates.get(nodeId);

         if (state) {
             // Position the node correctly based on its state
             const absoluteY = state.y + state.pageIndex * (PAGE_HEIGHT_PX + PAGE_GAP);
             this.updateNodeTransform(nodeEl, state.x, absoluteY);

             // Set visibility based on whether its page is the current page
             this.applyVisibilityToNode(nodeEl, state.pageIndex);

         } else {
             console.warn(`Paper Canvas: No state found for node ${nodeId} during applyState.`);
              // Hide nodes without state to avoid visual glitches
             nodeEl.classList.add(HIDDEN_NODE_CLASS);
         }
     }

     // Applies the correct visibility (hidden class or not) to a node
     applyVisibilityToNode(nodeEl: HTMLElement, nodePageIndex: number) {
          if (nodePageIndex === this.currentPageIndex) {
              nodeEl.classList.remove(HIDDEN_NODE_CLASS); // Show node
          } else {
              nodeEl.classList.add(HIDDEN_NODE_CLASS); // Hide node
          }
     }


    handleNodeStyleChange(nodeEl: HTMLElement) {
        if (this.isUpdatingNodePosition) return;

        const nodeId = this.ensureNodeId(nodeEl);
        const currentState = this.nodeStates.get(nodeId);

        // If state doesn't exist for this node yet, treat it as newly added/assigned
        if (!currentState) {
             console.log(`Node ${nodeId} style changed but no state found. Assigning state now.`);
             this.assignStateToNewNode(nodeEl);
             return; // assignState handles clamping and positioning
        }

        // Node exists in state, likely being moved by user
        const rect = this.getNodeRectFromElement(nodeEl);
        if (!rect) return;

        const targetPageIndex = currentState.pageIndex; // Node stays on its assigned page
        const relativeX = rect.x;
        const relativeY = rect.y - targetPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP);

        // Clamp relative position to bounds
        const clampedResult = this.clampToBounds(relativeX, relativeY, rect.width, rect.height);

        // Update stored state only if position actually changed relative to stored state
        if (clampedResult.x !== currentState.x || clampedResult.y !== currentState.y) {
             this.nodeStates.set(nodeId, {
                 pageIndex: targetPageIndex,
                 x: clampedResult.x,
                 y: clampedResult.y
             });
           // console.log(`Paper Canvas: Updated state for node ${nodeId} on page ${targetPageIndex + 1}: Rel (${clampedResult.x}, ${clampedResult.y})`);
        }


        // If clamping corrected the position, update the DOM element's transform
        if (clampedResult.changed) {
           // console.log(`Paper Canvas: Node ${nodeId} bounds corrected during move.`);
            this.isUpdatingNodePosition = true;
            const absoluteY = clampedResult.y + targetPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP);
            this.updateNodeTransform(nodeEl, clampedResult.x, absoluteY);
            setTimeout(() => this.isUpdatingNodePosition = false, 0);
        }
    }

    // Helper function to clamp coordinates and dimensions to page bounds
    clampToBounds(x: number, y: number, width: number, height: number): { x: number, y: number, changed: boolean } {
        let correctedX = x;
        let correctedY = y;
        let changed = false;

        const minX = 0;
        const minY = 0;
        const maxX = PAGE_WIDTH_PX - Math.max(1, width); // Ensure width is at least 1 for calc
        const maxY = PAGE_HEIGHT_PX - Math.max(1, height); // Ensure height is at least 1 for calc

        if (correctedX < minX) { correctedX = minX; changed = true; }
        if (correctedY < minY) { correctedY = minY; changed = true; }
        if (correctedX > maxX) { correctedX = maxX; changed = true; }
        if (correctedY > maxY) { correctedY = maxY; changed = true; }

        // Ensure position is valid even if node is larger than page
         if (width > PAGE_WIDTH_PX && correctedX < minX) correctedX = minX;
         if (height > PAGE_HEIGHT_PX && correctedY < minY) correctedY = minY;


        return { x: correctedX, y: correctedY, changed };
    }


     // NEW: Applies visibility and position based on stored state for ALL nodes
     applyNodeVisibilityAndPosition(canvasElement: HTMLElement) {
         console.log(`Paper Canvas: Applying visibility/position for all nodes on page ${this.currentPageIndex + 1}`);
         const nodes = canvasElement.querySelectorAll<HTMLElement>('.canvas-node');

         nodes.forEach(nodeEl => {
             this.applyStateToSingleNode(nodeEl); // Use the helper for each node
         });
     }


     // Helper to update the transform: translate() property
     updateNodeTransform(nodeEl: HTMLElement, x: number, y: number) {
         const currentTransform = nodeEl.style.transform || '';
         const otherTransforms = currentTransform.replace(/translate\([^)]+\)/, '').trim();
         const newTransform = `translate(${x}px, ${y}px) ${otherTransforms}`.trim();

         if (nodeEl.style.transform !== newTransform) {
             nodeEl.style.transform = newTransform;
         }
     }

     // Helper to get node Rect based on its style/transform
     getNodeRectFromElement(nodeEl: HTMLElement): { x: number; y: number; width: number; height: number } | null {
        const style = nodeEl.style;
        const transform = style.transform;
        let x = NaN, y = NaN;

        if (transform && transform.includes('translate')) {
            const match = transform.match(/translate\(\s*(-?[\d.]+px)\s*,\s*(-?[\d.]+px)\s*\)/);
            if (match && match[1] && match[2]) {
                x = parseFloat(match[1]);
                y = parseFloat(match[2]);
            }
        }

        if (isNaN(x) || isNaN(y)) {
           // Attempt to get rect if translate failed (might happen briefly during init)
           const bounds = nodeEl.getBoundingClientRect();
           const canvasRect = this.observedCanvasElement?.getBoundingClientRect(); // Need canvas parent offset
           if (bounds && canvasRect) {
               // Calculate position relative to the canvas origin
               // This is an approximation and might be slightly off depending on canvas zoom/pan state
               // but better than nothing if transform isn't set yet.
               // NOTE: This needs refinement based on how Obsidian handles zoom/pan internally.
               // For now, let's assume no zoom/pan offset for simplicity of fixing the core bug.
               // x = bounds.left - canvasRect.left;
               // y = bounds.top - canvasRect.top;
               // console.warn(`Node ${nodeEl.id} using getBoundingClientRect fallback for position: (${x}, ${y})`)

               // SAFER: Return null if translate fails, as BoundingClientRect is complex with zoom/pan
               console.warn(`Paper Canvas: Could not parse translate() for node ${nodeEl.id || '(no id)'}: transform='${transform}'. Cannot get reliable position.`);
               return null;

           } else {
             console.warn(`Paper Canvas: Could not parse translate() or get bounds for node ${nodeEl.id || '(no id)'}.`);
             return null;
           }
        }

        let width = nodeEl.offsetWidth;
        let height = nodeEl.offsetHeight;
        if (style.width && style.width.endsWith('px')) width = parseFloat(style.width) || width;
        if (style.height && style.height.endsWith('px')) height = parseFloat(style.height) || height;
        width = Math.max(1, width); // Ensure min 1px
        height = Math.max(1, height);

        return { x, y, width, height };
    }


    // --- Page Management ---

    generatePageId(): string {
        return 'page-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7);
    }

    ensureNodeId(nodeEl: HTMLElement): string {
        let nodeId = nodeEl.id || nodeEl.dataset.paperCanvasNodeId;
        if (nodeId && nodeId.startsWith('node-')) { // Allow our generated IDs or dataset IDs
             if (!nodeEl.id) nodeEl.id = nodeId; // Ensure element ID is set
             if (!nodeEl.dataset.paperCanvasNodeId) nodeEl.dataset.paperCanvasNodeId = nodeId; // Ensure dataset is set
            return nodeId;
        }
        // Generate new if needed
        nodeId = 'node-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7);
        nodeEl.id = nodeId;
        nodeEl.dataset.paperCanvasNodeId = nodeId;
        console.log(`Paper Canvas: Generated new ID ${nodeId} for node.`);
        return nodeId;
    }

    addNewPage() {
        const activeLeaf = this.app.workspace.activeLeaf;
        if (!this.isCanvasView(activeLeaf) || !this.observedCanvasElement) {
            this.showNotice("No active canvas view to add a page to.");
            return;
        }

        const newPageIndex = this.pages.length;
        const newPage: PageData = {
            id: this.generatePageId(),
            index: newPageIndex,
            name: `Page ${newPageIndex + 1}`
        };
        this.pages.push(newPage);

        this.goToPage(newPageIndex); // Switch to the new page
        this.showNotice(`Created ${newPage.name}`);
    }

    goToPage(targetPageIndex: number) {
        if (targetPageIndex < 0 || targetPageIndex >= this.pages.length) {
             this.showNotice(`Page ${targetPageIndex + 1} does not exist.`);
            return;
        }
         if (targetPageIndex === this.currentPageIndex) {
             console.log("Already on page", targetPageIndex + 1);
             return; // No action needed
         }

        const activeLeaf = this.app.workspace.activeLeaf;
        if (!this.isCanvasView(activeLeaf) || !this.observedCanvasElement) {
            return;
        }

        console.log(`Paper Canvas: Switching from page ${this.currentPageIndex + 1} to ${targetPageIndex + 1}`);
        this.currentPageIndex = targetPageIndex;

        // Update marker, indicator, controls state
        this.updatePageMarker(this.observedCanvasElement);
        this.updatePageIndicator();

        // Apply visibility and positioning for the new page
        this.applyNodeVisibilityAndPosition(this.observedCanvasElement);

        this.positionCamera(activeLeaf);
        this.showNotice(`Switched to ${this.pages[targetPageIndex].name}`);
    }


     // --- UI and Visuals --- (Largely unchanged, check updatePageIndicator for button state)

     updatePageMarker(canvasElement: HTMLElement) {
        this.removePageMarker();
        const yOffset = this.currentPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP);
        this.pageMarkerElement = document.createElement('div');
        this.pageMarkerElement.addClass('paper-canvas-page-marker');
        this.pageMarkerElement.setCssStyles({
            position: 'absolute', left: '0px', top: `${yOffset}px`,
            width: `${PAGE_WIDTH_PX}px`, height: `${PAGE_HEIGHT_PX}px`,
            border: '1px dashed var(--text-faint)', // Use theme color
            pointerEvents: 'none', zIndex: '0'
        });
        canvasElement.prepend(this.pageMarkerElement);
    }

    removePageMarker() {
        this.pageMarkerElement?.remove();
        this.pageMarkerElement = null;
    }

    setupPageControls(leaf: WorkspaceLeaf) {
        if (!this.isCanvasView(leaf)) return;
        this.removePageControls(); // Ensure no duplicates

        const viewContainer = leaf.view.containerEl;
        this.pageControlsElement = viewContainer.createDiv({ cls: 'paper-canvas-page-controls' });
        this.pageControlsElement.setCssStyles({
            position: 'absolute', bottom: '5px', left: '50%', transform: 'translateX(-50%)',
            backgroundColor: 'var(--background-secondary)', padding: '5px 10px', borderRadius: '8px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: '8px', zIndex: '50'
        });

        // Previous Button
        const prevButton = this.pageControlsElement.createEl('button', { cls: 'clickable-icon', attr: {'aria-label': 'Previous Page'} });
        // addIcon(prevButton, 'arrow-left'); // Using Obsidian Icons
        prevButton.setText('←'); // Simple text fallback
        prevButton.addEventListener('click', () => this.goToPage(this.currentPageIndex - 1));

        // Page Indicator Span
        this.pageIndicatorElement = this.pageControlsElement.createEl('span', { cls: 'paper-canvas-page-indicator' });
        this.pageIndicatorElement.setCssStyles({ fontSize: 'var(--font-ui-small)', color: 'var(--text-muted)' });

        // Next Button
        const nextButton = this.pageControlsElement.createEl('button', { cls: 'clickable-icon', attr: {'aria-label': 'Next Page'} });
        // addIcon(nextButton, 'arrow-right');
        nextButton.setText('→');
        nextButton.addEventListener('click', () => this.goToPage(this.currentPageIndex + 1));

        // Add Page Button
        const addButton = this.pageControlsElement.createEl('button', { cls: 'clickable-icon', attr: {'aria-label': 'Add New Page'} });
        // addIcon(addButton, 'plus');
         addButton.setText('+');
        addButton.addEventListener('click', () => this.addNewPage());

        this.updatePageIndicator(); // Set initial text and button states
        console.log("Paper Canvas: Page controls added.");
    }

    removePageControls() {
        this.pageControlsElement?.remove();
        this.pageControlsElement = null;
    }

    updatePageIndicator() {
        if (this.pageIndicatorElement) {
            this.pageIndicatorElement.setText(`Page ${this.currentPageIndex + 1} / ${this.pages.length}`);
             // Update button disabled states
             const controls = this.pageControlsElement;
             if (controls) {
                 const prevBtn = controls.querySelector<HTMLButtonElement>('button:first-child');
                 const nextBtn = controls.querySelector<HTMLButtonElement>('button:nth-child(3)');
                 if (prevBtn) prevBtn.disabled = this.currentPageIndex === 0;
                 if (nextBtn) nextBtn.disabled = this.currentPageIndex >= this.pages.length - 1;
             }
        }
    }

    positionCamera(leaf: WorkspaceLeaf) {
        if (!this.isCanvasView(leaf)) return;
        const targetY = this.currentPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP) + (PAGE_HEIGHT_PX / 2);
        const targetX = PAGE_WIDTH_PX / 2;

        const canvasView = leaf.view as any;
        const canvas = canvasView.canvas;

         if (canvas && typeof canvas.panTo === 'function') {
             try {
                 canvas.panTo(targetX, targetY);
                 // console.log(`Paper Canvas: Used canvas.panTo(${targetX}, ${targetY})`);
             } catch (e) { console.error("Paper Canvas: Error calling canvas.panTo:", e); this.fallbackScroll(leaf, targetY); }
         } else if (canvasView && typeof canvasView.setCameraPos === 'function') {
             try { canvasView.setCameraPos({ x: targetX, y: targetY }); /*console.log(`Used view.setCameraPos`)*/ }
             catch(e) { console.error("Failed setCameraPos:", e); this.fallbackScroll(leaf, targetY); }
         } else { console.warn("Cannot access panTo or setCameraPos."); this.fallbackScroll(leaf, targetY - (leaf.view.containerEl.clientHeight / 2)); }
    }

    fallbackScroll(leaf: WorkspaceLeaf, targetScrollTop: number) {
        const scrollable = leaf.view.containerEl.querySelector('.canvas-scroll-area') as HTMLElement;
         if (scrollable) { scrollable.scrollTop = targetScrollTop; /* console.log(`Fallback scroll set`) */; }
         else { console.warn("Fallback scrolling failed."); }
    }

    showNotice(message: string, duration: number = 3000) {
        new Notice(`Paper Canvas: ${message}`, duration);
    }
}