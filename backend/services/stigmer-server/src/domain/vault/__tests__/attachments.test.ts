/**
 * Pins the vault attachments step: a My vault is refused on every surface
 * that runs for someone else (a conversation, a share, a channel, a
 * platform client) and admitted on its owner's own schedule only;
 * who attached each vault is recorded for the vaults a write introduces
 * and kept for the ones it keeps, a removed vault's entry dropped, so an
 * editor's unrelated edit never re-attributes someone else's attachment;
 * and a schedule whose agent changes re-judges every vault it keeps
 * against the updater's permission to use it; and a schedule that keeps
 * its creator's My vault is locked to that person: anyone else's change to
 * what it runs is refused before any vault is re-judged, unless it removes
 * the vault (the platform's own internal writes excepted).
 */
import { clone, create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";

import { SCHEDULE_VAULT_ATTACHMENTS } from "../../schedule/vault-attachments.js";
import { myVaultLockRefusal, myVaultRefusal, newVaultAttachmentsStep } from "../attachments.js";
import type { VaultAttachmentOptions } from "../attachments.js";
import type { VaultRig } from "./support.js";
import { openVaultRig, seedMyVaultRow, seedSharedVault } from "./support.js";

const ORG = "acme";

let rig: VaultRig;
let teamId: string;
let anasId: string;

beforeEach(async () => {
  rig = openVaultRig();
  teamId = (await seedSharedVault(rig.store, ORG, "team-keys")).metadata!.id;
  await seedSharedVault(rig.store, ORG, "other-keys");
  anasId = (await seedMyVaultRow(rig.store, ORG, "ida_ana")).metadata!.id;
});

afterEach(() => {
  rig.close();
});

const allowAll: Authorizer = { authorize: async () => ({ kind: "allow" }) };

/** Allows can_use on every vault but `deniedId`, recording the questions. */
function useTable(deniedId: string, asked: string[]): Authorizer {
  return {
    authorize: async (caller, check) => {
      asked.push(`${caller.identityId}:${IamPermission[check.permission]}:${check.resourceId}`);
      return check.resourceId === deniedId
        ? { kind: "deny", reason: "may not use it" }
        : { kind: "allow" };
    },
  };
}

function ref(slug: string) {
  return { kind: ApiResourceKind.vault, org: ORG, slug };
}

const SESSION: VaultAttachmentOptions<typeof SessionSchema> = {
  surface: "a conversation",
  attachers: {
    get: (row) => row.status?.vaultAttachers,
    set: (row, attachers) => {
      (row.status ??= create(SessionStatusSchema)).vaultAttachers = attachers;
    },
  },
};

/** A surface whose recorded attachers the arm does not read. */
function unrecorded<Desc extends DescMessage>(surface: string): VaultAttachmentOptions<Desc> {
  return { surface, attachers: { get: () => undefined, set: () => undefined } };
}

const SCHEDULE: VaultAttachmentOptions<typeof ScheduleSchema> = {
  surface: "a schedule other than its owner's own",
  allowsOwnersMyVault: true,
  rejudgeAllWhen: (existing, next) => {
    const slugOf = (row: Schedule) =>
      row.spec?.target.case === "agent" ? row.spec.target.value.agentRef?.slug : "";
    return slugOf(existing) !== slugOf(next);
  },
  attachers: {
    get: (row) => row.status?.vaultAttachers,
    set: (row, attachers) => {
      (row.status ??= create(ScheduleStatusSchema)).vaultAttachers = attachers;
    },
  },
};

async function run<Desc extends DescMessage>(
  schema: Desc,
  kind: ApiResourceKind,
  next: MessageShape<Desc>,
  options: VaultAttachmentOptions<Desc>,
  opts: {
    writer: string;
    existing?: MessageShape<Desc>;
    authorizer?: Authorizer;
    internal?: boolean;
  },
): Promise<MessageShape<Desc>> {
  const ctx = new RequestContext(
    schema,
    next,
    testCallerIdentity({
      identityId: opts.writer,
      ...(opts.internal === true ? { callerClass: "internal" as const } : {}),
    }),
    kind,
  );
  if (opts.existing !== undefined) {
    ctx.set(EXISTING_RESOURCE_KEY, opts.existing);
  }
  await newVaultAttachmentsStep(rig.store, opts.authorizer ?? allowAll, options).execute(ctx);
  return ctx.newState;
}

function session(...slugs: string[]): Session {
  return create(SessionSchema, {
    metadata: { id: "ses_1", org: ORG },
    spec: { vaults: slugs.map(ref) },
  });
}

function schedule(agent: string, createdBy: string, ...slugs: string[]): Schedule {
  return create(ScheduleSchema, {
    metadata: { id: "sch_1", org: ORG },
    spec: {
      target: {
        case: "agent",
        value: { agentRef: { org: ORG, slug: agent }, vaults: slugs.map(ref) },
      },
    },
    status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
  });
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

describe("a My vault", () => {
  it("is refused on a conversation, a share, a channel and a platform client, even by its own person", async () => {
    const mine = ref((await rig.vaults.findById(anasId))!.metadata!.slug);
    const cases: Array<[string, Promise<unknown>]> = [
      [
        "a conversation",
        run(SessionSchema, ApiResourceKind.session, session(mine.slug), SESSION, { writer: "ida_ana" }),
      ],
      [
        "a share link",
        run(
          AgentShareSchema,
          ApiResourceKind.agent_share,
          create(AgentShareSchema, { metadata: { org: ORG }, spec: { vaults: [mine] } }),
          unrecorded("a share link"),
          { writer: "ida_ana" },
        ),
      ],
      [
        "a channel",
        run(
          AgentChannelSchema,
          ApiResourceKind.agent_channel,
          create(AgentChannelSchema, { metadata: { org: ORG }, spec: { vaults: [mine] } }),
          unrecorded("a channel"),
          { writer: "ida_ana" },
        ),
      ],
      [
        "a platform client",
        run(
          PlatformClientSchema,
          ApiResourceKind.platform_client,
          create(PlatformClientSchema, { metadata: { org: ORG }, spec: { vaults: [mine] } }),
          unrecorded("a platform client"),
          { writer: "ida_ana" },
        ),
      ],
    ];
    for (const [surface, attempt] of cases) {
      const failure = await refusalOf(attempt);
      expect(failure.code).toBe(Code.FailedPrecondition);
      expect(failure.rawMessage).toBe(myVaultRefusal(surface));
    }
  });

  it("is admitted on its owner's own schedule, and refused on someone else's or by someone else", async () => {
    const mine = (await rig.vaults.findById(anasId))!.metadata!.slug;
    const own = await run(
      ScheduleSchema,
      ApiResourceKind.schedule,
      schedule("helper", "ida_ana", mine),
      SCHEDULE,
      { writer: "ida_ana" },
    );
    expect(own.status?.vaultAttachers).toEqual({ [anasId]: "ida_ana" });

    const onBens = await refusalOf(
      run(
        ScheduleSchema,
        ApiResourceKind.schedule,
        schedule("helper", "ida_ben", mine),
        SCHEDULE,
        { writer: "ida_ana", existing: schedule("helper", "ida_ben") },
      ),
    );
    expect(onBens.code).toBe(Code.FailedPrecondition);

    const byBen = await refusalOf(
      run(
        ScheduleSchema,
        ApiResourceKind.schedule,
        schedule("helper", "ida_ben", mine),
        SCHEDULE,
        { writer: "ida_ben" },
      ),
    );
    expect(byBen.code).toBe(Code.FailedPrecondition);
  });
});

describe("who attached each vault", () => {
  it("records the writer for introduced vaults, keeps the stored attacher for kept ones, and drops removed ones", async () => {
    const created = await run(
      SessionSchema,
      ApiResourceKind.session,
      session("team-keys"),
      SESSION,
      { writer: "ida_admin" },
    );
    expect(created.status?.vaultAttachers).toEqual({ [teamId]: "ida_admin" });

    // A teammate's unrelated edit keeps the admin as the attacher and adds theirs.
    const edited = await run(
      SessionSchema,
      ApiResourceKind.session,
      session("team-keys", "other-keys"),
      SESSION,
      { writer: "ida_ben", existing: created },
    );
    const otherId = (await rig.vaults.findByReference(
      create(ApiResourceReferenceSchema, ref("other-keys")),
      ORG,
    ))!.metadata!.id;
    expect(edited.status?.vaultAttachers).toEqual({
      [teamId]: "ida_admin",
      [otherId]: "ida_ben",
    });

    const removed = await run(
      SessionSchema,
      ApiResourceKind.session,
      session("other-keys"),
      SESSION,
      { writer: "ida_ben", existing: edited },
    );
    expect(removed.status?.vaultAttachers).toEqual({ [otherId]: "ida_ben" });
  });
});

describe("a schedule whose agent changes", () => {
  it("re-judges every vault it keeps against the updater: admitted with use, refused without", async () => {
    const stored = await run(
      ScheduleSchema,
      ApiResourceKind.schedule,
      schedule("helper", "ida_admin", "team-keys"),
      SCHEDULE,
      { writer: "ida_admin" },
    );

    // Same agent, a cron-only edit by Ben: nothing is asked, the attacher stays.
    const asked: string[] = [];
    const cronEdit = await run(
      ScheduleSchema,
      ApiResourceKind.schedule,
      schedule("helper", "ida_admin", "team-keys"),
      SCHEDULE,
      { writer: "ida_ben", existing: stored, authorizer: useTable(teamId, asked) },
    );
    expect(asked).toEqual([]);
    expect(cronEdit.status?.vaultAttachers).toEqual({ [teamId]: "ida_admin" });

    // Ben points it at another agent without use of the vault: refused.
    const refused = await refusalOf(
      run(
        ScheduleSchema,
        ApiResourceKind.schedule,
        schedule("other-agent", "ida_admin", "team-keys"),
        SCHEDULE,
        { writer: "ida_ben", existing: stored, authorizer: useTable(teamId, asked) },
      ),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(asked).toEqual([`ida_ben:can_use:${teamId}`]);

    // With use, the change is admitted and Ben becomes the attacher.
    const moved = await run(
      ScheduleSchema,
      ApiResourceKind.schedule,
      schedule("other-agent", "ida_admin", "team-keys"),
      SCHEDULE,
      { writer: "ida_ben", existing: stored },
    );
    expect(moved.status?.vaultAttachers).toEqual({ [teamId]: "ida_ben" });
  });
});

describe("a schedule that keeps its creator's My vault", () => {
  async function anasSchedule(): Promise<Schedule> {
    const mine = (await rig.vaults.findById(anasId))!.metadata!.slug;
    return run(
      ScheduleSchema,
      ApiResourceKind.schedule,
      schedule("helper", "ida_ana", mine, "team-keys"),
      SCHEDULE_VAULT_ATTACHMENTS,
      { writer: "ida_ana" },
    );
  }

  function withAgent(row: Schedule, agent: string): Schedule {
    const next = clone(ScheduleSchema, row);
    if (next.spec?.target.case === "agent") {
      next.spec.target.value.agentRef = create(ApiResourceReferenceSchema, {
        kind: ApiResourceKind.agent,
        org: ORG,
        slug: agent,
      });
    }
    return next;
  }

  it("refuses anyone else's change with the lock, before any vault is re-judged", async () => {
    const stored = await anasSchedule();
    const asked: string[] = [];
    const refused = await refusalOf(
      run(ScheduleSchema, ApiResourceKind.schedule, withAgent(stored, "other-agent"), SCHEDULE_VAULT_ATTACHMENTS, {
        writer: "ida_admin",
        existing: stored,
        authorizer: useTable(teamId, asked),
      }),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(myVaultLockRefusal());
    expect(asked).toEqual([]);
  });

  it("does not lock the platform's own internal writes", async () => {
    const stored = await anasSchedule();
    const next = clone(ScheduleSchema, stored);
    next.spec!.cron = "0 10 * * *";
    const kept = await run(
      ScheduleSchema,
      ApiResourceKind.schedule,
      next,
      SCHEDULE_VAULT_ATTACHMENTS,
      { writer: "stigmer-system", existing: stored, internal: true },
    );
    expect(kept.status?.vaultAttachers).toEqual({ [anasId]: "ida_ana", [teamId]: "ida_ana" });
  });
});

describe("faults and deleted vaults", () => {
  it("keeps no attacher for a kept vault deleted since, and leaves its refusal to the run", async () => {
    const stored = await run(
      SessionSchema,
      ApiResourceKind.session,
      session("team-keys"),
      SESSION,
      { writer: "ida_admin" },
    );
    await rig.store.deleteResource(ApiResourceKind.vault, teamId);

    const kept = await run(
      SessionSchema,
      ApiResourceKind.session,
      session("team-keys"),
      SESSION,
      { writer: "ida_ben", existing: stored },
    );
    expect(kept.status?.vaultAttachers).toEqual({});
  });

  it("answers INTERNAL when the vaults cannot be read", async () => {
    const failing = new Proxy(rig.store, {
      get(target, prop, receiver) {
        if (prop === "listResources") {
          return async () => {
            throw new Error("disk gone");
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const ctx = new RequestContext(
      SessionSchema,
      session("team-keys"),
      testCallerIdentity({ identityId: "ida_admin" }),
      ApiResourceKind.session,
    );
    const error = await refusalOf(
      Promise.resolve(newVaultAttachmentsStep(failing, allowAll, SESSION).execute(ctx)),
    );
    expect(error.code).toBe(Code.Internal);
  });

  it("answers INTERNAL when re-judging a schedule's vault cannot be evaluated", async () => {
    const stored = await run(
      ScheduleSchema,
      ApiResourceKind.schedule,
      schedule("helper", "ida_admin", "team-keys"),
      SCHEDULE,
      { writer: "ida_admin" },
    );
    const unavailable: Authorizer = {
      authorize: async () => ({ kind: "unavailable", cause: new Error("fga down") }),
    };
    const error = await refusalOf(
      run(
        ScheduleSchema,
        ApiResourceKind.schedule,
        schedule("other-agent", "ida_admin", "team-keys"),
        SCHEDULE,
        { writer: "ida_ben", existing: stored, authorizer: unavailable },
      ),
    );
    expect(error.code).toBe(Code.Internal);
  });
});
