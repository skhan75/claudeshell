import { createContext, useContext } from "react";
import { useStore as useZustandStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { SessionManager } from "../core/session-manager.js";
import type { Config } from "../core/config.js";
import type { AppState } from "../store.js";

export interface AppCtx {
  manager: SessionManager;
  config: Config;
  store: StoreApi<AppState>;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useAppCtx(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext missing — wrap in <AppContext.Provider>");
  return ctx;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  const { store } = useAppCtx();
  return useZustandStore(store, selector);
}
