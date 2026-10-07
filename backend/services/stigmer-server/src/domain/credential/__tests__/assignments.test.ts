/**
 * Pins GuardCredentialAssignments (assignments.ts), the write rule for the
 * credentials a schedule, a share link, a channel and a platform client
 * assign to the runs they start, at the step over a real sqlite store and a
 * recording fake Authorizer — the composed suites run as one caller and
 * cannot be the two people the rule separates.
 *
 * What it pins:
 *   - an assignment a write INTRODUCES is the caller's: the writer is
 *     stamped from the caller (a value the client sent is discarded) and
 *     the caller must hold can_use on its credential, or the write is
 *     refused PERMISSION_DENIED;
 *   - an assignment a write KEEPS keeps the stored writer and is not
 *     re-judged;
 *   - a change of what consumes the assignments (the agent a surface
 *     starts) re-judges every one against the caller and re-stamps it;
 *   - a person's own credential is refused on a share link, a channel and
 *     a platform client, whose runs belong to nobody; on a schedule it is
 *     admitted only on a schedule its owner created, written by that owner;
 *     an edit that keeps another person's personal assignment is refused;
 *   - the server acting as itself writes the writer "" and asks nothing;
 *   - an assignment with no source is keyed by its requirement alone; a
 *     credential read or a can_use the Authorizer cannot answer is
 *     Internal, never a pass or a denial.
 *
 * The surfaces here mirror the four controllers' (the noun, whether a
 * person's own credential may be assigned, where the assignments live and
 * what consumes them); each controller's chain is pinned through the wire
 * in its own domain suite.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialAssignmentSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import type { CredentialAssignment } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type {
  AuthzCheck,
  AuthzDecision,
  Authorizer,
} from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newGuardCredentialAssignmentsStep } from "../assignments.js";
import type { AssignmentSurface } from "../assignments.js";

const ORG = "org_assignments";
const ALICE = "acct_alice";
const BOB = "acct_bob";

/** Credential ids and slugs, by role. */
const ALICE_KEY = { id: "cred_alicekey", slug: "alice-key-0a1b2c3d" };
const BOB_KEY = { id: "cred_bobkey", slug: "bob-key-0a1b2c3d" };
const ORG_KEY = { id: "cred_orgkey", slug: "org-key-0a1b2c3d" };

// ---------------------------------------------------------------------------
// The surfaces, as the controllers declare them.
// ---------------------------------------------------------------------------

const SCHEDULE: AssignmentSurface<MessageShape<typeof ScheduleSchema>> = {
  noun: "schedule",
  personsOwn: true,
  assignmentsOf: (row) =>
    row.spec?.target.case === "agent" ? row.spec.target.value.credentials : [],
  consumerOf: (row) => {
    const ref =
      row.spec?.target.case === "agent"
        ? row.spec.target.value.agentRef
        : undefined;
    return `${ref?.org ?? ""}/${ref?.slug ?? ""}`;
  },
};

const SHARE: AssignmentSurface<MessageShape<typeof AgentShareSchema>> = {
  noun: "share link",
  personsOwn: false,
  assignmentsOf: (row) => row.spec?.credentials ?? [],
  consumerOf: (row) =>
    `${row.spec?.agentRef?.org ?? ""}/${row.spec?.agentRef?.slug ?? ""}`,
};

const CHANNEL: AssignmentSurface<MessageShape<typeof AgentChannelSchema>> = {
  noun: "channel",
  personsOwn: false,
  assignmentsOf: (row) => row.spec?.credentials ?? [],
  consumerOf: (row) =>
    `${row.spec?.agentRef?.org ?? ""}/${row.spec?.agentRef?.slug ?? ""}`,
};

const PLATFORM_CLIENT: AssignmentSurface<
  MessageShape<typeof PlatformClientSchema>
> = {
  noun: "platform client",
  personsOwn: false,
  assignmentsOf: (row) => row.spec?.credentials ?? [],
  consumerOf: () => "",
};

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

/** An Authorizer that grants can_use on the pairs it is given, allows every other check, and records them. */
class RecordingAuthorizer implements Authorizer {
  readonly checks: Array<{ caller: string; check: AuthzCheck }> = [];
  private readonly usable = new Set<string>();

  grantUse(identityId: string, credentialId: string): void {
    this.usable.add(`${identityId}|${credentialId}`);
  }

