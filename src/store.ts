import { createStore, type StoreApi } from "zustand/vanilla";
import type { AppOverlay, HostStats } from "./core/types.js";

export type { AppOverlay };
export type Layout = "sidebar" | "zen";
export type Focus = "input" | "scroll" | "explorer";
/** A shown overlay panel, or null for none. `AppOverlay` is the shared source. */
export type Overlay = AppOverlay | null;
/** Left IDE explorer pane: a project file tree, or hidden. */
export type LeftPanel = "files" | "hidden";

export interface AppState {
  version: number;
  layout: Layout;
  focus: Focus;
  leftPanel: LeftPanel;
  paletteOpen: boolean;
  overlay: Overlay;
  /** Optional focus passed to /compact (text after the command), read by CompactOverlay. */
  compactFocus: string;
  /** Ctrl+Space tab-cycle leader is armed; the next ←/→ cycles tabs (one-shot). */
  tabLeader: boolean;
  /** When on, the terminal's mouse is captured so trackpad/wheel scroll the transcript
   *  (costs mouse text-selection — hold Option to copy). Off by default. */
  mouseScroll: boolean;
  hostStats: HostStats | null;
  bump(): void;
  setLayout(l: Layout): void;
  toggleLayout(): void;
  setFocus(f: Focus): void;
  cycleLeftPanel(): void;
  setLeftPanel(p: LeftPanel): void;
  setPaletteOpen(open: boolean): void;
  setOverlay(o: Overlay): void;
  setCompactFocus(f: string): void;
  setTabLeader(v: boolean): void;
  setMouseScroll(v: boolean): void;
  toggleMouseScroll(): void;
  setHostStats(h: HostStats): void;
}

export function createAppStore(initialLayout: Layout, initialMouseScroll = false): StoreApi<AppState> {
  return createStore<AppState>((set) => ({
    version: 0,
    layout: initialLayout,
    focus: "input",
    // Explorer is hidden by default (the chat + inspector are the focus); Ctrl+E
    // toggles the project file tree on demand.
    leftPanel: "hidden",
    paletteOpen: false,
    overlay: null,
    compactFocus: "",
    tabLeader: false,
    mouseScroll: initialMouseScroll,
    hostStats: null,
    bump: () => set((s) => ({ version: s.version + 1 })),
    setLayout: (layout) => set({ layout }),
    toggleLayout: () => set((s) => ({ layout: s.layout === "sidebar" ? "zen" : "sidebar" })),
    setFocus: (focus) => set({ focus }),
    cycleLeftPanel: () => set((s) => ({ leftPanel: s.leftPanel === "hidden" ? "files" : "hidden" })),
    setLeftPanel: (leftPanel) => set({ leftPanel }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setOverlay: (overlay) => set({ overlay }),
    setCompactFocus: (compactFocus) => set({ compactFocus }),
    setTabLeader: (tabLeader) => set({ tabLeader }),
    setMouseScroll: (mouseScroll) => set({ mouseScroll }),
    toggleMouseScroll: () => set((s) => ({ mouseScroll: !s.mouseScroll })),
    setHostStats: (hostStats) => set({ hostStats }),
  }));
}
