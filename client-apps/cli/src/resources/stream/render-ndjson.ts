// NDJSON headless renderer (`--json`): one line per stored session event, as
// Claude Managed Agents JSON (`toManagedAgentsJson`), Stigmer's own
// `stigmer.*` events under their own type. The line is the event and nothing
// else; previews are not written, so every line is an event the log keeps and
// `stigmer runs trace -o json` lists the same.
//
// The answers a run gives appear as their own events (user.tool_confirmation,
// stigmer.permission.grant). An unset `--approve-default` denies each ask, and
// says so on stderr.

import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { toManagedAgentsJson, type ToolUse } from "@stigmer/sdk";
import { writeNdjson } from "../../output/ndjson.js";
import type { ApproveDefault } from "./answer.js";
import type { HeadlessRenderer } from "./headless.js";

/** A minimal output sink (process.stdout/stderr or a test buffer). */
export interface LineWriter {
  write(chunk: string): unknown;
}

export interface NdjsonRendererOptions {
  /** NDJSON event lines (stdout). */
  readonly data: LineWriter;
  /** Diagnostics (stderr). */
  readonly status: LineWriter;
}

/** Writes one Managed Agents JSON line per stored event. */
export class NdjsonRenderer implements HeadlessRenderer {
  constructor(private readonly opts: NdjsonRendererOptions) {}

  event(event: SessionEvent): void {
    writeNdjson(this.opts.data, toManagedAgentsJson(event));
  }

  fold(): void {}

  answering(ask: ToolUse, choice: ApproveDefault): void {
    if (choice === "") {
      this.opts.status.write(`⚠ No --approve-default set; denying ${ask.name}\n`);
    }
  }
}
