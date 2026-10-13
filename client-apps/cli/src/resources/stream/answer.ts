// Answering a tool use that waits for a person, through the session's own
// methods. A headless run answers every ask with its `--approve-default`;
// `runs approve` answers one ask by hand.
//
//   allow ... confirmToolUse with result allow
//   deny .... confirmToolUse with result deny, and the reason the agent reads
//   grant ... grantPermission: this call and every waiting call of its class
//             run for the rest of the turn
//
// `--approve-default` picks one answer per run: approve allows, reject
// denies, approve-all grants, and skip (also what an unset flag means)
// denies with a neutral reason so the agent carries on without the call. The
// session has no answer called skip, and a headless run cannot leave the call
// unanswered: its turn would wait forever.

import { create } from "@bufbuild/protobuf";
import {
  ConfirmToolUseInputSchema,
  GrantPermissionInputSchema,
  type ConfirmToolUseInput,
  type GrantPermissionInput,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { UsageError } from "../../errors/index.js";

/** The `--approve-default` choice; "" when the flag is unset. */
export type ApproveDefault = "" | "approve" | "skip" | "reject" | "approve-all";

/** One answer to a waiting tool use. */
export type AskAnswer =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "grant" };

/** The reason a skipped call is denied with: the agent reads it and goes on. */
export const SKIP_REASON = "Skipped by the user: carry on without this call.";

/** The slice of the session client an answer goes through. */
export interface AnswerClient {
  readonly session: {
    confirmToolUse(input: ConfirmToolUseInput): Promise<unknown>;
    grantPermission(input: GrantPermissionInput): Promise<unknown>;
  };
}

/**
 * Parse `--approve-default`. Case-insensitive, with the approve-all
 * spellings the flag has always taken; empty means unset.
 */
export function parseApproveDefault(value: string): ApproveDefault {
  switch (value.trim().toLowerCase()) {
    case "":
      return "";
    case "approve":
      return "approve";
    case "skip":
      return "skip";
    case "reject":
      return "reject";
    case "approve-all":
    case "approve_all":
    case "approveall":
      return "approve-all";
    default:
      throw new UsageError(
        `invalid --approve-default value "${value}": must be one of: approve, skip, reject, approve-all`,
      );
  }
}

/** The answer a run's `--approve-default` gives every ask. */
export function answerFor(choice: ApproveDefault): AskAnswer {
  switch (choice) {
    case "approve":
      return { kind: "allow" };
    case "reject":
      return { kind: "deny", reason: "" };
    case "approve-all":
      return { kind: "grant" };
    case "skip":
    case "":
      return { kind: "deny", reason: SKIP_REASON };
  }
}

/** The answer's word, for a status line: allowed, denied, skipped, allowed for the turn. */
export function answerWord(answer: AskAnswer): string {
  switch (answer.kind) {
    case "allow":
      return "allowed";
    case "deny":
      return answer.reason === SKIP_REASON ? "skipped" : "denied";
    case "grant":
      return "allowed for the rest of the turn";
  }
}

/** Send one answer for the tool use `toolUseId` of the session. */
export async function submitAnswer(
  client: AnswerClient,
  sessionId: string,
  toolUseId: string,
  answer: AskAnswer,
): Promise<void> {
  if (answer.kind === "grant") {
    await client.session.grantPermission(create(GrantPermissionInputSchema, { sessionId, toolUseId }));
    return;
  }
  await client.session.confirmToolUse(
    create(ConfirmToolUseInputSchema, {
      sessionId,
      toolUseId,
      result: answer.kind,
      denyMessage: answer.kind === "deny" ? answer.reason : "",
    }),
  );
}
