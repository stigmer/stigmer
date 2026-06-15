// Plaintext renderer for workflow events (human + `execution logs` output).
//
// Renders one line per event: `[HH:MM:SS] <glyph> <text>`, with the glyph tinted
// by the event tone (color auto-disables off a TTY / under NO_COLOR, like the
// rest of the CLI). Mirrors the layout of Go's renderWorkflowEvent. Output goes
// to a caller-supplied sink so this composes into both the `run workflow` inline
// stream and `execution logs`.

import { type Styler, styler } from "../../output/style.js";
import { type EventTone, type WorkflowEventView, toWorkflowEventView } from "./workflow-event-view.js";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";

/** A single-line writer (e.g. a wrapper over process.stdout). */
export interface LineSink {
  write(line: string): void;
}

/** Render a workflow event as one tinted line to `sink`. */
export function renderWorkflowEventPlaintext(event: WorkflowExecutionEvent, sink: LineSink, colorize: boolean): void {
  const view = toWorkflowEventView(event);
  sink.write(formatLine(view, styler(colorize)));
}

function formatLine(view: WorkflowEventView, style: Styler): string {
  const prefix = style.dim(`[${view.time}]`);
  const glyph = view.glyph === "" ? "  " : tint(view.glyph, view.tone, style);
  return `${prefix} ${glyph} ${view.text}\n`;
}

function tint(glyph: string, tone: EventTone, style: Styler): string {
  switch (tone) {
    case "success":
      return style.green(glyph);
    case "error":
      return style.red(glyph);
    case "warning":
      return style.yellow(glyph);
    case "info":
      return style.cyan(glyph);
    case "muted":
      return style.dim(glyph);
  }
}