  authorize(caller: CallerIdentity, check: AuthzCheck): Promise<AuthzDecision> {
    this.checks.push({ caller: caller.identityId, check });
    if (check.permission !== IamPermission.can_use) {
      return Promise.resolve({ kind: "allow" });
    }
    return Promise.resolve(
      this.usable.has(`${caller.identityId}|${check.resourceId}`)
        ? { kind: "allow" }
        : { kind: "deny", reason: "no can_use" },
    );
  }

  /** The credential ids can_use was asked about, in order. */
  useChecks(): string[] {
    return this.checks
      .filter((c) => c.check.permission === IamPermission.can_use)
      .map((c) => c.check.resourceId);
  }
}

function personCredential(key: { id: string; slug: string }, person: string) {
  return create(CredentialSchema, {
    metadata: { id: key.id, name: key.slug, slug: key.slug, org: ORG },
    spec: { owner: { case: "person", value: person } },
  });
}

function orgCredential(key: { id: string; slug: string }) {
  return create(CredentialSchema, {
    metadata: { id: key.id, name: key.slug, slug: key.slug, org: ORG },
    spec: { owner: { case: "org", value: ORG } },
  });
}

/** An assignment of `credential`'s field to agent `agent`'s OPENAI_API_KEY, carrying a client-sent writer. */
function assigned(
  credential: { slug: string },
  writer = "forged-by-the-client",
  agent = "agent-a",
): CredentialAssignment {
  return create(CredentialAssignmentSchema, {
    requirement: {
      declarer: {
        target: {
          case: "agent",
          value: { org: ORG, slug: agent, kind: ApiResourceKind.agent },
        },
      },
      key: "OPENAI_API_KEY",
    },
    source: {
      case: "credential",
      value: {
        credential: {
          org: ORG,
          slug: credential.slug,
          kind: ApiResourceKind.credential,
        },
        field: "",
      },
    },
    writer,
  });
}

function literal(
  value: string,
  writer = "forged-by-the-client",
): CredentialAssignment {
  return create(CredentialAssignmentSchema, {
    requirement: {
      declarer: { target: { case: "gitHost", value: "github.com" } },
      key: "GIT_AUTHOR_NAME",
    },
    source: { case: "literal", value },
    writer,
  });
}

const audit = (createdBy: string) => ({
  audit: { specAudit: { createdBy: { id: createdBy } } },
});

function scheduleRow(
  assignments: CredentialAssignment[],
  options: { agent?: string; createdBy?: string } = {},
) {
  return create(ScheduleSchema, {
    metadata: { id: "sch_one", name: "Nightly", slug: "nightly", org: ORG },
    spec: {
      target: {
        case: "agent",
        value: {
          agentRef: {
            org: ORG,
            slug: options.agent ?? "agent-a",
            kind: ApiResourceKind.agent,
          },
          credentials: assignments,
        },
      },
    },
    ...(options.createdBy === undefined
      ? {}
      : { status: audit(options.createdBy) }),
  });
}

function shareRow(
  assignments: CredentialAssignment[],
  options: { agent?: string; createdBy?: string } = {},
) {
  return create(AgentShareSchema, {
    metadata: { id: "shr_one", name: "Public", slug: "public", org: ORG },
    spec: {
      agentRef: {
        org: ORG,
        slug: options.agent ?? "agent-a",
        kind: ApiResourceKind.agent,
      },
      credentials: assignments,
    },
    ...(options.createdBy === undefined
      ? {}
      : { status: audit(options.createdBy) }),
  });
}

function channelRow(assignments: CredentialAssignment[]) {
  return create(AgentChannelSchema, {
    metadata: { id: "chn_one", name: "Support", slug: "support", org: ORG },
    spec: {
      agentRef: { org: ORG, slug: "agent-a", kind: ApiResourceKind.agent },
      credentials: assignments,
    },
  });
}

function platformClientRow(assignments: CredentialAssignment[]) {
  return create(PlatformClientSchema, {
    metadata: { id: "pcl_one", name: "Embed", slug: "embed", org: ORG },
    spec: { credentials: assignments },
  });
}

const person = (identityId: string): CallerIdentity =>
  testCallerIdentity({ identityId });
const INTERNAL: CallerIdentity = testCallerIdentity({
  identityId: "",
  callerClass: "internal",
});

