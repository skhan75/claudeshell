import React, { useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
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

  const { stdout } = useStdout();
  useEffect(() => {
    const onResize = () => store.getState().bump();
    stdout?.on("resize", onResize);
    return () => {
      stdout?.off("resize", onResize);
    };
  }, [stdout, store]);

  const tooSmall = (stdout?.columns ?? 80) < 60 || (stdout?.rows ?? 24) < 14;

  useInput(
    (input, key) => {
      if (session?.status === "crashed" && input === "r") {
        session.resume();
        return;
      }
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
        // FIX 1: esc only transitions input->scroll to avoid double-fire with ChatPane.
        // When focus is already scroll, ChatPane owns esc (clear search).
        if (st.focus === "input") {
          st.setFocus("scroll");
        }
        return;
      }
      // FIX 1: 'i' returns from scroll back to input, avoiding esc collision with ChatPane.
      if (input === "i" && st.focus === "scroll") {
        st.setFocus("input");
        return;
      }
      if ((key.meta ?? false) && /^[1-9]$/.test(input)) manager.activate(Number(input) - 1);
    },
    { isActive: !pending && !paletteOpen && !tooSmall }
  );

  if (tooSmall) {
    return <Text color="yellow">terminal too small for claudeshell — resize to at least 60×14</Text>;
  }

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
