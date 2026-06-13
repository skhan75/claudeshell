import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";
import type { PermissionRequest } from "../core/types.js";

function inputPreview(input: Record<string, unknown>): string {
  if (typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return String(input.file_path);
  const s = JSON.stringify(input);
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

export function PermissionDialog({ request }: { request: PermissionRequest }) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");

  useInput((input, key) => {
    if (denying) {
      if (key.return) {
        request.resolve({ behavior: "deny", message: reason.trim() || "User denied this action" });
      } else if (key.escape) setDenying(false);
      else if (key.backspace || key.delete) setReason((r) => r.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setReason((r) => r + input);
      return;
    }
    if (input === "y") {
      request.resolve({ behavior: "allow", updatedInput: request.input });
    } else if (input === "a") {
      const persist = request.suggestions.filter((s) => s.destination === "localSettings");
      request.resolve({
        behavior: "allow",
        updatedInput: request.input,
        updatedPermissions: (persist.length > 0 ? persist : request.suggestions) as unknown[],
      });
    } else if (input === "n") {
      setDenying(true);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warn} paddingX={1}>
      <Text color={theme.warn} bold>⚠ Permission: {request.toolName}</Text>
      <Text color={theme.fg}>{inputPreview(request.input)}</Text>
      {denying ? (
        <Text color={theme.bad}>
          reason: {reason}▋ <Text dimColor>(Enter to send · Esc to cancel)</Text>
        </Text>
      ) : (
        <Text dimColor>y allow once · a always allow · n deny</Text>
      )}
    </Box>
  );
}

interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

export function QuestionDialog({ request }: { request: PermissionRequest }) {
  const questions = (request.input.questions as Question[] | undefined) ?? [];
  const [qi, setQi] = useState(0);
  const [sel, setSel] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [free, setFree] = useState<string | null>(null);
  const q: Question | undefined = questions[qi];

  useEffect(() => {
    if (!q) request.resolve({ behavior: "allow", updatedInput: { questions, answers: {} } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (value: string) => {
    const next = { ...answers, [q!.question]: value };
    if (qi + 1 < questions.length) {
      setAnswers(next);
      setQi(qi + 1);
      setSel(0);
      setChecked(new Set());
      setFree(null);
    } else {
      request.resolve({
        behavior: "allow",
        updatedInput: { questions: request.input.questions, answers: next },
      });
    }
  };

  useInput((input, key) => {
    if (!q) return;
    if (free !== null) {
      if (key.return) submit(free.trim() || q.options[sel]?.label || "");
      else if (key.escape) setFree(null);
      else if (key.backspace || key.delete) setFree((f) => (f ?? "").slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setFree((f) => (f ?? "") + input);
      return;
    }
    if (key.upArrow || input === "k") setSel((s) => Math.max(0, s - 1));
    else if (key.downArrow || input === "j") setSel((s) => Math.min(q.options.length - 1, s + 1));
    else if (input === " " && q.multiSelect) {
      setChecked((c) => {
        const n = new Set(c);
        if (n.has(sel)) n.delete(sel);
        else n.add(sel);
        return n;
      });
    } else if (input === "o") setFree("");
    else if (key.return) {
      if (q.multiSelect && checked.size > 0) {
        submit([...checked].sort((a, b) => a - b).map((i) => q.options[i].label).join(", "));
      } else {
        submit(q.options[sel].label);
      }
    }
  });

  if (!q) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        ? {q.header ? `${q.header}: ` : ""}{q.question} <Text dimColor>({qi + 1}/{questions.length})</Text>
      </Text>
      {q.options.map((o, i) => (
        <Text key={o.label} color={i === sel ? theme.accent : theme.fg} inverse={i === sel}>
          {q.multiSelect ? (checked.has(i) ? "[x] " : "[ ] ") : i === sel ? "❯ " : "  "}
          {o.label}
          {o.description ? <Text dimColor> — {o.description}</Text> : null}
        </Text>
      ))}
      {free !== null ? (
        <Text color={theme.fg}>other: {free}▋</Text>
      ) : (
        <Text dimColor>↑↓/jk move{q.multiSelect ? " · space toggle" : ""} · Enter confirm · o other</Text>
      )}
    </Box>
  );
}
