import { TFile, Notice } from "obsidian";
import {
	PageData,
	NodeState,
	SavedCanvasState,
	PaperCanvasPluginInterface,
	PaperCanvasSettings,
} from "./types";
import { CANVAS_DATA_VERSION, PAGE_GAP } from "./constants";

export class StateManager {
	plugin: PaperCanvasPluginInterface;
	pages: PageData[] = [];
	nodeStates: Map<string, NodeState> = new Map();
	currentPageIndex: number = 0;
	private saveTimeout: NodeJS.Timeout | null = null;

	constructor(plugin: PaperCanvasPluginInterface) {
		this.plugin = plugin;
		this.resetLocalState();
	}
	getCurrentPageIndex(): number {
		return this.currentPageIndex;
	}
	setCurrentPageIndex(index: number): void {
		if (index >= 0 && index < this.pages.length) {
			this.currentPageIndex = index;
			console.log(`StateManager: Set currentPageIndex to ${index}`);
		} else {
			console.error(
				`StateManager: Attempted to set invalid page index: ${index}`
			);
			if (this.pages.length > 0) {
				this.currentPageIndex = Math.max(
					0,
					Math.min(index, this.pages.length - 1)
				);
				console.warn(
					`StateManager: Clamped page index to ${this.currentPageIndex}`
				);
			} else {
				this.currentPageIndex = 0;
			}
		}
	}
	getPages(): PageData[] {
		this.pages.forEach((p, i) => (p.index = i));
		return this.pages;
	}
	getNodeState(nodeId: string): NodeState | undefined {
		return this.nodeStates.get(nodeId);
	}
	getAllNodeStates(): Map<string, NodeState> {
		return this.nodeStates;
	}
	resetLocalState(): void {
		this.pages = [{ id: this.generatePageId(), index: 0, name: "Page 1" }];
		this.nodeStates.clear();
		this.currentPageIndex = 0;
		console.log("StateManager: Local state reset.");
	}
	generatePageId(): string {
		return (
			"page-" +
			Date.now().toString(36) +
			"-" +
			Math.random().toString(36).substring(2, 7)
		);
	}
	ensureNodeId(nodeEl: HTMLElement): string {
		let nodeId = nodeEl.id || nodeEl.dataset.paperCanvasNodeId;
		if (
			nodeId &&
			(nodeId.startsWith("node-") || /^[a-zA-Z0-9-_]+$/.test(nodeId))
		) {
			if (!nodeEl.id) nodeEl.id = nodeId;
			if (!nodeEl.dataset.paperCanvasNodeId)
				nodeEl.dataset.paperCanvasNodeId = nodeId;
			return nodeId;
		}
		nodeId =
			"node-" +
			Date.now().toString(36) +
			"-" +
			Math.random().toString(36).substring(2, 7);
		nodeEl.id = nodeId;
		nodeEl.dataset.paperCanvasNodeId = nodeId;
		console.log(`StateManager: Generated new ID ${nodeId} for node.`);
		return nodeId;
	}
	getCanvasDataKey(file: TFile | null): string | null {
		if (!file) return null;
		return `canvasData_${file.path}`;
	}
	async loadCanvasData(file: TFile | null): Promise<boolean> {
		/* ... unchanged ... */ return false;
	}
	async saveCanvasData(file: TFile | null, immediate = false): Promise<void> {
		/* ... unchanged ... */
	}
	validateState(): void {
		/* ... unchanged ... */
	}

	// Debounce wrapper
	requestSave = (): void => {
		if (this.saveTimeout) clearTimeout(this.saveTimeout);
		this.saveTimeout = setTimeout(() => {
			this.saveCanvasData(this.plugin.getCurrentFile());
		}, 2500);
	};

	// --- State Modification Logic ---

	addNewPage(): number {
		const newPageIndex = this.pages.length;
		const newPage: PageData = {
			id: this.generatePageId(),
			index: newPageIndex,
			name: `Page ${newPageIndex + 1}`,
		};
		this.pages.push(newPage);
		this.validateState();
		this.requestSave(); // *** Save after adding page ***
		return newPageIndex;
	}

