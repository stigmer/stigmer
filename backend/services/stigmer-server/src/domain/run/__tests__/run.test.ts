/**
 * Pins the run surfaces through the REAL stack: a composed server on an ephemeral port, a
 * native gRPC client, the full interceptor chain. Executions cannot be
 * created through the RPC surface here (the engine gate refuses without
 * Temporal — the production posture while no engine is connected), so
 * records are seeded directly through the store.
 *
 * Load-bearing pins the conformance suite cannot cover:
 *   - a turn whose conversation runs on Claude reaches the engine gate like
 *     any offered engine's, a new conversation naming it and a message to a
 *     stored one alike; a stored conversation whose engine is a number no
 *     engine owns (a row written outside validation, the unused number 2
 *     among them) is refused before the engine gate;
 *   - the MANGLED unknown-execution message on getRunUsageReport,
 *     byte-for-byte (existing error copy is wire contract);
 *   - getAgentUsageReport org scoping (oss#389) incl. the no-name-oracle
 *     rule, case by case;
 *   - the usage reports over the wire: a run's runner report counted
 *     (estimated, under the unknown server), the organization report's
 *     range by creation instant and its UTC days;
 *   - list/listBySession filter semantics over seeded rows; list's cursor
 *     pages (newest created first, one organization, a token refused on
 *     another request) and listBySession returning its parent whole;
 *   - update's status-clearing standard build and delete's audit-trail
 *     return, over the wire; update's reserved-label guard under an
 *     authorizer that enforces it (a run's schedule label is refused, an
 *     echo of a stored one passes);
 *   - an update keeps a status write that lands between its read and its
 *     write (stigmer#2115): the stored row and the answer carry both, the
 *     lost swap retried from a fresh read; a row that moves before every
 *     swap answers ABORTED with WRITE_CONFLICT after three attempts, and
 *     every write that landed is kept;
 *   - the populated getRunSummary arm (phase counts, active count,
 *     avg duration, failure ranks) that the zero-record conformance arm
 *     cannot reach;
 *   - updateStatus over the wire persists the merge, the run's file
 *     record merged by change set id across writes;
 *   - what a run loaded (status.loaded_versions) admits only what the
 *     reference rule admits from the run's organization: a status write
 *     naming another organization's skill, or an id nothing holds, stores
 *     none of it, so no read names it; its own organization's skill is
 *     stored and named.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, fromBinary } from "@bufbuild/protobuf";
import type {
  DescMessage,
  MessageInitShape,
  MessageShape,
} from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import { RunPhase, ServiceTier } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import {
  ProviderKeySource,
  type StreamingUsageSummarySchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { fileReviewSeed } from "./file-review-seed.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";
import type { OrganizationIds } from "../../organization/__tests__/support.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";
import {
  GUARDED_WRITE_ATTEMPTS,
  WRITE_CONFLICT_REASON,
} from "../../../pipeline/guarded-write.js";
import { writeLandsMidUpdate } from "../../../pipeline/__tests__/race-support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const KIND = "Run";
const ORG = "acme";

// Requests name organizations by slug, which the serving chain turns into
// the minted id; rows seeded straight into the store carry the id, as a
// create through the API would have written them.
let organizationIds: OrganizationIds;
let ORG_ID: string;
function idOf(slug: string): string {
  return organizationId(organizationIds, slug);
}

type CommandClient = Client<typeof RunCommandController>;
type QueryClient = Client<typeof RunQueryController>;

let server: ComposedServer;
let dir: string;
let command: CommandClient;
let query: QueryClient;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "run-domain-test-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv(
    "STIGMER_RUNNER_TOKEN_KEY",
    Buffer.alloc(32, 8).toString("base64"),
  );
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      // The skill artifact store + staging wipe must stay inside the
      // test dir — the default resolves to ~/.stigmer/storage.
      STORAGE_PATH: path.join(dir, "storage"),
      // Keep the artifact store inside the test dir — the default
      // resolves to ~/.stigmer, which tests must never touch.
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  organizationIds = await seedOrganizations(transport, [
    ORG,
    "paging-org",
    "org-a",
    "org-b",
    "org-report",
    "org-summary",
    "other-org",
    "org-never-used",
    "labelled-org",
  ]);
  ORG_ID = idOf(ORG);
  command = createClient(RunCommandController, transport);
  query = createClient(RunQueryController, transport);
});

afterAll(async () => {
  try {
    await server?.shutdown();
    rmSync(dir, { recursive: true, force: true });
  } finally {
    vi.unstubAllEnvs();
  }
});

let counter = 0;
function seedInput(overrides?: {
  id?: string;
  org?: string;
  sessionId?: string;
  agentId?: string;
  phase?: RunPhase;
  startedAt?: string;
  completedAt?: string;
  createdAtMs?: number;
  labels?: Record<string, string>;
  streamingUsage?: MessageInitShape<typeof StreamingUsageSummarySchema>;
}): MessageInitShape<typeof RunSchema> & {
  metadata: { id: string };
} {
  counter += 1;
  const id = overrides?.id ?? `run_test_${counter}`;
  const slug = `exec-${id.replaceAll("_", "-")}`;
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      id,
      name: slug,
      slug,
      org: overrides?.org ?? ORG_ID,
      labels: overrides?.labels ?? {},
    },
    spec: {
      target: {
        case: "sessionId",
        value: overrides?.sessionId ?? `ses_test_${counter}`,
      },
      message: "Say hello.",
    },
    status: {
      agentId: overrides?.agentId ?? `agt_test_${counter}`,
      phase: overrides?.phase ?? RunPhase.RUN_COMPLETED,
      startedAt: overrides?.startedAt ?? "",
      completedAt: overrides?.completedAt ?? "",
      streamingUsage: overrides?.streamingUsage,
      audit:
        overrides?.createdAtMs === undefined
          ? undefined
          : {
              specAudit: { createdAt: timestampFromMs(overrides.createdAtMs) },
            },
    },
  };
}

async function seed(
  init: MessageInitShape<typeof RunSchema> & {
    metadata: { id: string };
  },
): Promise<string> {
  await namingSaves(server.store).saveResource(
    ApiResourceKind.run,
    init.metadata.id,
    RunSchema,
    create(RunSchema, init),
  );
  return init.metadata.id;
}

async function expectCode(
  fn: () => Promise<unknown>,
  code: Code,
): Promise<ConnectError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    const connectError = error as ConnectError;
    expect(connectError.code).toBe(code);
    return connectError;
  }
  throw new Error(`expected code ${Code[code]}, call succeeded`);
}

/** The agent the create tests seed, named as a new conversation names it. */
const GATE_AGENT_REF = {
  kind: ApiResourceKind.agent,
  org: ORG,
  slug: "gate-agent",
};
const GATE_AGENT_CONVERSATION = {
  case: "sessionSpec" as const,
  value: { agentRef: GATE_AGENT_REF },
};

