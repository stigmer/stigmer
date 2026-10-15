/**
 * The data migration a store driver runs each time a kind was renamed: the
 * kind's stored name and the rows that spell it. It has run five times,
 * with the same transformation and different names:
 *
 *   - SQLite v18, Postgres v13: agent executions became agent runs
 *     (`agent_execution`, `AgentExecution` to `agent_run`, `AgentRun`);
 *   - SQLite v21, Postgres v16: the agent run became a run (`agent_run`,
 *     `AgentRun` to `run`, `Run`), once the workflow product it was told
 *     apart from was gone;
 *   - Postgres v30: the identity provider became a federation issuer
 *     (`identity_provider`, `IdentityProvider` to `federation_issuer`,
 *     `FederationIssuer`), named for what it is once Stigmer had no single
 *     sign-on of its own; its driver also rewrites the permission
 *     history's entries for the kind (postgres/migrations.ts). SQLite has
 *     no step: the kind is Enterprise's, and Enterprise refuses SQLite
 *     (ee/server/src/editions/enterprise.ts), so no SQLite store holds its
 *     names or its grants.
 *   - SQLite v38, Postgres v34: the IAM policy became a grant
 *     (`iam_policy`, `IamPolicy` to `grant`, `Grant`), named for what one
 *     row is, one role given to one principal on one resource. Its ids
 *     move too (below), and its driver renames the permission history's
 *     tables and moves their entries.
 *   - SQLite v40, Postgres v36: the evaluator became a scoring rule
 *     (`evaluator`, `Evaluator` to `scoring_rule`, `ScoringRule`), so the
 *     setting that switches an agent's AI grading on is not read as the
 *     thing that runs evals. Its rows keep their `evl_` ids. It lists no
 *     grantable roles, so no grant and no history entry names it, and the
 *     grant arm finds none.
 *
 * The drivers own the SQL (which rows to read, in what pages, how to write
 * them, the transaction), one helper each that takes a rename; this module
 * owns what is driver-neutral: what one row becomes. Each step's names are
 * frozen literals here (`RUN_RENAME_V18`, `RUN_RENAME_V21`,
 * `FEDERATION_ISSUER_RENAME_V30`, `GRANT_RENAME_V34`,
 * `SCORING_RULE_RENAME_V36`), never read off the
 * contract, so a later rename cannot change what an earlier step does. The
 * grant id prefix is frozen the same way: v13, v16 and v30 (SQLite v18,
 * v21) re-key a grant to the `iamp_` id their time minted, and v34 moves
 * it. The retired-kind steps
 * are twin modules instead (agent-instance-retired.ts,
 * workflow-instance-retired.ts) because they delete different rows of
 * different kinds; a rename is one transformation, so it is one module.
 *
 * What changes, and why each row must.
 *
 *   - The `kind` column. A kind's stored name is its enum value name
 *     (proto-fields.ts `apiResourceKindName`), and the kind was renamed
 *     with its number kept. Every table that keys a row by kind follows
 *     (`KIND_TABLES`). The search index is not among them: boot's rebuild
 *     clears it and indexes every registered kind before the port binds.
 *   - A row's `kind` string. Every stored resource carries its kind's name
 *     in its bytes, which a read returns and an update of a fetched row
 *     must send back under the contract's const, so the row is rewritten.
 *     Field and enum value renames need nothing: the rows are binary, by
 *     number. Audit rows keep their bytes: only version history decodes
 *     audit rows, and neither renamed kind is versioned. An id is never
 *     rewritten: it is an identity (a run's engine workflow id ends with
 *     it, and sessions, memories, the schedule ledger and billing rows copy
 *     it; a federated account's id is derived from its issuer's), so a row
 *     keeps the prefix it was minted with. A grant is the one exception: its
 *     id is derived from its triple (below), never copied by another row
 *     but its own history, so v34 moves every stored grant from `iamp_X`
 *     to `grt_X`. The hash `X` is the triple's and the prefix is not part
 *     of it, so the move is a prefix swap, never a re-hash: a row whose
 *     id is not the one its triple derives under either prefix fails the
 *     step, naming it. The library's tables hold no
 *     federation issuer row (an edition keeps them in tables of its own and
 *     rewrites those itself), so at v30 the rewrite finds none; it runs
 *     anyway, so the step is whole whatever a store holds.
 *   - Grants on the kind. A grant names its subject and object by kind
 *     as a string (`ApiResourceRef.kind`), and its id is derived from that
 *     triple's text (domain/grant/constants.ts `grantIdFor`), so a grant
 *     naming the kind is re-keyed to the id its new text derives, or a
 *     revoke would never find it. Its old row leaves the way the store
 *     deletes a grant, with its list keys and with its history kept; the
 *     driver writes the new row unproven, so its list keys are derived on
 *     read (list-index.ts). At v34 the renamed kind is the grant itself,
 *     and this arm finds nothing: no grant names a grant (the kind lists
 *     no grantable roles), and it reads grants under their old name after
 *     the step renamed them.
 *
 * 2026-10-07: the v18 step no longer renames workflow runs, their event
 * log's types or the run keys in workflow steps. The workflow product was
 * removed, and the later step in workflow-retired.ts deletes every
 * workflow, workflow run (under either kind name) and grant naming one,
 * and drops the event log, so nothing those arms wrote survives the chain:
 * a store replayed from before this step reaches the state the full step
 * would have left.
 *
 * A row a step does not change is left byte for byte as it is. An
 * undecodable row fails the step, the rule the other data migrations keep
 * (public-visibility-retired.ts): the driver's transaction rolls back and
 * the boot stops on the row it names.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScoringRuleSchema } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/api_pb";
import { FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";

import type { GrantSpec } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";

import {
  canonicalTripleText,
  malformedTripleField,
  malformedTripleMessage,
} from "../domain/grant/constants.js";
import { derivedId } from "../pipeline/steps/defaults.js";

/** One rename of a kind, as one step applies it. */
export interface KindRename {
  /** The kind's stored name (its enum value name), before and after. */
  readonly kind: readonly [from: string, to: string];
  /** The kind's name in a row's bytes, before and after. */
  readonly kindString: readonly [from: string, to: string];
  /** The message the kind's rows decode as. */
  readonly schema: DescMessage;
  /** The rename, as the step's failure names it. */
  readonly label: string;
}