let ts: TempStore;
let authorizer: RecordingAuthorizer;

beforeAll(async () => {
  ts = tempStore();
  await ts.store.saveResource(
    ApiResourceKind.credential,
    ALICE_KEY.id,
    CredentialSchema,
    personCredential(ALICE_KEY, ALICE),
  );
  await ts.store.saveResource(
    ApiResourceKind.credential,
    BOB_KEY.id,
    CredentialSchema,
    personCredential(BOB_KEY, BOB),
  );
  await ts.store.saveResource(
    ApiResourceKind.credential,
    ORG_KEY.id,
    CredentialSchema,
    orgCredential(ORG_KEY),
  );
});

afterAll(async () => {
  await ts.cleanup();
});

beforeEach(() => {
  authorizer = new RecordingAuthorizer();
  authorizer.grantUse(ALICE, ALICE_KEY.id);
  authorizer.grantUse(BOB, BOB_KEY.id);
  authorizer.grantUse(ALICE, ORG_KEY.id);
});

/** Runs the step on `row` (with `existing` as the stored row, if any) as `caller`; returns the row it stamped. */
async function guard<Desc extends DescMessage>(
  schema: Desc,
  surface: AssignmentSurface<MessageShape<Desc>>,
  caller: CallerIdentity,
  row: MessageShape<Desc>,
  existing?: MessageShape<Desc>,
): Promise<MessageShape<Desc>> {
  const ctx = new RequestContext(schema, row, caller);
  if (existing !== undefined) {
    ctx.set(EXISTING_RESOURCE_KEY, existing);
  }
  await newGuardCredentialAssignmentsStep<Desc>(
    ts.store,
    authorizer,
    surface,
  ).execute(ctx);
  return ctx.newState;
}

async function refusal(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the guard to refuse");
}

const writersOf = (assignments: ReadonlyArray<CredentialAssignment>) =>
  assignments.map((a) => a.writer);

// ---------------------------------------------------------------------------
// The rule.
// ---------------------------------------------------------------------------

