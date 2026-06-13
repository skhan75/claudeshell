import React from "react";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Telescope, type TelescopeItem } from "./Telescope.js";

interface ModelItem extends TelescopeItem {
  model: string;
  current: boolean;
}

/**
 * A focused model switcher (opened by `/model` or the command palette). The SDK can't
 * run the CLI's interactive `/model`, but it does expose setModel — so this lists the
 * configured models, arrow-selectable, and applies the choice to the active session.
 */
export function ModelPicker({ onClose }: { onClose: () => void }) {
  const { manager, config } = useAppCtx();
  useApp((s) => s.version);
  const session = manager.active;
  const current = session?.transcript.meta.model ?? config.models[0] ?? "—";

  const items: ModelItem[] = config.models.map((m) => ({
    key: m,
    label: m === current ? `${m}  ●` : m,
    model: m,
    current: m === current,
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
          <Box marginTop={1}>
            <Text color={theme.dim}>Applies to the active session from the next query onward.</Text>
          </Box>
        </Box>
      )}
    />
  );
}
