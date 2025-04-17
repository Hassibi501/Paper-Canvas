import { TFile, Notice } from 'obsidian';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
// ** Added PageData import **
import { PaperCanvasPluginInterface, NodeState, PageData } from './types';
import { HIDDEN_NODE_CLASS } from './constants';

const EXPORT_CONTAINER_ID = 'paper-canvas-export-container';

export class PdfExporter {
    plugin: PaperCanvasPluginInterface;
    constructor(plugin: PaperCanvasPluginInterface) { this.plugin = plugin; }

    // exportSinglePageAsPDF can be added back if needed, ensure PageData import is present

    async exportAllPagesAsPDF(
        // ** Use imported PageData type **
        pages: PageData[],
        nodeStates: Map<string, NodeState>,
        canvasElement: HTMLElement | null,
        currentFile: TFile | null
    ): Promise<void> {
         if (!canvasElement || pages.length === 0) {
             this.plugin.showNotice("No pages or active canvas to export."); return;
         }
        const { width: pageW, height: pageH } = this.plugin.getPageDimensions();
        const baseFileName = `${currentFile?.basename || 'canvas'}-all-pages.pdf`;
        this.plugin.showNotice(`Exporting all ${pages.length} pages as PDF...`, 10000);

        // Create single PDF instance
        const pdf = new jsPDF({ orientation: pageW > pageH ? 'l' : 'p', unit: 'px', format: [pageW, pageH], hotfixes: ["px_scaling"] });
        let exportSuccess = true;

        for (let i = 0; i < pages.length; i++) {
             const pageIndex = pages[i].index; // Use the actual index from PageData
             this.plugin.showNotice(`Exporting page ${i + 1}/${pages.length}...`, 3000);

             // *** Pass the LIVE canvasElement to preparePageForExport ***
             const { success, cleanup } = await this.preparePageForExport(pageIndex, nodeStates, canvasElement);

             if (!success) {
                 this.plugin.showNotice(`Failed preparing page ${i + 1}. Aborting.`, 3000);
                 exportSuccess = false;
                 break; // Stop if preparation fails
             }

             const tempContainer = document.getElementById(EXPORT_CONTAINER_ID); // Get the container created by prepare
             if (!tempContainer) {
                 console.error(`Export container not found for page ${i+1}`);
                 this.plugin.showNotice(`Failed exporting page ${i+1}: Container Missing.`, 3000)
                 exportSuccess = false;
                 cleanup(); // Still run cleanup
                 break;
             }

             try {
                 // Capture the temporary container
                 const canvas = await html2canvas(tempContainer, {
                     width: pageW, height: pageH, scale: 2, useCORS: true, logging: false, backgroundColor: null, x: 0, y: 0, scrollX: 0, scrollY: 0,
                 });

                 if (i > 0) { // Add new page in PDF for pages after the first
                     pdf.addPage([pageW, pageH], pageW > pageH ? 'l' : 'p');
                 }
                 pdf.addImage(canvas.toDataURL('image/png', 1.0), 'PNG', 0, 0, pageW, pageH);
                 console.log(`PdfExporter: Added page ${i+1} (Index ${pageIndex}) to PDF.`);

             } catch (error) {
                 console.error(`PdfExporter: Error capturing or adding page ${i + 1} to PDF:`, error);
                 this.plugin.showNotice(`Failed exporting page ${i + 1}. Check console.`, 5000);
                 exportSuccess = false;
                 cleanup(); // Cleanup even if capture fails
                 break; // Stop export process on error
             } finally {
                 cleanup(); // Remove temporary container for this page
             }
             // Optional delay between pages if needed
             await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (exportSuccess && pages.length > 0) {
             pdf.save(baseFileName);
             this.plugin.showNotice(`All ${pages.length} pages exported as ${baseFileName}.`);
         } else if (!exportSuccess) {
             this.plugin.showNotice("PDF export incomplete due to errors.", 5000);
         } else {
              this.plugin.showNotice("No pages found to export."); // Should be caught earlier
         }
    }

    // Updated preparePageForExport
    async preparePageForExport(
        pageIndex: number,
        nodeStates: Map<string, NodeState>,
        canvasElement: HTMLElement // Expect the current, observed canvas element
    ): Promise<{ success: boolean; cleanup: () => void; }> {
        const cleanup = () => { document.getElementById(EXPORT_CONTAINER_ID)?.remove(); };
        if (!canvasElement) { console.error("PdfExporter: preparePage - received null canvasElement."); return { success: false, cleanup }; }

        const { width: pageW, height: pageH } = this.plugin.getPageDimensions();
        const tempContainer = document.createElement('div');
        tempContainer.id = EXPORT_CONTAINER_ID;
        // Style for off-screen but technically visible rendering
        Object.assign(tempContainer.style, {
            position: 'absolute', overflow: 'hidden',
            width: `${pageW}px`, height: `${pageH}px`,
            left: '-9999px', top: '0px', // Position off-screen
            visibility: 'visible', // Make sure it's considered visible by browser
            backgroundColor: getComputedStyle(canvasElement).getPropertyValue('--canvas-background') || '#ffffff',
        });
        document.body.appendChild(tempContainer);

        let nodesFound = 0;
        let nodesCloned = 0;
        let cloneErrors = 0;

        console.log(`PdfExporter: Preparing page ${pageIndex + 1}. Querying within:`, canvasElement.id || canvasElement.className);

        nodeStates.forEach((state, nodeId) => {
            if (state.pageIndex === pageIndex) {
                // *** Query within the LIVE canvasElement passed to this function ***
                const nodeEl = canvasElement.querySelector<HTMLElement>(`#${nodeId}`);
                if (nodeEl) {
                    nodesFound++;
                    try {
                        const clone = nodeEl.cloneNode(true) as HTMLElement;
                        Object.assign(clone.style, {
                            transform: '', position: 'absolute',
                            left: `${state.x}px`, top: `${state.y}px`,
                            opacity: '1', display: 'block', visibility: 'visible',
                            margin: '0', // Reset margin
                            boxSizing: 'border-box',
                        });
                        clone.classList.remove(HIDDEN_NODE_CLASS);
                        // Remove any potential troublesome attributes from clone if needed
                        // clone.removeAttribute('contenteditable');
                        tempContainer.appendChild(clone);
                        nodesCloned++;
                    } catch (e) {
                         cloneErrors++;
                         console.error(`PdfExporter: Error cloning node ${nodeId}:`, e);
                    }
                } else {
                    // Log if node expected on this page wasn't found in the live DOM
                    console.warn(`PdfExporter: Node ${nodeId} (page ${pageIndex + 1}) exists in state but querySelector failed in live canvasElement!`);
                }
            }
        });

        console.log(`PdfExporter: Prepared page ${pageIndex+1}. Nodes in state for page: ${[...nodeStates.values()].filter(s => s.pageIndex === pageIndex).length}, Nodes found in DOM: ${nodesFound}, Nodes cloned: ${nodesCloned}, Clone errors: ${cloneErrors}`);

        if (nodesCloned === 0 && nodesFound > 0) {
            console.warn(`PdfExporter: No nodes were successfully cloned for page ${pageIndex+1}, though some were found. PDF page may be blank.`);
        } else if (nodesCloned === 0 && nodesFound === 0 && [...nodeStates.values()].filter(s => s.pageIndex === pageIndex).length > 0) {
             console.warn(`PdfExporter: No nodes found in DOM for page ${pageIndex+1} despite existing state. PDF page will likely be blank.`);
        }

        // Wait for rendering using requestAnimationFrame
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve)); // Wait two frames
        tempContainer.offsetHeight; // Force reflow

        return { success: true, cleanup }; // Return success even if cloning failed, let capture try
    }
}