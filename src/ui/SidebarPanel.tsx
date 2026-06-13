import React from "react";
import { Box } from "ink";
import { theme } from "./theme.js";
import { SectionHeader } from "./chrome.js";
import { FileTree } from "./FileTree.js";

/**
 * The left IDE rail: a divider-bordered EXPLORER column hosting the project file
 * tree. Uses a right-edge divider only (the chat sits to its right), mirroring the
 * right SidePanel's left divider so the editor is cleanly bracketed. Hidden by
 * default; toggled with Ctrl+E.
 */
export function SidebarPanel({
  width,
  height,
  cwd,
  activeFile,
}: {
  width: number;
  height: number;
  cwd: string;
  activeFile?: string;
}) {
  const inner = width - 3; // right divider (1) + paddingX (1 each)
  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.dim}
      borderTop={false}
      borderLeft={false}
      borderBottom={false}
      paddingX={1}
    >
      <SectionHeader label="▤ EXPLORER" width={inner} />
      <FileTree cwd={cwd} width={inner} height={height - 1} activeFile={activeFile} />
    </Box>
  );
}
