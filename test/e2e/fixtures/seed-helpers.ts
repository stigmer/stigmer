import { Buffer } from "node:buffer";
import { crc32 } from "node:zlib";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { GetDefaultAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";

const DEFAULT_ORG = "default";

/**
 * The OSS seedpack system org (OSS is operationally single-tenant on
 * `"stigmer"` — see `identity.SystemOrg` in stigmer-server). E2E specs
 * that exercise system-org behavior seed here and point the console's
 * active org at it.
 */
const SYSTEM_ORG = "stigmer";

/**
 * Ensures the OSS `default` organization exists on a freshly-booted stack.
 *
 * In OSS, `FindMyOrganizations` lists every `Organization` entity in the store
 * (no IAM filtering), and the web's `OrgGate` blocks all authenticated routes
 * until at least one exists. A fresh e2e server starts with an empty store and
 * nothing auto-seeds an org — so without this, every seeded resource lives under
 * the `default` string namespace while the browser is stuck on the
 * "Create an organization" onboarding screen.
 *
 * This mirrors a first-run OSS user creating their org through
 * `CreateOrganizationForm` (organizations are self-owning: slug == org).
 * Idempotent — a no-op when the org already exists (e.g. a reused stack).
 */
export async function ensureDefaultOrg(client: Stigmer): Promise<void> {
  const existing = await client.organization.findMyOrganizations();
  if (existing.entries.some((o) => o.metadata?.slug === DEFAULT_ORG)) return;

  await client.organization.create({
    name: "Default",
    slug: DEFAULT_ORG,
    org: DEFAULT_ORG,
  });
}

/**
 * Ensures a platform default agent exists — the agent the session launcher's
 * send path resolves when the user picked none (`AgentQuery.getDefault`,
 * keyed on the `stigmer.ai/default-agent=true` label + public visibility).
 * The e2e stack boots a raw server with no seedpack bootstrap, so without
 * this seed every launcher send dead-ends on getDefault's NOT_FOUND
 * (stigmer/stigmer#743). Mirrors the integration harness's boot-time seed;
 * idempotent — a no-op when a default agent already exists, and tolerant of
 * a parallel worker winning the create race.
 */
export async function ensureDefaultAgent(client: Stigmer): Promise<void> {
  const getDefaultReq = create(GetDefaultAgentRequestSchema, {
    org: DEFAULT_ORG,
  });

  try {
    await client.agent.getDefault(getDefaultReq);
    return;
  } catch {
    // NOT_FOUND — fall through and seed one.
  }

  try {
    await client.agent.create({
      name: "e2e-default-agent",
      org: DEFAULT_ORG,
      instructions:
        "You are the default test assistant. Keep responses under 20 words.",
      labels: { "stigmer.ai/default-agent": "true" },
      visibility: ApiResourceVisibility.visibility_public,
    });
  } catch {
    // A parallel worker may have seeded it between our probe and create;
    // the fixed name makes the loser's create collide. Verify and settle.
    await client.agent.getDefault(getDefaultReq);
  }
}

/**
 * Ensures the `stigmer` system Organization exists. The e2e stack boots
 * a raw server with no seedpack bootstrap (which normally creates it),
 * so specs that need it create it explicitly — idempotent, like
 * {@link ensureDefaultOrg}.
 */
export async function ensureSystemOrg(client: Stigmer): Promise<void> {
  const existing = await client.organization.findMyOrganizations();
  if (existing.entries.some((o) => o.metadata?.slug === SYSTEM_ORG)) return;

  try {
    await client.organization.create({
      name: "Stigmer",
      slug: SYSTEM_ORG,
      org: SYSTEM_ORG,
    });
  } catch (err) {
    // Parallel workers race the same check-then-create; a loser sees
    // ALREADY_EXISTS, which is the desired end state.
    if (!String(err).includes("already exists")) throw err;
  }
}

export interface TestAgentResult {
  id: string;
  slug: string;
  org: string;
  cleanup: () => Promise<void>;
}

export interface CreateTestAgentOpts {
  name?: string;
  instructions?: string;
  org?: string;
}

export async function createTestAgent(
  client: Stigmer,
  opts?: CreateTestAgentOpts,
): Promise<TestAgentResult> {
  const name = opts?.name ?? `e2e-agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const org = opts?.org ?? DEFAULT_ORG;

  const agent = await client.agent.create({
    name,
    org,
    instructions: opts?.instructions ?? "You are a helpful test assistant. Keep responses under 20 words.",
  });

  const id = agent.metadata!.id;
  const slug = agent.metadata!.name;

  return {
    id,
    slug,
    org,
    cleanup: async () => {
      await client.agent.delete(id).catch(() => {});
    },
  };
}

export interface TestWorkflowResult {
  id: string;
  slug: string;
  org: string;
  cleanup: () => Promise<void>;
}

export interface CreateTestWorkflowOpts {
  name?: string;
  org?: string;
  tasks?: Array<{ name: string; variables: Record<string, string> }>;
}

export async function createTestWorkflow(
  client: Stigmer,
  opts?: CreateTestWorkflowOpts,
): Promise<TestWorkflowResult> {
  const name = opts?.name ?? `e2e-wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const org = opts?.org ?? DEFAULT_ORG;

  // Task names must match WorkflowTask.name's proto constraint
  // (^[a-zA-Z_][a-zA-Z0-9_]*$) — snake_case, never hyphenated like the
  // resource names above. The server rejects the whole apply otherwise.
  const tasks = opts?.tasks ?? [
    { name: "step_one", variables: { greeting: "hello-from-e2e" } },
    { name: "step_two", variables: { farewell: "goodbye-from-e2e" } },
  ];

  const workflow = await client.workflow.apply({
    name,
    org,
    description: "E2E test workflow with deterministic set_vars tasks",
    document: {
      dsl: "1.0.0",
      namespace: org,
      name,
      version: "1.0.0",
    },
    tasks: tasks.map((t) => ({
      name: t.name,
      kind: WorkflowTaskKind.set_vars,
      taskConfig: { variables: t.variables },
      export: { as: "${ . }" },
    })),
  });

  const id = workflow.metadata!.id;
  const slug = workflow.metadata!.name;

  return {
    id,
    slug,
    org,
    cleanup: async () => {
      await client.workflow.delete(id).catch(() => {});
    },
  };
}

export interface TestWorkflowExecutionResult {
  id: string;
  workflowId: string;
  cleanup: () => Promise<void>;
}

export interface CreateTestWaitWorkflowOpts {
  name?: string;
  org?: string;
  waitDurationSeconds?: number;
}

export async function createTestWaitWorkflow(
  client: Stigmer,
  opts?: CreateTestWaitWorkflowOpts,
): Promise<TestWorkflowResult> {
  const name = opts?.name ?? `e2e-wait-wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const org = opts?.org ?? DEFAULT_ORG;
  const waitSeconds = opts?.waitDurationSeconds ?? 10;

  const workflow = await client.workflow.apply({
    name,
    org,
    description: "E2E workflow with wait task for lifecycle testing",
    document: {
      dsl: "1.0.0",
      namespace: org,
      name,
      version: "1.0.0",
    },
    // Task names: snake_case per WorkflowTask.name's proto constraint
    // (see createTestWorkflow above).
    tasks: [
      {
        name: "blocking_wait",
        kind: WorkflowTaskKind.wait,
        taskConfig: { duration: { seconds: waitSeconds } },
      },
      {
        name: "final_step",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { completed: "true" } },
        export: { as: "${ . }" },
      },
    ],
  });

  const id = workflow.metadata!.id;
  const slug = workflow.metadata!.name;

  return {
    id,
    slug,
    org,
    cleanup: async () => {
      await client.workflow.delete(id).catch(() => {});
    },
  };
}

/**
 * Creates a workflow with tasks spanning multiple visual classes for T01
 * visual registry E2E testing. Includes: agent_call (task-card),
 * switch_case (decision-diamond), human_input (gate-octagon),
 * set_vars (task-card), and wait (event-circle).
 */
export async function createMultiKindTestWorkflow(
  client: Stigmer,
  opts?: { name?: string; org?: string },
): Promise<TestWorkflowResult> {
  const name = opts?.name ?? `e2e-multi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const org = opts?.org ?? DEFAULT_ORG;

  const workflow = await client.workflow.apply({
    name,
    org,
    description: "E2E multi-kind workflow for visual registry testing",
    document: {
      dsl: "1.0.0",
      namespace: org,
      name,
      version: "1.0.0",
    },
    tasks: [
      {
        name: "init_vars",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { status: "started" } },
        export: { as: "${ . }" },
      },
      {
        name: "classify_input",
        kind: WorkflowTaskKind.agent_call,
        taskConfig: { agent: "test-agent", message: "classify this" },
        export: { as: "${ . }" },
      },
      {
        name: "route_by_type",
        kind: WorkflowTaskKind.switch_case,
        taskConfig: {
          cases: [
            { name: "urgent", when: "${ $context.classify_input.severity == 'high' }", then: "approval_gate" },
            { name: "default", then: "cooldown" },
          ],
        },
      },
      {
        name: "approval_gate",
        kind: WorkflowTaskKind.human_input,
        taskConfig: {
          prompt: "Approve escalation?",
          outcomes: [
            { name: "approve", label: "Approve" },
            { name: "deny", label: "Deny" },
          ],
        },
        flow: { then: "cooldown" },
      },
      {
        name: "cooldown",
        kind: WorkflowTaskKind.wait,
        taskConfig: { duration: { seconds: 1 } },
      },
    ],
  });

  const id = workflow.metadata!.id;
  const slug = workflow.metadata!.name;

  return {
    id,
    slug,
    org,
    cleanup: async () => {
      await client.workflow.delete(id).catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------
// Skill seeding (content-addressed version history)
// ---------------------------------------------------------------------------

export interface TestSkillResult {
  id: string;
  slug: string;
  org: string;
  /** Push an updated artifact (changed body → new version). Returns the new hash. */
  pushUpdate: (body: string) => Promise<string>;
  cleanup: () => Promise<void>;
}

export interface CreateTestSkillOpts {
  name?: string;
  org?: string;
  body?: string;
}

/**
 * Seeds a skill by building a minimal stored ZIP containing a SKILL.md and
 * pushing it. Returns a handle that can push further versions, exercising the
 * content-addressed version history end to end.
 */
export async function createTestSkill(
  client: Stigmer,
  opts?: CreateTestSkillOpts,
): Promise<TestSkillResult> {
  const name = opts?.name ?? `e2e-skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const org = opts?.org ?? DEFAULT_ORG;

  const buildMd = (body: string) =>
    `---\nname: ${name}\ndescription: E2E seeded skill for version history\n---\n\n# ${name}\n\n${body}\n`;

  const push = async (body: string) => {
    const artifact = buildStoredZip("SKILL.md", buildMd(body));
    return client.skill.push({
      org,
      artifact,
      tag: "latest",
      message: `e2e push ${new Date().toISOString()}`,
    } as never);
  };

  const created = await push(opts?.body ?? "Initial version body.");
  const id = created.metadata!.id;
  const slug = created.metadata!.slug;

  return {
    id,
    slug,
    org,
    pushUpdate: async (body: string) => {
      const updated = await push(body);
      return updated.status?.versionHash ?? "";
    },
    cleanup: async () => {
      await client.skill.delete(id).catch(() => {});
    },
  };
}

/**
 * Builds a single-entry ZIP archive using the STORED (uncompressed) method.
 * Self-contained (no third-party zip dependency) — relies only on Node's
 * built-in CRC-32 (Node >= 22). The backend extracts SKILL.md from this archive.
 */
function buildStoredZip(fileName: string, content: string): Uint8Array {
  const nameBytes = Buffer.from(fileName, "utf8");
  const data = Buffer.from(content, "utf8");
  const crc = crc32(data) >>> 0;
  const size = data.length;

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(0, 8); // method: stored
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0, 12); // mod date
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(size, 18); // compressed size
  localHeader.writeUInt32LE(size, 22); // uncompressed size
  localHeader.writeUInt16LE(nameBytes.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra length

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0); // central dir signature
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed
  centralHeader.writeUInt16LE(0, 8); // flags
  centralHeader.writeUInt16LE(0, 10); // method: stored
  centralHeader.writeUInt16LE(0, 12); // mod time
  centralHeader.writeUInt16LE(0, 14); // mod date
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(size, 20); // compressed size
  centralHeader.writeUInt32LE(size, 24); // uncompressed size
  centralHeader.writeUInt16LE(nameBytes.length, 28);
  centralHeader.writeUInt16LE(0, 30); // extra length
  centralHeader.writeUInt16LE(0, 32); // comment length
  centralHeader.writeUInt16LE(0, 34); // disk number start
  centralHeader.writeUInt16LE(0, 36); // internal attrs
  centralHeader.writeUInt32LE(0, 38); // external attrs
  centralHeader.writeUInt32LE(0, 42); // local header offset

  const localBlock = Buffer.concat([localHeader, nameBytes, data]);
  const centralBlock = Buffer.concat([centralHeader, nameBytes]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(1, 8); // entries this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralBlock.length, 12); // CD size
  eocd.writeUInt32LE(localBlock.length, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // comment length

  return new Uint8Array(Buffer.concat([localBlock, centralBlock, eocd]));
}

export async function createTestWorkflowExecution(
  client: Stigmer,
  workflowId: string,
  opts?: { org?: string; triggerMessage?: string },
): Promise<TestWorkflowExecutionResult> {
  const org = opts?.org ?? DEFAULT_ORG;
  const name = `e2e-exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const execution = await client.workflowExecution.create({
    name,
    org,
    workflowId,
    triggerMessage: opts?.triggerMessage,
  });

  const id = execution.metadata!.id;

  return {
    id,
    workflowId,
    cleanup: async () => {
      await client.workflowExecution.delete(id).catch(() => {});
    },
  };
}
