/**
 * Shared doubles for the eval run activities' tests: a temp store seeded
 * with a plugin (one row, its status listing a skill and an MCP server, as
 * install writes it) and an eval run about it, or an agent attaching that
 * plugin and an eval run about the agent stamping it; an in-memory
 * suite source over real `evals/` files read by `readEvalSuite`; a
 * catalog that knows one model; a try lane that records what it is asked
 * and creates rows in the store as the real chains would; a score
 * recorder with the chain's one-per-writer rule; and a turn's session
 * events appended under a stored run, as its runner writes them.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { PluginFiles } from "@stigmer/plugin-package";
import { inMemoryPluginFiles } from "@stigmer/plugin-package";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunSpecSchema, EvalRunTargetSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import type { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { EvalRunPhase, EvalRunPluginSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ScoreSchema } from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreState } from "@stigmer/apis/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/score/v1/status_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { EvalModelCatalog } from "../../../domain/eval-run/matrix.js";
import { sessionIdOf } from "../../../domain/run/target.js";
import type {
  JudgeSessionDeleter,
  ScoreDeleter,
  ScoreRecorder,
} from "../../../domain/score/ports.js";
import { listRunScores } from "../../../domain/score/queries.js";
import {
  RunEventsBuilder,
  appendRunEvents,
} from "../../../domain/session/events/__tests__/run-events-fixture.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { Store } from "../../../store/interface.js";
import type { EvalSuiteSource } from "../../../domain/eval-run/suite.js";
import type { EvalRunTryLane } from "../ports.js";

export const ORG = "acme";
export const PLUGIN_ID = "plg_1";
export const EVAL_ID = "evr_1";
export const DIGEST = "d".repeat(64);
export const MODEL = "claude-sonnet-4-6";

/** A two-case suite: one that runs, one that needs a feature Stigmer does not run yet. */
export const SUITE_FILES: Readonly<Record<string, string>> = {
  "evals/first-case/prompt.md":
    "---\nmax_turns: 4\nallowed_tools: [Read, Skill, Bash]\ntimeout_seconds: 120\n---\n\nWrite me a commit message.\n",
  "evals/first-case/graders/mentions.md":
    "---\ntype: regex\npattern: fetchUser\nweight: 2\n---\n",
  "evals/first-case/graders/skill-fired.md":
    '---\ntype: tool_used\ntool: Skill\ninput_match: \'"skill"\\s*:\\s*"(?:[\\w-]+:)?commit-message"\'\n---\n',
  "evals/first-case/graders/criteria.md":
    "---\ntype: llm\n---\n\nPASS if the message names the rename.\n",
  "evals/other-plugin/case.yaml":
    'schema_version: "1.1"\nname: other-plugin\nplugins: [/plugins/other]\nexecution:\n  prompt: go\ngraders:\n  - name: any\n    type: regex\n    pattern: x\n',
};

export function suiteFiles(
  files: Readonly<Record<string, string>> = SUITE_FILES,
): PluginFiles {
  return inMemoryPluginFiles(new Map(Object.entries(files)));
}

/** A suite source over `files`, counting its reads; `broken` makes every read fail. */
export function suiteSource(
  files: PluginFiles = suiteFiles(),
): EvalSuiteSource & { reads: number; broken: boolean } {
  const source = {
    reads: 0,
    broken: false,
    async readArchive(): Promise<PluginFiles> {
      source.reads++;
      if (source.broken) {
        throw new Error("the archive is unreadable");
      }
      return files;
    },
  };
  return source;
}

export const catalog: EvalModelCatalog = {
  isCatalogModel: (_harness, model) => model === MODEL,
  defaultModel: () => "",
};

/** The seeded plugin's one skill, at its path in the plugin. */
export const PLUGIN_SKILL = { name: "commit-message", path: "skills/commit-message" } as const;

/** The seeded plugin's one MCP server, and the segment a turn names it by (`toolServerSegment`). */
export const PLUGIN_SERVER = "github";
export const PLUGIN_SERVER_SEGMENT = "plugin_thermos_github";

/** The plugin under eval: one row whose status lists what it carries, at DIGEST. */
export async function seedPlugin(store: Store): Promise<void> {
  await store.saveResource(
    ApiResourceKind.plugin,
    PLUGIN_ID,
    PluginSchema,
    create(PluginSchema, {
      metadata: { id: PLUGIN_ID, org: ORG, slug: "thermos", name: "thermos" },
      spec: { name: "thermos" },
      status: {
        digest: DIGEST,
        skills: [{ ...PLUGIN_SKILL, description: "Writes commit messages" }],
        mcpServers: [{ name: PLUGIN_SERVER }],
      },
    }),
  );
}

