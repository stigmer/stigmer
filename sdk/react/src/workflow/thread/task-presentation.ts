import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";
import { formatDuration } from "../format-utils.js";

// Headless presentation layer for workflow task cards (T04) — the thread's
// sibling of the session's `tool-presenter.ts`.
//
// `resolveTaskPreview` turns a `DerivedTaskState` into the two presentation
// primitives a card needs — a bounded one-line preview of what the task did
// and its disclosure mode — without rendering anything.
//
// WHERE THIS RUNS (a deliberate divergence from the session): the session
// computes presentation in a card-level hook (`useToolPresentation`) because
// its stream store preserves `ToolCall` object identity across frames, so
// the hook's `useMemo` bails. The workflow store instead REBUILDS every
// `DerivedTaskState` on each event append; the memo boundary is the
// projection's `WorkflowThreadItem` (`threadItemEqual`). Preview-affecting
// values must therefore be primitives on that item, computed once in
// `projectThreadItems` — NOT in a card hook. Do not "fix" this back to a
// hook: it would defeat the thread's structural sharing (DD-009/DD-010).
//
// DATA HONESTY: the kind-specific lines read the TRUNCATED event summaries
// (`input_summary` on task_started, `output_summary` on task_completed).
// Their population is runner-dependent per kind — every parser here is
// defensive against absent or unexpectedly-shaped Structs and degrades to
// the empty string (status-only card), never a broken line. The FULL output
// lives on the status snapshot and is rendered by the card body, not here.

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Disclosure mode for a task card, mirroring the session's rule — "does the
 * body carry content the one-line row cannot?":
 *
 * - `"preview"` — I/O-bearing kinds: the card keeps an always-visible,
 *   bounded body of the task's output (the session's shell/edit/MCP model).
 * - `"summary"` — thin/derived kinds: a compact row with a chevron-gated
 *   detail body.
 */
export type WorkflowTaskDisclosure = "preview" | "summary";

/** The resolved presentation primitives for one task card. */
export interface WorkflowTaskPreview {
  /**
   * Bounded one-line preview of what the task did (e.g. `set orderId,
   * total`, `3 errors`, `emitted ticket.classified`). The empty string when
   * there is nothing kind-specific to say — consumers hide the line rather
   * than render filler.
   */
  readonly previewLine: string;
  /** Disclosure mode for the card. Pure function of the task kind. */
  readonly disclosure: WorkflowTaskDisclosure;
}

/**
 * Optional per-kind overrides for the preview line and disclosure — the
 * workflow twin of the session's `ToolPresenter` (minus `runGroupable`:
 * workflow tasks are one card per task).
 */
export interface WorkflowTaskPresenter {
  /**
   * Overrides the kind-specific preview line. Return `null` to fall back to
   * the built-in line for the kind. Status lines (awaiting approval, the
   * failure message, "Skipped") always take precedence and are not
   * overridable — they are correctness surfaces, not wording.
   */
  readonly previewLine?: (state: DerivedTaskState) => string | null;
  /** Overrides the default disclosure mode for the kind. */
  readonly disclosure?: (state: DerivedTaskState) => WorkflowTaskDisclosure;
}

// ---------------------------------------------------------------------------
// Registry (the platform-builder extension seam)
// ---------------------------------------------------------------------------

const registry = new Map<WorkflowTaskKind, WorkflowTaskPresenter>();

/**
 * Registers a custom presenter for a {@link WorkflowTaskKind}, overriding
 * the built-in preview line and/or disclosure. Call once at app startup.
 * This is the extension point for platform builders embedding the workflow
 * execution UI who want product-specific wording without forking the
 * components — the same seam as the session's `registerToolPresenter`.
 *
 * Returns a disposer that unregisters the presenter, restoring the previous
 * one for that kind (or the default). Most apps register once at startup
 * and ignore it; tests and dynamic hosts use it to avoid leaking global
 * state.
 */