/** SQLite v18, Postgres v13: agent executions became agent runs. */
export const RUN_RENAME_V18: KindRename = {
  kind: ["agent_execution", "agent_run"],
  kindString: ["AgentExecution", "AgentRun"],
  schema: RunSchema,
  label: "the rename of executions to runs",
};

/** SQLite v21, Postgres v16: the agent run became a run. */
export const RUN_RENAME_V21: KindRename = {
  kind: ["agent_run", "run"],
  kindString: ["AgentRun", "Run"],
  schema: RunSchema,
  label: "the rename of the agent run to a run",
};

/** Postgres v30: the identity provider became a federation issuer. */
export const FEDERATION_ISSUER_RENAME_V30: KindRename = {
  kind: ["identity_provider", "federation_issuer"],
  kindString: ["IdentityProvider", "FederationIssuer"],
  schema: FederationIssuerSchema,
  label: "the rename of the identity provider to a federation issuer",
};

/** SQLite v38, Postgres v34: the IAM policy became a grant. */
export const GRANT_RENAME_V34: KindRename = {
  kind: ["iam_policy", "grant"],
  kindString: ["IamPolicy", "Grant"],
  schema: GrantSchema,
  label: "the rename of the IAM policy to a grant",
};

/** SQLite v40, Postgres v36: the evaluator became a scoring rule. */
export const SCORING_RULE_RENAME_V36: KindRename = {
  kind: ["evaluator", "scoring_rule"],
  kindString: ["Evaluator", "ScoringRule"],
  schema: ScoringRuleSchema,
  label: "the rename of the evaluator to a scoring rule",
};

/** The prefix grant ids were minted with until v34, which every earlier step re-keys to. */
export const GRANT_ID_PREFIX_BEFORE_V34 = "iamp";

/** The prefix v34 moves every stored grant id to. */
export const GRANT_ID_PREFIX_V34 = "grt";

/** The tables that key a row by kind. */
export const KIND_TABLES: ReadonlyArray<string> = [
  "resources",
  "resource_audit",
  "resource_list_keys",
  "resource_names",
];

