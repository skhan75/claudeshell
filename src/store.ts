import { createStore, type StoreApi } from "zustand/vanilla";
import type { HostStats } from "./core/types.js";

export type Layout = "sidebar" | "zen";
export type Focus = "input" | "scroll" | "pills";
export type Overlay = "help" | "sessions" | "buffers" | null;

export interface AppState {
  version: number;
  layout: Layout;
  focus: Focus;
  paletteOpen: boolean;
  overlay: Overlay;
  hostStats: HostStats | null;
  bump(): void;
  setLayout(l: Layout): void;
  toggleLayout(): void;
  setFocus(f: Focus): void;
  setPaletteOpen(open: boolean): void;
  setOverlay(o: Overlay): void;
  setHostStats(h: HostStats): void;
}

export function createAppStore(initialLayout: Layout): StoreApi<AppState> {
  return createStore<AppState>((set) => ({
    version: 0,
    layout: initialLayout,
    focus: "input",
    paletteOpen: false,
    overlay: null,
    hostStats: null,
    bump: () => set((s) => ({ version: s.version + 1 })),
    setLayout: (layout) => set({ layout }),
    toggleLayout: () => set((s) => ({ layout: s.layout === "sidebar" ? "zen" : "sidebar" })),
    setFocus: (focus) => set({ focus }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setOverlay: (overlay) => set({ overlay }),
    setHostStats: (hostStats) => set({ hostStats }),
  }));
}
