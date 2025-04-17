import { Plugin, WorkspaceLeaf, Notice, ItemView, Menu, MenuItem } from 'obsidian';

// --- Configuration ---
const PAGE_WIDTH_PX = 794;  // A4 width in pixels at 96 DPI
const PAGE_HEIGHT_PX = 1123; // A4 height in pixels at 96 DPI
const PAGE_GAP = 50; // Gap between pages

// Interface for page data
interface PageData {
    id: string;
    index: number;
    name: string;
}

// --- Plugin Class ---
export default class PaperCanvasPlugin extends Plugin {
    private observer: MutationObserver | null = null;
    private observedCanvasElement: HTMLElement | null = null;
    private pageMarkerElement: HTMLElement | null = null;
    
    // Multi-page related properties
    private pages: PageData[] = [];
    private currentPageIndex: number = 0;
    private pageIndicatorElement: HTMLElement | null = null;
    private pageControlsElement: HTMLElement | null = null;
    // Track node positions by page
    private nodePositions: Map<string, Map<number, {x: number, y: number}>> = new Map();

    async onload() {
        console.log('Loading Paper Canvas Plugin (Multi-page v1)');

        // Initialize with a first page
        this.pages = [{ id: this.generatePageId(), index: 0, name: 'Page 1' }];

        this.registerEvent(
            this.app.workspace.on('layout-change', this.handleLayoutChange)
        );

        this.app.workspace.onLayoutReady(() => {
            this.handleLayoutChange();
        });

        // Command to apply/refresh paper canvas bounds
        this.addCommand({
            id: 'apply-paper-canvas-bounds',
            name: 'Apply Paper Canvas Bounds (Refresh)',
            callback: () => {
                const activeLeaf = this.app.workspace.activeLeaf;
                if (this.isCanvasView(activeLeaf)) {
                    console.log("Manually applying bounds via command.");
                    this.setupCanvasObserverAndMarker(activeLeaf);
                    this.checkExistingNodes(activeLeaf);
                } else {
                    this.showNotice("No active canvas view found.");
                }
            }
        });

        // Command to add a new page
        this.addCommand({
            id: 'add-new-page',
            name: 'Add New Page',
            callback: () => {
                this.addNewPage();
            }
        });

        // Command to go to next page
        this.addCommand({
            id: 'next-page',
            name: 'Go to Next Page',
            callback: () => {
                this.goToPage(this.currentPageIndex + 1);
            }
        });

        // Command to go to previous page
        this.addCommand({
            id: 'previous-page',
            name: 'Go to Previous Page',
            callback: () => {
                this.goToPage(this.currentPageIndex - 1);
            }
        });
    }

    onunload() {
        console.log('Unloading Paper Canvas Plugin (Multi-page v1)');
        this.disconnectObserver();
        this.removePageMarker();
        this.removePageControls();
    }

    // --- Core Logic ---

    handleLayoutChange = () => {
        const activeLeaf = this.app.workspace.activeLeaf;

        if (this.isCanvasView(activeLeaf)) {
            const canvasElement = activeLeaf.view.containerEl.querySelector('.canvas');
            if (canvasElement instanceof HTMLElement) {
                if (this.observedCanvasElement === canvasElement && this.observer) {
                    return; // Already observing the correct element
                }
                console.log("Active leaf is a canvas view. Setting up bounds...");
                this.setupCanvasObserverAndMarker(activeLeaf);
                this.setupPageControls(activeLeaf);
                this.checkExistingNodes(activeLeaf);
            } else {
                // Canvas element not found or not HTMLElement
                this.disconnectObserver();
                this.removePageMarker();
                this.removePageControls();
                this.observedCanvasElement = null;
            }
        } else {
            // Not canvas view
            this.disconnectObserver();
            this.removePageMarker();
            this.removePageControls();
            this.observedCanvasElement = null;
        }
    }

    isCanvasView(leaf: WorkspaceLeaf | null | undefined): leaf is WorkspaceLeaf & { view: { getViewType: () => 'canvas', containerEl: HTMLElement, [key: string]: any } } {
        return !!leaf && leaf.view?.getViewType() === 'canvas';
    }

