import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';

// --- Configuration ---
const PAGE_WIDTH_PX = 794;
const PAGE_HEIGHT_PX = 1123;
const PAGE_BOUNDS = {
    minX: 0,
    minY: 0,
    maxX: PAGE_WIDTH_PX,
    maxY: PAGE_HEIGHT_PX,
};

// --- Plugin Class ---
export default class PaperCanvasPlugin extends Plugin {
    // Ensure this is typed correctly
    private observer: MutationObserver | null = null;
    private observedCanvasElement: HTMLElement | null = null; // Explicitly type as HTMLElement
    private pageMarkerElement: HTMLElement | null = null;

    async onload() {
        console.log('Loading Paper Canvas Plugin (Draft v2)');

        this.registerEvent(
            this.app.workspace.on('layout-change', this.handleLayoutChange)
        );

        this.app.workspace.onLayoutReady(() => {
            this.handleLayoutChange();
        });

        this.addCommand({
             id: 'apply-paper-canvas-bounds',
             name: 'Apply Paper Canvas Bounds (Refresh)',
             callback: () => {
                const activeLeaf = this.app.workspace.activeLeaf;
                if (this.isCanvasView(activeLeaf)) {
                    console.log("Manually applying bounds via command.")
                    this.setupCanvasObserverAndMarker(activeLeaf);
                     this.checkExistingNodes(activeLeaf);
                } else {
                    this.showNotice("No active canvas view found.");
                }
             }
         });
    }

    onunload() {
        console.log('Unloading Paper Canvas Plugin (Draft v2)');
        this.disconnectObserver();
        this.removePageMarker();
    }

    // --- Core Logic ---

    handleLayoutChange = () => {
        const activeLeaf = this.app.workspace.activeLeaf;

        if (this.isCanvasView(activeLeaf)) {
             const canvasElement = activeLeaf.view.containerEl.querySelector('.canvas');
             // Also check if it's an HTMLElement here for safety, though less critical than below
             if (canvasElement instanceof HTMLElement) {
                 if (this.observedCanvasElement === canvasElement && this.observer) {
                     return; // Already observing the correct element
                 }
                 console.log("Active leaf is a canvas view. Setting up bounds...");
                 this.setupCanvasObserverAndMarker(activeLeaf);
                 this.checkExistingNodes(activeLeaf);
             } else if (canvasElement) {
                console.error("Paper Canvas: Found '.canvas' but it's not an HTMLElement in handleLayoutChange.");
                this.disconnectObserver(); // Disconnect if the element is weird
                this.removePageMarker();
                this.observedCanvasElement = null;
             } else {
                 // '.canvas' not found yet, might be loading, don't disconnect existing observer yet
             }

        } else {
            // Active leaf is not a canvas, definitely clean up
            this.disconnectObserver();
            this.removePageMarker();
            this.observedCanvasElement = null;
        }
    }

    isCanvasView(leaf: WorkspaceLeaf | null | undefined): leaf is WorkspaceLeaf & { view: { getViewType: () => 'canvas', containerEl: HTMLElement, [key: string]: any } } {
        return !!leaf && leaf.view?.getViewType() === 'canvas';
    }

