import { WorkspaceLeaf, TFile, Notice, Menu, View } from "obsidian";
import {
	PaperCanvasPluginInterface,
	PageData,
	NodeState,
	CanvasView,
} from "./types";
import {
	HIDDEN_NODE_CLASS,
	PAGE_GAP,
	EXPORT_BUTTON_CLASS,
	EXPORT_ALL_BUTTON_CLASS,
} from "./constants";

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
		this.removeActionButtons(); // Ensure called during cleanup
		this.removeHideStyle();
		this.observedCanvasElement = null;
	}

	addHideStyle(): void {
		this.removeHideStyle(); // Ensure no duplicates
		this.styleEl = document.createElement("style");
		this.styleEl.textContent = `.${HIDDEN_NODE_CLASS} { opacity: 0 !important; pointer-events: none !important; user-select: none !important; }`;
		document.head.appendChild(this.styleEl);
	}

	removeHideStyle(): void {
		this.styleEl?.remove();
		this.styleEl = null;
	}

	getObservedCanvasElement(): HTMLElement | null {
		return this.observedCanvasElement;
	}

	disconnectObserver(): void {
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
			console.log("ViewManager: Observer disconnected.");
		}
	}

	// --- Observer Setup ---
	setupCanvasObserver(
		canvasElement: HTMLElement,
		stateManager: {
			// Interface for StateManager methods needed by observer
			// ** Expects updateNodeStateFromStyleChange with specific signature **
			updateNodeStateFromStyleChange(
				nodeId: string,
				currentState: NodeState,
				rect: { x: number; y: number; width: number; height: number }
			): {
				stateChanged: boolean;
				clampedResult: { x: number; y: number; changed: boolean };
			};
			assignStateToNewNode(
				nodeEl: HTMLElement,
				rect: { x: number; y: number; width: number; height: number }
			): void;
			getNodeState(nodeId: string): NodeState | undefined;
			ensureNodeId(nodeEl: HTMLElement): string;
		}
	): void {
		if (this.observer) this.disconnectObserver();
		this.observedCanvasElement = canvasElement;

		this.observer = new MutationObserver((mutations: MutationRecord[]) => {
			if (this.isUpdatingNodePosition) return;

			// Process attribute changes first
			mutations.forEach((mutationRecord: MutationRecord) => {
				if (
					mutationRecord.type === "attributes" &&
					mutationRecord.attributeName === "style"
				) {
					if (
						mutationRecord.target instanceof HTMLElement &&
						mutationRecord.target.classList.contains("canvas-node")
					) {
						const nodeEl = mutationRecord.target;
						const nodeId = stateManager.ensureNodeId(nodeEl);
						const currentState = stateManager.getNodeState(nodeId); // Get current state

						// *** Only process style change if state exists (i.e., not the initial placement glitch) ***
						if (currentState) {
							const rect = this.getNodeRectFromElement(
								nodeEl,
								canvasElement
							);
							if (rect) {
								// *** Pass nodeId, currentState, and rect to StateManager ***
								// StateManager now handles state update logic and requests save if needed
								const { stateChanged, clampedResult } =
									stateManager.updateNodeStateFromStyleChange(
										nodeId,
										currentState,
										rect
									);

								// If clamping occurred (even if state didn't change), update DOM position
								if (clampedResult.changed) {
									this.isUpdatingNodePosition = true;
									const pageDimensions =
										this.plugin.getPageDimensions();
									const absoluteY =
										clampedResult.y +
										currentState.pageIndex *
											(pageDimensions.height + PAGE_GAP);
									this.updateNodeTransform(
										nodeEl,
										clampedResult.x,
										absoluteY
									);
									setTimeout(
										() =>
											(this.isUpdatingNodePosition =
												false),
										0
									);
									console.log(
										`ViewManager: Clamped node ${nodeId} position due to move.`
									);
								}
							} else {
								console.warn(
									`Observer: Could not get rect for style change on ${nodeId}`
								);
							}
						} else {
							// Ignore style changes reported before initial state is assigned
							// console.log(`Style change on node ${nodeId} without state, ignored.`);
						}
					}
				}
			});

			// Process added nodes with delay
			mutations.forEach((mutationRecord: MutationRecord) => {
				if (mutationRecord.type === "childList") {
					mutationRecord.removedNodes.forEach((node) => {
						/* ... log removal ... */
					});
					mutationRecord.addedNodes.forEach((node) => {
						if (
							node instanceof HTMLElement &&
							node.classList.contains("canvas-node")
						) {
							const htmlNode = node as HTMLElement;
							const nodeId = stateManager.ensureNodeId(htmlNode);
							setTimeout(() => {
								if (!document.body.contains(htmlNode)) {
									return;
								}
								const rect = this.getNodeRectFromElement(
									htmlNode,
									canvasElement
								);
								if (rect) {
									let nodeState =
										stateManager.getNodeState(nodeId);
									let needsPositionReapplied = false;

									if (!nodeState) {
										// Check if state *still* doesn't exist
										console.log(
											`Node ${nodeId} added. Assigning state.`
										);
										stateManager.assignStateToNewNode(
											htmlNode,
											rect
										); // StateManager handles saving
										nodeState =
											stateManager.getNodeState(nodeId); // Get newly assigned state
										needsPositionReapplied = true; // Definitely reapply after new assignment
									} else {
										// Node was re-added, state exists
										console.log(
											`Node ${nodeId} re-added. Ensuring position matches state.`
										);
										needsPositionReapplied = true; // Re-apply existing state too
									}

									// *** FIX: Force re-apply position after state assignment/check on next frame ***
									if (needsPositionReapplied && nodeState) {
										// Use local copy of state for closure
										const stateToApply = { ...nodeState };
										requestAnimationFrame(() => {
											if (
												document.body.contains(htmlNode)
											) {
												console.log(
													`Re-applying state/position for ${nodeId} after add/re-add.`
												);
												this.applyStateToSingleNode(
													htmlNode,
													stateToApply
												);
											}
										});
									}
								} else {
									console.warn(
										`Could not get rect for added node ${nodeId} even after delay.`
									);
								}
							}, 50); // Keep delay
						}
					});
				}
			});
		});
		this.observer.observe(canvasElement, {
			subtree: true,
			attributes: true,
			attributeFilter: ["style"],
			childList: true,
		});
		console.log("ViewManager: MutationObserver attached.");
	}

	// --- DOM Updates & UI ---
	updatePageMarker(currentPageIndex: number, pagesLength: number): void {
		if (!this.observedCanvasElement) return;
		this.removePageMarker();
		const { width: pageW, height: pageH } = this.plugin.getPageDimensions();
		const yOffset = currentPageIndex * (pageH + PAGE_GAP);
		this.pageMarkerElement = document.createElement("div");
		this.pageMarkerElement.addClass("paper-canvas-page-marker");
		this.pageMarkerElement.setCssStyles({
			position: "absolute",
			left: "0px",
			top: `${yOffset}px`,
			width: `${pageW}px`,
			height: `${pageH}px`,
			border: "1px dashed var(--text-faint)",
			pointerEvents: "none",
			zIndex: "0",
		});
		this.observedCanvasElement.prepend(this.pageMarkerElement);
	}
	removePageMarker(): void {
		this.pageMarkerElement?.remove();
		this.pageMarkerElement = null;
	}

	setupPageControls(
		leaf: WorkspaceLeaf,
		currentPageIndex: number,
		pagesLength: number,
		goToPageFn: (index: number) => void,
		addPageFn: () => void
	): void {
		this.removePageControls();
		const viewContainer = leaf.view.containerEl;
		this.pageControlsElement = viewContainer.createDiv({
			cls: "paper-canvas-page-controls",
		});
		this.pageControlsElement.setCssStyles({
			position: "absolute",
			bottom: "40px",
			left: "50%",
			transform: "translateX(-50%)",
			backgroundColor: "var(--background-secondary)",
			padding: "5px 10px",
			borderRadius: "8px",
			boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
			display: "flex",
			alignItems: "center",
			gap: "8px",
			zIndex: "50",
		});
		const prevButton = this.pageControlsElement.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": "Previous Page" },
		});
		prevButton.setText("←");
		prevButton.addEventListener("click", () => {
			const liveCurrentIndex = this.plugin.getCurrentPageIndex();
			console.log(
				`Prev button clicked. Live index: ${liveCurrentIndex}. Requesting: ${
					liveCurrentIndex - 1
				}`
			);
			goToPageFn(liveCurrentIndex - 1);
		});
		this.pageIndicatorElement = this.pageControlsElement.createEl("span", {
			cls: "paper-canvas-page-indicator",
		});
		this.pageIndicatorElement.setCssStyles({
			fontSize: "var(--font-ui-small)",
			color: "var(--text-muted)",
		});
		const nextButton = this.pageControlsElement.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": "Next Page" },
		});
		nextButton.setText("→");
		nextButton.addEventListener("click", () => {
			const liveCurrentIndex = this.plugin.getCurrentPageIndex();
			console.log(
				`Next button clicked. Live index: ${liveCurrentIndex}. Requesting: ${
					liveCurrentIndex + 1
				}`
			);
			goToPageFn(liveCurrentIndex + 1);
		});
		const addButton = this.pageControlsElement.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": "Add New Page" },
		});
		addButton.setText("+");
		addButton.addEventListener("click", addPageFn);
		this.updatePageIndicator(currentPageIndex, pagesLength);
	}
	removePageControls(): void {
		this.pageControlsElement?.remove();
		this.pageControlsElement = null;
	}
	updatePageIndicator(currentPageIndex: number, pagesLength: number): void {
		console.log(
			`ViewManager: Updating indicator - Current ${
				currentPageIndex + 1
			}, Total ${pagesLength}`
		);
		if (this.pageIndicatorElement) {
			this.pageIndicatorElement.setText(
				`Page ${currentPageIndex + 1} / ${pagesLength}`
			);
			const controls = this.pageControlsElement;
			if (controls) {
				const prevBtn =
					controls.querySelector<HTMLButtonElement>(
						"button:first-child"
					);
				const nextBtn = controls.querySelector<HTMLButtonElement>(
					"button:nth-child(3)"
				);
				if (prevBtn) prevBtn.disabled = currentPageIndex === 0;
				if (nextBtn)
					nextBtn.disabled = currentPageIndex >= pagesLength - 1;
			}
		} else {
			console.warn(
				"ViewManager: pageIndicatorElement not found during update."
			);
		}
	}

	positionCamera(leaf: WorkspaceLeaf, currentPageIndex: number): void {
		if (!this.plugin.isCanvasView(leaf)) return;
		const { width: pageW, height: pageH } = this.plugin.getPageDimensions();
		const targetY = currentPageIndex * (pageH + PAGE_GAP) + pageH / 2;
		const targetX = pageW / 2;
		const canvasView = leaf.view; // Already narrowed to CanvasView
		const canvas = canvasView.canvas;
		if (canvas?.panTo) {
			try {
				canvas.panTo(targetX, targetY);
				console.log(
					`ViewManager: Used canvas.panTo(${targetX}, ${targetY})`
				);
			} catch (e) {
				console.error("panTo failed:", e);
				this.fallbackScroll(leaf, targetY);
			}
		} else if (canvasView.setCameraPos) {
			try {
				canvasView.setCameraPos({ x: targetX, y: targetY });
				console.log(
					`ViewManager: Used view.setCameraPos({ x: ${targetX}, y: ${targetY} })`
				);
			} catch (e) {
				console.error("setCameraPos failed:", e);
				this.fallbackScroll(leaf, targetY);
			}
		} else {
			console.warn(
				"ViewManager: Cannot access canvas.panTo or view.setCameraPos function."
			);
			this.fallbackScroll(
				leaf,
				targetY - leaf.view.containerEl.clientHeight / 2
			);
		}
	}

	fallbackScroll(leaf: WorkspaceLeaf, targetScrollTop: number): void {
		const scrollable = leaf.view.containerEl.querySelector(
			".canvas-scroll-area"
		) as HTMLElement;
		if (scrollable) {
			scrollable.scrollTop = Math.max(0, targetScrollTop);
			console.log(
				`ViewManager: Fallback - set scrollTop to ${scrollable.scrollTop}`
			);
		} else {
			console.warn(
				"ViewManager: Fallback scrolling failed, could not find '.canvas-scroll-area'."
			);
		}
	}

	// *** More aggressive button removal ***
	addActionButtons(leaf: WorkspaceLeaf, exportAllFn: () => void): void {
		if (!this.plugin.isCanvasView(leaf)) return;
		const view = leaf.view;
		if (!view.addAction) {
			console.warn("addAction not available on this view.");
			return;
		}
		const header = view.containerEl.querySelector(
			".view-header .view-actions"
		);
		if (!header) {
			console.warn("Cannot find view header actions.");
			return;
		}

		// ** Remove ALL child buttons first (more aggressive) **
		// This assumes no other plugin adds buttons here, or that it's acceptable to remove them briefly.
		// Alternatively, stick to removing by class if preferred.
		while (header.firstChild) {
			header.removeChild(header.firstChild);
		}
		// ** Or, slightly safer: Remove only OUR buttons by class **
		// header.querySelectorAll(`.${EXPORT_ALL_BUTTON_CLASS}`).forEach(btn => btn.remove());
		// header.querySelectorAll(`.${EXPORT_BUTTON_CLASS}`).forEach(btn => btn.remove()); // Cleanup old

		// Re-Add Export All Pages Button
		view.addAction(
			"lucide-book-down",
			"Export All Pages as PDF",
			exportAllFn,
			{ class: EXPORT_ALL_BUTTON_CLASS }
		);
		console.log("ViewManager: Added export all button.");
	}

	// removeActionButtons already removes by class from all leaves - should be ok
	removeActionButtons(): void {
		console.log(
			"ViewManager: Removing action buttons from all canvas leaves..."
		);
		if (!this.plugin.app?.workspace) return;
		this.plugin.app.workspace
			.getLeavesOfType("canvas")
			.forEach((leaf: WorkspaceLeaf) => {
				// Added type
				if (this.plugin.isCanvasView(leaf)) {
					try {
						const header = leaf.view.containerEl.querySelector(
							".view-header .view-actions"
						);
						header
							?.querySelector(`.${EXPORT_BUTTON_CLASS}`)
							?.remove();
						header
							?.querySelector(`.${EXPORT_ALL_BUTTON_CLASS}`)
							?.remove();
					} catch (e) {
						console.error("Error removing action buttons:", e);
					}
				}
			});
	}

	// --- Node Visibility / Positioning ---

	// *** FULL applyNodeVisibilityAndPosition method ***
	applyNodeVisibilityAndPosition(
		canvasElement: HTMLElement,
		currentPageIndex: number,
		nodeStates: Map<string, NodeState>
	): void {
		console.log(
			`ViewManager: Applying visibility/position for page ${
				currentPageIndex + 1
			} using ${nodeStates.size} states.`
		);
		// Ensure all nodes currently in state are processed
		nodeStates.forEach((state, nodeId) => {
			const nodeEl = canvasElement.querySelector<HTMLElement>(
				`#${nodeId}`
			);
			if (nodeEl) {
				this.applyStateToSingleNode(nodeEl, state, currentPageIndex);
			}
		});
		// Hide nodes in DOM that *shouldn't* be visible (e.g., if state was lost somehow or node belongs to another page)
		canvasElement
			.querySelectorAll<HTMLElement>(".canvas-node")
			.forEach((nodeEl) => {
				const state = nodeStates.get(nodeEl.id); // Check if we have state for it
				if (
					nodeEl.id &&
					(!state || state.pageIndex !== currentPageIndex)
				) {
					// Hide if no state OR state belongs to different page
					nodeEl.classList.add(HIDDEN_NODE_CLASS);
				} else if (state && state.pageIndex === currentPageIndex) {
					// Ensure visible if state matches current page (redundant with applyStateToSingleNode but safe)
					nodeEl.classList.remove(HIDDEN_NODE_CLASS);
				} else if (!nodeEl.id) {
					// Node without ID - might be temporary, observer should handle it
				}
			});
	}

	// *** FULL applyStateToSingleNode method ***
	applyStateToSingleNode(
		nodeEl: HTMLElement,
		state: NodeState,
		currentPageIndex?: number
	): void {
		if (!state) return;
		const pageDimensions = this.plugin.getPageDimensions();
		const pageIndexToUse = state.pageIndex ?? 0;
		const absoluteY =
			state.y + pageIndexToUse * (pageDimensions.height + PAGE_GAP);
		this.updateNodeTransform(nodeEl, state.x, absoluteY);
		// Determine the current page view index to check against
		const currentViewPageIndex =
			currentPageIndex ?? this.plugin.getCurrentPageIndex();
		this.applyVisibilityToNode(
			nodeEl,
			pageIndexToUse,
			currentViewPageIndex
		);
	}

	// *** FULL applyVisibilityToNode method ***
	applyVisibilityToNode(
		nodeEl: HTMLElement,
		nodePageIndex: number,
		currentViewPageIndex: number
	): void {
		if (nodePageIndex === currentViewPageIndex) {
			nodeEl.classList.remove(HIDDEN_NODE_CLASS);
		} else {
			nodeEl.classList.add(HIDDEN_NODE_CLASS);
		}
	}

	updateNodeTransform(nodeEl: HTMLElement, x: number, y: number): void {
		nodeEl.style.transform = `translate(${x}px, ${y}px)`;
	}

	// *** FULL getCanvasElement method ***
	getCanvasElement(leaf: WorkspaceLeaf): HTMLElement | null {
		if (!this.plugin.isCanvasView(leaf)) return null;
		const canvasElement = leaf.view.containerEl.querySelector(".canvas");
		if (!(canvasElement instanceof HTMLElement)) {
			console.error("ViewManager: Could not find main canvas element.");
			return null;
		}
		return canvasElement;
	}

	// *** FULL getNodeRectFromElement method (v13 version) ***
	getNodeRectFromElement(
		nodeEl: HTMLElement,
		canvasEl: HTMLElement | null
	): { x: number; y: number; width: number; height: number } | null {
		let x = NaN,
			y = NaN;
		let width = nodeEl.offsetWidth; // Get dimensions first
		let height = nodeEl.offsetHeight;

		// Ensure positive dimensions early
		width = Math.max(1, width);
		height = Math.max(1, height);
		if (width <= 1 || height <= 1)
			console.warn(
				`Node ${nodeEl.id} has small/zero offset dimensions: W=${width} H=${height}`
			);

		// 1. Try using offsetLeft/offsetTop relative to '.canvas-nodes' container
		const nodesContainer = canvasEl?.querySelector(".canvas-nodes"); // Cache selector
		if (
			nodeEl.offsetParent &&
			nodesContainer &&
			nodeEl.offsetParent === nodesContainer
		) {
			x = nodeEl.offsetLeft;
			y = nodeEl.offsetTop;
			console.log(
				`Node ${nodeEl.id}: Used offsetLeft/Top relative to nodes container: (${x}, ${y})`
			);
		}

		// 2. Fallback: Try parsing transform: translate()
		if (isNaN(x) || isNaN(y)) {
			const transform = nodeEl.style.transform;
			if (transform && transform.includes("translate")) {
				const match = transform.match(
					/translate\(\s*(-?[\d.eE+-]+)px\s*,\s*(-?[\d.eE+-]+)px\s*\)/
				);
				if (match && match[1] && match[2]) {
					x = parseFloat(match[1]);
					y = parseFloat(match[2]);
					console.log(
						`Node ${nodeEl.id}: Used transform: (${x}, ${y})`
					);
				}
			}
		}

		// 3. Fallback: getBoundingClientRect relative to scroll area (use as last resort)
		if (isNaN(x) || isNaN(y)) {
			console.log(
				`Node ${nodeEl.id}: Trying getBoundingClientRect fallback.`
			);
			if (!canvasEl) {
				console.warn(
					`Cannot use gBCR fallback for ${nodeEl.id}: canvas element missing.`
				);
				return null;
			}
			try {
				const nodeRect = nodeEl.getBoundingClientRect();
				const scrollArea =
					canvasEl.closest(".canvas-scroll-area") || canvasEl;
				const scrollRect = scrollArea.getBoundingClientRect();
				x = nodeRect.left - scrollRect.left + scrollArea.scrollLeft;
				y = nodeRect.top - scrollRect.top + scrollArea.scrollTop;
				if (isNaN(x) || isNaN(y)) {
					console.warn(`gBCR fallback failed for ${nodeEl.id}.`);
					return null;
				}
				console.log(
					`Node ${nodeEl.id}: Used gBCR fallback: (${x}, ${y})`
				);
			} catch (e) {
				console.error(`Error using gBCR fallback for ${nodeEl.id}:`, e);
				return null;
			}
		}

		// Final Check
		if (isNaN(x) || isNaN(y)) {
			console.error(
				`getNodeRectFromElement failed to get valid coordinates for ${nodeEl.id}.`
			);
			return null;
		}

		return { x, y, width, height };
	}
}