    setupCanvasObserverAndMarker(leaf: WorkspaceLeaf) {
        if (!this.isCanvasView(leaf)) return;

        // Clean up previous setup
        this.disconnectObserver();
        this.removePageMarker();

        const view = leaf.view;
        const container = view.containerEl;
        const canvasElement = container.querySelector('.canvas');

        if (!canvasElement) {
            console.error("Paper Canvas: Could not find the main canvas element (div.canvas). Cannot add marker or observer.");
            return;
        }

        if (!(canvasElement instanceof HTMLElement)) {
            console.error("Paper Canvas: The found '.canvas' element is not an HTMLElement as expected:", canvasElement);
            return;
        }

        this.observedCanvasElement = canvasElement;

        // Add visual page marker
        this.updatePageMarker(canvasElement);

        // Setup Mutation Observer
        this.observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (mutation.target instanceof HTMLElement && mutation.target.classList.contains('canvas-node')) {
                        this.saveNodePosition(mutation.target);
                        this.enforceBounds(mutation.target);
                    }
                }
            });
        });

        this.observer.observe(canvasElement, {
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
        });

        console.log("Paper Canvas: MutationObserver attached to div.canvas.");
    }

    updatePageMarker(canvasElement: HTMLElement) {
        this.removePageMarker();
        
        // Create page marker based on current page
        const yOffset = this.currentPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP);
        
        this.pageMarkerElement = document.createElement('div');
        this.pageMarkerElement.addClass('paper-canvas-page-marker');
        
        this.pageMarkerElement.setCssStyles({
            position: 'absolute',
            left: '0px',
            top: `${yOffset}px`,
            width: `${PAGE_WIDTH_PX}px`,
            height: `${PAGE_HEIGHT_PX}px`,
            border: '1px dashed grey',
            pointerEvents: 'none',
            zIndex: '0'
        });
        
        canvasElement.prepend(this.pageMarkerElement);
        console.log(`Paper Canvas: Created page marker for page ${this.currentPageIndex + 1}`);
    }

    setupPageControls(leaf: WorkspaceLeaf) {
        if (!this.isCanvasView(leaf)) return;
        
        this.removePageControls(); // Remove existing controls first
        
        const container = leaf.view.containerEl;
        const controlsContainer = container.querySelector('.canvas-controls');
        
        if (!controlsContainer || !(controlsContainer instanceof HTMLElement)) {
            console.error("Paper Canvas: Could not find canvas controls container");
            return;
        }
        
        // Create page controls container
        this.pageControlsElement = document.createElement('div');
        this.pageControlsElement.addClass('paper-canvas-page-controls');
        this.pageControlsElement.setCssStyles({
            position: 'absolute',
            bottom: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255, 255, 255, 0.7)',
            padding: '5px 10px',
            borderRadius: '5px',
            display: 'flex',
            gap: '5px',
            zIndex: '10'
        });
        
        // Create previous page button
        const prevButton = document.createElement('button');
        prevButton.addClass('paper-canvas-page-button');
        prevButton.setText('←');
        prevButton.addEventListener('click', () => {
            this.goToPage(this.currentPageIndex - 1);
        });
        
        // Create page indicator
        this.pageIndicatorElement = document.createElement('span');
        this.pageIndicatorElement.addClass('paper-canvas-page-indicator');
        this.updatePageIndicator();
        
        // Create next page button
        const nextButton = document.createElement('button');
        nextButton.addClass('paper-canvas-page-button');
        nextButton.setText('→');
        nextButton.addEventListener('click', () => {
            this.goToPage(this.currentPageIndex + 1);
        });
        
        // Create add page button
        const addButton = document.createElement('button');
        addButton.addClass('paper-canvas-page-button');
        addButton.setText('+');
        addButton.addEventListener('click', () => {
            this.addNewPage();
        });
        
        // Add elements to controls
        this.pageControlsElement.appendChild(prevButton);
        this.pageControlsElement.appendChild(this.pageIndicatorElement);
        this.pageControlsElement.appendChild(nextButton);
        this.pageControlsElement.appendChild(addButton);
        
        // Add controls to the canvas view
        container.appendChild(this.pageControlsElement);
        console.log("Paper Canvas: Page controls added");
    }

    removePageControls() {
        if (this.pageControlsElement) {
            this.pageControlsElement.remove();
            this.pageControlsElement = null;
            console.log("Paper Canvas: Page controls removed");
        }
    }

    updatePageIndicator() {
        if (this.pageIndicatorElement) {
            this.pageIndicatorElement.setText(`Page ${this.currentPageIndex + 1} of ${this.pages.length}`);
        }
    }

    checkExistingNodes(leaf: WorkspaceLeaf | null) {
        if (!this.isCanvasView(leaf)) return;

        const canvasElement = leaf.view.containerEl.querySelector('.canvas');
        if (!(canvasElement instanceof HTMLElement)) {
            console.error("Paper Canvas: Cannot check existing nodes, '.canvas' is not an HTMLElement.");
            return;
        };

        const existingNodes = canvasElement.querySelectorAll('.canvas-node');
        console.log(`Paper Canvas: Checking bounds for ${existingNodes.length} existing nodes.`);
        
        // First save positions for all nodes on current page
        existingNodes.forEach(node => {
            if (node instanceof HTMLElement) {
                this.saveNodePosition(node);
            }
        });
        
        // Then restore node positions from saved data and enforce bounds
        existingNodes.forEach(node => {
            if (node instanceof HTMLElement) {
                this.restoreNodePosition(node);
                this.enforceBounds(node);
            }
        });
    }

    // Save node position for current page
    saveNodePosition(nodeEl: HTMLElement) {
        const rect = this.getNodeRect(nodeEl);
        if (!rect) return;
        
        const nodeId = nodeEl.id || this.generateNodeId(nodeEl);
        
        // Ensure the node has an ID
        if (!nodeEl.id) {
            nodeEl.id = nodeId;
        }
        
        // Initialize position maps if needed
        if (!this.nodePositions.has(nodeId)) {
            this.nodePositions.set(nodeId, new Map());
        }
        
        // Save position for current page
        const pagePositions = this.nodePositions.get(nodeId);
        if (pagePositions) {
            pagePositions.set(this.currentPageIndex, {
                x: rect.x,
                y: rect.y - (this.currentPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP)) // Save relative to page
            });
        }
    }
    
    // Restore node position for current page
    restoreNodePosition(nodeEl: HTMLElement) {
        const nodeId = nodeEl.id || this.generateNodeId(nodeEl);
        
        // Check if we have saved position for this node on this page
        const pagePositions = this.nodePositions.get(nodeId);
        if (!pagePositions) return;
        
        const savedPos = pagePositions.get(this.currentPageIndex);
        if (!savedPos) return;
        
        // Calculate absolute position based on page
        const pageOffset = this.currentPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP);
        const x = savedPos.x;
        const y = savedPos.y + pageOffset;
        
        // Apply position
        const currentTransform = nodeEl.style.transform || '';
        const otherTransforms = currentTransform.replace(/translate\([^)]+\)/, '').trim();
        const newTransform = `translate(${x}px, ${y}px) ${otherTransforms}`.trim();
        
        nodeEl.style.transform = newTransform;
    }
    
    generateNodeId(nodeEl: HTMLElement): string {
        return 'node-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
    }

    disconnectObserver() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
            this.observedCanvasElement = null;
            console.log("Paper Canvas: MutationObserver disconnected.");
        }
    }

    removePageMarker() {
        if (this.pageMarkerElement) {
            this.pageMarkerElement.remove();
            this.pageMarkerElement = null;
            console.log("Paper Canvas: Page marker removed.");
        }
    }

    // --- Page Management ---
    
    generatePageId(): string {
        return 'page-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
    }
    
    addNewPage() {
        const activeLeaf = this.app.workspace.activeLeaf;
        if (!this.isCanvasView(activeLeaf)) {
            this.showNotice("No active canvas view to add a page to.");
            return;
        }
        
        // Save current node positions before adding new page
        this.saveAllNodePositions(activeLeaf);
        
        // Create a new page
        const newPageIndex = this.pages.length;
        const newPage: PageData = {
            id: this.generatePageId(),
            index: newPageIndex,
            name: `Page ${newPageIndex + 1}`
        };
        
        // Add to our pages array
        this.pages.push(newPage);
        
        // Switch to the new page
        this.goToPage(newPageIndex);
        
        this.showNotice(`New page created: ${newPage.name}`);
    }
    
    saveAllNodePositions(leaf: WorkspaceLeaf) {
        if (!this.isCanvasView(leaf)) return;
        
        const canvasElement = leaf.view.containerEl.querySelector('.canvas');
        if (!(canvasElement instanceof HTMLElement)) return;
        
        const nodes = canvasElement.querySelectorAll('.canvas-node');
        nodes.forEach(node => {
            if (node instanceof HTMLElement) {
                this.saveNodePosition(node);
            }
        });
    }
    
    goToPage(pageIndex: number) {
        // Check if page exists
        if (pageIndex < 0 || pageIndex >= this.pages.length) {
            this.showNotice(`Page ${pageIndex + 1} does not exist`);
            return;
        }
        
        const activeLeaf = this.app.workspace.activeLeaf;
        if (!this.isCanvasView(activeLeaf)) {
            return;
        }
        
        // Save current node positions before switching
        this.saveAllNodePositions(activeLeaf);
        
        // Update current page index
        this.currentPageIndex = pageIndex;
        console.log(`Paper Canvas: Switched to page ${pageIndex + 1} of ${this.pages.length}`);
        
        // Update the page marker position
        if (this.observedCanvasElement) {
            this.updatePageMarker(this.observedCanvasElement);
        }
        
        // Update the page indicator
        this.updatePageIndicator();
        
        // Try to set camera position via view API first
        try {
            const view = activeLeaf.view;
            const targetY = this.currentPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP);
            
            // Try multiple ways to set camera position
            if (view && typeof view.setCameraPos === 'function') {
                view.setCameraPos({
                    x: 0,
                    y: targetY
                });
                console.log(`Paper Canvas: Set camera position to y=${targetY}`);
            } 
            else if (view && view.canvas && typeof view.canvas.setCameraPos === 'function') {
                view.canvas.setCameraPos({
                    x: 0,
                    y: targetY
                });
                console.log(`Paper Canvas: Set camera position via canvas to y=${targetY}`);
            }
            else {
                // Fallback for camera position
                const canvasView = activeLeaf.view.containerEl.querySelector('.canvas-view');
                if (canvasView instanceof HTMLElement) {
                    canvasView.scrollTop = targetY;
                    console.log(`Paper Canvas: Fallback - set scrollTop to y=${targetY}`);
                } else {
                    console.warn("Paper Canvas: Cannot access setCameraPos function");
                }
            }
        } catch (e) {
            console.error("Paper Canvas: Failed to set camera position:", e);
        }
        
        // Restore node positions
        this.checkExistingNodes(activeLeaf);
        
        // Show notification about page change
        this.showNotice(`Switched to ${this.pages[pageIndex].name}`);
    }

    // --- Bounds Enforcement ---

    getNodeRect(nodeEl: HTMLElement): { x: number; y: number; width: number; height: number } | null {
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
            return null;
        }

        let width = nodeEl.offsetWidth;
        let height = nodeEl.offsetHeight;

        if (style.width && style.width.endsWith('px')) {
            width = parseFloat(style.width) || width;
        }
        if (style.height && style.height.endsWith('px')) {
            height = parseFloat(style.height) || height;
        }

        if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
            console.warn(`Paper Canvas: Invalid dimensions for node ${nodeEl.id || '(no id)'}. W: ${width}, H: ${height}`);
            return null;
        }
        return { x, y, width, height };
    }

    enforceBounds(nodeEl: HTMLElement) {
        if (nodeEl.dataset.checkingBounds === 'true') return;

        const rect = this.getNodeRect(nodeEl);
        if (!rect) {
            return;
        }

        nodeEl.dataset.checkingBounds = 'true';

        let { x, y, width, height } = rect;
        let correctedX = x;
        let correctedY = y;
        let changed = false;

        // Calculate page offset
        const pageOffset = this.currentPageIndex * (PAGE_HEIGHT_PX + PAGE_GAP);
        
        // Page bounds for current page
        const pageBounds = {
            minX: 0,
            minY: pageOffset,
            maxX: PAGE_WIDTH_PX,
            maxY: pageOffset + PAGE_HEIGHT_PX
        };

        // If node is completely outside current page bounds, move it to current page
        if (y < pageBounds.minY - height || y > pageBounds.maxY + height) {
            correctedY = pageBounds.minY;
            changed = true;
        }

        // Standard bounds checking
        if (correctedX < pageBounds.minX) { correctedX = pageBounds.minX; changed = true; }
        if (correctedX + width > pageBounds.maxX) { correctedX = pageBounds.maxX - width; changed = true; }
        if (correctedY < pageBounds.minY) { correctedY = pageBounds.minY; changed = true; }
        if (correctedY + height > pageBounds.maxY) { correctedY = pageBounds.maxY - height; changed = true; }

        // Handle oversized nodes
        if (width > PAGE_WIDTH_PX) correctedX = pageBounds.minX;
        if (height > PAGE_HEIGHT_PX) correctedY = pageBounds.minY;

        if (changed) {
            console.log(`Paper Canvas: Node ${nodeEl.id || '(no id)'} out of bounds. Correcting position to (${correctedX}, ${correctedY})`);

            const currentTransform = nodeEl.style.transform || '';
            const otherTransforms = currentTransform.replace(/translate\([^)]+\)/, '').trim();
            const newTransform = `translate(${correctedX}px, ${correctedY}px) ${otherTransforms}`.trim();

            nodeEl.style.transform = newTransform;
            
            // Update saved position after correction
            if (nodeEl.id) {
                const pagePositions = this.nodePositions.get(nodeEl.id);
                if (pagePositions) {
                    pagePositions.set(this.currentPageIndex, {
                        x: correctedX,
                        y: correctedY - pageOffset
                    });
                }
            }
        }

        setTimeout(() => {
            delete nodeEl.dataset.checkingBounds;
        }, 0);
    }

    showNotice(message: string, duration: number = 5000) {
        new Notice(message, duration);
    }
}