export function registerTaskPresenter(
  kind: WorkflowTaskKind,
  presenter: WorkflowTaskPresenter,
): () => void {
  const previous = registry.get(kind);
  registry.set(kind, presenter);
  return () => {
    if (previous === undefined) {
      registry.delete(kind);
    } else {
      registry.set(kind, previous);
    }
  };
}

/** Returns the registered presenter for a kind, if any. */
export function getTaskPresenter(
  kind: WorkflowTaskKind,
): WorkflowTaskPresenter | undefined {
  return registry.get(kind);
}

// ---------------------------------------------------------------------------
// Disclosure defaults
// ---------------------------------------------------------------------------

/**
 * Kinds whose output can be the point of the task — their cards keep an
 * always-visible bounded body (the session's "preview" categories). The
 * body renders only when output actually exists (the `showBody` gate), so
 * a kind whose runner writes no output — today's invocation kinds, until
 * the output-envelope follow-up standardizes them (DD-T04-3) — stays a
 * clean one-line row with zero cost. `set_vars` earns its place from live
 * data: the runner writes the seeded variables to task output (T05, R2-5).
 *
 * Only genuinely body-less kinds (control flow, `wait`/`listen`, and the
 * snapshot fallback's `unspecified`) stay compact summary rows.
 */
const PREVIEW_KINDS: ReadonlySet<WorkflowTaskKind> = new Set([
  WorkflowTaskKind.transform,
  WorkflowTaskKind.validate,
  WorkflowTaskKind.llm_call,
  WorkflowTaskKind.eval,
  WorkflowTaskKind.emit_event,
  WorkflowTaskKind.notification,
  WorkflowTaskKind.agent_call,
  WorkflowTaskKind.set_vars,
  WorkflowTaskKind.human_input,
  WorkflowTaskKind.http_call,
  WorkflowTaskKind.grpc_call,
  WorkflowTaskKind.activity_call,
  WorkflowTaskKind.run_workflow,
]);

