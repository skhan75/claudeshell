import React from "react";
import { Box, Text } from "ink";
import { theme } from "./theme.js";
import { SectionHeader } from "./chrome.js";
import { FileTree } from "./FileTree.js";

/**
 * The left IDE rail: a divider-bordered EXPLORER column hosting the project file
 * tree. Uses a right-edge divider only (the chat sits to its right), mirroring the
 * right SidePanel's left divider so the editor is cleanly bracketed. Hidden by
 * default; Ctrl+E toggles it and focuses it for keyboard navigation.
 */
export function SidebarPanel({
  width,
  height,
  cwd,
  activeFile,
  focused = false,
  onExit,
  onOpenFile,
}: {
  width: number;
  height: number;
  cwd: string;
  activeFile?: string;
  focused?: boolean;
  onExit?: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const inner = width - 3; // right divider (1) + paddingX (1 each)
  const treeHeight = Math.max(1, height - 1 - (focused ? 1 : 0)); // header (+ hint when focused)
  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? theme.accent : theme.dim}
      borderTop={false}
      borderLeft={false}
      borderBottom={false}
      paddingX={1}
    >
      <SectionHeader label="▤ EXPLORER" width={inner} right={focused ? "●" : undefined} />
      <FileTree
        cwd={cwd}
        width={inner}
        height={treeHeight}
        activeFile={activeFile}
        focused={focused}
        onExit={onExit}
        onOpenFile={onOpenFile}
      />
      {focused && <Text color={theme.dim}>↑↓ move · ⏎ edit · → open · ← close · esc</Text>}
    </Box>
  );
}
