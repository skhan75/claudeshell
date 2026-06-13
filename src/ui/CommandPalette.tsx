import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useApp, useAppCtx, type AppCtx } from "./context.js";
import { theme } from "./theme.js";
import { fuzzyFilter } from "../core/fuzzy.js";
import { searchHistory, type HistoryHit } from "../core/history-search.js";

export interface PaletteItem {
  label: string;
  hint?: string;
  run: () => void;
  /** "history" switches the palette into history-search mode instead of closing. */
  mode?: "history";
}

export function buildPaletteItems(ctx: AppCtx): PaletteItem[] {
  const { manager, config, store } = ctx;
  const session = manager.active;
  const items: PaletteItem[] = [];

  manager.sessions.forEach((s, i) => {
    // Only tabs 1-9 have an alt+digit shortcut (App handles /^[1-9]$/); omit the hint beyond that.
    items.push({ label: `switch: ${s.title}`, hint: i < 9 ? `alt+${i + 1}` : undefined, run: () => manager.activate(i) });
  });

  items.push({ label: "action: new session", run: () => void manager.create() });
  items.push({ label: "action: close session", run: () => session && manager.close(session.id) });
  items.push({ label: "action: toggle layout", run: () => store.getState().toggleLayout() });
  items.push({ label: "action: interrupt session", run: () => void session?.interrupt() });
  // Only offer resume when the session has actually crashed
  if (session?.status === "crashed") {
    items.push({ label: "action: resume crashed session", run: () => session?.resume() });
  }
  items.push({ label: "action: search history", mode: "history", run: () => {} });

  for (const mode of ["default", "plan", "acceptEdits", "bypassPermissions"]) {
    items.push({ label: `mode: ${mode}`, run: () => void session?.setPermissionMode(mode) });
  }

  for (const model of config.models) {
    items.push({ label: `model: ${model}`, run: () => void session?.setModel(model) });
  }

  for (const pill of config.pills) {
    items.push({
      label: `pill: ${pill.label}`,
      run: () => {
        const payload = pill.slash ?? pill.prompt;
        if (payload) session?.send(payload);
      },
    });
  }

  const slashCommands = (session?.transcript.meta.slashCommands ?? []).map((c) =>
    c.startsWith("/") ? c : "/" + c
  );
  for (const cmd of slashCommands) {
    items.push({ label: `slash: ${cmd}`, run: () => session?.send(cmd) });
  }

  return items;
}

export function CommandPalette({ claudeDir }: { claudeDir?: string } = {}) {
  const ctx = useAppCtx();
  const { manager, store } = ctx;
  useApp((s) => s.version);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [historyMode, setHistoryMode] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  const close = () => {
    store.getState().setPaletteOpen(false);
  };

  // Compute items, hits, rows, and clampedSel BEFORE useInput so handlers reference current values
  const items = historyMode ? [] : fuzzyFilter(buildPaletteItems(ctx), query, (i) => i.label).slice(0, 8);
  const active = manager.active;
  // Core caps hits at 120 chars; render truncates at 70 chars
  const hits: HistoryHit[] = useMemo(
    () => (historyMode && active ? searchHistory(active.cwd, debouncedQuery, { limit: 8, claudeDir }) : []),
    [historyMode, debouncedQuery, active, claudeDir]
  );
  const rows = historyMode ? hits.map((h) => h.text) : items.map((i) => i.label + (i.hint ? `  ${i.hint}` : ""));
  const clampedSel = Math.min(sel, Math.max(0, rows.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      if (historyMode) {
        setHistoryMode(false);
        setQuery("");
        return;
      }
      close();
      return;
    }
    if (key.return) {
      if (historyMode) {
        const hit = hits[clampedSel];
        if (hit) { manager.active?.send(hit.text); close(); }
        return;
      }
      const item = items[clampedSel];
      if (!item) return;
      if (item.mode === "history") {
        setHistoryMode(true);
        setQuery("");
        setSel(0);
        return;
      }
      item.run();
      close();
      return;
    }
    if (key.upArrow) setSel((s) => Math.max(0, s - 1));
    else if (key.downArrow) setSel((s) => Math.min(s + 1, Math.max(0, rows.length - 1)));
    else if (key.backspace || key.delete) setQuery((q) => q.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setSel(0);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent}>
        {historyMode ? "history ❯ " : "❯ "}{query}▋
      </Text>
      {rows.map((r, i) => (
        <Text key={i} inverse={i === clampedSel} color={i === clampedSel ? theme.accent : theme.fg}>
          {r.length > 70 ? r.slice(0, 67) + "…" : r}
        </Text>
      ))}
      {rows.length === 0 && <Text dimColor>{historyMode ? "type to search past sessions" : "no matches"}</Text>}
      <Text dimColor>{historyMode ? "Enter re-sends as prompt · Esc back" : "Enter run · Esc close"}</Text>
    </Box>
  );
}
