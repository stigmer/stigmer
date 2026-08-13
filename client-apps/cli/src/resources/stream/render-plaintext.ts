// Plaintext headless renderer for non-TTY output (piped stdout).
//
// Inherited from the retired Go CLI's streamAgentPlainText: clean AI text to
// the data sink (stdout), terse tool/status lines to the status sink (stderr).
// No ANSI, no frames. Approvals are auto-skipped — there is no keyboard here;
// use --json for a machine-readable non-TTY stream. Phase/done/stream-error are
// not rendered: the driver returns the outcome and the command surfaces it.

import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { resolveToolKindByName, shellIntentFromArgs } from "@stigmer/sdk";
import type { ApprovalNeededEvent, StreamEvent, ToolCallInfo } from "./events.js";
import type { HeadlessRenderer } from "./headless.js";
import type { LineWriter } from "./render-ndjson.js";

export interface PlaintextRendererOptions {
  /** AI text output (stdout). */
  readonly data: LineWriter;
  /** Tool/status/diagnostic lines (stderr). */
  readonly status: LineWriter;
}

const MAX_ERROR_LEN = 100;

/** Renders a terse, ANSI-free transcript; auto-skips every approval. */
export class PlaintextRenderer implements HeadlessRenderer {
  constructor(private readonly opts: PlaintextRendererOptions) {}

  render(event: StreamEvent): void {
    const { data, status } = this.opts;
    switch (event.kind) {
      case "aiStreamDelta":
        data.write(event.content);
        return;
      case "aiStreamEnd":
        data.write("\n");
        return;
      case "aiMessage":
        if (event.content !== "") data.write(`${event.content}\n`);
        return;
      case "humanMessage":
        status.write(`\n> ${event.content}\n\n`);
        return;
      case "toolRunning":
        status.write(`  ⠋ ${toolLine(event.toolCall)}\n`);
        return;
      case "toolCompleted":
        status.write(
          event.toolCall.error !== ""
            ? `  ✗ ${toolLine(event.toolCall)}: ${truncate(event.toolCall.error, MAX_ERROR_LEN)}\n`
            : `  ✓ ${toolLine(event.toolCall)}\n`,
        );
        return;
      case "toolInterrupted":
        status.write(`  ⊘ ${toolLine(event.toolCall)} (interrupted)\n`);
        return;
      case "approvalNeeded":
        status.write(`  ⚠ Approval needed: ${event.toolName} (auto-skipped in non-TTY mode)\n`);
        return;
      case "subAgentStarted":
        status.write(`  ↳ Sub-agent: ${event.description !== "" ? event.description : event.name}\n`);
        return;
      case "subAgentCompleted":
        status.write(`  ✓ Sub-agent completed: ${event.id}\n`);
        return;
      case "contextCompacted":
        status.write(
          `  … Context compacted (${Math.floor(event.tokensBefore / 1000)}K → ${Math.floor(event.tokensAfter / 1000)}K tokens)\n`,
        );
        return;
      case "systemMessage":
        status.write(`[system] ${event.content}\n`);
        return;
      default:
        // phaseChange, toolWaitingApproval, toolStreamDelta, todoUpdate, done,
        // streamError: not surfaced in plaintext (parity with Go).
        return;
    }
  }

  // Non-TTY has no prompt — always skip (the render() line already noted it).
  resolveApproval(_event: ApprovalNeededEvent): ApprovalAction {
    return ApprovalAction.SKIP;
  }
}

/**
 * The status-line label for a tool call: the model-authored intent phrase
 * when the shell call carries one (stigmer#276) — the same convention that
 * titles rows in the web console and the Ink TTY path — otherwise the raw
 * tool name. Kind is resolved by name only: the snapshot projection carries
 * neither `tool_kind` nor `mcp_server_slug`, and MCP tools never carry an
 * intent (the fixture pins them to null), so name-lookup is sufficient here.
 * NDJSON is deliberately untouched — it is the machine contract.
 */
function toolLine(toolCall: ToolCallInfo): string {
  const intent = shellIntentFromArgs(
    resolveToolKindByName(toolCall.name),
    toolCall.args,
  );
  return intent ?? toolCall.name;
}

// Trim and ellipsize. Mirrors Go's truncate.
function truncate(value: string, maxLen: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen)}…`;
}
