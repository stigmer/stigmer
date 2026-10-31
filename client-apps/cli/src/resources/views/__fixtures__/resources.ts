// Fixed resources for the designed `get` views' goldens and unit tests: one
// of each kind carrying every field its view shows, plus the session's runs,
// all stamped from one frozen instant so nothing reads the clock. The
// organization is filed under its id, as the server stores it; the views
// name it by the label the caller passes ("acme").

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentSchema, type Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { EnvironmentSchema, type Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { RoutineSchema, type Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RunSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, ServiceTier, ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema, type Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { EnvironmentSource, Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { SkillSchema, type Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema, type Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";

/** The organization every fixture belongs to, by the id the server files it under. */
export const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

/** The frozen instant the fixtures are stamped from: 2026-10-30 09:15 UTC. */
export const FROZEN = Date.UTC(2026, 9, 30, 9, 15, 0);

/** `minutes` after the frozen instant, as an ISO string. */
export function at(minutes: number): string {
  return new Date(FROZEN + minutes * 60_000).toISOString();
}

function audit(createdMinutes: number, updatedMinutes: number) {
  return {
    specAudit: {
      createdAt: timestampFromDate(new Date(at(createdMinutes))),
      updatedAt: timestampFromDate(new Date(at(updatedMinutes))),
    },
  };
}

const INSTRUCTIONS = [
  "You review a quarter's ledger against its budget.",
  "",
  "Read the ledger you are given, then:",
  "  - compare each account's actual spend with its budget;",
  "  - name every account more than ten percent over or under, with its variance, in the words a finance lead would use;",
  "  - say what most likely drove each one, from the ledger's own lines.",
  "",
  "Keep the report short. An account within its budget is left out.",
  "",
  "Save the report as variance-report.md.",
  "Ask before sending it to anyone.",
  "Sign as the finance team.",
  "Never name a person.",
  "Use the past tense.",
  "Write dates as 31 October 2026.",
  "End with the three largest variances.",
].join("\n");

/** An agent carrying every part its view shows; 16 lines of instructions, 4 past the cut. */
export const agent: Agent = create(AgentSchema, {
  metadata: { id: "agt_01jbbbbbbbbbbbbbbbbbbbbbbb", name: "Variance Reporter", slug: "variance-reporter", org: ACME_ID },
  spec: {
    description: "Reviews a quarter's ledger against its budget and saves a variance report.",
    instructions: INSTRUCTIONS,
    skillRefs: [
      { org: ACME_ID, kind: ApiResourceKind.skill, slug: "finance-style" },
      { org: "stigmer", kind: ApiResourceKind.skill, slug: "semver", version: "stable" },
    ],
    mcpServers: [
      { name: "github", url: "https://api.githubcopilot.com/mcp/" },
      { name: "linear", url: "https://mcp.linear.app/mcp" },
    ],
    tools: ["Read", "Grep", "Glob", "WebFetch", "mcp__github", "mcp__linear__list_issues"],
    disallowedTools: ["Bash(git push *)"],
    subagents: [{ org: ACME_ID, kind: ApiResourceKind.agent, slug: "ledger-reader", version: "a".repeat(64) }],
    plugins: [{ org: ACME_ID, kind: ApiResourceKind.plugin, slug: "ledger-kit" }],
    environmentRef: { org: ACME_ID, kind: ApiResourceKind.environment, slug: "finance-build" },
    env: {
      GITHUB_TOKEN: { isSecret: true, description: "Reads the ledger's repository." },
      REPORT_CURRENCY: { optional: true },
      REGION: {},
    },
    harness: Harness.CLAUDE,
    runConfig: {
      modelName: "claude-sonnet-4-5",
      thinkingMode: ThinkingMode.ENABLED,
      maxCostUsd: 2,
    },
  },
  status: { audit: audit(-2880, -90) },
});

/** A skill pushed from a git repository, with frontmatter and 3 lines of body. */
export const skill: Skill = create(SkillSchema, {
  metadata: { id: "skl_01jccccccccccccccccccccccc", name: "finance-style", slug: "finance-style", org: ACME_ID },
  spec: {
    name: "finance-style",
    description: "How the finance team writes a variance line.",
    tag: "stable",
    skillMd: [
      "---",
      "name: finance-style",
      "description: How the finance team writes a variance line.",
      "---",
      "",
      "# Finance style",
      "",
      "One line per account, its variance first, in the finance lead's words.",
    ].join("\n"),
  },
  status: {
    versionHash: "4f2a9c1e7b3d5a6f8e0c2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a",
    gitProvenance: {
      remoteUrl: "https://github.com/acme/skills.git",
      ref: "main",
      commit: "9e1b2c3d4e5f60718293a4b5c6d7e8f901234567",
      subdir: "finance-style",
    },
    audit: audit(-4320, -4320),
  },
});

/** A conversation with an agent, its Environment named by the agent. */
export const session: Session = create(SessionSchema, {
  metadata: { id: "ses_01jddddddddddddddddddddddd", name: "ses-01jddd", slug: "ses-01jddd", org: ACME_ID },
  spec: {
    subject: "Q3 ledger variance review",
    agentRef: { org: ACME_ID, kind: ApiResourceKind.agent, slug: "variance-reporter" },
  },
  status: {
    state: "running",
    agentId: "agt_01jbbbbbbbbbbbbbbbbbbbbbbb",
    environment: { org: ACME_ID, kind: ApiResourceKind.environment, slug: "finance-build" },
    environmentSource: EnvironmentSource.AGENT,
    audit: audit(-60, -1),
  },
});

/** The session's run number `index`, started and (when `endMinutes` is given) ended that many minutes from the frozen instant. */
function sessionRun(index: number, phase: RunPhase, startMinutes: number, endMinutes?: number): Run {
  return create(RunSchema, {
    metadata: { id: `run_01jeeeeeeeeeeeeeeeeeeeeee${index}`, org: ACME_ID },
    spec: { target: { case: "sessionId", value: session.metadata!.id } },
    status: {
      phase,
      startedAt: at(startMinutes),
      completedAt: endMinutes === undefined ? "" : at(endMinutes),
    },
  });
}

/** The session's seven runs, newest first (the backend's order): one working, one failed, five completed. */
export const sessionRuns: readonly Run[] = [
  sessionRun(7, RunPhase.RUN_IN_PROGRESS, -3),
  sessionRun(6, RunPhase.RUN_FAILED, -20, -19.5),
  sessionRun(5, RunPhase.RUN_COMPLETED, -30, -28),
  sessionRun(4, RunPhase.RUN_COMPLETED, -40, -39),
  sessionRun(3, RunPhase.RUN_COMPLETED, -50, -49),
  sessionRun(2, RunPhase.RUN_COMPLETED, -55, -54),
  sessionRun(1, RunPhase.RUN_COMPLETED, -60, -58),
];

/** A turn that failed: its message, error, stop cause, tokens and resolved settings. */
export const failedRun: Run = create(RunSchema, {
  metadata: { id: "run_01jfffffffffffffffffffffff", org: ACME_ID },
  spec: {
    target: { case: "sessionId", value: session.metadata!.id },
    message: "Review this quarter's ledger and save the variance report.",
  },
  status: {
    phase: RunPhase.RUN_FAILED,
    agentId: "agt_01jbbbbbbbbbbbbbbbbbbbbbbb",
    startedAt: at(-20),
    completedAt: at(-17.75),
    error: "the model provider refused the request: overloaded",
    stopCause: "model_error",
    streamingUsage: { inputTokens: 12_400n, outputTokens: 6_000n, totalTokens: 18_400n, model: "claude-sonnet-4-5" },
    runConfig: { modelName: "claude-sonnet-4-5", serviceTier: ServiceTier.STANDARD },
  },
});

/** A child organization of acme's parent. */
export const organization: Organization = create(OrganizationSchema, {
  metadata: { id: ACME_ID, name: "Acme Robotics", slug: "acme" },
  spec: {
    description: "Robots for warehouses.",
    parentOrg: "org_01jggggggggggggggggggggggg",
  },
  status: { audit: audit(-525_600, -1440) },
});

/** A weekday routine the platform paused after failures. */
export const routine: Routine = create(RoutineSchema, {
  metadata: { id: "rtn_01jhhhhhhhhhhhhhhhhhhhhhhh", name: "Weekday digest", slug: "weekday-digest", org: ACME_ID },
  spec: {
    cron: "0 9 * * 1,2,3,4,5",
    timeZone: "Asia/Kolkata",
    enabled: true,
    agent: {
      agentRef: { org: ACME_ID, kind: ApiResourceKind.agent, slug: "variance-reporter" },
      message: "Summarise yesterday's merged pull requests.",
    },
  },
  status: {
    pausedReason: "5 consecutive failed runs",
    consecutiveFailures: 5,
    lastFireAt: timestampFromDate(new Date(at(-1440))),
    lastRunId: "run_01jiiiiiiiiiiiiiiiiiiiiiii",
    audit: audit(-10_080, -1440),
  },
});

/** A limited Environment with hosts and packages. */
export const environment: Environment = create(EnvironmentSchema, {
  metadata: { id: "env_01jjjjjjjjjjjjjjjjjjjjjjjj", name: "Docs build", slug: "finance-build", org: ACME_ID },
  spec: {
    description: "What the docs site needs to build.",
    networking: {
      type: NetworkingType.limited,
      allowedHosts: ["api.github.com", "*.githubusercontent.com"],
      allowPackageManagers: true,
    },
    packages: { apt: ["graphviz"], npm: ["@mermaid-js/mermaid-cli", "prettier"], pip: ["mkdocs", "mkdocs-material"] },
  },
  status: { audit: audit(-20_160, -2880) },
});
