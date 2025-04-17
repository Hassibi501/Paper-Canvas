import { TFile, App, Plugin, WorkspaceLeaf, View } from 'obsidian';

export interface PageData {
    id: string;
    index: number; // Ensure this is always updated based on array position
    name: string;
}

export interface NodeState {
    pageIndex: number;
    x: number;
    y: number;
}

export interface PaperCanvasSettings {
    pageWidthPx: number;
    pageHeightPx: number;
}

export interface SavedCanvasState {
    version: number;
    pages: PageData[];
    nodeStates: [string, NodeState][]; // Map serialized as array of [key, value] pairs
}

// Type for the specific Canvas View we interact with
export type CanvasView = View & {
    file: TFile | null;
    addAction?: (icon: string, title: string, callback: (evt: MouseEvent) => any, extra?: { class?: string }) => HTMLElement | null; // Added class option to extra args type
    setCameraPos?(pos: { x: number, y: number }): void;
    canvas?: {
        panTo?(x: number, y: number): void;
        [key: string]: any; // Allow other unknown properties
    };
    containerEl: HTMLElement;
};

// Interface for the main plugin class passed around
export interface PaperCanvasPluginInterface extends Plugin {
    app: App;
    settings: PaperCanvasSettings;
    showNotice(message: string, duration?: number): void;
    requestSave(): void;
    getCurrentFile(): TFile | null;
    getPageDimensions(): { width: number; height: number; };
    getCurrentPageIndex(): number;
    isCanvasView(leaf: WorkspaceLeaf | null | undefined): leaf is WorkspaceLeaf & { view: CanvasView };
    saveSettings(): Promise<void>; // Ensure main plugin implements saveSettings
    // Methods from Plugin that might be needed (add as required by managers)
    loadData(): Promise<any>;
    saveData(data: any): Promise<void>;
}