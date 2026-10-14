/**
 * The one data migration both store drivers run when the PluginEval and
 * AgentEval kinds leave the platform for one EvalRun kind
 * (agentic/evalrun/v1). The drivers own the SQL (which rows to read, in
 * what pages, how to write and delete them, the transaction); this module
 * owns what is driver-neutral: which kinds go, which grant names one, and
 * what a try's row becomes. It follows platform-client-retired.ts.
 *
 * What leaves. Every plugin eval and agent eval row leaves every table
 * that keys a row by kind (kind-rename.ts `KIND_TABLES`): the live rows,
 * their history, their list keys and the names they held. They are not
 * converted into eval runs: their status shapes differ, no store held one
 * a person relied on before the change, and a conversion would keep the
 * old shapes alive in code. Every IamPolicy row whose resource or
 * principal is one of them leaves too (`policyNamesRetiredEvalKind`); the
 * kinds granted no roles, so none is expected, and the rule is the one
 * every retirement keeps. Search entries are boot's rebuild's to drop; the
 * kinds were never search-indexed.
 *
 * What stays, relabelled. A try is an ordinary conversation, run and
 * score, which a migration cannot delete whole (a session's delete also
 * removes its events, its authorization tuples, its sealed values and its
 * search entries: domain/session/controller.ts). They stay, with their
 * label `stigmer.ai/plugin-eval` rewritten to `stigmer.ai/eval-run`
 * (`relabelEvalTryRow`), so the list keys derived from the new label at the
 * next open keep every old try out of the conversation lists and recents,
 * as rows no eval run reaches. A row that carries an etag is stamped again,
 * as a write would stamp it.
 *
 * An undecodable row fails the step, the rule the other data migrations
 * keep (public-visibility-retired.ts): the driver's transaction rolls back
 * and the boot stops on the row it names.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { stampEtag, storedEtagOf } from "./etag.js";

/** The `kind` column values of the rows the step removes. */
export const RETIRED_EVAL_KINDS: ReadonlyArray<string> = ["plugin_eval", "agent_eval"];

/** The `kind` column value of the grant rows the step reads. */
export const EVAL_KINDS_RETIRED_POLICY_KIND = "iam_policy";

/** The label the retired kinds' workflows stamped on a try's rows. */
export const RETIRED_EVAL_LABEL = "stigmer.ai/plugin-eval";

/**
 * The label an eval run's workflow stamps (domain/eval-run/constants.ts
 * EVAL_RUN_LABEL), written here as a constant of its own so the step means
 * what it meant when it arrived.
 */
export const EVAL_RUN_LABEL_AT_RETIREMENT = "stigmer.ai/eval-run";

/** How many rows the step decodes per page. */
export const EVAL_KINDS_RETIRED_PAGE_SIZE = 500;

/** The kinds whose rows a try leaves, with the message each decodes as, frozen. */
const TRY_SCHEMAS: ReadonlyMap<string, DescMessage> = new Map<string, DescMessage>([
  ["session", SessionSchema],
  ["run", RunSchema],
  ["score", ScoreSchema],
]);

/** The `kind` column values of the try rows the step relabels. */
export const EVAL_TRY_KIND_NAMES: ReadonlyArray<string> = [...TRY_SCHEMAS.keys()];

/**
 * Whether a stored IamPolicy row names a retired eval kind as its resource
 * or its principal (an `ApiResourceRef.kind` is the enum member name).
 * Throws when the bytes do not decode.
 */
export function policyNamesRetiredEvalKind(data: Uint8Array): boolean {
  const spec = fromBinary(IamPolicySchema, data).spec;
  return (
    RETIRED_EVAL_KINDS.includes(spec?.resource?.kind ?? "") ||
    RETIRED_EVAL_KINDS.includes(spec?.principal?.kind ?? "")
  );
}

/**
 * The relabelled bytes of one try row of `kindName` (the module header),
 * or undefined when the row carries no retired label (the driver then
 * leaves its bytes as they are). A row that already holds the new label
 * keeps that value. Throws when the bytes do not decode.
 */
export function relabelEvalTryRow(kindName: string, data: Uint8Array): Uint8Array | undefined {
  const schema = TRY_SCHEMAS.get(kindName);
  if (schema === undefined) {
    return undefined;
  }
  const resource = fromBinary(schema, data);
  const labels = (resource as unknown as { readonly metadata?: { readonly labels: Record<string, string> } }).metadata
    ?.labels;
  const value = labels?.[RETIRED_EVAL_LABEL];
  if (labels === undefined || value === undefined) {
    return undefined;
  }
  delete labels[RETIRED_EVAL_LABEL];
  labels[EVAL_RUN_LABEL_AT_RETIREMENT] ??= value;
  if ((storedEtagOf(schema, resource) ?? "") !== "") {
    stampEtag(schema, resource);
  }
  return toBinary(schema, resource);
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableEvalKindRowError(kind: string, id: string, error: unknown): Error {
  return new Error(`${kind} '${id}' cannot be read to retire the plugin eval and agent eval kinds: ${String(error)}`, {
    cause: error,
  });
}
