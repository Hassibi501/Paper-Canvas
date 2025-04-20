import { TFile, Notice } from "obsidian";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { PaperCanvasPluginInterface, NodeState, PageData } from "./types";
import { HIDDEN_NODE_CLASS } from "./constants";

const EXPORT_CONTAINER_ID = "paper-canvas-export-container";

export class PdfExporter {
	plugin: PaperCanvasPluginInterface;
	constructor(plugin: PaperCanvasPluginInterface) {
		this.plugin = plugin;
	}

	async exportAllPagesAsPDF(
		pages: PageData[],
		nodeStates: Map<string, NodeState>,
		canvasElement: HTMLElement | null,
		currentFile: TFile | null
	): Promise<void> {
		if (!canvasElement || pages.length === 0) {
			this.plugin.showNotice("No pages or active canvas to export.");
			return;
		}
		const { width: pageW, height: pageH } = this.plugin.getPageDimensions();
		const baseFileName = `${
			currentFile?.basename || "canvas"
		}-all-pages.pdf`;
		this.plugin.showNotice(
			`Exporting all ${pages.length} pages as PDF...`,
			10000
		);
		const pdf = new jsPDF({
			orientation: pageW > pageH ? "l" : "p",
			unit: "px",
			format: [pageW, pageH],
			hotfixes: ["px_scaling"],
		});
		let exportSuccess = true;

		for (let i = 0; i < pages.length; i++) {
			const pageIndex = pages[i].index;
			this.plugin.showNotice(
				`Exporting page ${i + 1}/${pages.length}...`,
				3000
			);
			const { success, cleanup, tempContainer } =
				await this.preparePageForExport(
					pageIndex,
					nodeStates,
					canvasElement
				);
			if (!success || !tempContainer) {
				this.plugin.showNotice(
					`Failed preparing page ${i + 1}. Aborting.`,
					3000
				);
				exportSuccess = false;
				cleanup();
				break;
			}
			try {
				const canvas = await html2canvas(tempContainer, {
					width: pageW,
					height: pageH,
					scale: 2,
					useCORS: true,
					logging: false,
					backgroundColor: null,
					x: 0,
					y: 0,
					scrollX: 0,
					scrollY: 0,
				});
				if (i > 0) {
					pdf.addPage([pageW, pageH], pageW > pageH ? "l" : "p");
				}
				pdf.addImage(
					canvas.toDataURL("image/png", 1.0),
					"PNG",
					0,
					0,
					pageW,
					pageH
				);
				console.log(
					`PdfExporter: Added page ${
						i + 1
					} (Index ${pageIndex}) to PDF.`
				);
			} catch (error) {
				console.error(
					`PdfExporter: Error capturing or adding page ${
						i + 1
					} to PDF:`,
					error
				);
				this.plugin.showNotice(
					`Failed exporting page ${i + 1}. Check console.`,
					5000
				);
				exportSuccess = false;
				cleanup();
				break;
			} finally {
				cleanup();
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		if (exportSuccess && pages.length > 0) {
			pdf.save(baseFileName);
			this.plugin.showNotice(
				`All ${pages.length} pages exported as ${baseFileName}.`
			);
		} else if (!exportSuccess) {
			this.plugin.showNotice(
				"PDF export incomplete due to errors.",
				5000
			);
		} else {
			this.plugin.showNotice("No pages found to export.");
		}
	}

	async preparePageForExport(
		pageIndex: number,
		nodeStates: Map<string, NodeState>,
		canvasElement: HTMLElement
	): Promise<{
		success: boolean;
		cleanup: () => void;
		tempContainer: HTMLElement | null;
	}> {
		const cleanup = () => {
			document.getElementById(EXPORT_CONTAINER_ID)?.remove();
		};
		if (!canvasElement) {
			console.error(
				"PdfExporter: preparePage - received null canvasElement."
			);
			return { success: false, cleanup, tempContainer: null };
		}
		const { width: pageW, height: pageH } = this.plugin.getPageDimensions();
		const tempContainer = document.createElement("div");
		tempContainer.id = EXPORT_CONTAINER_ID;
		Object.assign(tempContainer.style, {
			position: "absolute",
			overflow: "hidden",
			width: `${pageW}px`,
			height: `${pageH}px`,
			left: "-9999px",
			top: "0px",
			visibility: "visible",
			backgroundColor:
				getComputedStyle(canvasElement).getPropertyValue(
					"--canvas-background"
				) || "#ffffff",
			border: "1px solid #ccc",
		});
		document.body.appendChild(tempContainer);
		let nodesRendered = 0;
		console.log(
			`PdfExporter: Preparing page ${
				pageIndex + 1
			}. Rendering placeholders...`
		);
		nodeStates.forEach((state, nodeId) => {
			if (state.pageIndex === pageIndex) {
				try {
					const placeholder = document.createElement("div");
					const nodeWidth = 150;
					const nodeHeight = 80;
					// *** Log position being used ***
					console.log(
						`  > Rendering placeholder for ${nodeId} at x:${state.x}, y:${state.y}`
					);
					Object.assign(placeholder.style, {
						position: "absolute",
						left: `${state.x}px`,
						top: `${state.y}px`,
						width: `${nodeWidth}px`,
						height: `${nodeHeight}px`,
						border: "1px solid blue",
						backgroundColor: "rgba(200, 200, 255, 0.5)",
						fontSize: "10px",
						padding: "2px",
						overflow: "hidden",
						boxSizing: "border-box",
						color: "black",
					});
					placeholder.textContent = `Node: ${nodeId.substring(
						0,
						10
					)}... (x:${Math.round(state.x)}, y:${Math.round(state.y)})`;
					tempContainer.appendChild(placeholder);
					nodesRendered++;
				} catch (e) {
					console.error(
						`PdfExporter: Error creating placeholder for node ${nodeId}:`,
						e
					);
				}
			}
		});
		console.log(
			`PdfExporter: Prepared page ${
				pageIndex + 1
			}. Rendered ${nodesRendered} placeholders.`
		);
		if (
			[...nodeStates.values()].filter((s) => s.pageIndex === pageIndex)
				.length > 0 &&
			nodesRendered === 0
		) {
			console.warn(
				`PdfExporter: No placeholder nodes rendered for page ${
					pageIndex + 1
				} despite existing state.`
			);
		}
		await new Promise((resolve) => requestAnimationFrame(resolve));
		await new Promise((resolve) => requestAnimationFrame(resolve));
		tempContainer.offsetHeight;
		return { success: true, cleanup, tempContainer };
	}
}
