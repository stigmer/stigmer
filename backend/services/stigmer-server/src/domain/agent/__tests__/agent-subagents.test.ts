/**
 * Pins an agent's subagents (../subagents.ts): the saved agents it lists in
 * spec.subagents, checked and pinned when it is saved, and the delete
 * guard that keeps a listed agent (pipeline/steps/guard-unlisted.ts).
 *
 * Through the REAL stack (a composed server on an ephemeral port, a native
 * gRPC client, the full interceptor chain):
 *   - pinning: a reference without a version, and one naming `latest`,
 *     are pinned to the listed agent's head hash; a tag to the hash it
 *     names; a 64-hex hash of an older version is kept; what is stored and
 *     read back is the pin;
 *   - refusals: a version the agent does not hold (FAILED_PRECONDITION,
 *     the sentence), a head with no hash, the agent listing itself and a
 *     slug listed twice, from one organization or two, since a turn names
 *     a subagent by its slug (INVALID_ARGUMENT, on create and on update), and
 *     a subagent whose pinned version lists subagents of its own, while an
 *     older version of the same agent without them may be pinned;
 *   - the floor: an organization-visible parent may not list a private
 *     agent (the reference rule's floor, reached through the field);
 *   - the version hash covers the pins: re-saving the stored spec keeps the
 *     parent's version, re-pinning to a newer subagent version moves it;
 *   - delete: an agent listed by another agent of its organization is
 *     refused naming the lister, and deletes once it is no longer listed.
 * Through the two steps on the composed server's store, with a recording
 * Authorizer (the writer clause, which the composed server's permissive
 * Authorizer always admits):
 *   - a member adding an agent they may not run is PERMISSION_DENIED,
 *     naming it, and the check asked is can_execute on that agent;
 *   - an edit that keeps a reference someone else added passes, asking only
 *     about what it introduces; the server acting as itself is exempt;
 *   - an Authorizer that no longer finds the agent answers the missing
 *     copy, and one that is down is INTERNAL.
 * Through the two steps' own faults: a reference with no slug is passed
 * over; a state with no metadata, PinSubagents run without
 * ValidateReferences' targets, and a store fault reading a subagent are
 * INTERNAL; a subagent deleted between the two steps answers the
 * reference rule's missing copy.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  UNLISTED_AGENT,
  stillListedMessage,
} from "../../../pipeline/steps/guard-unlisted.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import {
  missingReferencesMessage,
  newValidateReferencesStep,
  referenceTargetKind,
} from "../../../pipeline/steps/references.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";
import {
  listedTwiceMessage,
  nestedSubagentMessage,
  newPinSubagentsStep,
  newValidateSubagentListStep,
  selfListedMessage,
  subagentNotRunnableMessage,
  subagentUnversionedMessage,
  subagentVersionNotFoundMessage,
} from "../subagents.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";
let ORG_ID: string;

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof AgentCommandController>;
let query: Client<typeof AgentQueryController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "agent-subagents-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: a deterministically closed port.
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  ORG_ID = organizationId(await seedOrganizations(transport, [ORG]), ORG);
  command = createClient(AgentCommandController, transport);
  query = createClient(AgentQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
/** A unique slug-shaped name: the agent's slug is its name. */
function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

interface Listed {
  readonly slug: string;
  readonly version?: string;
  /** Empty (the default) files it under the agent's own organization. */
  readonly org?: string;
}

function agentInput(
  name: string,
  opts: {
    readonly instructions?: string;
    readonly subagents?: readonly Listed[];
    readonly visibility?: ApiResourceVisibility;
    readonly tag?: string;
  } = {},
) {
  return {
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: {
      name,
      org: ORG,
      visibility:
        opts.visibility ?? ApiResourceVisibility.api_resource_visibility_unspecified,
      ...(opts.tag === undefined ? {} : { version: { tag: opts.tag } }),
    },
    spec: {
      instructions: opts.instructions ?? `Agent instructions for ${name}.`,
      // org stays empty so NormalizeReferences files it under the agent's own.
      subagents: (opts.subagents ?? []).map((listed) => ({
        kind: ApiResourceKind.agent,
        org: listed.org ?? "",
        slug: listed.slug,
        version: listed.version ?? "",
      })),
    },
  };
}

