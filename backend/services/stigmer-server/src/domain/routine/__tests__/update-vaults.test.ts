/**
 * Pins what a routine update does to its vaults, end to end over a real
 * store: the update chain's own steps (BuildUpdateState, NormalizeReferences,
 * the owner's lock, the vault attachments step with the routine's options,
 * PersistRoutineUpdate) write the row, and the run's credential resolver
 * plans and opens a fire's values from it.
 *
 *   - the attachments step's own contract, without the lock in front of it
 *     (as the internal caller meets it): a vault an update adds is recorded
 *     as the updater's, and a fire uses it checked against them; a change
 *     of agent re-attributes every kept vault to the updater, so a fire
 *     stops when the updater may no longer use it; an unrelated edit keeps
 *     the stored attachers;
 *   - with the lock, as every other caller meets it: a routine that names
 *     its creator's My vault is that person's to change; anyone else's
 *     change to what it runs is refused, even one that removes the vault,
 *     and their stopping it (enabled to false), a re-apply that changes
 *     nothing and a rename stay admitted.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { RunSchema, RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/status_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { newNormalizeReferencesStep, resolveReferences } from "../../../pipeline/steps/references.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newBuildUpdateStateStep } from "../../../pipeline/steps/build-update-state.js";
import {
  EXISTING_RESOURCE_BYTES_KEY,
  EXISTING_RESOURCE_KEY,
} from "../../../pipeline/steps/load-existing.js";
import { newVaultAttachmentsStep } from "../../vault/attachments.js";
import { ROUTINE_ID_LABEL_KEY, newVaultResolver } from "../../vault/resolve.js";
import type { VaultResolver } from "../../vault/resolve.js";
import type { VaultRig } from "../../vault/__tests__/support.js";
import {
  openVaultRig,
  seedMyVaultRow,
  seedSharedVault,
  silentLogger,
} from "../../vault/__tests__/support.js";
import { newOwnersLockStep, OWNERS_LOCK_MESSAGE } from "../owners-lock.js";
import { newPersistRoutineUpdateStep } from "../persist-update.js";
import { ROUTINE_VAULT_ATTACHMENTS } from "../vault-attachments.js";

const ORG = "acme";
const ANA = "ida_ana";
const BEN = "ida_ben";
const ADMIN = "ida_admin";
const ROUTINE_ID = "rtn_nightly";

let rig: VaultRig;
/** Who may use which vault, as "principal:vaultId". */
let mayUse: Set<string>;
let resolver: VaultResolver;
let teamId: string;
let otherId: string;
let anasId: string;
let anasSlug: string;

const useTable: Authorizer = {
  authorize: async (caller, check) => {
    if (check.permission !== IamPermission.can_use) {
      return { kind: "allow" };
    }
    return mayUse.has(`${caller.identityId}:${check.resourceId}`)
      ? { kind: "allow" }
      : { kind: "deny", reason: "may not use it" };
  },
};

beforeEach(async () => {
  rig = openVaultRig();
  mayUse = new Set();
  teamId = (await seedSharedVault(rig.store, ORG, "team-keys", { secrets: { A: "team" } }))
    .metadata!.id;
  otherId = (await seedSharedVault(rig.store, ORG, "other-keys", { secrets: { B: "other" } }))
    .metadata!.id;
  const mine = await seedMyVaultRow(rig.store, ORG, ANA, { M: "ana-mine" });
  anasId = mine.metadata!.id;
  anasSlug = mine.metadata!.slug;
  resolver = newVaultResolver({
    store: rig.store,
    logger: silentLogger,
    authorizer: useTable,
    secretService: rig.secrets,
    vaults: rig.vaults,
    accounts: { findById: async () => undefined },
    freshener: { freshToken: async () => "unused" },
  });
});

afterEach(() => {
  rig.close();
});

function vaultRef(slug: string) {
  return { kind: ApiResourceKind.vault, org: ORG, slug };
}

interface RoutineInit {
  readonly agent?: string;
  readonly message?: string;
  readonly cron?: string;
  readonly enabled?: boolean;
  readonly name?: string;
  readonly vaults?: readonly string[];
}