describe("create over the wire (engine gate)", () => {
  it("valid create refuses Unavailable at the engine gate, BEFORE any side effect", async () => {
    // Seed an agent the request references, so target resolution and
    // validation pass and the refusal is provably the engine gate.
    await namingSaves(server.store).saveResource(
      ApiResourceKind.agent,
      "agt_create_gate",
      AgentSchema,
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: {
          id: "agt_create_gate",
          name: "gate-agent",
          slug: "gate-agent",
          org: ORG_ID,
        },
      }),
    );

    const err = await expectCode(
      () =>
        command.create({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: "gated-exec", org: ORG },
          spec: { target: GATE_AGENT_CONVERSATION, message: "hello" },
        }),
      Code.Unavailable,
    );
    expect(err.rawMessage).toBe(
      "The execution engine is temporarily unavailable. Please try again shortly.",
    );

    // The gate ran before the side-effecting steps: nothing persisted.
    // Both checks filter to THIS request's artifacts rather than
    // asserting global emptiness, so future seeding elsewhere in the
    // file can never make them order-dependent.
    const executions = await server.store.listResources(
      ApiResourceKind.run,
    );
    for (const data of executions) {
      const row = fromBinary(RunSchema, data);
      expect(row.metadata?.name).not.toBe("gated-exec");
    }
    const sessions = await server.store.listResources(ApiResourceKind.session);
    for (const data of sessions) {
      const row = fromBinary(SessionSchema, data);
      expect(row.status?.agentId ?? "").not.toBe("agt_create_gate");
      expect(row.spec?.subject).not.toBe("Auto-created session");
    }
  });

  it("validation runs before the gate: a tier without a model answers InvalidArgument", async () => {
    const err = await expectCode(
      () =>
        command.create({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: "bad-tier-exec", org: ORG },
          spec: {
            target: GATE_AGENT_CONVERSATION,
            message: "hello",
            runConfig: { serviceTier: ServiceTier.FAST },
          },
        }),
      Code.InvalidArgument,
    );
    expect(err.rawMessage).toContain("requires a model_name");
  });
});