	assignStateToNewNode(
		nodeEl: HTMLElement,
		rect: { x: number; y: number; width: number; height: number }
	): void {
		const nodeId = this.ensureNodeId(nodeEl);
		const pageDimensions = this.plugin.getPageDimensions();
		const targetPageIndex = this.currentPageIndex;
		const relativeX = rect.x;
		const relativeY =
			rect.y - targetPageIndex * (pageDimensions.height + PAGE_GAP);
		const clampedResult = this.clampToBounds(
			relativeX,
			relativeY,
			rect.width,
			rect.height,
			pageDimensions
		);

		this.nodeStates.set(nodeId, {
			pageIndex: targetPageIndex,
			x: clampedResult.x,
			y: clampedResult.y,
		});
		console.log(
			`StateManager: Assigned state to ${nodeId} on page ${
				targetPageIndex + 1
			}`
		);
		this.requestSave(); // *** Save after assigning state ***
	}

	// *** MAJOR REWORK: Make state authoritative during moves ***
	updateNodeStateFromStyleChange(
		nodeId: string,
		currentState: NodeState, // Existing state is required
		rect: { x: number; y: number; width: number; height: number } // Current DOM rect
	): {
		stateChanged: boolean;
		clampedResult: { x: number; y: number; changed: boolean };
	} {
		const pageDimensions = this.plugin.getPageDimensions();
		const pageOffsetY =
			currentState.pageIndex * (pageDimensions.height + PAGE_GAP);

		// Calculate the absolute position the node *should* be at based on stored state
		const lastKnownAbsoluteX = currentState.x; // Relative X is Absolute X on canvas
		const lastKnownAbsoluteY = currentState.y + pageOffsetY;

		// Calculate the difference (delta) between the last known good position
		// and the position reported by the DOM event (rect)
		const deltaX = rect.x - lastKnownAbsoluteX;
		const deltaY = rect.y - lastKnownAbsoluteY;

		// Apply the delta to the stored *relative* coordinates
		// This assumes the delta represents the user's intended move since the last *valid* state update
		const newRelativeX = currentState.x + deltaX;
		const newRelativeY = currentState.y + deltaY;

		// Clamp the *new* calculated relative position
		const clampedResult = this.clampToBounds(
			newRelativeX,
			newRelativeY,
			rect.width,
			rect.height,
			pageDimensions
		);

		let stateChanged = false;
		// Update state only if the *clamped result* differs from the stored state
		if (
			clampedResult.x !== currentState.x ||
			clampedResult.y !== currentState.y
		) {
			this.nodeStates.set(nodeId, {
				pageIndex: currentState.pageIndex, // Keep the same page index
				x: clampedResult.x,
				y: clampedResult.y,
			});
			stateChanged = true;
			this.requestSave(); // Save if state changed
			console.log(
				`StateManager: Node ${nodeId} state updated based on delta. New Rel: (${clampedResult.x}, ${clampedResult.y})`
			);
		}

		// Return the clamped result (even if state didn't change, DOM might need update due to clamping)
		// and whether the state map was actually updated
		return { stateChanged, clampedResult };
	}

	// *** Complete removeNodeState method ***
    removeNodeState(nodeId: string): void {
        if (this.nodeStates.delete(nodeId)) {
             console.log(`StateManager: Removed state for node ${nodeId}`);
             this.requestSave(); // Ensure save is requested after removing state
        }
    }

    // *** Complete clampToBounds method ***
    clampToBounds(
        x: number,
        y: number,
        width: number,
        height: number,
        pageDimensions: {width: number, height: number}
    ): { x: number; y: number; changed: boolean; } {
        const pageW = pageDimensions.width;
        const pageH = pageDimensions.height;
        let cX = x; // Use cX, cY for corrected values
        let cY = y;
        let ch = false; // Use ch for changed flag

        // Ensure dimensions are at least 1px for calculation safety
        const effWidth = Math.max(1, width);
        const effHeight = Math.max(1, height);

        const minX = 0;
        const minY = 0;
        // Calculate max based on effective dimensions to prevent negative max values
        const maxX = pageW - effWidth;
        const maxY = pageH - effHeight;

        // Clamp left edge
        if (cX < minX) { cX = minX; ch = true; }
        // Clamp top edge
        if (cY < minY) { cY = minY; ch = true; }

        // Clamp right edge (check against page width)
        // Use Math.max(minX, ...) to handle cases where node is wider than page
        if (cX > maxX) { cX = Math.max(minX, maxX); ch = true; }
        // Clamp bottom edge (check against page height)
        // Use Math.max(minY, ...) to handle cases where node is taller than page
        if (cY > maxY) { cY = Math.max(minY, maxY); ch = true; }

        return { x: cX, y: cY, changed: ch };
    }

}
