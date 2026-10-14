/**
 * The data migration a store driver runs each time a kind was renamed: the
 * kind's stored name and the rows that spell it. It has run three times,
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
 *
 * The drivers own the SQL (which rows to read, in what pages, how to write
 * them, the transaction), one helper each that takes a rename; this module
 * owns what is driver-neutral: what one row becomes. Each step's names are
 * frozen literals here (`RUN_RENAME_V18`, `RUN_RENAME_V21`,
 * `FEDERATION_ISSUER_RENAME_V30`), never read off the contract, so a later
 * rename cannot change what an earlier step does. The retired-kind steps
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
 *     keeps the prefix it was minted with. The library's tables hold no
 *     federation issuer row (an edition keeps them in tables of its own and
 *     rewrites those itself), so at v30 the rewrite finds none; it runs
 *     anyway, so the step is whole whatever a store holds.
 *   - Grants on the kind. An IamPolicy names its subject and object by kind
 *     as a string (`ApiResourceRef.kind`), and its id is derived from that
 *     triple's text (domain/iampolicy/constants.ts `policyIdFor`), so a
 *     policy naming the kind is re-keyed to the id its new text derives, or
 *     a revoke would never find it. Its old row leaves the way the store
 *     deletes a policy, with its list keys and with its history kept; the
 *     driver writes the new row unproven, so its list keys are derived on
 *     read (list-index.ts).
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
import { FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";

import { grantIdFor } from "../domain/grant/constants.js";

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

/** The tables that key a row by kind. */
export const KIND_TABLES: ReadonlyArray<string> = [
  "resources",
  "resource_audit",
  "resource_list_keys",
  "resource_names",
];

/** The `kind` column value of the grant rows a step reads. */
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
  /** The id the policy's renamed triple derives. */
  readonly id: string;
  /** The row's new bytes, its metadata id the new one. */
  readonly data: Uint8Array;
}

/**
 * The re-keyed grant of one IamPolicy row whose subject or object is the
 * renamed kind, or undefined when it names neither. Throws when the bytes
 * do not decode.
 */
export function rekeyedGrant(rename: KindRename, data: Uint8Array): RekeyedGrant | undefined {
  const policy = fromBinary(GrantSchema, data);
  const spec = policy.spec;
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
  const id = grantIdFor(spec);
  if (policy.metadata !== undefined) {
    policy.metadata.id = id;
  }
  return { id, data: toBinary(GrantSchema, policy) };
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
