import React, { useEffect } from "react";
import { Box, useInput } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { matchKey } from "./keys.js";
import { TabBar } from "./TabBar.js";
import { ChatPane } from "./ChatPane.js";
import { SidePanel } from "./SidePanel.js";
import { TelemetryStrip } from "./TelemetryStrip.js";
import { InputBar } from "./InputBar.js";
import { PillBar } from "./PillBar.js";
import { CommandPalette } from "./CommandPalette.js";
import { PermissionDialog, QuestionDialog } from "./dialogs.js";

export function App() {
  const { manager, config, store } = useAppCtx();
  useApp((s) => s.version);
  const layout = useApp((s) => s.layout);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const session = manager.active;
  const pending = session?.pendingPermission ?? null;

  useEffect(() => manager.subscribe(() => store.getState().bump()), [manager, store]);

  useInput(
    (input, key) => {
      const st = store.getState();
      if (matchKey(config.keys.palette, input, key)) return st.setPaletteOpen(true);
      if (matchKey(config.keys.layoutToggle, input, key)) return st.toggleLayout();
      if (matchKey(config.keys.newSession, input, key)) {
        manager.create();
        return;
      }
      if (matchKey(config.keys.closeSession, input, key)) {
        if (session) manager.close(session.id);
        return;
      }
      if (matchKey(config.keys.focusToggle, input, key)) {
        st.setFocus(st.focus === "input" ? "scroll" : "input");
        return;
      }
      if ((key.meta ?? false) && /^[1-9]$/.test(input)) manager.activate(Number(input) - 1);
    },
    { isActive: !pending && !paletteOpen }
  );

  return (
    <Box flexDirection="column">
      <TabBar />
      {layout === "zen" && <TelemetryStrip />}
      <Box>
        <Box flexDirection="column" flexGrow={1}>
          <ChatPane />
          {pending ? (
            pending.toolName === "AskUserQuestion" ? (
              <QuestionDialog key={pending.id} request={pending} />
            ) : (
              <PermissionDialog key={pending.id} request={pending} />
            )
          ) : paletteOpen ? (
            <CommandPalette />
          ) : (
            <>
              <InputBar />
              <PillBar />
            </>
          )}
        </Box>
        {layout === "sidebar" && <SidePanel />}
      </Box>
    </Box>
  );
}
