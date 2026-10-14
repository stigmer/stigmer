// Test fixtures for the terminal components: session events, built with
// `@stigmer/react/test`'s samples where they cover the shape and with
// `create(SessionEventSchema)` where they do not (asks' answers, file
// reviews, subagent threads), folded the way the conversation hooks fold
// them. Every component under test reads the fold's types.
import { create, type JsonObject, type MessageInitShape } from "@bufbuild/protobuf";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { FileReviewSet, ToolUse, Turn } from "@stigmer/sdk";
import { samples } from "@stigmer/react/test";

export const RUN_ID = "run_00000000000000000000000001";

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

/** A stored event of the demo run, on a thread ("" for the primary). */
export function event(init: EventInit, threadId = "", runId = RUN_ID): SessionEvent {
  return create(SessionEventSchema, { sessionId: "ses-1", runId, threadId, event: init });
}

/** The one turn the events fold to. */
export function turnOf(events: readonly SessionEvent[]): Turn {
  return samples.fold(events).turns[0]!;
}

/** The first tool use of the folded turn. */
export function toolUseOf(events: readonly SessionEvent[]): ToolUse {
  return turnOf(events).items.find((item): item is ToolUse => item.kind === "tool_use")!;
}

/** A tool use that waits for a person: its use (permission `ask`) and its ask. */
export function askEvents(
  name: string,
  opts: {
    readonly id?: string;
    readonly input?: JsonObject;
    readonly mcpServerName?: string;
    readonly argsPreview?: string;
    readonly policySource?: string;
    readonly policyHook?: string;
  } = {},
): SessionEvent[] {
  const id = opts.id ?? `${RUN_ID}.tc-${name}`;
  return [
    samples.toolUseEvent(name, opts.input ?? {}, {
      id,
      evaluatedPermission: "ask",
      ...(opts.mcpServerName === undefined ? {} : { mcpServerName: opts.mcpServerName }),
    }),
    samples.permissionAskedEvent(id, {
      argsPreview: opts.argsPreview ?? "",
      ...(opts.policySource === undefined ? {} : { policySource: opts.policySource }),
      ...(opts.policyHook === undefined ? {} : { policyHook: opts.policyHook }),
    }),
  ];
}

/** A tool use that waits for a person, folded. */
export function waitingToolUse(name: string, opts: Parameters<typeof askEvents>[1] = {}): ToolUse {
  return toolUseOf([samples.userMessageEvent("go"), ...askEvents(name, opts)]);
}

/** One file of a review set's `stigmer.file_review.changes`. */
export interface ReviewFileInit {
  readonly id: string;
  readonly path: string;
  readonly previousPath?: string;
  readonly change?: string;
  readonly reviewable?: string;
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
}

/** A decision on a review set: its scope, action, and the file for a file decision. */
export interface ReviewDecisionInit {
  readonly id: string;
  readonly action: "keep" | "undo";
  readonly fileChangeId?: string;
  readonly origin?: string;
  /** For an undo: whether the files were put back (`true`), failed (`false`), or not yet (absent). */
  readonly reconciled?: boolean;
}

/**
 * A review set's events: its `stigmer.file_review.changes` (set `cs-1`,
 * aggregate digest `agg-1`, each file's digest `fd-<id>`) and each decision
 * with its reconcile.
 */
export function reviewEvents(
  files: readonly ReviewFileInit[],
  decisions: readonly ReviewDecisionInit[] = [],
  changeSetId = "cs-1",
): SessionEvent[] {
  const changesId = `${RUN_ID}.review.${changeSetId}`;
  const events = [
    event({
      case: "stigmerFileReviewChanges",
      value: {
        id: changesId,
        changeSetId,
        aggregateDigest: "agg-1",
        files: files.map((file) => ({
          fileChangeId: file.id,
          path: file.path,
          previousPath: file.previousPath ?? "",
          change: file.change ?? "modified",
          digest: `fd-${file.id}`,
          linesAdded: file.linesAdded ?? 0,
          linesRemoved: file.linesRemoved ?? 0,
          reviewable: file.reviewable ?? "complete",
        })),
      },
    }),
  ];
  for (const decision of decisions) {
    events.push(
      event({
        case: "stigmerFileReviewDecided",
        value: {
          id: decision.id,
          changeSetId,
          scope: decision.fileChangeId ? "file" : "change_set",
          fileChangeId: decision.fileChangeId ?? "",
          action: decision.action,
          expectedDigest: "d",
          origin: decision.origin ?? "person",
        },
      }),
    );
    if (decision.reconciled !== undefined) {
      events.push(
        event({
          case: "stigmerFileReviewReconciled",
          value: {
            id: `${changesId}.r.${decision.id}`,
            changeSetId,
            failure: decision.reconciled ? "" : "reconcile_failed",
          },
        }),
      );
    }
  }
  return events;
}

/** A review set, folded. */
export function reviewSet(
  files: readonly ReviewFileInit[],
  decisions: readonly ReviewDecisionInit[] = [],
): FileReviewSet {
  return turnOf([samples.userMessageEvent("go"), ...reviewEvents(files, decisions)]).fileReview[0]!;
}

/** A subagent's thread events, opened by its `task` tool use `taskId`, as it finished. */
export function threadEvents(
  taskId: string,
  opts: {
    readonly agentName?: string;
    readonly input?: string;
    readonly reply?: string;
    readonly items?: readonly SessionEvent[];
    readonly state?: "running" | "completed" | "failed";
  } = {},
): SessionEvent[] {
  const events = [
    event({ case: "sessionThreadCreated", value: { id: `${taskId}.created`, sessionThreadId: taskId, agentName: opts.agentName ?? "researcher" } }),
    event({
      case: "agentThreadMessageSent",
      value: { id: `${taskId}.sent`, toSessionThreadId: taskId, content: [{ type: "text", text: opts.input ?? "" }] },
    }),
    ...(opts.items ?? []),
  ];
  const state = opts.state ?? "completed";
  if (state !== "running") {
    events.push(
      event({
        case: "agentThreadMessageReceived",
        value: { id: `${taskId}.received`, fromSessionThreadId: taskId, content: [{ type: "text", text: opts.reply ?? "" }] },
      }),
      event({
        case: "sessionThreadStatusIdle",
        value: {
          id: `${taskId}.idle`,
          sessionThreadId: taskId,
          stopReason: { type: state === "completed" ? "end_turn" : "retries_exhausted" },
        },
      }),
    );
  }
  return events;
}
