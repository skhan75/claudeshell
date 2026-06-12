import { createStore, type StoreApi } from "zustand/vanilla";
import type { HostStats } from "./core/types.js";

export type Layout = "sidebar" | "zen";
export type Focus = "input" | "scroll" | "pills";

export interface AppState {
  version: number;
  layout: Layout;
  focus: Focus;
  paletteOpen: boolean;
  hostStats: HostStats | null;
  bump(): void;
  setLayout(l: Layout): void;
  toggleLayout(): void;
  setFocus(f: Focus): void;
  setPaletteOpen(open: boolean): void;
  setHostStats(h: HostStats): void;
}

export function createAppStore(initialLayout: Layout): StoreApi<AppState> {
  return createStore<AppState>((set) => ({
    version: 0,
    layout: initialLayout,
    focus: "input",
    paletteOpen: false,
    hostStats: null,
    bump: () => set((s) => ({ version: s.version + 1 })),
    setLayout: (layout) => set({ layout }),
    toggleLayout: () => set((s) => ({ layout: s.layout === "sidebar" ? "zen" : "sidebar" })),
    setFocus: (focus) => set({ focus }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setHostStats: (hostStats) => set({ hostStats }),
  }));
}