describe("the offered-engine rule over the wire", () => {
  it("admits a new conversation on Claude to the engine gate", async () => {
    await namingSaves(server.store).saveResource(
      ApiResourceKind.agent,
      "agt_claude_gate",
      AgentSchema,
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { id: "agt_claude_gate", name: "claude-gate-agent", slug: "claude-gate-agent", org: ORG_ID },
      }),
    );
    const err = await expectCode(
      () =>
        command.create({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: "claude-exec", org: ORG },
          spec: {
            target: {
              case: "sessionSpec",
              value: { agentRef: { ...GATE_AGENT_REF, slug: "claude-gate-agent" }, harness: Harness.CLAUDE },
            },
            message: "hello",
          },
        }),
      Code.Unavailable,
    );
    expect(err.rawMessage).not.toContain("not available on this platform");
  });

  it("admits a message to a stored conversation on Claude to the engine gate", async () => {
    await namingSaves(server.store).saveResource(
      ApiResourceKind.session,
      "ses_stored_on_claude",
      SessionSchema,
      create(SessionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Session",
        metadata: { id: "ses_stored_on_claude", name: "claude-session", slug: "claude-session", org: ORG_ID },
        spec: { harness: Harness.CLAUDE },
      }),
    );
    const err = await expectCode(
      () =>
        command.sendMessage({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: "a-claude-message", org: ORG },
          spec: { target: { case: "sessionId", value: "ses_stored_on_claude" }, message: "hello" },
        }),
      Code.Unavailable,
    );
    expect(err.rawMessage).not.toContain("not available on this platform");
  });

  it.each([2, 7])(
    "refuses a message to a stored conversation whose engine is harness %i, a number no engine owns, before the engine gate",
    async (harness) => {
      const sessionId = `ses_stored_on_${harness}`;
      await namingSaves(server.store).saveResource(
        ApiResourceKind.session,
        sessionId,
        SessionSchema,
        create(SessionSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Session",
          metadata: { id: sessionId, name: `harness-${harness}-session`, slug: `harness-${harness}-session`, org: ORG_ID },
          spec: { harness: harness as Harness },
        }),
      );
      const err = await expectCode(
        () =>
          command.sendMessage({
            apiVersion: API_VERSION,
            kind: KIND,
            metadata: { name: `a-harness-${harness}-message`, org: ORG },
            spec: { target: { case: "sessionId", value: sessionId }, message: "hello" },
          }),
        Code.FailedPrecondition,
      );
      expect(err.rawMessage).toBe(`the conversation names harness ${harness}, which this platform does not run`);
    },
  );
});

describe("sendMessage over the wire", () => {
  it("refuses a message naming no existing session, and admits one as create does, to the engine gate", async () => {
    const none = await expectCode(
      () =>
        command.sendMessage({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: "a-message", org: ORG },
          spec: { message: "hello" },
        }),
      Code.FailedPrecondition,
    );
    expect(none.rawMessage).toContain("spec.session_id");
    await expectCode(
      () =>
        command.sendMessage({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: "a-message", org: ORG },
          spec: { target: { case: "sessionId", value: "ses_absent_for_send" }, message: "hello" },
        }),
      Code.Unavailable,
    );
  });
});