/** A copy of a saved agent to update, listing `slugs` without a version. */
function listing(agent: Agent, slugs: readonly string[]): Agent {
  const next = clone(AgentSchema, agent);
  next.spec!.subagents = slugs.map((slug) =>
    create(ApiResourceReferenceSchema, { kind: ApiResourceKind.agent, slug }),
  );
  return next;
}

/** A copy of a saved agent to update, with new instructions and no version tag. */
function instructed(agent: Agent, instructions: string): Agent {
  const next = clone(AgentSchema, agent);
  next.spec!.instructions = instructions;
  if (next.metadata !== undefined) {
    next.metadata.version = undefined;
  }
  return next;
}

/** The pins an agent holds, as [slug, version] pairs. */
function pins(agent: Agent): Array<[string, string]> {
  return (agent.spec?.subagents ?? []).map((ref) => [ref.slug, ref.version]);
}

async function grpcError(call: Promise<unknown>): Promise<ConnectError> {
  const error = await call.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof ConnectError)) {
    throw new Error(`expected a ConnectError, got ${String(error)}`);
  }
  return error;
}

async function expectRefused(
  call: Promise<unknown>,
  code: Code,
  message: string,
): Promise<void> {
  const error = await grpcError(call);
  expect(error.code).toBe(code);
  expect(error.rawMessage).toBe(message);
}

