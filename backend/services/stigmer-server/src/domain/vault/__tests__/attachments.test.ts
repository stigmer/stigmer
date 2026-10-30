/**
 * Pins the vault attachments step: a My vault is refused on every surface
 * that runs for someone else (a conversation, a channel of any type, an
 * organization's embedding settings, which an Organization row carries
 * under its own id rather than metadata.org, an eval run, whose tries its plugin's viewers read)
 * and admitted on its owner's own schedule only;
 * who attached each vault is recorded for the vaults a write introduces
 * and kept for the ones it keeps, a removed vault's entry dropped, so an
 * editor's unrelated edit never re-attributes someone else's attachment;
 * a kept reference to a vault deleted and created again under the same
 * slug holding the old id, so the new vault is neither attached nor
 * attributed until a write names it again (stigmer#2038);
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

import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/status_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/status_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";

import { EMBEDDING_VAULT_ATTACHMENTS } from "../../organization/embedding.js";
import { EVAL_RUN_VAULT_ATTACHMENTS } from "../../eval-run/vault-attachments.js";
import { ROUTINE_VAULT_ATTACHMENTS } from "../../routine/vault-attachments.js";
import { resolveReferences } from "../../../pipeline/steps/references.js";
import { myVaultRefusal, newVaultAttachmentsStep } from "../attachments.js";
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

const SCHEDULE: VaultAttachmentOptions<typeof RoutineSchema> = {
  surface: "a schedule other than its owner's own",
  allowsOwnersMyVault: true,
  rejudgeAllWhen: (existing, next) => {
    const agentOf = (row: Routine) => {
      const ref = row.spec?.agent?.agentRef;
      return `${ref?.id ?? ""}/${ref?.slug ?? ""}`;
    };
    return agentOf(existing) !== agentOf(next);
  },
  attachers: {
    get: (row) => row.status?.vaultAttachers,
    set: (row, attachers) => {
      (row.status ??= create(RoutineStatusSchema)).vaultAttachers = attachers;
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
  // The chain's resolver runs first, and a stored row holds ids.
  await resolveReferences(rig.store, schema, ctx.newState, ORG);
  if (opts.existing !== undefined) {
    await resolveReferences(rig.store, schema, opts.existing, ORG);
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

function schedule(agent: string, createdBy: string, ...slugs: string[]): Routine {
  return create(RoutineSchema, {
    metadata: { id: "rtn_1", org: ORG },
    spec: {
      agent: { agentRef: { org: ORG, slug: agent }, vaults: slugs.map(ref) },
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
  it("is refused on a conversation, a web channel, a Slack channel and an organization's embedding settings, even by its own person", async () => {
    const mine = ref((await rig.vaults.findById(anasId))!.metadata!.slug);
    const cases: Array<[string, Promise<unknown>]> = [
      [
        "a conversation",
        run(SessionSchema, ApiResourceKind.session, session(mine.slug), SESSION, { writer: "ida_ana" }),
      ],
      [
        "a channel",
        run(
          ChannelSchema,
          ApiResourceKind.channel,
          create(ChannelSchema, {
            metadata: { org: ORG },
            spec: {
              vaults: [mine],
              type: { case: "web", value: { audience: ChannelAudience.public } },
            },
          }),
          unrecorded("a channel"),
          { writer: "ida_ana" },
        ),
      ],
      [
        "a channel",
        run(
          ChannelSchema,
          ApiResourceKind.channel,
          create(ChannelSchema, {
            metadata: { org: ORG },
            spec: { vaults: [mine], type: { case: "slack", value: {} } },
          }),
          unrecorded("a channel"),
          { writer: "ida_ana" },
        ),
      ],
      [
        "an organization's embedding settings",
        run(
          OrganizationSchema,
          ApiResourceKind.organization,
          create(OrganizationSchema, { metadata: { id: ORG }, spec: { embedding: { vaults: [mine] } } }),
          EMBEDDING_VAULT_ATTACHMENTS,
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

  it("is refused on an eval run, even its creator's own, since every viewer of the plugin reads its tries", async () => {
    const mine = ref((await rig.vaults.findById(anasId))!.metadata!.slug);
    const failure = await refusalOf(
      run(
        EvalRunSchema,
        ApiResourceKind.eval_run,
        create(EvalRunSchema, {
          metadata: { id: "evr_1", org: ORG },
          spec: { vaults: [mine] },
          status: { audit: { specAudit: { createdBy: { id: "ida_ana" } } } },
        }),
        EVAL_RUN_VAULT_ATTACHMENTS,
        { writer: "ida_ana" },
      ),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toBe(
      "a My vault cannot be attached to an eval run, whose tries every viewer of its agent or plugin can read: " +
        "it serves only its own person's runs. Attach a shared vault that holds what is needed instead",
    );
  });

  it("is admitted on its owner's own schedule, and refused on someone else's or by someone else", async () => {
    const mine = (await rig.vaults.findById(anasId))!.metadata!.slug;
    const own = await run(
      RoutineSchema,
      ApiResourceKind.routine,
      schedule("helper", "ida_ana", mine),
      SCHEDULE,
      { writer: "ida_ana" },
    );
    expect(own.status?.vaultAttachers).toEqual({ [anasId]: "ida_ana" });

    const onBens = await refusalOf(
      run(
        RoutineSchema,
        ApiResourceKind.routine,
        schedule("helper", "ida_ben", mine),
        SCHEDULE,
        { writer: "ida_ana", existing: schedule("helper", "ida_ben") },
      ),
    );
    expect(onBens.code).toBe(Code.FailedPrecondition);

    const byBen = await refusalOf(
      run(
        RoutineSchema,
        ApiResourceKind.routine,
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
      RoutineSchema,
      ApiResourceKind.routine,
      schedule("helper", "ida_admin", "team-keys"),
      SCHEDULE,
      { writer: "ida_admin" },
    );

    // Same agent, a cron-only edit by Ben: nothing is asked, the attacher stays.
    const asked: string[] = [];
    const cronEdit = await run(
      RoutineSchema,
      ApiResourceKind.routine,
      schedule("helper", "ida_admin", "team-keys"),
      SCHEDULE,
      { writer: "ida_ben", existing: stored, authorizer: useTable(teamId, asked) },
    );
    expect(asked).toEqual([]);
    expect(cronEdit.status?.vaultAttachers).toEqual({ [teamId]: "ida_admin" });

    // Ben points it at another agent without use of the vault: refused.
    const refused = await refusalOf(
      run(
        RoutineSchema,
        ApiResourceKind.routine,
        schedule("other-agent", "ida_admin", "team-keys"),
        SCHEDULE,
        { writer: "ida_ben", existing: stored, authorizer: useTable(teamId, asked) },
      ),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(asked).toEqual([`ida_ben:can_use:${teamId}`]);

    // With use, the change is admitted and Ben becomes the attacher.
    const moved = await run(
      RoutineSchema,
      ApiResourceKind.routine,
      schedule("other-agent", "ida_admin", "team-keys"),
      SCHEDULE,
      { writer: "ida_ben", existing: stored },
    );
    expect(moved.status?.vaultAttachers).toEqual({ [teamId]: "ida_ben" });
  });
});

describe("a routine that keeps its creator's My vault", () => {
  async function anasRoutine(): Promise<Routine> {
    const mine = (await rig.vaults.findById(anasId))!.metadata!.slug;
    return run(
      RoutineSchema,
      ApiResourceKind.routine,
      schedule("helper", "ida_ana", mine, "team-keys"),
      ROUTINE_VAULT_ATTACHMENTS,
      { writer: "ida_ana" },
    );
  }

  function withAgent(row: Routine, agent: string): Routine {
    const next = clone(RoutineSchema, row);
    if (next.spec?.agent !== undefined) {
      next.spec.agent.agentRef = create(ApiResourceReferenceSchema, {
        kind: ApiResourceKind.agent,
        org: ORG,
        slug: agent,
      });
    }
    return next;
  }

  it("keeps every attacher through the platform's own internal write", async () => {
    const stored = await anasRoutine();
    const next = clone(RoutineSchema, stored);
    next.spec!.cron = "0 10 * * *";
    const kept = await run(
      RoutineSchema,
      ApiResourceKind.routine,
      next,
      ROUTINE_VAULT_ATTACHMENTS,
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

  it("a kept reference to a vault deleted and created again under its slug loads nothing, and naming the slug again records the writer (stigmer#2038)", async () => {
    const stored = await run(
      SessionSchema,
      ApiResourceKind.session,
      session("team-keys"),
      SESSION,
      { writer: "ida_admin" },
    );
    const again = clone(VaultSchema, (await rig.vaults.findById(teamId))!);
    await rig.store.deleteResource(ApiResourceKind.vault, teamId);
    again.metadata!.id = "vlt_acme_team_keys_again";
    await rig.store.saveResource(ApiResourceKind.vault, again.metadata!.id, VaultSchema, again);

    // The stored reference holds the deleted vault's id, never its slug,
    // so the new vault is not attached and inherits no attacher.
    const kept = await run(
      SessionSchema,
      ApiResourceKind.session,
      clone(SessionSchema, stored),
      SESSION,
      { writer: "ida_ben", existing: stored },
    );
    expect(kept.spec?.vaults.map((held) => held.id)).toEqual([teamId]);
    expect(kept.status?.vaultAttachers).toEqual({});

    const renamed = await run(
      SessionSchema,
      ApiResourceKind.session,
      session("team-keys"),
      SESSION,
      { writer: "ida_ben", existing: stored },
    );
    expect(renamed.spec?.vaults.map((held) => held.id)).toEqual([again.metadata!.id]);
    expect(renamed.status?.vaultAttachers).toEqual({ [again.metadata!.id]: "ida_ben" });
  });

  it("answers INTERNAL when the vaults cannot be read", async () => {
    const failing = new Proxy(rig.store, {
      get(target, prop, receiver) {
        if (prop === "getResource") {
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
    await resolveReferences(rig.store, SessionSchema, ctx.newState, ORG);
    const error = await refusalOf(
      Promise.resolve(newVaultAttachmentsStep(failing, allowAll, SESSION).execute(ctx)),
    );
    expect(error.code).toBe(Code.Internal);
  });

  it("answers INTERNAL when re-judging a schedule's vault cannot be evaluated", async () => {
    const stored = await run(
      RoutineSchema,
      ApiResourceKind.routine,
      schedule("helper", "ida_admin", "team-keys"),
      SCHEDULE,
      { writer: "ida_admin" },
    );
    const unavailable: Authorizer = {
      authorize: async () => ({ kind: "unavailable", cause: new Error("fga down") }),
    };
    const error = await refusalOf(
      run(
        RoutineSchema,
        ApiResourceKind.routine,
        schedule("other-agent", "ida_admin", "team-keys"),
        SCHEDULE,
        { writer: "ida_ben", existing: stored, authorizer: unavailable },
      ),
    );
    expect(error.code).toBe(Code.Internal);
  });
});