export async function seedEval(
  store: Store,
  spec: {
    readonly runs?: number;
    readonly maxCostUsd?: number;
    readonly ablation?: EvalRunAblation;
    readonly concurrency?: number;
    readonly judgeModel?: string;
    readonly threshold?: number;
    readonly allowTools?: string[];
  } = {},
  phase: EvalRunPhase = EvalRunPhase.pending,
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.eval_run,
    EVAL_ID,
    EvalRunSchema,
    create(EvalRunSchema, {
      metadata: { id: EVAL_ID, org: ORG, name: EVAL_ID },
      spec: create(EvalRunSpecSchema, {
        subject: { case: "pluginId", value: PLUGIN_ID },
        pluginDigest: DIGEST,
        maxCostUsd: 5,
        runs: 2,
        ...spec,
      }),
      status: {
        phase,
        plugins: [create(EvalRunPluginSchema, { pluginId: PLUGIN_ID, pluginSlug: "thermos", pluginDigest: DIGEST, compared: true })],
      },
    }),
  );
}

export async function readEval(store: Store) {
  return store.getResource(
    ApiResourceKind.eval_run,
    EVAL_ID,
    EvalRunSchema,
  );
}

export const AGENT_ID = "agt_1";
export const AGENT_HASH = "a".repeat(64);
export const EVAL_RUN_ON_AGENT_ID = "evr_agent";

/** The agent under eval at AGENT_HASH, attaching the seeded plugin and running MODEL. */
export async function seedAgent(
  store: Store,
  options: { readonly mcpServers?: ReadonlyArray<{ readonly name: string; readonly url: string }> } = {},
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.agent,
    AGENT_ID,
    AgentSchema,
    create(AgentSchema, {
      metadata: { id: AGENT_ID, org: ORG, slug: "support-desk", name: "support-desk" },
      spec: {
        instructions: "You answer support tickets politely.",
        runConfig: { modelName: MODEL },
        plugins: [{ kind: ApiResourceKind.plugin, slug: "thermos" }],
        mcpServers: (options.mcpServers ?? []).map((server) => ({ ...server })),
      },
      status: { versionHash: AGENT_HASH },
    }),
  );
}

/**
 * An eval run of the seeded agent stamping the seeded plugin at
 * `pluginDigest`; `compared` compares that plugin, so each case runs
 * with and without it.
 */
export async function seedEvalRunOnAgent(
  store: Store,
  options: {
    readonly targets?: ReadonlyArray<{ readonly harness: Harness; readonly modelName: string }>;
    readonly pluginDigest?: string;
    readonly threshold?: number;
    readonly phase?: EvalRunPhase;
    readonly compared?: boolean;
  } = {},
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.eval_run,
    EVAL_RUN_ON_AGENT_ID,
    EvalRunSchema,
    create(EvalRunSchema, {
      metadata: { id: EVAL_RUN_ON_AGENT_ID, org: ORG, name: EVAL_RUN_ON_AGENT_ID },
      spec: {
        subject: { case: "agentId", value: AGENT_ID },
        agentVersion: AGENT_HASH,
        comparedPluginId: options.compared === true ? PLUGIN_ID : "",
        runs: 1,
        maxCostUsd: 5,
        ...(options.threshold !== undefined && { threshold: options.threshold }),
        targets: (options.targets ?? []).map((target) => create(EvalRunTargetSchema, target)),
      },
      status: {
        phase: options.phase ?? EvalRunPhase.pending,
        agentVersionHash: AGENT_HASH,
        plugins: [
          create(EvalRunPluginSchema, {
            pluginId: PLUGIN_ID,
            pluginSlug: "thermos",
            pluginDigest: options.pluginDigest ?? DIGEST,
            attached: true,
            compared: options.compared === true,
          }),
        ],
      },
    }),
  );
}

export async function readEvalRunOnAgent(store: Store) {
  return store.getResource(ApiResourceKind.eval_run, EVAL_RUN_ON_AGENT_ID, EvalRunSchema);
}