    setupCanvasObserverAndMarker(leaf: WorkspaceLeaf) {
         if (!this.isCanvasView(leaf)) return;

         // It's good practice to disconnect/remove existing before setting up new ones
         this.disconnectObserver();
         this.removePageMarker();

        const view = leaf.view;
        const container = view.containerEl;

        const canvasElement = container.querySelector('.canvas');

        if (!canvasElement) {
            console.error("Paper Canvas: Could not find the main canvas element (div.canvas). Cannot add marker or observer.");
            return;
        }

        // *** ADDED TYPE GUARD ***
        if (!(canvasElement instanceof HTMLElement)) {
             console.error("Paper Canvas: The found '.canvas' element is not an HTMLElement as expected:", canvasElement);
             return;
        }
        // *** END OF ADDED CHECK ***

        this.observedCanvasElement = canvasElement; // Assign the verified HTMLElement

        // --- 1. Add Visual Page Marker ---
        this.pageMarkerElement = document.createElement('div');
        this.pageMarkerElement.addClass('paper-canvas-page-marker');
        this.pageMarkerElement.setCssStyles({
            position: 'absolute',
            left: `${PAGE_BOUNDS.minX}px`,
            top: `${PAGE_BOUNDS.minY}px`,
            width: `${PAGE_WIDTH_PX}px`,
            height: `${PAGE_HEIGHT_PX}px`,
            border: '1px dashed grey',
            pointerEvents: 'none',
            zIndex: '0'
        });

        canvasElement.prepend(this.pageMarkerElement);
        console.log("Paper Canvas: Page marker added to div.canvas.");

        // --- 2. Setup Mutation Observer ---
        this.observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    // Ensure mutation.target is also HTMLElement before passing
                    if (mutation.target instanceof HTMLElement && mutation.target.classList.contains('canvas-node')) {
                        this.enforceBounds(mutation.target);
                    }
                }
            });
        });

        this.observer.observe(canvasElement, { // Observe the verified HTMLElement
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
        });

        console.log("Paper Canvas: MutationObserver attached to div.canvas.");
    }

     checkExistingNodes(leaf: WorkspaceLeaf | null) {
         if (!this.isCanvasView(leaf)) return;

         const canvasElement = leaf.view.containerEl.querySelector('.canvas');
         // Add type guard here too for robustness
         if (!(canvasElement instanceof HTMLElement)) {
             console.error("Paper Canvas: Cannot check existing nodes, '.canvas' is not an HTMLElement.");
             return;
         };

         const existingNodes = canvasElement.querySelectorAll('.canvas-node');
         console.log(`Paper Canvas: Checking bounds for ${existingNodes.length} existing nodes.`);
         existingNodes.forEach(node => {
             // NodeList elements are 'Element', add check here too
             if (node instanceof HTMLElement) {
                 this.enforceBounds(node);
             }
         });
     }


    disconnectObserver() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
             // Clear the reference only when explicitly disconnecting
             // Avoid clearing it if just switching between canvas views handled by handleLayoutChange
             // Let's move the null assignment here for simplicity on unload/failure.
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

    // --- Bounds Enforcement ---

    // getNodeRect expects HTMLElement, so ensure calls pass HTMLElement
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

    // enforceBounds expects HTMLElement
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

        if (correctedX < PAGE_BOUNDS.minX) { correctedX = PAGE_BOUNDS.minX; changed = true; }
        if (correctedX + width > PAGE_BOUNDS.maxX) { correctedX = PAGE_BOUNDS.maxX - width; changed = true; }
        if (correctedY < PAGE_BOUNDS.minY) { correctedY = PAGE_BOUNDS.minY; changed = true; }
        if (correctedY + height > PAGE_BOUNDS.maxY) { correctedY = PAGE_BOUNDS.maxY - height; changed = true; }

        if (width > PAGE_WIDTH_PX && correctedX < PAGE_BOUNDS.minX) correctedX = PAGE_BOUNDS.minX;
        if (height > PAGE_HEIGHT_PX && correctedY < PAGE_BOUNDS.minY) correctedY = PAGE_BOUNDS.minY;


        if (changed) {
             console.log(`Paper Canvas: Node ${nodeEl.id || '(no id)'} out of bounds. Correcting position to (${correctedX}, ${correctedY})`);

             const currentTransform = nodeEl.style.transform || '';
             const otherTransforms = currentTransform.replace(/translate\([^)]+\)/, '').trim();
             const newTransform = `translate(${correctedX}px, ${correctedY}px) ${otherTransforms}`.trim();

            nodeEl.style.transform = newTransform;
        }

        setTimeout(() => {
            delete nodeEl.dataset.checkingBounds;
        }, 0);
    }

     showNotice(message: string, duration: number = 5000) {
         new Notice(message, duration);
     }
}