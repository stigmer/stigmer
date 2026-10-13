// Plaintext headless renderer for non-TTY output (piped stdout), drawn from
// the session's fold.
//
// The agent's messages on its primary thread go to the data sink (stdout);
// terse status lines go to the status sink (stderr): the person's message,
// one line per tool use each time its state changes, a sub-agent's start and
// end with its tool uses indented beneath, the platform's notes, a context
// compaction, the turn's errors, and how each ask was answered. No ANSI, no
// frames. Each fold is compared with the last by reference, so a turn no event
// touched is not walked again, and everything already written stays written.

import { extractShellIntent, type SessionFold, type ToolUse, type Turn, type TurnItem } from "@stigmer/sdk";
import { answerWord, type ApproveDefault, type AskAnswer } from "./answer.js";
import type { HeadlessRenderer } from "./headless.js";
import type { LineWriter } from "./render-ndjson.js";

export interface PlaintextRendererOptions {
  /** The agent's messages (stdout). */
  readonly data: LineWriter;
  /** Tool/status/diagnostic lines (stderr). */
  readonly status: LineWriter;
}

const MAX_ERROR_LEN = 100;

/** Renders a terse, ANSI-free transcript from the fold. */
export class PlaintextRenderer implements HeadlessRenderer {
  private readonly rendered = new Map<string, Turn>();
  private readonly written = new Set<string>();
  private readonly toolStates = new Map<string, string>();
  private readonly threadStates = new Map<string, string>();

  constructor(private readonly opts: PlaintextRendererOptions) {}

  event(): void {}

  fold(fold: SessionFold): void {
    for (const turn of fold.turns) {
      if (this.rendered.get(turn.runId) === turn) continue;
      this.rendered.set(turn.runId, turn);
      this.renderTurn(turn);
    }
  }

  answering(_ask: ToolUse, choice: ApproveDefault, answer: AskAnswer): void {
    const why = choice === "" ? "no --approve-default" : `--approve-default ${choice}`;
    this.opts.status.write(`    → ${answerWord(answer)} (${why})\n`);
  }

  private renderTurn(turn: Turn): void {
    const message = turn.userMessage;
    if (message !== undefined && this.once(message.id)) {
      this.opts.status.write(`\n> ${message.text}\n\n`);
    }
    this.renderItems(turn.items, "", true);
    for (const error of turn.errors) {
      if (this.once(error.id)) this.opts.status.write(`  ✗ ${error.message}\n`);
    }
  }

  // The primary thread's messages are the answer and go to stdout; a
  // sub-agent's are its own working and are left out (its reply reaches the
  // agent, which answers in its own words).
  private renderItems(items: readonly TurnItem[], indent: string, primary: boolean): void {
    const { data, status } = this.opts;
    for (const item of items) {
      switch (item.kind) {
        case "message":
          if (primary && this.once(item.id)) data.write(`${item.text}\n`);
          break;
        case "note":
          if (this.once(item.id)) status.write(`${indent}[system] ${item.text}\n`);
          break;
        case "compacted":
          if (this.once(item.id)) status.write(`${indent}  … Context compacted\n`);
          break;
        case "tool_use":
          this.renderTool(item, indent);
          break;
        case "thinking":
          break;
      }
    }
  }

  private renderTool(tool: ToolUse, indent: string): void {
    if (this.toolStates.get(tool.id) !== tool.state) {
      this.toolStates.set(tool.id, tool.state);
      this.opts.status.write(`${indent}  ${toolLine(tool)}\n`);
    }
    const thread = tool.thread;
    if (thread === undefined) return;
    const name = thread.agentName !== "" ? thread.agentName : tool.name;
    const previous = this.threadStates.get(thread.id);
    if (previous === undefined) this.opts.status.write(`${indent}  ↳ Sub-agent: ${name}\n`);
    this.renderItems(thread.items, `${indent}  `, false);
    if (previous !== thread.state) {
      this.threadStates.set(thread.id, thread.state);
      const end = THREAD_END[thread.state];
      if (end !== "") this.opts.status.write(`${indent}  ${end}: ${name}\n`);
    }
  }

  private once(id: string): boolean {
    if (this.written.has(id)) return false;
    this.written.add(id);
    return true;
  }
}

const THREAD_END: Record<NonNullable<ToolUse["thread"]>["state"], string> = {
  running: "",
  completed: "✓ Sub-agent completed",
  failed: "✗ Sub-agent failed",
  stopped: "⊘ Sub-agent stopped",
};

// One line for a tool use in its current state.
function toolLine(tool: ToolUse): string {
  const label = toolLabel(tool);
  switch (tool.state) {
    case "running":
      return `⠋ ${label}`;
    case "waiting":
      return `⚠ Approval needed: ${label}`;
    case "completed":
      return `✓ ${label}`;
    case "failed": {
      const error = truncate(tool.result?.text ?? "", MAX_ERROR_LEN);
      return error === "" ? `✗ ${label}` : `✗ ${label}: ${error}`;
    }
    case "denied":
      return `⊘ ${label} (denied)`;
    case "stopped":
      return `⊘ ${label} (interrupted)`;
  }
}

/**
 * The status-line label for a tool use: the model-authored intent phrase
 * when the shell call carries one (stigmer#276), the same convention that
 * titles rows in the web console and the Ink TTY path, otherwise the tool's
 * name.
 */
function toolLabel(tool: ToolUse): string {
  return extractShellIntent(tool) ?? tool.name;
}

// Trim and ellipsize.
function truncate(value: string, maxLen: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen)}…`;
}