/** What the lane was asked, and how it answers. */
export interface LaneRecord {
  readonly sessions: Array<{
    session: Session;
    caller: CallerIdentity | undefined;
  }>;
  readonly runs: Array<{ run: Run; caller: CallerIdentity | undefined }>;
  readonly terminated: string[];
  readonly deletedSessions: string[];
  /** The next run create's refusal, if any. */
  refuse: ConnectError | undefined;
  /** The phase a created run is stored in. */
  phase: RunPhase;
}

export function lane(store: Store): {
  lane: EvalRunTryLane;
  sessions: JudgeSessionDeleter;
  record: LaneRecord;
} {
  let next = 0;
  const record: LaneRecord = {
    sessions: [],
    runs: [],
    terminated: [],
    deletedSessions: [],
    refuse: undefined,
    phase: RunPhase.RUN_PENDING,
  };
  return {
    record,
    lane: {
      async createSession(session, caller) {
        next++;
        const stored = clone(SessionSchema, session);
        stored.metadata = { ...stored.metadata!, id: `ses_${next}` };
        record.sessions.push({ session: stored, caller });
        await store.saveResource(
          ApiResourceKind.session,
          `ses_${next}`,
          SessionSchema,
          stored,
        );
        return stored;
      },
      async createRun(run, caller) {
        const refusal = record.refuse;
        if (refusal !== undefined) {
          record.refuse = undefined;
          throw refusal;
        }
        next++;
        const stored = clone(RunSchema, run);
        stored.metadata = { ...stored.metadata!, id: `run_${next}` };
        stored.status = create(RunStatusSchema, { phase: record.phase });
        record.runs.push({ run: stored, caller });
        await store.saveResource(
          ApiResourceKind.run,
          `run_${next}`,
          RunSchema,
          stored,
        );
        return stored;
      },
      async terminateRun(runId) {
        record.terminated.push(runId);
        const run = await store
          .getResource(ApiResourceKind.run, runId, RunSchema)
          .catch(() => undefined);
        if (run === undefined) {
          throw new ConnectError("not found", Code.NotFound);
        }
        await store.updateResource(
          ApiResourceKind.run,
          runId,
          RunSchema,
          (live) => {
            if (live.status !== undefined) {
              live.status.phase = RunPhase.RUN_TERMINATED;
            }
          },
        );
      },
    },
    sessions: {
      async delete(sessionId) {
        record.deletedSessions.push(sessionId);
        await store.deleteResource(ApiResourceKind.session, sessionId);
      },
    },
  };
}

/** The session id a stored run names. */
export function sessionOf(run: Run): string {
  return sessionIdOf(run.spec);
}

/** The score chain as the activities see it: one score per writer and version, the run required. */
export function scoreChain(store: Store): {
  recorder: ScoreRecorder;
  deleter: ScoreDeleter;
} {
  let written = 0;
  return {
    recorder: {
      async record(score) {
        const runId = score.spec?.runId ?? "";
        const run = await store
          .getResource(ApiResourceKind.run, runId, RunSchema)
          .catch(() => undefined);
        if (run === undefined) {
          throw new ConnectError("Run not found", Code.NotFound);
        }
        const held = (await listRunScores(store, silentLogger, runId)).some(
          (other) =>
            other.spec?.metric === score.spec?.metric &&
            other.spec?.evaluatorVersion === score.spec?.evaluatorVersion,
        );
        if (held) {
          throw new ConnectError("exists", Code.AlreadyExists);
        }
        written++;
        const id = `scr_eval${written}`;
        const stored = clone(ScoreSchema, score);
        stored.metadata = { ...stored.metadata!, id, name: id, slug: id };
        stored.status = create(ScoreStatusSchema, {
          notGradedReason: stored.status?.notGradedReason ?? "",
          state:
            stored.spec?.value.case !== undefined
              ? ScoreState.graded
              : ScoreState.not_graded,
        });
        await store.saveResource(
          ApiResourceKind.score,
          id,
          ScoreSchema,
          stored,
        );
        return stored;
      },
    },
    deleter: {
      delete: async (scoreId) => {
        await store.deleteResource(ApiResourceKind.score, scoreId);
      },
    },
  };
}

export { silentLogger };

/** Appends one turn's events to the stored run's session, as its runner writes them. */
export async function appendTurnEvents(
  store: Store,
  runId: string,
  build: (events: RunEventsBuilder) => RunEventsBuilder,
): Promise<void> {
  const run = await store.getResource(ApiResourceKind.run, runId, RunSchema);
  await appendRunEvents(
    store,
    sessionIdOf(run.spec),
    run.metadata?.org ?? "",
    build(new RunEventsBuilder(runId)).build(),
  );
}
