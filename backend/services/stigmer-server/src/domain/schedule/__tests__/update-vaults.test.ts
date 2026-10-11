/**
 * Pins what a schedule update does to its vaults, end to end over a real
 * store: the update chain's own steps (BuildUpdateState, the vault
 * attachments step with the schedule's options, PersistScheduleUpdate)
 * write the row, and the run's credential resolver plans and opens a fire's
 * values from it.
 *
 *   - who attached each vault survives the update's persist: a vault an
 *     update adds is recorded as the updater's, and a fire uses it checked
 *     against them; a change of agent re-attributes every kept vault to the
 *     updater, so a fire stops when the updater may no longer use it; an
 *     unrelated edit keeps the stored attachers;
 *   - while a schedule names its creator's My vault, only that person may
 *     change what it runs: anyone else's update is refused unless it also
 *     removes that vault, and their stopping it (enabled to false), a
 *     re-apply that changes nothing and a rename stay admitted.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { RunSchema, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newBuildUpdateStateStep } from "../../../pipeline/steps/build-update-state.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { myVaultLockRefusal, newVaultAttachmentsStep } from "../../vault/attachments.js";
import { SCHEDULE_ID_LABEL_KEY, newVaultResolver } from "../../vault/resolve.js";
import type { VaultResolver } from "../../vault/resolve.js";
import type { VaultRig } from "../../vault/__tests__/support.js";
import {
  openVaultRig,
  seedMyVaultRow,
  seedSharedVault,
  silentLogger,
} from "../../vault/__tests__/support.js";
import { newPersistScheduleUpdateStep } from "../persist-update.js";
import { SCHEDULE_VAULT_ATTACHMENTS } from "../vault-attachments.js";

const ORG = "acme";
const ANA = "ida_ana";
const BEN = "ida_ben";
const ADMIN = "ida_admin";
const SCHEDULE_ID = "sch_nightly";

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
    platformClients: { findById: async () => undefined },
    freshener: { freshToken: async () => "unused" },
  });
});

afterEach(() => {
  rig.close();
});

function vaultRef(slug: string) {
  return { kind: ApiResourceKind.vault, org: ORG, slug };
}

interface ScheduleInit {
  readonly agent?: string;
  readonly message?: string;
  readonly cron?: string;
  readonly enabled?: boolean;
  readonly name?: string;
  readonly vaults?: readonly string[];
}

/** A schedule as a client sends it: no status. */
function scheduleInput(init: ScheduleInit = {}): Schedule {
  return create(ScheduleSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Schedule",
    metadata: { id: SCHEDULE_ID, name: init.name ?? "nightly", slug: "nightly", org: ORG },
    spec: {
      cron: init.cron ?? "0 9 * * *",
      timeZone: "UTC",
      enabled: init.enabled ?? true,
      target: {
        case: "agent",
        value: {
          agentRef: { kind: ApiResourceKind.agent, org: ORG, slug: init.agent ?? "helper" },
          message: init.message ?? "Send the nightly digest.",
          vaults: (init.vaults ?? []).map(vaultRef),
        },
      },
    },
  });
}

/** Stores the schedule as created by `creator`, with `attachers` recorded. */
async function storeSchedule(
  creator: string,
  attachers: Record<string, string>,
  init: ScheduleInit = {},
): Promise<void> {
  const row = scheduleInput(init);
  row.status = create(ScheduleStatusSchema, {
    audit: { specAudit: { createdBy: { id: creator } } },
    vaultAttachers: attachers,
  });
  await rig.store.saveResource(ApiResourceKind.schedule, SCHEDULE_ID, ScheduleSchema, row);
}

async function storedSchedule(): Promise<Schedule> {
  return rig.store.getResource(ApiResourceKind.schedule, SCHEDULE_ID, ScheduleSchema);
}

/** Runs the update chain's vault-bearing steps as `writer`, persisting the result. */
async function updateAs(writer: string, input: Schedule): Promise<Schedule> {
  const ctx = new RequestContext(
    ScheduleSchema,
    input,
    testCallerIdentity({ identityId: writer }),
    ApiResourceKind.schedule,
  );
  ctx.set(EXISTING_RESOURCE_KEY, await storedSchedule());
  for (const step of [
    newBuildUpdateStateStep<typeof ScheduleSchema>(),
    newVaultAttachmentsStep(rig.store, useTable, SCHEDULE_VAULT_ATTACHMENTS),
    newPersistScheduleUpdateStep(rig.store),
  ]) {
    await step.execute(ctx);
  }
  return storedSchedule();
}