describe("get / list / listBySession over the wire", () => {
  it("get answers NotFound for an unknown id and the record for a seeded one", async () => {
    await expectCode(
      () => query.get({ value: "run_missing" }),
      Code.NotFound,
    );

    const id = await seed(seedInput());
    const got = await query.get({ value: id });
    expect(got.metadata?.id).toBe(id);
    expect(got.spec?.message).toBe("Say hello.");
  });

  it("list with no page_size returns the default page, filtered by phase on request", async () => {
    const completed = await seed(
      seedInput({ phase: RunPhase.RUN_COMPLETED }),
    );
    const failed = await seed(
      seedInput({ phase: RunPhase.RUN_FAILED }),
    );

    const all = await query.list({});
    expect(all.nextPageToken).toBe("");
    const ids = all.entries.map((e) => e.metadata?.id);
    expect(ids).toContain(completed);
    expect(ids).toContain(failed);

    const failedOnly = await query.list({
      phase: RunPhase.RUN_FAILED,
    });
    const failedIds = failedOnly.entries.map((e) => e.metadata?.id);
    expect(failedIds).toContain(failed);
    expect(failedIds).not.toContain(completed);
  });

  it("listBySession requires session_id and filters by it", async () => {
    await expectCode(
      () => query.listBySession({ sessionId: "" }),
      Code.InvalidArgument,
    );

    const inSession = await seed(seedInput({ sessionId: "ses_shared" }));
    const outOfSession = await seed(seedInput({ sessionId: "ses_other" }));

    const result = await query.listBySession({ sessionId: "ses_shared" });
    expect(result.nextPageToken).toBe("");
    const ids = result.entries.map((e) => e.metadata?.id);
    expect(ids).toContain(inSession);
    expect(ids).not.toContain(outOfSession);
  });

  it("list pages one organization newest created first, with a token until the last page", async () => {
    const org = "paging-org";
    const base = Date.parse("2026-09-01T00:00:00Z");
    const newestFirst: string[] = [];
    for (let i = 0; i < 5; i++) {
      newestFirst.unshift(
        await seed(seedInput({ org: idOf(org), createdAtMs: base + i * 1000 })),
      );
    }
    await seed(
      seedInput({ org: idOf("other-org"), createdAtMs: base + 10_000 }),
    );

    const walked: string[] = [];
    let pageToken = "";
    do {
      const page = await query.list({ org, pageSize: 2, pageToken });
      expect(page.entries.length).toBeLessThanOrEqual(2);
      walked.push(...page.entries.map((e) => e.metadata!.id));
      pageToken = page.nextPageToken;
    } while (pageToken !== "");

    expect(walked).toEqual(newestFirst);
  });

  it("list refuses a page_token issued for another request, and a negative page_size", async () => {
    const org = "token-org";
    await seed(
      seedInput({ org, createdAtMs: Date.parse("2026-09-02T00:00:00Z") }),
    );
    await seed(
      seedInput({ org, createdAtMs: Date.parse("2026-09-02T00:00:01Z") }),
    );
    const first = await query.list({ org, pageSize: 1 });
    expect(first.nextPageToken).not.toBe("");

    const replayed = await expectCode(
      () =>
        query.list({
          org,
          phase: RunPhase.RUN_FAILED,
          pageSize: 1,
          pageToken: first.nextPageToken,
        }),
      Code.InvalidArgument,
    );
    expect(replayed.rawMessage).toBe(
      "page_token was issued for a different request",
    );
    await expectCode(
      () => query.list({ org, pageToken: "not-a-token" }),
      Code.InvalidArgument,
    );
    await expectCode(
      () => query.list({ org, pageSize: -1 }),
      Code.InvalidArgument,
    );
  });

  it("list and listBySession walk only the runs carrying every label named, a page at a time", async () => {
    const org = "labelled-org";
    const sessionId = "ses_labelled";
    const base = Date.parse("2026-09-03T00:00:00Z");
    const labels = { team: "support", tier: "gold" };
    const runAt = (i: number, runLabels: Record<string, string>) =>
      seed(
        seedInput({
          org: idOf(org),
          sessionId,
          createdAtMs: base + i * 1000,
          labels: runLabels,
        }),
      );
    await runAt(0, {});
    const labelled = [await runAt(1, labels), await runAt(2, labels)];
    await runAt(3, { team: "support" });
    labelled.push(await runAt(4, { ...labels, extra: "x" }));
    const newestFirst = [...labelled].reverse();

    async function walk(
      read: (pageToken: string) => Promise<{ entries: { metadata?: { id: string } }[]; nextPageToken: string }>,
    ): Promise<string[]> {
      const walked: string[] = [];
      let pageToken = "";
      do {
        const page = await read(pageToken);
        expect(page.entries.length).toBeLessThanOrEqual(1);
        walked.push(...page.entries.map((e) => e.metadata!.id));
        pageToken = page.nextPageToken;
      } while (pageToken !== "");
      return walked;
    }

    expect(
      await walk((pageToken) => query.list({ org, labels, pageSize: 1, pageToken })),
    ).toEqual(newestFirst);
    expect(
      await walk((pageToken) =>
        query.listBySession({ sessionId, labels, pageSize: 1, pageToken }),
      ),
    ).toEqual(newestFirst);
  });

  it("listBySession pages the session's executions one page_size at a time", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      ids.add(await seed(seedInput({ sessionId: "ses_paged" })));
    }

    const walked: string[] = [];
    let pageToken = "";
    let pages = 0;
    do {
      const page = await query.listBySession({
        sessionId: "ses_paged",
        pageSize: 1,
        pageToken,
      });
      expect(page.entries.length).toBeLessThanOrEqual(1);
      walked.push(...page.entries.map((e) => e.metadata!.id));
      pageToken = page.nextPageToken;
      pages += 1;
    } while (pageToken !== "");

    expect(pages).toBe(3);
    expect(new Set(walked)).toEqual(ids);
    expect(walked).toHaveLength(3);
  });
});

