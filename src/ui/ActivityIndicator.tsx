import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";

/** Cyberpunk star-cycle spinner frames. */
const FRAMES = ["✶", "✸", "✹", "✺", "✹", "✷"];

/**
 * Live inference indicator. Rendered by App directly above the InputBar while the
 * active session is processing. Conveys an animated spinner, a thinking/working
 * label, elapsed seconds, the running thinking-token count, and an interrupt hint.
 */
export function ActivityIndicator() {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const session = manager.active;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 120);
    return () => clearInterval(id);
  }, []);

  if (!session || session.status !== "processing") return null;

  const thinkingTokens = session.transcript.thinkingTokens;
  const thinking = thinkingTokens > 0;
  const label = thinking ? "Thinking…" : "Working…";
  const accentColor = thinking ? theme.warn : theme.accent;

  const elapsed =
    session.turnStartedAt != null
      ? Math.round((Date.now() - session.turnStartedAt) / 1000)
      : 0;

  return (
    <Box>
      <Text color={accentColor} bold>
        {FRAMES[frame]} {label}
      </Text>
      <Text color={theme.dim}>
        {" "}
        · {elapsed}s
        {thinking ? ` · ${thinkingTokens} tok` : ""} · esc to interrupt
      </Text>
    </Box>
  );
}
