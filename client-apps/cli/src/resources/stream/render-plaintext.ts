// Plaintext headless renderer for non-TTY output (piped stdout).
//
// Mirrors Go's streamAgentPlainText (run_stream_plaintext.go): clean AI text to
// the data sink (stdout), terse tool/status lines to the status sink (stderr).
// No ANSI, no frames. Approvals are auto-skipped — there is no keyboard here;
// use --json for a machine-readable non-TTY stream. Phase/done/stream-error are
// not rendered: the driver returns the outcome and the command surfaces it.

import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ApprovalNeededEvent, StreamEvent } from "./events.js";
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
        status.write(`  ⠋ ${event.toolCall.name}\n`);
        return;
      case "toolCompleted":
        status.write(
          event.toolCall.error !== ""
            ? `  ✗ ${event.toolCall.name}: ${truncate(event.toolCall.error, MAX_ERROR_LEN)}\n`
            : `  ✓ ${event.toolCall.name}\n`,
        );
        return;
      case "toolInterrupted":
        status.write(`  ⊘ ${event.toolCall.name} (interrupted)\n`);
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

// Trim and ellipsize. Mirrors Go's truncate.
function truncate(value: string, maxLen: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen)}…`;
}