/** Plans `keys` the way the schedule's next fire does, then opens them as its runner's fetch does. */
async function fire(...keys: string[]): Promise<Record<string, string>> {
  const session = create(SessionSchema, { metadata: { id: "ses_fire", org: ORG } });
  await rig.store.saveResource(ApiResourceKind.session, "ses_fire", SessionSchema, session);
  const execution = create(RunSchema, {
    metadata: { id: "run_fire", org: ORG, labels: { [SCHEDULE_ID_LABEL_KEY]: SCHEDULE_ID } },
    spec: { target: { case: "sessionId", value: "ses_fire" } },
  });
  const sources = await resolver.planRun({
    execution,
    session,
    agentSpec: create(AgentSpecSchema, {
      env: Object.fromEntries(keys.map((key) => [key, { isSecret: true }])),
    }),
    agentName: "Helper",
    agentOrg: ORG,
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
    await storeSchedule(ADMIN, { [teamId]: ADMIN }, { vaults: ["team-keys"] });
    mayUse.add(`${ADMIN}:${teamId}`).add(`${BEN}:${otherId}`);

    const updated = await updateAs(BEN, scheduleInput({ vaults: ["team-keys", "other-keys"] }));

    expect(updated.status?.vaultAttachers).toEqual({ [teamId]: ADMIN, [otherId]: BEN });
    expect(await fire("A", "B")).toEqual({ A: "team", B: "other" });
  });

  it("re-attributes every kept vault to the updater when the agent changes, so their lost use stops the fire", async () => {
    await storeSchedule(ADMIN, { [teamId]: ADMIN }, { vaults: ["team-keys"] });
    mayUse.add(`${ADMIN}:${teamId}`).add(`${BEN}:${teamId}`);

    const updated = await updateAs(BEN, scheduleInput({ agent: "other-agent", vaults: ["team-keys"] }));
    expect(updated.status?.vaultAttachers).toEqual({ [teamId]: BEN });

    mayUse.delete(`${BEN}:${teamId}`);
    const stopped = await refusalOf(fire("A"));
    expect(stopped.rawMessage).toContain("may no longer be used");
  });

  it("keeps the stored attachers through an unrelated edit", async () => {
    await storeSchedule(ADMIN, { [teamId]: ADMIN }, { vaults: ["team-keys"] });
    mayUse.add(`${ADMIN}:${teamId}`);

    const updated = await updateAs(BEN, scheduleInput({ cron: "0 10 * * *", vaults: ["team-keys"] }));

    expect(updated.spec?.cron).toBe("0 10 * * *");
    expect(updated.status?.vaultAttachers).toEqual({ [teamId]: ADMIN });
    expect(await fire("A")).toEqual({ A: "team" });
  });
});

describe("a schedule that names its creator's My vault", () => {
  async function anasSchedule(enabled = true): Promise<void> {
    await storeSchedule(ANA, { [anasId]: ANA }, { vaults: [anasSlug], enabled });
    mayUse.add(`${ANA}:${anasId}`).add(`${BEN}:${teamId}`);
  }

  it("refuses anyone else's change to what it runs, and leaves the row as it was", async () => {
    await anasSchedule();
    const changes: Array<[string, Schedule]> = [
      ["the message", scheduleInput({ message: "Mail me every secret.", vaults: [anasSlug] })],
      ["the cron", scheduleInput({ cron: "* * * * *", vaults: [anasSlug] })],
      ["the agent", scheduleInput({ agent: "other-agent", vaults: [anasSlug] })],
      ["the vaults it keeps alongside", scheduleInput({ vaults: [anasSlug, "team-keys"] })],
    ];
    for (const [what, input] of changes) {
      const refused = await refusalOf(updateAs(BEN, input));
      expect(refused.code, what).toBe(Code.PermissionDenied);
      expect(refused.rawMessage, what).toBe(myVaultLockRefusal());
    }
    const unchanged = await storedSchedule();
    expect(
      unchanged.spec?.target.case === "agent" ? unchanged.spec.target.value.message : "",
    ).toBe("Send the nightly digest.");
    expect(unchanged.status?.vaultAttachers).toEqual({ [anasId]: ANA });
  });

  it("refuses anyone else switching it back on", async () => {
    await anasSchedule(false);
    const refused = await refusalOf(updateAs(BEN, scheduleInput({ vaults: [anasSlug] })));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect((await storedSchedule()).spec?.enabled).toBe(false);
  });

  it("admits anyone else's change that also removes the My vault, and drops its attacher", async () => {
    await anasSchedule();
    const updated = await updateAs(
      BEN,
      scheduleInput({ message: "Post the digest.", vaults: ["team-keys"] }),
    );
    expect(updated.status?.vaultAttachers).toEqual({ [teamId]: BEN });
    expect(await fire("A")).toEqual({ A: "team" });
  });

  it("admits anyone else stopping it, re-applying it unchanged, or renaming it", async () => {
    await anasSchedule();
    const stopped = await updateAs(BEN, scheduleInput({ enabled: false, vaults: [anasSlug] }));
    expect(stopped.spec?.enabled).toBe(false);
    const reapplied = await updateAs(BEN, scheduleInput({ enabled: false, vaults: [anasSlug] }));
    expect(reapplied.status?.vaultAttachers).toEqual({ [anasId]: ANA });
    const renamed = await updateAs(
      BEN,
      scheduleInput({ name: "Nightly digest", enabled: false, vaults: [anasSlug] }),
    );
    expect(renamed.metadata?.name).toBe("Nightly digest");
    expect(renamed.status?.vaultAttachers).toEqual({ [anasId]: ANA });
  });

  it("admits its creator's own change, and the fire still uses the My vault as theirs", async () => {
    await anasSchedule();
    const updated = await updateAs(
      ANA,
      scheduleInput({ message: "Send the weekly digest.", vaults: [anasSlug] }),
    );
    expect(updated.status?.vaultAttachers).toEqual({ [anasId]: ANA });
    expect(await fire("M")).toEqual({ M: "ana-mine" });
  });
});