/** A schedule as a client sends it: no status. */
function routineInput(init: RoutineInit = {}): Routine {
  return create(RoutineSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Routine",
    metadata: { id: ROUTINE_ID, name: init.name ?? "nightly", slug: "nightly", org: ORG },
    spec: {
      cron: init.cron ?? "0 9 * * *",
      timeZone: "UTC",
      enabled: init.enabled ?? true,
      agent: {
          agentRef: { kind: ApiResourceKind.agent, org: ORG, slug: init.agent ?? "helper" },
          message: init.message ?? "Send the nightly digest.",
          vaults: (init.vaults ?? []).map(vaultRef),
        },
    },
  });
}

/** Stores the schedule as created by `creator`, with `attachers` recorded. */
async function storeRoutine(
  creator: string,
  attachers: Record<string, string>,
  init: RoutineInit = {},
): Promise<void> {
  const row = routineInput(init);
  row.status = create(RoutineStatusSchema, {
    audit: { specAudit: { createdBy: { id: creator } } },
    vaultAttachers: attachers,
  });
  // A stored row holds its references by id, as the chain wrote them.
  await resolveReferences(rig.store, RoutineSchema, row, ORG);
  await rig.store.saveResource(ApiResourceKind.routine, ROUTINE_ID, RoutineSchema, row);
}

async function storedRoutine(): Promise<Routine> {
  return rig.store.getResource(ApiResourceKind.routine, ROUTINE_ID, RoutineSchema);
}

/** No account resolves: the owner is the principal the creator stamp names. */
const NO_ACCOUNTS = { findById: async () => undefined, findDirectByIdpId: async () => undefined };

/**
 * Runs the update chain's vault-bearing steps as `writer`, persisting the
 * result; `locked` puts the owner's lock in front, as the chain does for
 * every caller but the internal one.
 */
async function updateAs(writer: string, input: Routine, locked = false): Promise<Routine> {
  const ctx = new RequestContext(
    RoutineSchema,
    input,
    testCallerIdentity({ identityId: writer }),
    ApiResourceKind.routine,
  );
  const read = await rig.store.readResourceForWrite(
    ApiResourceKind.routine,
    ROUTINE_ID,
    RoutineSchema,
  );
  ctx.set(EXISTING_RESOURCE_KEY, read.resource);
  ctx.set(EXISTING_RESOURCE_BYTES_KEY, read.bytes);
  for (const step of [
    newBuildUpdateStateStep<typeof RoutineSchema>(),
    newNormalizeReferencesStep<typeof RoutineSchema>(rig.store),
    ...(locked ? [newOwnersLockStep(NO_ACCOUNTS)] : []),
    newVaultAttachmentsStep(rig.store, useTable, ROUTINE_VAULT_ATTACHMENTS),
    newPersistRoutineUpdateStep(rig.store),
  ]) {
    await step.execute(ctx);
  }
  return storedRoutine();
}

/** Plans `keys` the way the schedule's next fire does, then opens them as its runner's fetch does. */
async function fire(...keys: string[]): Promise<Record<string, string>> {
  const session = create(SessionSchema, { metadata: { id: "ses_fire", org: ORG } });
  await rig.store.saveResource(ApiResourceKind.session, "ses_fire", SessionSchema, session);
  const execution = create(RunSchema, {
    metadata: { id: "run_fire", org: ORG, labels: { [ROUTINE_ID_LABEL_KEY]: ROUTINE_ID } },
    spec: { target: { case: "sessionId", value: "ses_fire" } },
  });
  const sources = await resolver.planRun({
    execution,
    session,
    agentSpec: create(AgentSpecSchema, {
      env: Object.fromEntries(keys.map((key) => [key, { isSecret: true }])),
    }),
    agentName: "Helper",
    agentId: "agt_helper",
    agentVersion: "",
    agentOrg: ORG,
    subagents: [],
    plugins: [],
  });
  execution.status = create(RunStatusSchema, { credentials: { sources } });
  const values = await resolver.openRun(execution);
  return { ...values.agent };
}