/**
 * The `kind` column value of the grant rows v13, v16 and v30 read: the
 * grant rows' stored kind at those steps' time, before v34 renamed it.
 */
export const KIND_RENAME_GRANT_KIND = "iam_policy";

/** How many rows of a kind a step decodes per page. */
export const KIND_RENAME_PAGE_SIZE = 500;

/**
 * The migrated bytes of one row of the renamed kind, or undefined when its
 * kind string is not the one this rename renames. Throws when the bytes do
 * not decode.
 */
export function renamedKindRow(rename: KindRename, data: Uint8Array): Uint8Array | undefined {
  const row = reflect(rename.schema, fromBinary(rename.schema, data));
  const field = rename.schema.fields.find((f) => f.name === "kind");
  const [from, to] = rename.kindString;
  if (field === undefined || row.get(field) !== from) {
    return undefined;
  }
  row.set(field, to);
  return toBinary(rename.schema, row.message);
}

/** What a step made of one grant row. */
export interface RekeyedGrant {
  /** The id the grant's renamed triple derives. */
  readonly id: string;
  /** The row's new bytes, its metadata id the new one. */
  readonly data: Uint8Array;
}

/**
 * The re-keyed grant of one grant row whose subject or object is the
 * renamed kind, or undefined when it names neither. Its new id carries
 * `idPrefix`: the prefix grants were minted with before v34 for the steps
 * before it, the one v34 moved them to for a step after it (the channel
 * merge, channel-kinds-merged.ts). Throws when the bytes do not decode.
 */
export function rekeyedGrant(
  rename: KindRename,
  data: Uint8Array,
  idPrefix: string = GRANT_ID_PREFIX_BEFORE_V34,
): RekeyedGrant | undefined {
  const grant = fromBinary(GrantSchema, data);
  const spec = grant.spec;
  if (spec === undefined) {
    return undefined;
  }
  const [from, to] = rename.kind;
  let changed = false;
  for (const ref of [spec.resource, spec.principal]) {
    if (ref !== undefined && ref.kind === from) {
      ref.kind = to;
      changed = true;
    }
  }
  if (!changed) {
    return undefined;
  }
  const id = stepGrantId(idPrefix, spec);
  if (grant.metadata !== undefined) {
    grant.metadata.id = id;
  }
  return { id, data: toBinary(GrantSchema, grant) };
}

/**
 * v34's move of one grant row, or of one history entry's copy of it, to
 * the `grt_` id its triple derives, its kind string the new one; undefined
 * when the row already holds that id and that kind string. `storedId` is
 * the id the store keys it by. Throws when the bytes do not decode, the row
 * holds no triple, or `storedId` is neither the `iamp_` nor the `grt_` id
 * its triple derives.
 */
export function movedGrant(storedId: string, data: Uint8Array): RekeyedGrant | undefined {
  const grant = fromBinary(GrantSchema, data);
  if (grant.spec === undefined) {
    throw new Error("it holds no triple");
  }
  const before = stepGrantId(GRANT_ID_PREFIX_BEFORE_V34, grant.spec);
  const id = stepGrantId(GRANT_ID_PREFIX_V34, grant.spec);
  if (storedId !== before && storedId !== id) {
    throw new Error(`its id is not the one its triple derives (${before})`);
  }
  const [fromKind, toKind] = GRANT_RENAME_V34.kindString;
  if (storedId === id && grant.kind !== fromKind && grant.metadata?.id === id) {
    return undefined;
  }
  if (grant.kind === fromKind) {
    grant.kind = toKind;
  }
  if (grant.metadata !== undefined) {
    grant.metadata.id = id;
  }
  return { id, data: toBinary(GrantSchema, grant) };
}

/** The id `spec` derives under `prefix`, refusing a triple no grant could hold. */
function stepGrantId(prefix: string, spec: GrantSpec): string {
  const malformed = malformedTripleField(spec);
  if (malformed !== undefined) {
    throw new Error(malformedTripleMessage(malformed));
  }
  return derivedId(prefix, canonicalTripleText(spec));
}

/** A step's failure for a row it cannot read (the module header). */
export function unreadableKindRenameRowError(
  rename: KindRename,
  kind: string,
  id: string,
  error: unknown,
): Error {
  return new Error(
    `the ${kind} row ${id} cannot be read for ${rename.label}: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}
