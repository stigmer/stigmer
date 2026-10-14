// Answering a tool use that waits for a person, through the session's own
// methods. A headless run answers every ask with its `--approve-default`;
// `runs approve` answers one ask by hand.
//
//   allow ... confirmToolUse with result allow
//   deny .... confirmToolUse with result deny, and the reason the agent reads
//   grant ... grantPermission: this call and every waiting call of its class
//             run for the rest of the turn
//
// `--approve-default` picks one answer per run, in the session's own words:
// allow, deny (with a neutral reason, so the agent carries on without the
// call) or allow-all (a grant). An unset flag denies the same way: a headless
// run cannot leave the call unanswered, or its turn would wait forever. The
// retired words approve, skip, reject and approve-all are refused with the
// word that replaced them.

import { create } from "@bufbuild/protobuf";
import {
  ConfirmToolUseInputSchema,
  GrantPermissionInputSchema,
  type ConfirmToolUseInput,
  type GrantPermissionInput,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { UsageError } from "../../errors/index.js";

/** The `--approve-default` choice; "" when the flag is unset. */
export type ApproveDefault = "" | "allow" | "deny" | "allow-all";

/** One answer to a waiting tool use. */
export type AskAnswer =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "grant" };

/** The reason `--approve-default` denies a call with: the agent reads it and goes on. */
export const DENY_REASON = "Denied by --approve-default: carry on without this call.";

/** The answers the flag no longer takes, each with the word that replaced it. */
const RETIRED: Readonly<Record<string, string>> = {
  approve: '"approve" is now "allow"',
  skip: '"skip" and "reject" are now "deny"',
  reject: '"skip" and "reject" are now "deny"',
  "approve-all": '"approve-all" is now "allow-all"',
  approve_all: '"approve-all" is now "allow-all"',
  approveall: '"approve-all" is now "allow-all"',
};

/** The slice of the session client an answer goes through. */
export interface AnswerClient {
  readonly session: {
    confirmToolUse(input: ConfirmToolUseInput): Promise<unknown>;
    grantPermission(input: GrantPermissionInput): Promise<unknown>;
  };
}

/**
 * Parse `--approve-default`. Case-insensitive, with `allow_all` and
 * `allowall` read as allow-all; empty means unset. A retired word is refused
 * with the word that replaced it.
 */
export function parseApproveDefault(value: string): ApproveDefault {
  const word = value.trim().toLowerCase();
  switch (word) {
    case "":
      return "";
    case "allow":
      return "allow";
    case "deny":
      return "deny";
    case "allow-all":
    case "allow_all":
    case "allowall":
      return "allow-all";
  }
  const replaced = RETIRED[word];
  throw new UsageError(
    `invalid --approve-default value "${value}": ${replaced === undefined ? "" : `${replaced}; `}must be one of: allow, deny, allow-all`,
  );
}

/** The answer a run's `--approve-default` gives every ask. */
export function answerFor(choice: ApproveDefault): AskAnswer {
  switch (choice) {
    case "allow":
      return { kind: "allow" };
    case "allow-all":
      return { kind: "grant" };
    case "deny":
    case "":
      return { kind: "deny", reason: DENY_REASON };
  }
}

/** The answer's word, for a status line: allowed, denied, allowed for the turn. */
export function answerWord(answer: AskAnswer): string {
  switch (answer.kind) {
    case "allow":
      return "allowed";
    case "deny":
      return "denied";
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