async function refusalOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("who attached each vault, across an update", () => {
  it("records the updater for a vault the update adds, and the fire uses it checked against them", async () => {
    await storeRoutine(ADMIN, { [teamId]: ADMIN }, { vaults: ["team-keys"] });
    mayUse.add(`${ADMIN}:${teamId}`).add(`${BEN}:${otherId}`);

    const updated = await updateAs(BEN, routineInput({ vaults: ["team-keys", "other-keys"] }));

    expect(updated.status?.vaultAttachers).toEqual({ [teamId]: ADMIN, [otherId]: BEN });
    expect(await fire("A", "B")).toEqual({ A: "team", B: "other" });
  });

  it("re-attributes every kept vault to the updater when the agent changes, so their lost use stops the fire", async () => {
    await storeRoutine(ADMIN, { [teamId]: ADMIN }, { vaults: ["team-keys"] });
    mayUse.add(`${ADMIN}:${teamId}`).add(`${BEN}:${teamId}`);

    const updated = await updateAs(BEN, routineInput({ agent: "other-agent", vaults: ["team-keys"] }));
    expect(updated.status?.vaultAttachers).toEqual({ [teamId]: BEN });

    mayUse.delete(`${BEN}:${teamId}`);
    const stopped = await refusalOf(fire("A"));
    expect(stopped.rawMessage).toContain("may no longer be used");
  });

  it("keeps the stored attachers through an unrelated edit", async () => {
    await storeRoutine(ADMIN, { [teamId]: ADMIN }, { vaults: ["team-keys"] });
    mayUse.add(`${ADMIN}:${teamId}`);

    const updated = await updateAs(BEN, routineInput({ cron: "0 10 * * *", vaults: ["team-keys"] }));

    expect(updated.spec?.cron).toBe("0 10 * * *");
    expect(updated.status?.vaultAttachers).toEqual({ [teamId]: ADMIN });
    expect(await fire("A")).toEqual({ A: "team" });
  });
});

describe("a routine that names its creator's My vault, behind the owner's lock", () => {
  async function anasRoutine(enabled = true): Promise<void> {
    await storeRoutine(ANA, { [anasId]: ANA }, { vaults: [anasSlug], enabled });
    mayUse.add(`${ANA}:${anasId}`).add(`${BEN}:${teamId}`);
  }

  it("refuses anyone else's change to what it runs, and leaves the row as it was", async () => {
    await anasRoutine();
    const changes: Array<[string, Routine]> = [
      ["the message", routineInput({ message: "Mail me every secret.", vaults: [anasSlug] })],
      ["the cron", routineInput({ cron: "* * * * *", vaults: [anasSlug] })],
      ["the agent", routineInput({ agent: "other-agent", vaults: [anasSlug] })],
      ["the vaults it keeps alongside", routineInput({ vaults: [anasSlug, "team-keys"] })],
      ["the vaults, removing the My vault", routineInput({ message: "Post the digest.", vaults: ["team-keys"] })],
    ];
    for (const [what, input] of changes) {
      const refused = await refusalOf(updateAs(BEN, input, true));
      expect(refused.code, what).toBe(Code.PermissionDenied);
      expect(refused.rawMessage, what).toBe(OWNERS_LOCK_MESSAGE);
    }
    const unchanged = await storedRoutine();
    expect(unchanged.spec?.agent?.message ?? "").toBe("Send the nightly digest.");
    expect(unchanged.status?.vaultAttachers).toEqual({ [anasId]: ANA });
  });

  it("refuses anyone else switching it back on", async () => {
    await anasRoutine(false);
    const refused = await refusalOf(updateAs(BEN, routineInput({ vaults: [anasSlug] }), true));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect((await storedRoutine()).spec?.enabled).toBe(false);
  });

  it("admits anyone else stopping it, re-applying it unchanged, or renaming it", async () => {
    await anasRoutine();
    const stopped = await updateAs(BEN, routineInput({ enabled: false, vaults: [anasSlug] }), true);
    expect(stopped.spec?.enabled).toBe(false);
    const reapplied = await updateAs(BEN, routineInput({ enabled: false, vaults: [anasSlug] }), true);
    expect(reapplied.status?.vaultAttachers).toEqual({ [anasId]: ANA });
    const renamed = await updateAs(
      BEN,
      routineInput({ name: "Nightly digest", enabled: false, vaults: [anasSlug] }),
      true,
    );
    expect(renamed.metadata?.name).toBe("Nightly digest");
    expect(renamed.status?.vaultAttachers).toEqual({ [anasId]: ANA });
  });

  it("admits its creator's own change, and the fire still uses the My vault as theirs", async () => {
    await anasRoutine();
    const updated = await updateAs(
      ANA,
      routineInput({ message: "Send the weekly digest.", vaults: [anasSlug] }),
      true,
    );
    expect(updated.status?.vaultAttachers).toEqual({ [anasId]: ANA });
    expect(await fire("M")).toEqual({ M: "ana-mine" });
  });
});
