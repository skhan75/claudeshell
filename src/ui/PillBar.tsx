import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";

export function PillBar() {
  const { manager, config, store } = useAppCtx();
  useApp((s) => s.version);
  const focus = useApp((s) => s.focus);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const [sel, setSel] = useState(0);
  const session = manager.active;
  const focused = focus === "pills";

  const isActive = focused && !paletteOpen && !manager.active?.pendingPermission;

  useInput(
    (input, key) => {
      if (key.escape || key.tab) {
        store.getState().setFocus("input");
        return;
      }
      if (key.leftArrow) setSel((s) => Math.max(0, s - 1));
      else if (key.rightArrow) setSel((s) => Math.min(config.pills.length - 1, s + 1));
      else if (key.return) {
        const p = config.pills[sel];
        const payload = p.slash ?? p.prompt;
        if (payload) session?.send(payload);
        store.getState().setFocus("input");
      }
    },
    { isActive }
  );

  return (
    <Box>
      {config.pills.map((p, i) => (
        <Text
          key={p.label}
          inverse={focused && i === sel}
          color={focused && i === sel ? theme.accent : theme.dim}
        >
          {" "}{p.label}{" "}
        </Text>
      ))}
    </Box>
  );
}
