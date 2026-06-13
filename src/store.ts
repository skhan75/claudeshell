import { createStore, type StoreApi } from "zustand/vanilla";
import type { HostStats } from "./core/types.js";

export type Layout = "sidebar" | "zen";
export type Focus = "input" | "scroll";
export type Overlay = "help" | "sessions" | "buffers" | null;
/** Left IDE explorer pane: a project file tree, or hidden. */
export type LeftPanel = "files" | "hidden";

export interface AppState {
  version: number;
  layout: Layout;
  focus: Focus;
  leftPanel: LeftPanel;
  paletteOpen: boolean;
  overlay: Overlay;
  hostStats: HostStats | null;
  bump(): void;
  setLayout(l: Layout): void;
  toggleLayout(): void;
  setFocus(f: Focus): void;
  cycleLeftPanel(): void;
  setLeftPanel(p: LeftPanel): void;
  setPaletteOpen(open: boolean): void;
  setOverlay(o: Overlay): void;
  setHostStats(h: HostStats): void;
}

export function createAppStore(initialLayout: Layout): StoreApi<AppState> {
  return createStore<AppState>((set) => ({
    version: 0,
    layout: initialLayout,
    focus: "input",
    // Explorer is hidden by default (the chat + inspector are the focus); Ctrl+E
    // toggles the project file tree on demand.
    leftPanel: "hidden",
    paletteOpen: false,
    overlay: null,
    hostStats: null,
    bump: () => set((s) => ({ version: s.version + 1 })),
    setLayout: (layout) => set({ layout }),
    toggleLayout: () => set((s) => ({ layout: s.layout === "sidebar" ? "zen" : "sidebar" })),
    setFocus: (focus) => set({ focus }),
    cycleLeftPanel: () => set((s) => ({ leftPanel: s.leftPanel === "hidden" ? "files" : "hidden" })),
    setLeftPanel: (leftPanel) => set({ leftPanel }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setOverlay: (overlay) => set({ overlay }),
    setHostStats: (hostStats) => set({ hostStats }),
  }));
}
