import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Panel, SectionHeader } from "./chrome.js";
import { fmtUsd, bar } from "./format.js";

const W = 40;

/** Color for a budget level word/value. */
function levelColor(level: "ok" | "warn" | "over"): string {
  return level === "over" ? theme.bad : level === "warn" ? theme.warn : theme.good;
}

/**
 * The /budget overlay: total fleet spend, per-tab breakdown, soft/hard caps + level, and
 * inline cap editing. A form+dashboard (not Telescope). Caps are CORE state on the
 * SessionManager (manager.budget / setBudget) — the single source of truth. `s` edits the
 * soft cap, `h` the hard cap, digits/`.`/backspace build the value, Enter commits, `c`
 * clears both, Esc closes (or cancels an edit).
 */
export function BudgetOverlay({ onClose }: { onClose: () => void }) {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const [editing, setEditing] = useState<null | "soft" | "hard">(null);
  const [draft, setDraft] = useState("");

  const b = manager.budget;
  const total = manager.totalCostUsd();
  const level = manager.budgetLevel();
  const claudeTabs = manager.tabs.filter((t) => t.kind === "claude");

  useInput((input, key) => {
    if (editing) {
      if (key.escape) {
        setEditing(null);
        return;
      }
      if (key.return) {
        const v = draft.trim() === "" ? undefined : Number(draft);
        manager.setBudget({ ...b, [editing === "soft" ? "softUsd" : "hardUsd"]: v });
        setEditing(null);
        return;
      }
      if (key.backspace || key.delete) {
        setDraft((d) => d.slice(0, -1));
        return;
      }
      if (/^[0-9.]$/.test(input)) setDraft((d) => d + input);
      return;
    }
    if (key.escape) {
      onClose();
      return;
    }
    if (input === "s") {
      setEditing("soft");
      setDraft(b.softUsd?.toString() ?? "");
      return;
    }
    if (input === "h") {
      setEditing("hard");
      setDraft(b.hardUsd?.toString() ?? "");
      return;
    }
    if (input === "c") manager.setBudget({});
  });

  const capRow = (which: "soft" | "hard", value: number | undefined) => {
    const isEditing = editing === which;
    const label = which === "soft" ? "SOFT (warn)" : "HARD (block spawns)";
    return (
      <Text>
        <Text color={theme.dim}>{label.padEnd(20)}</Text>
        {isEditing ? (
          <Text color={theme.accent}>${draft}▋</Text>
        ) : (
          <Text color={value != null ? theme.fg : theme.dim}>{value != null ? fmtUsd(value) : "— none"}</Text>
        )}
      </Text>
    );
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Panel accent flexDirection="column">
        <Text bold color={theme.accent}>
          BUDGET · cost-guard
        </Text>

        <Box marginTop={1}>
          <Text color={theme.dim}>{"TOTAL SPEND".padEnd(20)}</Text>
          <Text bold color={levelColor(level)}>
            {fmtUsd(total)}
          </Text>
          <Text color={theme.dim}>{`  (${level})`}</Text>
        </Box>
        {b.hardUsd != null && (
          <Text color={levelColor(level)}>{bar(Math.min(100, (total / b.hardUsd) * 100), W)}</Text>
        )}

        <Box marginTop={1} flexDirection="column">
          {capRow("soft", b.softUsd)}
          {capRow("hard", b.hardUsd)}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <SectionHeader label="PER-AGENT" width={W} />
          {claudeTabs.length === 0 ? (
            <Text color={theme.dim}>(no agents)</Text>
          ) : (
            claudeTabs.map((t) => {
              const cost = t.kind === "claude" ? t.transcript.usage.costUsd : 0;
              const name = t.title.length > 26 ? t.title.slice(0, 25) + "…" : t.title;
              return (
                <Text key={t.id}>
                  <Text color={theme.fg}>{name.padEnd(28)}</Text>
                  <Text color={theme.good}>{fmtUsd(cost)}</Text>
                </Text>
              );
            })
          )}
        </Box>

        <Box marginTop={1}>
          <Text color={theme.dim}>s soft · h hard · c clear · enter save · esc {editing ? "cancel" : "close"}</Text>
        </Box>
      </Panel>
    </Box>
  );
}
