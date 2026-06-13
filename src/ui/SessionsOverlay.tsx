import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { Panel } from "./chrome.js";
import { useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Telescope, type TelescopeItem } from "./Telescope.js";
import { listProjectSessions, type ProjectSession } from "../core/sessions-index.js";

interface SessionItem extends TelescopeItem {
  session: ProjectSession;
}

/** Render a coarse "x ago" recency string from a mtime. */
function relativeRecency(mtimeMs: number): string {
  const diff = Date.now() - mtimeMs;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * A saved-sessions picker built on Telescope. On mount it lists this project's
 * past sessions; selecting one resumes that conversation in a NEW tab.
 *
 * `claudeDir` is injectable for tests (default undefined → real ~/.claude).
 */
export function SessionsOverlay({ onClose, claudeDir }: { onClose: () => void; claudeDir?: string }) {
  const { manager } = useAppCtx();
  const cwd = manager.active?.cwd;

  const items: SessionItem[] = useMemo(() => {
    if (!cwd) return [];
    return listProjectSessions(cwd, { claudeDir }).map((session) => ({
      key: session.sessionId,
      label: session.title,
      session,
    }));
  }, [cwd, claudeDir]);

  if (items.length === 0) {
    return (
      <Box width={Math.min(90, 60)} flexDirection="column">
        <Panel accent flexDirection="column">
          <Text bold color={theme.accent}>
            SAVED SESSIONS
          </Text>
          <Text color={theme.dim}>No saved sessions for this project yet.</Text>
          <Text color={theme.dim}>esc close</Text>
        </Panel>
      </Box>
    );
  }

  return (
    <Telescope<SessionItem>
      title="SAVED SESSIONS"
      items={items}
      placeholder="search saved sessions…"
      onSelect={(item) => {
        manager.create({ resumeSessionId: item.session.sessionId, title: item.label });
        onClose();
      }}
      onClose={onClose}
      renderPreview={(item) => {
        const s = item.session;
        return (
          <Box flexDirection="column">
            <Text bold color={theme.accent}>
              {s.title}
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.dim}>
                id <Text color={theme.fg}>{s.sessionId}</Text>
              </Text>
              <Text color={theme.dim}>
                messages <Text color={theme.fg}>{String(s.messageCount)}</Text>
              </Text>
              <Text color={theme.dim}>
                last active <Text color={theme.fg}>{relativeRecency(s.mtimeMs)}</Text>
              </Text>
            </Box>
          </Box>
        );
      }}
    />
  );
}