describe("an assignment the write introduces", () => {
  it("is stamped with the caller as writer, the client's value discarded, after can_use is asked", async () => {
    const row = await guard(
      AgentShareSchema,
      SHARE,
      person(ALICE),
      shareRow([assigned(ORG_KEY)]),
    );
    expect(writersOf(row.spec?.credentials ?? [])).toEqual([ALICE]);
    expect(authorizer.useChecks()).toEqual([ORG_KEY.id]);
    expect(authorizer.checks[0]?.caller).toBe(ALICE);
  });

  it("is refused PERMISSION_DENIED when the caller may not use the credential", async () => {
    const error = await refusal(() =>
      guard(
        AgentShareSchema,
        SHARE,
        person(BOB),
        shareRow([assigned(ORG_KEY)]),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(
      `credential '${ORG_KEY.slug}' is not one you may use, so you cannot assign it on a share link; assign a credential of your own or one the organization lets you use`,
    );
    expect(authorizer.useChecks()).toEqual([ORG_KEY.id]);
  });

  it("stamps a literal's writer without a can_use question: it names no credential", async () => {
    const row = await guard(
      AgentShareSchema,
      SHARE,
      person(BOB),
      shareRow([literal("Ada")]),
    );
    expect(writersOf(row.spec?.credentials ?? [])).toEqual([BOB]);
    expect(authorizer.useChecks()).toEqual([]);
  });
});

describe("an assignment the write keeps", () => {
  it("keeps the stored writer and is not re-judged, whoever edits", async () => {
    const existing = shareRow([assigned(ORG_KEY, ALICE)], { createdBy: ALICE });
    // Bob holds no can_use on the organization's key; the kept assignment is not his to judge.
    const row = await guard(
      AgentShareSchema,
      SHARE,
      person(BOB),
      shareRow([assigned(ORG_KEY, "forged-by-the-client")]),
      existing,
    );
    expect(writersOf(row.spec?.credentials ?? [])).toEqual([ALICE]);
    expect(authorizer.useChecks()).toEqual([]);
  });

  it("judges only the assignment the edit adds beside the kept one", async () => {
    const existing = shareRow([assigned(ORG_KEY, ALICE)], { createdBy: ALICE });
    const row = await guard(
      AgentShareSchema,
      SHARE,
      person(BOB),
      shareRow([assigned(ORG_KEY), literal("Grace")]),
      existing,
    );
    expect(writersOf(row.spec?.credentials ?? [])).toEqual([ALICE, BOB]);
    expect(authorizer.useChecks()).toEqual([]);
  });
});

describe("a change of what consumes the assignments", () => {
  it("re-judges every kept assignment against the caller and re-stamps it", async () => {
    const existing = shareRow([assigned(ORG_KEY, BOB)], {
      agent: "agent-a",
      createdBy: BOB,
    });
    const row = await guard(
      AgentShareSchema,
      SHARE,
      person(ALICE),
      shareRow([assigned(ORG_KEY, BOB)], { agent: "agent-b" }),
      existing,
    );
    expect(writersOf(row.spec?.credentials ?? [])).toEqual([ALICE]);
    expect(authorizer.useChecks()).toEqual([ORG_KEY.id]);
  });

  it("refuses the caller who may not use a credential the new agent would receive", async () => {
    const existing = shareRow([assigned(ORG_KEY, ALICE)], {
      agent: "agent-a",
      createdBy: ALICE,
    });
    const error = await refusal(() =>
      guard(
        AgentShareSchema,
        SHARE,
        person(BOB),
        shareRow([assigned(ORG_KEY, ALICE)], { agent: "agent-b" }),
        existing,
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(authorizer.useChecks()).toEqual([ORG_KEY.id]);
  });
});

describe("a person's own credential", () => {
  const unattended = [
    [
      "share link",
      () =>
        guard(
          AgentShareSchema,
          SHARE,
          person(ALICE),
          shareRow([assigned(ALICE_KEY)]),
        ),
    ],
    [
      "channel",
      () =>
        guard(
          AgentChannelSchema,
          CHANNEL,
          person(ALICE),
          channelRow([assigned(ALICE_KEY)]),
        ),
    ],
    [
      "platform client",
      () =>
        guard(
          PlatformClientSchema,
          PLATFORM_CLIENT,
          person(ALICE),
          platformClientRow([assigned(ALICE_KEY)]),
        ),
    ],
  ] as const;

  it.each(unattended)(
    "is refused on a %s, even by its owner",
    async (noun, run) => {
      const error = await refusal(run);
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toBe(
        `credential '${ALICE_KEY.slug}' is a person's own and cannot be assigned on a ${noun}: its runs have no person behind them. Assign one of the organization's credentials instead`,
      );
    },
  );

  it("is refused on a share link even for the server acting as itself", async () => {
    const error = await refusal(() =>
      guard(AgentShareSchema, SHARE, INTERNAL, shareRow([assigned(ALICE_KEY)])),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
  });

  it("is admitted on a schedule its owner creates, written by that owner", async () => {
    const row = await guard(
      ScheduleSchema,
      SCHEDULE,
      person(ALICE),
      scheduleRow([assigned(ALICE_KEY)]),
    );
    expect(writersOf(SCHEDULE.assignmentsOf(row))).toEqual([ALICE]);
    expect(authorizer.useChecks()).toEqual([ALICE_KEY.id]);
  });

  it("is refused on a schedule another person creates", async () => {
    const error = await refusal(() =>
      guard(
        ScheduleSchema,
        SCHEDULE,
        person(BOB),
        scheduleRow([assigned(ALICE_KEY)]),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      `credential '${ALICE_KEY.slug}' is a person's own and can be assigned only on a schedule that person created`,
    );
  });

  it("is refused when its owner adds it to a schedule someone else created", async () => {
    const existing = scheduleRow([], { createdBy: BOB });
    const error = await refusal(() =>
      guard(
        ScheduleSchema,
        SCHEDULE,
        person(ALICE),
        scheduleRow([assigned(ALICE_KEY)]),
        existing,
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      `credential '${ALICE_KEY.slug}' is a person's own and can be assigned only on a schedule that person created`,
    );
  });

  it("refuses an edit by another person that keeps it — only its owner edits that schedule", async () => {
    const existing = scheduleRow([assigned(ALICE_KEY, ALICE)], {
      createdBy: ALICE,
    });
    const error = await refusal(() =>
      guard(
        ScheduleSchema,
        SCHEDULE,
        person(BOB),
        scheduleRow([assigned(ALICE_KEY, ALICE)]),
        existing,
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(
      `this schedule keeps an assignment of credential '${ALICE_KEY.slug}', which belongs to another person; only that person may edit a schedule that uses their credential, or remove the assignment`,
    );
  });

  it("admits its owner's edit that keeps it, with the stored writer", async () => {
    const existing = scheduleRow([assigned(ALICE_KEY, ALICE)], {
      createdBy: ALICE,
    });
    const row = await guard(
      ScheduleSchema,
      SCHEDULE,
      person(ALICE),
      scheduleRow([
        assigned(ALICE_KEY, "forged-by-the-client"),
        literal("Ada"),
      ]),
      existing,
    );
    expect(writersOf(SCHEDULE.assignmentsOf(row))).toEqual([ALICE, ALICE]);
    expect(authorizer.useChecks()).toEqual([]);
  });

  it("admits another person's edit that drops it", async () => {
    const existing = scheduleRow([assigned(ALICE_KEY, ALICE)], {
      createdBy: ALICE,
    });
    const row = await guard(
      ScheduleSchema,
      SCHEDULE,
      person(BOB),
      scheduleRow([]),
      existing,
    );
    expect(SCHEDULE.assignmentsOf(row)).toEqual([]);
  });
});

describe("the server acting as itself", () => {
  it('writes the writer "" and asks nothing', async () => {
    const row = await guard(
      AgentShareSchema,
      SHARE,
      INTERNAL,
      shareRow([assigned(ORG_KEY), literal("Ada")]),
    );
    expect(writersOf(row.spec?.credentials ?? [])).toEqual(["", ""]);
    expect(authorizer.checks).toEqual([]);
  });

  it('re-stamps "" on a consumer change, without asking', async () => {
    const existing = shareRow([assigned(ORG_KEY, ALICE)], {
      agent: "agent-a",
      createdBy: ALICE,
    });
    const row = await guard(
      AgentShareSchema,
      SHARE,
      INTERNAL,
      shareRow([assigned(ORG_KEY, ALICE)], { agent: "agent-b" }),
      existing,
    );
    expect(writersOf(row.spec?.credentials ?? [])).toEqual([""]);
    expect(authorizer.checks).toEqual([]);
  });
});

describe("an assignment with no source, and the faults", () => {
  function unsourced(writer = "forged-by-the-client"): CredentialAssignment {
    return create(CredentialAssignmentSchema, {
      requirement: {
        declarer: { target: { case: "gitHost", value: "github.com" } },
        key: "GITHUB_TOKEN",
      },
      writer,
    });
  }

  it("an assignment with no source is stamped and asks nothing; an edit keeps it by its requirement", async () => {
    const created = await guard(
      AgentShareSchema,
      SHARE,
      person(ALICE),
      shareRow([unsourced()]),
    );
    expect(writersOf(created.spec?.credentials ?? [])).toEqual([ALICE]);

    const edited = await guard(
      AgentShareSchema,
      SHARE,
      person(BOB),
      shareRow([unsourced()]),
      shareRow([unsourced(ALICE)], { createdBy: ALICE }),
    );
    expect(writersOf(edited.spec?.credentials ?? [])).toEqual([ALICE]);
    expect(authorizer.useChecks()).toEqual([]);
  });

  /** Runs the step on a new share as Alice over `store` and `deciding`. */
  async function guardWith(
    store: typeof ts.store,
    deciding: Authorizer,
  ): Promise<ConnectError> {
    const ctx = new RequestContext(
      AgentShareSchema,
      shareRow([assigned(ORG_KEY)]),
      person(ALICE),
    );
    return refusal(async () => {
      await newGuardCredentialAssignmentsStep(store, deciding, SHARE).execute(
        ctx,
      );
    });
  }

  it("credentials that cannot be read are Internal, never an assignment let through", async () => {
    const faulty = {
      queryResources: () => Promise.reject(new Error("SQLITE_BUSY")),
    } as unknown as typeof ts.store;

    const error = await guardWith(faulty, authorizer);

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(
      "failed to read the organization's credentials",
    );
  });

  it("a can_use the Authorizer cannot answer is Internal, never a denial", async () => {
    const failing: Authorizer = {
      authorize: () => Promise.reject(new Error("fga down")),
    };

    const error = await guardWith(ts.store, failing);

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to authorize an assigned credential");
  });
});