describe("what a run loaded (loaded_versions) over the wire", () => {
  async function seedSkill(id: string, org: string, slug: string): Promise<void> {
    await namingSaves(server.store).saveResource(
      ApiResourceKind.skill,
      id,
      SkillSchema,
      create(SkillSchema, { metadata: { id, org, slug, name: slug }, spec: { name: slug, skillMd: "# s" } }),
    );
  }

  it("stores and names its own organization's skill, and drops another organization's and an id nothing holds", async () => {
    const id = await seed(seedInput());
    await seedSkill("skl_loaded_own", ORG_ID, "loaded-own");
    await seedSkill("skl_loaded_theirs", idOf("other-org"), "loaded-theirs");
    const version = "1".repeat(64);

    await command.updateStatus({
      runId: id,
      status: {
        phase: RunPhase.RUN_IN_PROGRESS,
        loadedVersions: {
          skills: [
            { org: ORG_ID, kind: ApiResourceKind.skill, id: "skl_loaded_own", version },
            { org: idOf("other-org"), kind: ApiResourceKind.skill, id: "skl_loaded_theirs", version },
            { org: ORG_ID, kind: ApiResourceKind.skill, id: "skl_loaded_nothing", version },
          ],
        },
      },
    });

    const read = await query.get({ value: id });
    expect(read.status?.loadedVersions?.skills.map((r) => [r.org, r.id, r.slug])).toEqual([
      [ORG_ID, "skl_loaded_own", "loaded-own"],
    ]);
  });

  it("keeps what the run holds across later writes, drops a new foreign entry beside it, and answers NotFound for a missing run", async () => {
    const id = await seed(seedInput());
    await seedSkill("skl_held_own", ORG_ID, "held-own");
    const v1 = "1".repeat(64);
    const held = { org: ORG_ID, kind: ApiResourceKind.skill, id: "skl_held_own", version: v1 };
    await command.updateStatus({ runId: id, status: { phase: RunPhase.RUN_IN_PROGRESS, loadedVersions: { skills: [held] } } });
    // A resend of what the run holds, then the held entry beside a foreign one.
    await command.updateStatus({ runId: id, status: { phase: RunPhase.RUN_IN_PROGRESS, loadedVersions: { skills: [held] } } });
    await command.updateStatus({
      runId: id,
      status: {
        phase: RunPhase.RUN_IN_PROGRESS,
        loadedVersions: {
          skills: [held],
          plugins: [{ org: idOf("other-org"), kind: ApiResourceKind.plugin, id: "plg_theirs", version: "d".repeat(64) }],
        },
      },
    });
    const read = await query.get({ value: id });
    expect(read.status?.loadedVersions?.skills.map((r) => [r.id, r.version])).toEqual([["skl_held_own", v1]]);
    expect(read.status?.loadedVersions?.plugins).toEqual([]);

    await expectCode(
      () => command.updateStatus({ runId: "run_loaded_missing", status: { loadedVersions: { skills: [held] } } }),
      Code.NotFound,
    );
  });
});

describe("update / delete over the wire", () => {
  it("update rewrites the spec through the standard build (status cleared per the shared pattern)", async () => {
    const init = seedInput({ phase: RunPhase.RUN_FAILED });
    const id = await seed(init);

    const updated = await command.update({ resource: {
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: init.metadata,
      spec: {
        target: init.spec?.target,
        message: "Say goodbye.",
      },
    }, updateMask: { paths: ["*"] } });
    expect(updated.metadata?.id).toBe(id);
    expect(updated.spec?.message).toBe("Say goodbye.");

    // The standard BuildUpdateState clears caller-supplied status; the
    // persisted record reflects the update response.
    const got = await query.get({ value: id });
    expect(got.spec?.message).toBe("Say goodbye.");
  });

  it("an update keeps a write that lands between its read and its write", async () => {
    const init = seedInput({ phase: RunPhase.RUN_IN_PROGRESS });
    const id = await seed(init);

    // The runner's status write (stigmer#2115): the run finishes while a
    // person's update is between its load and its persist.
    const { result: updated, writes } = await writeLandsMidUpdate(
      server.store,
      ApiResourceKind.run,
      id,
      () =>
        server.store.updateResource(
          ApiResourceKind.run,
          id,
          RunSchema,
          (live) => {
            if (live.status !== undefined) {
              live.status.phase = RunPhase.RUN_COMPLETED;
              live.status.completedAt = "2026-10-13T09:00:00Z";
            }
          },
        ),
      () =>
        command.update({ resource: {
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: init.metadata,
          spec: { target: init.spec?.target, message: "Say goodbye." },
        }, updateMask: { paths: ["*"] } }),
    );

    expect(writes).toBeGreaterThanOrEqual(2);
    for (const run of [
      updated,
      await server.store.getResource(ApiResourceKind.run, id, RunSchema),
    ]) {
      expect(run.status?.phase).toBe(RunPhase.RUN_COMPLETED);
      expect(run.status?.completedAt).toBe("2026-10-13T09:00:00Z");
      expect(run.spec?.message).toBe("Say goodbye.");
    }
  });

  it("an update of a row that moves before every swap answers WRITE_CONFLICT after three attempts, keeping every landed write", async () => {
    const init = seedInput({ phase: RunPhase.RUN_IN_PROGRESS });
    const id = await seed(init);

    const store = server.store;
    const swapResource = store.swapResource.bind(store);
    let landings = 0;
    const swap = vi.spyOn(store, "swapResource").mockImplementation((async <
      Desc extends DescMessage,
    >(
      writtenKind: ApiResourceKind,
      writtenId: string,
      schema: Desc,
      expectedBytes: Uint8Array,
      resource: MessageShape<Desc>,
    ) => {
      if (writtenKind === ApiResourceKind.run && writtenId === id) {
        landings += 1;
        const landing = `landing-${landings}`;
        await store.updateResource(ApiResourceKind.run, id, RunSchema, (live) => {
          if (live.metadata !== undefined) {
            live.metadata.labels[landing] = "landed";
          }
        });
      }
      return swapResource(writtenKind, writtenId, schema, expectedBytes, resource);
    }) as typeof store.swapResource);
    let refused: ConnectError;
    try {
      refused = await expectCode(
        () =>
          command.update({ resource: {
            apiVersion: API_VERSION,
            kind: KIND,
            metadata: init.metadata,
            spec: { target: init.spec?.target, message: "Say goodbye." },
          }, updateMask: { paths: ["*"] } }),
        Code.Aborted,
      );
    } finally {
      swap.mockRestore();
    }

    expect(landings).toBe(GUARDED_WRITE_ATTEMPTS);
    expect(refused.findDetails(ErrorInfoSchema)[0]?.reason).toBe(
      WRITE_CONFLICT_REASON,
    );
    expect(refused.rawMessage).toBe(
      `Run '${ORG_ID}/${init.metadata.slug}' kept changing while this update was being saved; try again`,
    );
    const stored = await server.store.getResource(
      ApiResourceKind.run,
      id,
      RunSchema,
    );
    expect(stored.metadata?.labels).toEqual({
      "landing-1": "landed",
      "landing-2": "landed",
      "landing-3": "landed",
    });
    expect(stored.spec?.message).toBe("Say hello.");
  });

  it("delete returns the deleted record (audit-trail convention) and removes it", async () => {
    const id = await seed(seedInput());

    const deleted = await command.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectCode(() => query.get({ value: id }), Code.NotFound);
  });

  it("delete answers NotFound for an unknown id", async () => {
    await expectCode(
      () => command.delete({ value: "run_missing" }),
      Code.NotFound,
    );
  });
});

