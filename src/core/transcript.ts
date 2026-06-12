import type { SdkMessage, SessionMeta, TranscriptBlock, Usage } from "./types.js";

const FILE_TOOLS = new Set(["Read", "Edit", "Write", "NotebookEdit"]);

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
  tool_use_id?: string;
}

function contentBlocks(msg: SdkMessage): ContentBlock[] {
  const c = msg.message?.content;
  return Array.isArray(c) ? (c as ContentBlock[]) : [];
}

function textOf(blocks: ContentBlock[]): string {
  return blocks.filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text).join("");
}

function summarize(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  if (typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return input.file_path;
  const s = JSON.stringify(input);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

export class Transcript {
  blocks: TranscriptBlock[] = [];
  usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, turns: 0 };
  meta: SessionMeta = { slashCommands: [], mcpServers: [] };
  contextFiles = new Set<string>();

  addUser(text: string): void {
    this.blocks.push({ kind: "user", text });
  }

  addInfo(text: string): void {
    this.blocks.push({ kind: "info", text });
  }

  apply(msg: SdkMessage): void {
    if (msg.type === "system" && msg.subtype === "init") {
      this.meta.model = msg.model ?? this.meta.model;
      this.meta.mcpServers = msg.mcp_servers ?? this.meta.mcpServers;
      this.meta.slashCommands = msg.slash_commands ?? this.meta.slashCommands;
      return;
    }

    if (msg.type === "stream_event") {
      const delta = msg.event?.delta;
      if (msg.event?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
        const last = this.blocks[this.blocks.length - 1];
        if (last?.kind === "assistant" && last.streaming) last.text += delta.text;
        else this.blocks.push({ kind: "assistant", text: delta.text, streaming: true });
      }
      return;
    }

    if (msg.type === "partial_assistant") {
      const text = textOf(contentBlocks(msg));
      if (text === "") return;
      const last = this.blocks[this.blocks.length - 1];
      if (last?.kind === "assistant" && last.streaming) last.text = text;
      else this.blocks.push({ kind: "assistant", text, streaming: true });
      return;
    }

    if (msg.type === "assistant") {
      const blocks = contentBlocks(msg);
      const text = textOf(blocks);
      if (text !== "") {
        const last = this.blocks[this.blocks.length - 1];
        if (last?.kind === "assistant" && last.streaming) {
          last.text = text;
          last.streaming = false;
        } else {
          this.blocks.push({ kind: "assistant", text, streaming: false });
        }
      }
      for (const b of blocks) {
        if (b.type === "tool_use" && typeof b.name === "string") {
          this.blocks.push({ kind: "tool", name: b.name, detail: summarize(b.name, b.input), status: "running", id: typeof b.id === "string" ? b.id : undefined });
          const fp = b.input?.file_path;
          if (FILE_TOOLS.has(b.name) && typeof fp === "string") this.contextFiles.add(fp);
        }
      }
      const u = msg.message?.usage;
      if (u) {
        this.usage.inputTokens += u.input_tokens ?? 0;
        this.usage.outputTokens += u.output_tokens ?? 0;
        this.usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      }
      this.meta.model = msg.message?.model ?? this.meta.model;
      return;
    }

    if (msg.type === "user") {
      const results = contentBlocks(msg).filter((b) => b.type === "tool_result");
      for (const r of results) {
        let marked = false;
        if (typeof r.tool_use_id === "string") {
          for (const b of this.blocks) {
            if (b.kind === "tool" && b.status === "running" && b.id === r.tool_use_id) {
              b.status = "done";
              marked = true;
              break;
            }
          }
        }
        if (!marked) {
          for (let i = this.blocks.length - 1; i >= 0; i--) {
            const b = this.blocks[i];
            if (b.kind === "tool" && b.status === "running") {
              b.status = "done";
              break;
            }
          }
        }
      }
      return;
    }

    if (msg.type === "result") {
      if (typeof msg.total_cost_usd === "number") this.usage.costUsd = msg.total_cost_usd;
      if (typeof msg.num_turns === "number") this.usage.turns = msg.num_turns;
      if (msg.subtype && msg.subtype !== "success") this.addInfo(`result: ${msg.subtype}`);
    }
  }
}