/** Default disclosure mode for a task kind. */
export function defaultDisclosureForKind(
  kind: WorkflowTaskKind,
): WorkflowTaskDisclosure {
  return PREVIEW_KINDS.has(kind) ? "preview" : "summary";
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Hard cap on the preview line — it is a header suffix, not a body. */
const PREVIEW_LINE_MAX_CHARS = 80;

/**
 * Resolves the presentation primitives for one task card.
 *
 * Precedence for the line: universal status lines first (awaiting approval,
 * the failure's first line, "Skipped") — these are correctness surfaces —
 * then the registered presenter's line, then the built-in per-kind line.
 */
export function resolveTaskPreview(
  state: DerivedTaskState,
): WorkflowTaskPreview {
  const override = registry.get(state.taskKind);
  const disclosure =
    override?.disclosure?.(state) ?? defaultDisclosureForKind(state.taskKind);

  const statusLine = statusPreviewLine(state);
  if (statusLine !== null) {
    return { previewLine: truncateLine(statusLine), disclosure };
  }

  const line =
    override?.previewLine?.(state) ?? defaultPreviewLine(state) ?? "";
  return { previewLine: truncateLine(line), disclosure };
}

/** Universal status lines that outrank any kind-specific preview. */
function statusPreviewLine(state: DerivedTaskState): string | null {
  if (state.status === "waiting_approval") return "Awaiting approval";
  if (state.status === "failed" && state.error) return firstLine(state.error);
  if (state.status === "skipped") return "Skipped";
  return null;
}

// ---------------------------------------------------------------------------
// Built-in per-kind lines
// ---------------------------------------------------------------------------

function defaultPreviewLine(state: DerivedTaskState): string | null {
  switch (state.taskKind) {
    case WorkflowTaskKind.agent_call:
      return agentCallLine(state);
    case WorkflowTaskKind.set_vars:
      return setVarsLine(state.inputSummary);
    case WorkflowTaskKind.transform:
      return transformLine(state);
    case WorkflowTaskKind.validate:
      return validateLine(state.outputSummary);
    case WorkflowTaskKind.llm_call:
      return llmCallLine(state);
    case WorkflowTaskKind.eval:
      return evalLine(state.outputSummary);
    case WorkflowTaskKind.emit_event:
      return emitEventLine(state);
    case WorkflowTaskKind.notification:
      return notificationLine(state);
    case WorkflowTaskKind.human_input:
      return humanInputLine(state.outputSummary);
    case WorkflowTaskKind.wait:
      return waitLine(state);
    case WorkflowTaskKind.listen:
      return listenLine(state);
    default:
      // Control flow (branch-taken / fork progress need graph topology the
      // thread does not have — deferred), raise_error (the failure
      // precedence already shows the message), the invocation kinds
      // (pending the backend output-envelope follow-up), and the snapshot
      // fallback's `unspecified` all stay status-only.
      return null;
  }
}

/**
 * The flagship agent-call line: `slug · running <tool> · N msgs · M tools`.
 * Field-for-field the pre-T04 card line — kept here so the thread has one
 * source of preview semantics.
 */
function agentCallLine(state: DerivedTaskState): string | null {
  const parts: string[] = [];
  if (state.agentSlug) parts.push(state.agentSlug);
  if (state.status === "running" && state.currentToolName) {
    parts.push(`running ${state.currentToolName}`);
  }
  if (state.messagesCount > 0 || state.toolCallsCount > 0) {
    parts.push(`${state.messagesCount} msgs · ${state.toolCallsCount} tools`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** `set orderId, total +2 more` — from the resolved variables map. */
function setVarsLine(input: JsonObject | null): string | null {
  if (!input) return null;
  // The summary may nest the map under `variables` (the config field) or
  // carry the resolved variables at the top level — accept both.
  const vars = asObject(input["variables"]) ?? input;
  const keys = Object.keys(vars);
  if (keys.length === 0) return null;
  const shown = keys.slice(0, 3).join(", ");
  const rest = keys.length - 3;
  return rest > 0 ? `set ${shown} +${rest} more` : `set ${shown}`;
}

/** `jq → 42` while settled; the engine alone while running. */
function transformLine(state: DerivedTaskState): string | null {
  const engine = asString(state.inputSummary?.["engine"])?.toLowerCase() ?? null;
  if (state.outputSummary) {
    const snippet = valueSnippet(state.outputSummary);
    return engine ? `${engine} → ${snippet}` : `→ ${snippet}`;
  }
  return engine;
}

/** `valid` / `3 errors` — from the documented `{valid, errors[]}` shape. */
function validateLine(output: JsonObject | null): string | null {
  if (!output) return null;
  const valid = output["valid"];
  if (valid === true) return "valid";
  if (valid === false) {
    const errors = Array.isArray(output["errors"]) ? output["errors"].length : 0;
    return errors > 0 ? `${errors} ${errors === 1 ? "error" : "errors"}` : "invalid";
  }
  return null;
}

/** `claude-sonnet · "snippet…"` — model from input, text from output. */
function llmCallLine(state: DerivedTaskState): string | null {
  const parts: string[] = [];
  const model = asString(state.inputSummary?.["model"]);
  if (model) parts.push(model);
  if (state.outputSummary) parts.push(valueSnippet(state.outputSummary));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** `pass · score 0.82` — from the documented `{pass, score}` shape. */
function evalLine(output: JsonObject | null): string | null {
  if (!output) return null;
  const pass = output["pass"];
  const score = output["score"];
  if (typeof pass !== "boolean") return null;
  const verdict = pass ? "pass" : "fail";
  return typeof score === "number" ? `${verdict} · score ${score}` : verdict;
}

/** `emitted ticket.classified` — the CloudEvents `type` is the identity. */
function emitEventLine(state: DerivedTaskState): string | null {
  const emittedType = asString(state.outputSummary?.["type"]);
  if (emittedType) return `emitted ${emittedType}`;
  const configured = asString(asObject(state.inputSummary?.["event"])?.["type"]);
  return configured ? `emitting ${configured}` : null;
}

/** `sent via slack` / `delivery failed` — from `{channel, delivered}`. */
function notificationLine(state: DerivedTaskState): string | null {
  const output = state.outputSummary;
  const channel =
    asString(output?.["channel"]) ?? asString(state.inputSummary?.["channel"]);
  if (output && output["delivered"] === false) return "delivery failed";
  if (output && channel) return `sent via ${channel}`;
  return channel;
}

/** `approve · by suresh` — the settled decision from the task output. */
function humanInputLine(output: JsonObject | null): string | null {
  // The gating state is covered by the universal "Awaiting approval" line;
  // this renders only the settled decision record.
  const outcome = asString(output?.["outcome"]);
  if (!outcome) return null;
  const reviewer = asString(output?.["reviewer"]);
  return reviewer ? `${outcome} · by ${reviewer}` : outcome;
}

/** `waiting 10s` / `waited 10s` / `until <timestamp>`. */
function waitLine(state: DerivedTaskState): string | null {
  const input = state.inputSummary;
  if (!input) return null;
  const verb = state.status === "running" ? "waiting" : "waited";
  const duration = asObject(input["duration"]);
  if (duration) {
    const label = formatWaitDuration(duration);
    return label ? `${verb} ${label}` : null;
  }
  const until = asString(input["until"]);
  return until ? `${verb} until ${until}` : null;
}

/** `waiting for signal` / `signal received` — status-verbed. */
function listenLine(state: DerivedTaskState): string | null {
  if (state.status === "running") return "waiting for signal";
  if (state.status === "completed") return "signal received";
  return null;
}

// ---------------------------------------------------------------------------
// Struct-reading helpers (defensive by construction)
// ---------------------------------------------------------------------------

function asString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/**
 * One-line snippet of an arbitrary JSON value: scalars verbatim (strings
 * quoted), containers as a shape summary. Used where a kind's output has
 * no documented structure to name (transform results, raw LLM text).
 */
export function valueSnippet(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${firstLine(value)}"`;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} ${value.length === 1 ? "item" : "items"}]`;
  }
  const keys = Object.keys(value);
  // A single-field wrapper is usually an envelope (`{result: …}`) — unwrap
  // one level so the snippet names the payload, not the wrapper.
  if (keys.length === 1) {
    const inner = value[keys[0]];
    if (
      inner === null ||
      typeof inner === "string" ||
      typeof inner === "number" ||
      typeof inner === "boolean"
    ) {
      return valueSnippet(inner);
    }
  }
  return `{${keys.length} ${keys.length === 1 ? "field" : "fields"}}`;
}

/**
 * Formats the WaitTaskConfig `Duration` shape (`{days, hours, minutes,
 * seconds, milliseconds}`) via the shared duration formatter. Unknown or
 * empty shapes yield `null`.
 */
function formatWaitDuration(duration: JsonObject): string | null {
  const num = (key: string): number => {
    const v = duration[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const totalMs =
    num("days") * 86_400_000 +
    num("hours") * 3_600_000 +
    num("minutes") * 60_000 +
    num("seconds") * 1_000 +
    num("milliseconds");
  return totalMs > 0 ? formatDuration(totalMs) : null;
}

function firstLine(text: string): string {
  const nl = text.indexOf("\n");
  return nl === -1 ? text : text.slice(0, nl);
}

function truncateLine(line: string): string {
  return line.length > PREVIEW_LINE_MAX_CHARS
    ? `${line.slice(0, PREVIEW_LINE_MAX_CHARS - 1)}\u2026`
    : line;
}