/**
 * Update's reserved-label guard where an authorizer enforces it. The
 * open-source authorizer grants `can_write_reserved_labels` to everyone,
 * so this composition denies exactly that permission, as a hosted edition
 * does. A run's `stigmer.ai/routine-id` names the routine whose vaults a
 * person-less run uses, so a caller that could set it on its own run would
 * reach that routine's vaults on the run's next recover.
 */
describe("update under an authorizer that enforces reserved labels", () => {
  let enforcingDir: string;
  let enforcing: ComposedServer;
  let enforcingCommand: CommandClient;
  let enforcingOrgId: string;

  beforeAll(async () => {
    enforcingDir = mkdtempSync(path.join(tmpdir(), "run-reserved-labels-"));
    const authorizer: Authorizer = {
      authorize(_caller, check) {
        return Promise.resolve(
          check.permission === IamPermission.can_write_reserved_labels
            ? { kind: "deny", reason: "reserved labels are the platform's" }
            : { kind: "allow" },
        );
      },
    };
    enforcing = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(enforcingDir, "stigmer.db"),
        STORAGE_PATH: path.join(enforcingDir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(enforcingDir, "artifacts"),
      }),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
      extensions: [{ name: "reserved-labels-enforced", authorizer }],
    });
    const port = await enforcing.start();
    const transport: Transport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
    enforcingOrgId = organizationId(
      await seedOrganizations(transport, [ORG]),
      ORG,
    );
    enforcingCommand = createClient(RunCommandController, transport);
  });

  afterAll(async () => {
    await enforcing.shutdown();
    rmSync(enforcingDir, { recursive: true, force: true });
  });

  async function seedEnforced(labels: Record<string, string>) {
    const init = seedInput({ org: enforcingOrgId });
    init.metadata = { ...init.metadata, labels };
    await namingSaves(enforcing.store).saveResource(
      ApiResourceKind.run,
      init.metadata.id,
      RunSchema,
      create(RunSchema, init),
    );
    return init;
  }

  it("refuses an update that sets a reserved label on a run, and stores nothing", async () => {
    const init = await seedEnforced({});
    const refused = await expectCode(
      () =>
        enforcingCommand.update({ resource: {
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: {
            ...init.metadata,
            labels: { "stigmer.ai/routine-id": "rtn_someone_elses" },
          },
          spec: { target: init.spec?.target, message: "Say goodbye." },
        }, updateMask: { paths: ["*"] } }),
      Code.InvalidArgument,
    );
    expect(refused.rawMessage).toContain("stigmer.ai/routine-id");
    const stored = await enforcing.store.getResource(
      ApiResourceKind.run,
      init.metadata.id,
      RunSchema,
    );
    expect(stored.metadata?.labels["stigmer.ai/routine-id"]).toBeUndefined();
    expect(stored.spec?.message).toBe("Say hello.");
  });

  it("lets an update echo the run's stored reserved label unchanged", async () => {
    const init = await seedEnforced({ "stigmer.ai/routine-id": "rtn_nightly" });
    const updated = await enforcingCommand.update({ resource: {
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: init.metadata,
      spec: { target: init.spec?.target, message: "Say goodbye." },
    }, updateMask: { paths: ["*"] } });
    expect(updated.metadata?.labels["stigmer.ai/routine-id"]).toBe("rtn_nightly");
    expect(updated.spec?.message).toBe("Say goodbye.");
  });
});