describe("saving an agent pins each subagent it lists", () => {
  it("pins a reference without a version, and one naming latest, to the listed agent's head hash", async () => {
    const child = await command.create(agentInput(uniqueName("helper")));
    const head = child.status!.versionHash;
    expect(head).toMatch(/^[a-f0-9]{64}$/);
    const slug = child.metadata!.slug;

    const bare = await command.create(
      agentInput(uniqueName("parent"), { subagents: [{ slug }] }),
    );
    expect(pins(bare)).toEqual([[slug, head]]);
    expect(pins(await query.get({ value: bare.metadata!.id }))).toEqual([[slug, head]]);
    // Filed under the agent's own organization by the reference rule.
    expect(bare.spec?.subagents[0]?.org).toBe(ORG_ID);

    const latest = await command.create(
      agentInput(uniqueName("parent"), { subagents: [{ slug, version: "latest" }] }),
    );
    expect(pins(latest)).toEqual([[slug, head]]);
  });

  it("pins a tag to the hash it names, and keeps a 64-hex hash of an older version", async () => {
    const name = uniqueName("helper");
    const first = await command.create(
      agentInput(name, { instructions: "The first cut.", tag: "v1" }),
    );
    const firstHash = first.status!.versionHash;
    const second = await command.update(instructed(first, "The second cut."));
    const secondHash = second.status!.versionHash;
    expect(secondHash).not.toBe(firstHash);
    const slug = first.metadata!.slug;

    const byTag = await command.create(
      agentInput(uniqueName("parent"), { subagents: [{ slug, version: "v1" }] }),
    );
    expect(pins(byTag)).toEqual([[slug, firstHash]]);

    const byHash = await command.create(
      agentInput(uniqueName("parent"), { subagents: [{ slug, version: firstHash }] }),
    );
    expect(pins(byHash)).toEqual([[slug, firstHash]]);
  });

  it("refuses a version the listed agent does not hold, FAILED_PRECONDITION with the sentence", async () => {
    const child = await command.create(agentInput(uniqueName("helper")));
    const slug = child.metadata!.slug;
    await expectRefused(
      command.create(agentInput(uniqueName("parent"), { subagents: [{ slug, version: "v9" }] })),
      Code.FailedPrecondition,
      subagentVersionNotFoundMessage(slug, "v9"),
    );
    const unknown = "f".repeat(64);
    await expectRefused(
      command.create(agentInput(uniqueName("parent"), { subagents: [{ slug, version: unknown }] })),
      Code.FailedPrecondition,
      subagentVersionNotFoundMessage(slug, unknown),
    );
  });

  it("refuses an agent saved before agents were versioned, naming it", async () => {
    const slug = uniqueName("legacy");
    const id = `agt_${slug.replace("-", "_")}`;
    await namingSaves(server.store).saveResource(
      ApiResourceKind.agent,
      id,
      AgentSchema,
      create(AgentSchema, {
        apiVersion: API_VERSION,
        kind: "Agent",
        metadata: { id, name: slug, slug, org: ORG_ID, visibility: ApiResourceVisibility.visibility_org },
        spec: { instructions: "An agent from before versions." },
      }),
    );
    await expectRefused(
      command.create(agentInput(uniqueName("parent"), { subagents: [{ slug }] })),
      Code.FailedPrecondition,
      subagentUnversionedMessage(slug),
    );
  });

  it("refuses an agent listing itself, on create and on update, INVALID_ARGUMENT", async () => {
    const name = uniqueName("narcissus");
    await expectRefused(
      command.create(agentInput(name, { subagents: [{ slug: name }] })),
      Code.InvalidArgument,
      selfListedMessage(name),
    );
    const saved = await command.create(agentInput(name));
    await expectRefused(
      command.update(listing(saved, [name])),
      Code.InvalidArgument,
      selfListedMessage(name),
    );
  });

  it("refuses an agent listed twice, INVALID_ARGUMENT", async () => {
    const child = await command.create(agentInput(uniqueName("helper")));
    const slug = child.metadata!.slug;
    await expectRefused(
      command.create(
        agentInput(uniqueName("parent"), {
          subagents: [{ slug }, { slug, version: child.status!.versionHash }],
        }),
      ),
      Code.InvalidArgument,
      `subagents lists two agents named '${slug}'; a turn names a subagent by its slug, so list each slug once`,
    );
    expect(listedTwiceMessage(slug)).toBe(
      `subagents lists two agents named '${slug}'; a turn names a subagent by its slug, so list each slug once`,
    );
  });

  it("refuses two agents of one slug from two organizations: a turn names a subagent by its slug", async () => {
    const child = await command.create(agentInput(uniqueName("helper")));
    const slug = child.metadata!.slug;
    await expectRefused(
      command.create(
        agentInput(uniqueName("parent"), { subagents: [{ slug }, { slug, org: "globex" }] }),
      ),
      Code.InvalidArgument,
      listedTwiceMessage(slug),
    );
  });

  it("refuses a subagent whose pinned version lists subagents, and admits an older version without them", async () => {
    const grandchild = await command.create(agentInput(uniqueName("leaf")));
    const name = uniqueName("middle");
    const plain = await command.create(agentInput(name));
    const plainHash = plain.status!.versionHash;
    await command.update(listing(plain, [grandchild.metadata!.slug]));

    await expectRefused(
      command.create(agentInput(uniqueName("top"), { subagents: [{ slug: name }] })),
      Code.FailedPrecondition,
      nestedSubagentMessage(name),
    );
    // The check reads the pinned version: the one before the list was added passes.
    const pinnedOld = await command.create(
      agentInput(uniqueName("top"), { subagents: [{ slug: name, version: plainHash }] }),
    );
    expect(pins(pinnedOld)).toEqual([[name, plainHash]]);
  });

  it("holds the field to the floor: an organization-visible agent may not list a private one", async () => {
    const child = await command.create(
      agentInput(uniqueName("secret"), {
        visibility: ApiResourceVisibility.visibility_private,
      }),
    );
    const error = await grpcError(
      command.create(
        agentInput(uniqueName("team"), {
          visibility: ApiResourceVisibility.visibility_org,
          subagents: [{ slug: child.metadata!.slug }],
        }),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain(
      `referenced agent '${ORG}/${child.metadata!.slug}' is visibility_private while this resource is visibility_org`,
    );
  });

  it("hashes the pins: re-saving the stored spec keeps the version, re-pinning to a newer subagent moves it", async () => {
    const child = await command.create(
      agentInput(uniqueName("helper"), { instructions: "The first cut of the helper." }),
    );
    const slug = child.metadata!.slug;
    const parent = await command.create(agentInput(uniqueName("parent"), { subagents: [{ slug }] }));
    const parentHash = parent.status!.versionHash;

    const childNext = await command.update(instructed(child, "The second cut of the helper."));
    const childNextHash = childNext.status!.versionHash;
    expect(childNextHash).not.toBe(child.status!.versionHash);

    // The console sends the stored spec back: the pin is kept, and so is the version.
    const kept = await command.update(clone(AgentSchema, parent));
    expect(pins(kept)).toEqual([[slug, child.status!.versionHash]]);
    expect(kept.status?.versionHash).toBe(parentHash);

    // A write that sends the reference without a version takes the latest: a new parent version.
    const repinned = await command.update(listing(parent, [slug]));
    expect(pins(repinned)).toEqual([[slug, childNextHash]]);
    expect(repinned.status?.versionHash).not.toBe(parentHash);
  });
});

describe("deleting an agent another agent lists", () => {
  it("is refused naming the lister, and allowed once no agent lists it", async () => {
    const child = await command.create(agentInput(uniqueName("helper")));
    const slug = child.metadata!.slug;
    const first = await command.create(agentInput(uniqueName("lister"), { subagents: [{ slug }] }));
    const second = await command.create(agentInput(uniqueName("lister"), { subagents: [{ slug }] }));

    await expectRefused(
      command.delete({ value: child.metadata!.id }),
      Code.FailedPrecondition,
      stillListedMessage(UNLISTED_AGENT, slug, [first.metadata!.slug, second.metadata!.slug]),
    );
    expect(stillListedMessage(UNLISTED_AGENT, slug, [first.metadata!.slug])).toBe(
      `agent '${slug}' is still used by agent '${first.metadata!.slug}'; remove it from their subagents first`,
    );
    await query.get({ value: child.metadata!.id });

    for (const lister of [first, second]) {
      await command.update(listing(lister, []));
    }
    const deleted = await command.delete({ value: child.metadata!.id });
    expect(deleted.metadata?.id).toBe(child.metadata?.id);
  });
});

describe("the writer clause on subagents", () => {
  /**
   * An Authorizer over the model's answer for running agents: Ana may run
   * the private agent she owns, nobody else may; one agent is gone from
   * the model and one evaluation is down. Every check is recorded.
   */
  function runs(
    checks: string[],
    ids: { readonly anas: string; readonly gone: string; readonly flaky: string },
  ): Authorizer {
    return {
      authorize: async (caller, check) => {
        checks.push(
          `${caller.identityId}:${IamPermission[check.permission]}:${check.resourceId}`,
        );
        if (check.resourceId === ids.flaky) {
          return { kind: "unavailable", cause: new Error("authorization store offline") };
        }
        if (check.resourceId === ids.gone) {
          return { kind: "not-found" };
        }
        if (check.resourceId === ids.anas && caller.identityId !== "acc_ana") {
          return { kind: "deny", reason: "may not run it" };
        }
        return { kind: "allow" };
      },
    };
  }

  let anas: Agent;
  let teams: Agent;
  let gone: Agent;
  let flaky: Agent;

  beforeAll(async () => {
    anas = await command.create(agentInput(uniqueName("anas")));
    teams = await command.create(agentInput(uniqueName("teams")));
    gone = await command.create(agentInput(uniqueName("gone")));
    flaky = await command.create(agentInput(uniqueName("flaky")));
  });

  /** A parent listing `listed`; `pinned` gives each reference a version (a stored row always carries its pins). */
  function parentListing(listed: readonly Agent[], pinned: ReadonlyMap<Agent, string> = new Map()): Agent {
    return create(AgentSchema, {
      apiVersion: API_VERSION,
      kind: "Agent",
      metadata: { name: "writer-parent", slug: "writer-parent", org: ORG_ID },
      spec: {
        instructions: "A parent the writer clause is judged for.",
        subagents: listed.map((agent) => ({
          kind: ApiResourceKind.agent,
          org: ORG_ID,
          slug: agent.metadata!.slug,
          version: pinned.get(agent) ?? "",
        })),
      },
    });
  }

  /** Each agent pinned at its head, as the save step leaves a stored row. */
  function atHeads(...agents: Agent[]): ReadonlyMap<Agent, string> {
    return new Map(agents.map((agent) => [agent, agent.status!.versionHash]));
  }

  async function write(opts: {
    readonly writer: string;
    readonly lists: readonly Agent[];
    /** The versions the write names, by agent; none names no version. */
    readonly versions?: ReadonlyMap<Agent, string>;
    readonly stored?: readonly Agent[];
    /** The stored row's pins; every stored agent at its head when absent. */
    readonly storedPins?: ReadonlyMap<Agent, string>;
    readonly callerClass?: string;
    readonly checks?: string[];
  }): Promise<unknown> {
    const authorizer = runs(opts.checks ?? [], {
      anas: anas.metadata!.id,
      gone: gone.metadata!.id,
      flaky: flaky.metadata!.id,
    });
    const ctx = new RequestContext(
      AgentSchema,
      parentListing(opts.lists, opts.versions),
      testCallerIdentity({ identityId: opts.writer, callerClass: opts.callerClass ?? "user" }),
      ApiResourceKind.agent,
    );
    if (opts.stored !== undefined) {
      ctx.set(EXISTING_RESOURCE_KEY, parentListing(opts.stored, opts.storedPins ?? atHeads(...opts.stored)));
    }
    try {
      await newValidateReferencesStep<typeof AgentSchema>(server.store, authorizer).execute(ctx);
      await newPinSubagentsStep(server.store, authorizer).execute(ctx);
      return undefined;
    } catch (error) {
      return error;
    }
  }

  it("refuses a member listing an agent they may not run PERMISSION_DENIED, asking can_execute on it", async () => {
    const checks: string[] = [];
    const error = await write({ writer: "acc_ben", lists: [anas], checks });
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
    expect((error as ConnectError).rawMessage).toBe(
      subagentNotRunnableMessage(anas.metadata!.slug),
    );
    expect(checks).toEqual([`acc_ben:can_execute:${anas.metadata!.id}`]);
  });

  it("admits the agent's owner, and any member for an agent they may run", async () => {
    const checks: string[] = [];
    expect(await write({ writer: "acc_ana", lists: [anas], checks })).toBeUndefined();
    expect(await write({ writer: "acc_ben", lists: [teams], checks })).toBeUndefined();
    expect(checks).toEqual([
      `acc_ana:can_execute:${anas.metadata!.id}`,
      `acc_ben:can_execute:${teams.metadata!.id}`,
    ]);
  });

  it("judges only what the write introduces: an edit that keeps a reference someone else added passes", async () => {
    const checks: string[] = [];
    expect(
      await write({ writer: "acc_ben", lists: [anas, teams], stored: [anas], checks }),
    ).toBeUndefined();
    expect(checks).toEqual([`acc_ben:can_execute:${teams.metadata!.id}`]);
    const error = await write({ writer: "acc_ben", lists: [anas], stored: [teams] });
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
  });

  it("judges a kept reference whose pin the write moves: choosing another version of an agent one may not run is refused", async () => {
    const older = anas.status!.versionHash;
    const newer = await command.update(instructed(anas, "Ana's agent, revised."));
    anas = newer;
    try {
      // Kept at the head it is pinned to: the write moves nothing, and asks nothing.
      const checks: string[] = [];
      expect(await write({ writer: "acc_ben", lists: [anas], stored: [anas], checks })).toBeUndefined();
      expect(checks).toEqual([]);
      // Moved back to the older version by someone who may not run it.
      const moved = await write({
        writer: "acc_ben",
        lists: [anas],
        versions: new Map([[anas, older]]),
        stored: [anas],
        checks,
      });
      expect((moved as ConnectError).code).toBe(Code.PermissionDenied);
      expect(checks).toEqual([`acc_ben:can_execute:${anas.metadata!.id}`]);
      // Moved forward to the head from an older pin: still a move, still judged.
      const forward = await write({
        writer: "acc_ben",
        lists: [anas],
        stored: [anas],
        storedPins: new Map([[anas, older]]),
      });
      expect((forward as ConnectError).code).toBe(Code.PermissionDenied);
      // Its owner may move it.
      expect(
        await write({ writer: "acc_ana", lists: [anas], versions: new Map([[anas, older]]), stored: [anas] }),
      ).toBeUndefined();
    } finally {
      anas = await query.get({ value: anas.metadata!.id });
    }
  });

  it("refuses an agent one may not run before reading any of its versions, so the refusal says nothing of them", async () => {
    const error = await write({ writer: "acc_ben", lists: [anas], versions: new Map([[anas, "no-such-tag"]]) });
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
    expect((error as ConnectError).rawMessage).toBe(subagentNotRunnableMessage(anas.metadata!.slug));
  });

  it("exempts the server acting as itself", async () => {
    const checks: string[] = [];
    expect(
      await write({ writer: "system", lists: [anas], callerClass: "internal", checks }),
    ).toBeUndefined();
    expect(checks).toEqual([]);
  });

  it("an agent the Authorizer no longer finds answers the missing copy; an Authorizer that is down is INTERNAL", async () => {
    const missing = await write({ writer: "acc_ben", lists: [gone] });
    expect((missing as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((missing as ConnectError).rawMessage).toBe(
      missingReferencesMessage(referenceTargetKind(ApiResourceKind.agent)!, [
        { slug: gone.metadata!.slug, org: ORG_ID },
      ]),
    );
    const down = await write({ writer: "acc_ben", lists: [flaky] });
    expect((down as ConnectError).code).toBe(Code.Internal);
  });

  it("pins every reference before judging the writer: an admitted write carries the hashes", async () => {
    const ctx = new RequestContext(
      AgentSchema,
      parentListing([teams]),
      testCallerIdentity({ identityId: "acc_ben" }),
      ApiResourceKind.agent,
    );
    const authorizer = runs([], { anas: "", gone: "", flaky: "" });
    await newValidateReferencesStep<typeof AgentSchema>(server.store, authorizer).execute(ctx);
    await newPinSubagentsStep(server.store, authorizer).execute(ctx);
    expect(pins(ctx.newState)).toEqual([[teams.metadata!.slug, teams.status!.versionHash]]);
  });
});

describe("the two steps' own faults", () => {
  const admits: Authorizer = { authorize: async () => ({ kind: "allow" }) };

  /** A context for a parent listing `slugs` under the seeded organization, or with no metadata at all. */
  function context(slugs: readonly string[], opts: { readonly metadata?: boolean } = {}): RequestContext<typeof AgentSchema> {
    return new RequestContext(
      AgentSchema,
      create(AgentSchema, {
        apiVersion: API_VERSION,
        kind: "Agent",
        ...(opts.metadata === false ? {} : { metadata: { name: "fault-parent", slug: "fault-parent", org: ORG_ID } }),
        spec: {
          instructions: "A parent the steps' faults are proven on.",
          subagents: slugs.map((slug) => ({ kind: ApiResourceKind.agent, org: ORG_ID, slug })),
        },
      }),
      testCallerIdentity({ identityId: "acc_ben" }),
      ApiResourceKind.agent,
    );
  }

  /** PinSubagents over `store`, as a promise however the step settles. */
  async function pin(store: typeof server.store, ctx: RequestContext<typeof AgentSchema>): Promise<void> {
    await newPinSubagentsStep(store, admits).execute(ctx);
  }

  /** The store with its listing failing, as a database fault would. */
  function readingFails(): typeof server.store {
    return new Proxy(server.store, {
      get(target, property, receiver) {
        if (property === "getResource") {
          return async () => {
            throw new Error("database offline");
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  it("ValidateSubagentList passes over a reference with no slug, however many there are", () => {
    const ctx = context(["", "", "lone"]);
    expect(() => newValidateSubagentListStep().execute(ctx)).not.toThrow();
  });

  it("PinSubagents on a state with no metadata is INTERNAL", async () => {
    const error = await grpcError(pin(server.store, context(["any"], { metadata: false })));
    expect(error.code).toBe(Code.Internal);
  });

  it("PinSubagents run without ValidateReferences' recorded targets is INTERNAL, a wiring fault", async () => {
    const helper = await command.create(agentInput(uniqueName("unvalidated")));
    const error = await grpcError(pin(server.store, context([helper.metadata!.slug])));
    expect(error.code).toBe(Code.Internal);
  });

  it("a store fault while reading a subagent is INTERNAL", async () => {
    const helper = await command.create(agentInput(uniqueName("unreadable")));
    const ctx = context([helper.metadata!.slug]);
    await newValidateReferencesStep<typeof AgentSchema>(server.store, admits).execute(ctx);
    const error = await grpcError(pin(readingFails(), ctx));
    expect(error.code).toBe(Code.Internal);
  });

  it("a subagent that leaves between ValidateReferences and PinSubagents answers the reference rule's missing copy", async () => {
    const helper = await command.create(agentInput(uniqueName("leaving")));
    const ctx = context([helper.metadata!.slug]);
    await newValidateReferencesStep<typeof AgentSchema>(server.store, admits).execute(ctx);
    await command.delete({ value: helper.metadata!.id });
    await expectRefused(
      pin(server.store, ctx),
      Code.FailedPrecondition,
      missingReferencesMessage(referenceTargetKind(ApiResourceKind.agent)!, [
        { slug: helper.metadata!.slug, org: ORG_ID },
      ]),
    );
  });
});
