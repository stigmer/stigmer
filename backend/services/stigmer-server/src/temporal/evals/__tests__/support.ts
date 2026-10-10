/**
 * Shared doubles for the eval activities' tests: a temp store seeded with
 * a plugin, its composed agent and server, and an eval; an in-memory
 * suite source over real `evals/` files read by `readEvalSuite`; a
 * catalog that knows one model; a try lane that records what it is asked
 * and creates rows in the store as the real chains would; a score
 * recorder with the chain's one-per-writer rule.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { PluginFiles } from "@stigmer/plugin-package";
import { inMemoryPluginFiles } from "@stigmer/plugin-package";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import type { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { RunSchema, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreState } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/status_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { EvalModelCatalog } from "../../../domain/plugin-eval/matrix.js";
import { sessionIdOf } from "../../../domain/run/target.js";
import type { JudgeSessionDeleter, ScoreDeleter, ScoreRecorder } from "../../../domain/score/ports.js";
import { listRunScores } from "../../../domain/score/queries.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { PLUGIN_LABEL } from "../../../pipeline/apiresource-labels.js";
import type { Store } from "../../../store/interface.js";
import type { EvalSuiteSource } from "../../../domain/plugin-eval/suite.js";
import type { PluginEvalTryLane } from "../ports.js";

export const ORG = "acme";
export const PLUGIN_ID = "plg_1";
export const EVAL_ID = "pev_1";
export const DIGEST = "d".repeat(64);
export const MODEL = "claude-sonnet-4-6";

/** A two-case suite: one that runs, one that needs a feature Stigmer does not run yet. */
export const SUITE_FILES: Readonly<Record<string, string>> = {
  "evals/first-case/prompt.md":
    "---\nmax_turns: 4\nallowed_tools: [Read, Skill, Bash]\ntimeout_seconds: 120\n---\n\nWrite me a commit message.\n",
  "evals/first-case/graders/mentions.md":
    "---\ntype: regex\npattern: fetchUser\nweight: 2\n---\n",
  "evals/first-case/graders/skill-fired.md":
    "---\ntype: tool_used\ntool: Skill\ninput_match: '\"skill\"\\s*:\\s*\"(?:[\\w-]+:)?commit-message\"'\n---\n",
  "evals/first-case/graders/criteria.md": "---\ntype: llm\n---\n\nPASS if the message names the rename.\n",
  "evals/scaffolded/case.yaml":
    'schema_version: "1.1"\nname: scaffolded\ncontext:\n  scaffold_script: fixture.sh\nexecution:\n  prompt: go\ngraders:\n  - name: any\n    type: regex\n    pattern: x\n',
};

export function suiteFiles(files: Readonly<Record<string, string>> = SUITE_FILES): PluginFiles {
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

export async function seedPlugin(store: Store, withAgent = true): Promise<void> {
  await store.saveResource(
    ApiResourceKind.plugin,
    PLUGIN_ID,
    PluginSchema,
    create(PluginSchema, {
      metadata: { id: PLUGIN_ID, org: ORG, slug: "thermos", name: "thermos" },
      spec: { name: "thermos" },
      status: { digest: DIGEST },
    }),
  );
  if (withAgent) {
    await store.saveResource(
      ApiResourceKind.agent,
      "agt_1",
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_1", org: ORG, slug: "thermos", name: "thermos", labels: { [PLUGIN_LABEL]: PLUGIN_ID } },
      }),
    );
  }
  await store.saveResource(
    ApiResourceKind.mcp_server,
    "mcp_1",
    McpServerSchema,
    create(McpServerSchema, {
      metadata: { id: "mcp_1", org: ORG, slug: "github", name: "github", labels: { [PLUGIN_LABEL]: PLUGIN_ID } },
    }),
  );
}

export async function seedEval(
  store: Store,
  spec: {
    readonly runs?: number;
    readonly maxCostUsd?: number;
    readonly ablation?: PluginEvalAblation;
    readonly concurrency?: number;
    readonly judgeModel?: string;
    readonly threshold?: number;
    readonly allowTools?: string[];
  } = {},
  phase: PluginEvalPhase = PluginEvalPhase.pending,
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.plugin_eval,
    EVAL_ID,
    PluginEvalSchema,
    create(PluginEvalSchema, {
      metadata: { id: EVAL_ID, org: ORG, name: EVAL_ID },
      spec: create(PluginEvalSpecSchema, {
        pluginId: PLUGIN_ID,
        pluginDigest: DIGEST,
        maxCostUsd: 5,
        runs: 2,
        ...spec,
      }),
      status: { phase },
    }),
  );
}

export async function readEval(store: Store) {
  return store.getResource(ApiResourceKind.plugin_eval, EVAL_ID, PluginEvalSchema);
}

/** What the lane was asked, and how it answers. */
export interface LaneRecord {
  readonly sessions: Array<{ session: Session; caller: CallerIdentity | undefined }>;
  readonly runs: Array<{ run: Run; caller: CallerIdentity | undefined }>;
  readonly terminated: string[];
  readonly deletedSessions: string[];
  /** The next run create's refusal, if any. */
  refuse: ConnectError | undefined;
  /** The phase a created run is stored in. */
  phase: RunPhase;
}

export function lane(store: Store): {
  lane: PluginEvalTryLane;
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
        await store.saveResource(ApiResourceKind.session, `ses_${next}`, SessionSchema, stored);
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
        await store.saveResource(ApiResourceKind.run, `run_${next}`, RunSchema, stored);
        return stored;
      },
      async terminateRun(runId) {
        record.terminated.push(runId);
        const run = await store.getResource(ApiResourceKind.run, runId, RunSchema).catch(() => undefined);
        if (run === undefined) {
          throw new ConnectError("not found", Code.NotFound);
        }
        await store.updateResource(ApiResourceKind.run, runId, RunSchema, (live) => {
          if (live.status !== undefined) {
            live.status.phase = RunPhase.RUN_TERMINATED;
          }
        });
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
export function scoreChain(store: Store): { recorder: ScoreRecorder; deleter: ScoreDeleter } {
  let written = 0;
  return {
    recorder: {
      async record(score) {
        const runId = score.spec?.runId ?? "";
        const run = await store.getResource(ApiResourceKind.run, runId, RunSchema).catch(() => undefined);
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
          state: stored.spec?.value.case !== undefined ? ScoreState.graded : ScoreState.not_graded,
        });
        await store.saveResource(ApiResourceKind.score, id, ScoreSchema, stored);
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