describe("usage reports over the wire", () => {
  it("getRunUsageReport answers the domain's NotFound copy for an unknown execution (#859)", async () => {
    await expectCode(
      () => query.getRunUsageReport({ runId: "" }),
      Code.InvalidArgument,
    );

    const err = await expectCode(
      () => query.getRunUsageReport({ runId: "run_missing" }),
      Code.NotFound,
    );
    expect(err.rawMessage).toBe("Run not found: run_missing");
  });

  it("getRunUsageReport answers a run with no runner report as zero, and a reported run with its runner's tokens", async () => {
    const quiet = await query.getRunUsageReport({ runId: await seed(seedInput()) });
    expect(quiet.aggregate).toBeDefined();
    expect(quiet.aggregate?.totalTokens).toBe(0n);
    expect(quiet.aggregate?.servedBy).toEqual([]);

    // No session row and no meter: the Stigmer rule, counted under the
    // unknown server (input less both cache buckets).
    const reported = await query.getRunUsageReport({
      runId: await seed(
        seedInput({
          streamingUsage: {
            inputTokens: 18_432n,
            outputTokens: 1_210n,
            cacheReadTokens: 15_000n,
            cacheWriteTokens: 2_000n,
            totalTokens: 19_642n,
            model: "claude-sonnet-4-5",
          },
        }),
      ),
    });
    expect(reported.aggregate?.totalTokens).toBe(19_642n);
    expect(reported.aggregate?.inputTokens).toBe(1_432n);
    expect(reported.aggregate?.servedBy.map((s) => [s.providerKeySource, s.totalTokens])).toEqual([
      [ProviderKeySource.UNSPECIFIED, 19_642n],
    ]);
  });

  it("getAgentUsageReport scopes to the requested org (oss#389)", async () => {
    await seed(
      seedInput({
        agentId: "agt_scoped",
        org: idOf("org-a"),
        sessionId: "ses_a1",
        startedAt: "2026-03-10T10:00:00Z",
      }),
    );
    await seed(
      seedInput({
        agentId: "agt_scoped",
        org: idOf("org-a"),
        sessionId: "ses_a2",
        startedAt: "2026-03-11T10:00:00Z",
      }),
    );
    await seed(
      seedInput({
        agentId: "agt_scoped",
        org: idOf("org-b"),
        sessionId: "ses_b1",
        startedAt: "2026-03-10T10:00:00Z",
      }),
    );

    const orgA = await query.getAgentUsageReport({
      agentId: "agt_scoped",
      org: "org-a",
    });
    expect(orgA.totalRuns).toBe(2);
    expect(orgA.totalSessions).toBe(2);
    for (const session of orgA.sessions) {
      expect(session.sessionId, "org-b session must not leak").not.toBe(
        "ses_b1",
      );
    }

    const orgB = await query.getAgentUsageReport({
      agentId: "agt_scoped",
      org: "org-b",
    });
    expect(orgB.totalRuns).toBe(1);
  });

  it("getAgentUsageReport resolves the display name only when the org used the agent (no id-to-name oracle)", async () => {
    await namingSaves(server.store).saveResource(
      ApiResourceKind.agent,
      "agt_named",
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_named", name: "PR Reviewer", org: idOf("org-a") },
      }),
    );
    await seed(
      seedInput({
        agentId: "agt_named",
        org: idOf("org-a"),
        startedAt: "2026-03-10T10:00:00Z",
      }),
    );

    const used = await query.getAgentUsageReport({
      agentId: "agt_named",
      org: "org-a",
    });
    expect(used.agentName).toBe("PR Reviewer");

    const unused = await query.getAgentUsageReport({
      agentId: "agt_named",
      org: "org-never-used",
    });
    expect(unused.agentName, "the raw id, not the name").toBe("agt_named");
  });

  it("the scope-field refusals: agent report without org, org report without dates", async () => {
    await expectCode(
      () => query.getAgentUsageReport({ agentId: "agt_x" }),
      Code.InvalidArgument,
    );
    await expectCode(
      () => query.getAgentUsageReport({ org: "org-a" }),
      Code.InvalidArgument,
    );
    await expectCode(
      () => query.getOrgUsageReport({ org: "org-a" }),
      Code.InvalidArgument,
    );
  });

  it("getOrgUsageReport counts the org's runs created in range, by UTC day of creation", async () => {
    await seed(
      seedInput({
        agentId: "agt_org_report",
        org: idOf("org-report"),
        sessionId: "ses_r1",
        startedAt: "2026-04-10T10:00:00Z",
        createdAtMs: Date.UTC(2026, 3, 10, 9, 59),
      }),
    );
    await seed(
      seedInput({
        agentId: "agt_org_report",
        org: idOf("org-report"),
        sessionId: "ses_r2",
        startedAt: "2026-04-11T10:00:00Z",
        createdAtMs: Date.UTC(2026, 3, 11, 9, 59),
      }),
    );
    // Created the day before the range, started inside it: out.
    await seed(
      seedInput({
        agentId: "agt_org_report",
        org: idOf("org-report"),
        sessionId: "ses_r3",
        startedAt: "2026-04-01T00:30:00Z",
        createdAtMs: Date.UTC(2026, 2, 31, 23, 30),
      }),
    );

    const report = await query.getOrgUsageReport({
      org: "org-report",
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
    });
    expect(report.totalRuns).toBe(2);
    expect(report.totalAgents).toBe(1);
    expect(report.totalSessions).toBe(2);
    expect(report.dailyUsage.map((d) => [d.date, d.runCount])).toEqual([
      ["2026-04-10", 1],
      ["2026-04-11", 1],
    ]);
    expect(report.topAgents.map((a) => [a.agentId, a.runCount, a.totalTokens])).toEqual([
      ["agt_org_report", 2, 0n],
    ]);
    expect(report.totalUsage?.totalTokens).toBe(0n);
  });

  it("getSessionUsageReport orders per-execution summaries chronologically", async () => {
    await seed(
      seedInput({
        sessionId: "ses_report_order",
        startedAt: "2026-05-02T10:00:00Z",
      }),
    );
    await seed(
      seedInput({
        sessionId: "ses_report_order",
        startedAt: "2026-05-01T10:00:00Z",
      }),
    );

    const report = await query.getSessionUsageReport({
      sessionId: "ses_report_order",
    });
    expect(report.runCount).toBe(2);
    expect(report.runs[0]?.startedAt).toBe("2026-05-01T10:00:00Z");
    expect(report.runs[1]?.startedAt).toBe("2026-05-02T10:00:00Z");
    expect(report.firstRunAt).toBe("2026-05-01T10:00:00Z");
    expect(report.lastRunAt).toBe("2026-05-02T10:00:00Z");
  });
});

