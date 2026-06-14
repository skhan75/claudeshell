import React from "react";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Telescope, type TelescopeItem } from "./Telescope.js";

interface ModelItem extends TelescopeItem {
  model: string;
  current: boolean;
  description?: string;
}

/**
 * A focused model switcher (opened by `/model` or the command palette). The SDK can't
 * run the CLI's interactive `/model`, but it exposes supportedModels() + setModel — so
 * this lists the SDK's live model list (with display names/descriptions), falling back
 * to the configured models before the session has initialized, and applies the choice.
 */
export function ModelPicker({ onClose }: { onClose: () => void }) {
  const { manager, config } = useAppCtx();
  useApp((s) => s.version);
  const session = manager.active;
  const current = session?.transcript.meta.model ?? config.models[0] ?? "—";

  // Prefer the SDK's live model list; fall back to the configured ids pre-init.
  const live = session?.availableModels ?? [];
  const models = live.length
    ? live.map((m) => ({ value: m.value, label: m.displayName || m.value, description: m.description }))
    : config.models.map((m) => ({ value: m, label: m, description: undefined as string | undefined }));

  const items: ModelItem[] = models.map((m) => ({
    key: m.value,
    label: m.value === current ? `${m.label}  ●` : m.label,
    model: m.value,
    current: m.value === current,
    description: m.description,
  }));

  return (
    <Telescope<ModelItem>
      title="SELECT MODEL"
      items={items}
      placeholder="filter models…"
      onClose={onClose}
      onSelect={(it) => {
        void session?.setModel(it.model);
        onClose();
      }}
      renderPreview={(it) => (
        <Box flexDirection="column">
          <Text bold color={theme.accent}>
            {it.model}
          </Text>
          {it.current ? <Text color={theme.good}>● current model</Text> : <Text color={theme.dim}>press enter to switch</Text>}
          {it.description ? (
            <Box marginTop={1}>
              <Text color={theme.fg}>{it.description}</Text>
            </Box>
          ) : null}
          <Box marginTop={1}>
            <Text color={theme.dim}>Applies to the active session from the next query onward.</Text>
          </Box>
        </Box>
      )}
    />
  );
}