describe("updateStatus over the wire", () => {
  it("answers NotFound for an unknown execution and InvalidArgument without a status", async () => {
    await expectCode(
      () =>
        command.updateStatus({
          runId: "run_missing",
          status: { phase: RunPhase.RUN_IN_PROGRESS },
        }),
      Code.NotFound,
    );
    await expectCode(
      () => command.updateStatus({ runId: "run_missing" }),
      Code.InvalidArgument,
    );
  });

  it("persists the merge, the run's file record merged by change set id", async () => {
    const init = seedInput({ phase: RunPhase.RUN_IN_PROGRESS });
    const id = await seed(init);
    const { status } = fileReviewSeed(id, `${id}:0`);

    await command.updateStatus({ runId: id, status: { fileChanges: status.fileChanges } });
    await command.updateStatus({
      runId: id,
      status: {
        phase: RunPhase.RUN_COMPLETED,
        completedAt: "2026-08-24T10:00:00Z",
        fileChanges: fileReviewSeed(id, `${id}:1`).status.fileChanges,
      },
    });

    const reloaded = await query.get({ value: id });
    expect(reloaded.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(reloaded.status?.fileChanges.map((cs) => cs.id)).toEqual([`${id}:0`, `${id}:1`]);
  });
});

describe("getRunSummary — the populated arm", () => {
  it("counts phases, actives, completion durations, and failure ranks", async () => {
    // Seeded records carry no audit timestamps, so the window cutoff
    // never skips them (a zero created_at disables the skip).
    await seed(
      seedInput({
        org: idOf("org-summary"),
        phase: RunPhase.RUN_COMPLETED,
        startedAt: "2026-06-01T10:00:00Z",
        completedAt: "2026-06-01T11:00:00Z",
      }),
    );
    await seed(
      seedInput({
        org: idOf("org-summary"),
        agentId: "agt_failing",
        phase: RunPhase.RUN_FAILED,
      }),
    );
    await seed(
      seedInput({
        org: idOf("org-summary"),
        phase: RunPhase.RUN_PENDING,
      }),
    );

    const summary = await query.getRunSummary({ org: "org-summary" });

    // The org field is a no-op on this single-tenant edition; earlier
    // suites' seeds are counted too — assert at-least semantics on the
    // shared counters and exact semantics on this suite's own markers.
    expect(
      summary.phaseCounts[RunPhase.RUN_PENDING] ?? 0,
    ).toBeGreaterThanOrEqual(1);
    expect(summary.activeCount).toBeGreaterThanOrEqual(1);

    expect(summary.avgDuration, "one completed pair exists").toBeDefined();
    expect(Number(summary.avgDuration?.seconds ?? 0n)).toBeGreaterThan(0);

    const failing = summary.topFailingAgents.find(
      (rank) => rank.agentSlug === "agt_failing",
    );
    expect(failing, "the failed execution ranks its agent").toBeDefined();
    expect(failing?.failureCount).toBe(1);
  });
});
