/**
 * The harness adapter contract — the line between what the turn runtime owns
 * and what a harness owns.
 *
 * Stigmer runs an agent turn through one of several engines ("harnesses"):
 * the native LangGraph deep-agent, the Cursor SDK, and in future the Claude
 * Agent SDK and the Codex SDK. Everything about a turn that does NOT touch a
 * vendor SDK — fetching the execution, resolving the blueprint, fetching the
 * run's values, provisioning and locking the workspace, mounting skills,
 * resolving MCP servers, the approval default and the tool scope, seeding the transcript, the
 * persist chokepoint, the stall watchdog, the Temporal heartbeat, pause vs
 * shutdown, the cost cap, the terminal mapping — is the RUNTIME's
 * (`run-turn.ts`), written once. What a harness owns is its SDK slice: how
 * the engine is created or resumed, how the prompt is placed, how MCP servers
 * are bound, how the engine is made to stop before a gated side effect, and
 * how its events become transcript rows. This file is the whole of what a
 * harness author has to implement; `__test-utils__/harness-contract/` is the
 * kit every implementation has to pass.
 *
 * Every member here is a rename of a function the Cursor loop already injects
 * (`execute-cursor/turn-stream.ts` `CursorTurnStreamDeps`) or a fact the
 * runtime cannot read anywhere else. Nothing here is speculative: where the
 * program's original sketch and the code disagreed, the code won, and the
 * disagreement was ruled before the code landed (#1064; the growth below in
 * #1070).
 *
 * What is deliberately NOT on this contract, and why:
 *
 *  - No `dispose()`. One adapter object serves many concurrent turns
 *    (`maxConcurrentActivities`), so a per-turn teardown method on the
 *    adapter is a race. The adapter owns its per-turn teardown in its own
 *    `finally` inside `runTurn` (the Cursor harness parks its agent there).
 *  - No `isCancelled()`, no `heartbeat(details)`, and the sink does not
 *    EXTEND a status-writer interface. Each would be a second way of saying
 *    something `stopSignal`, `recordActivity()` or `requestPersist()` already
 *    says, and two writers of one fact drift. The transcript builder rides
 *    the sink as a MEMBER (`transcript`), and the distinction holds: its
 *    `dirty` is a fact the adapter's persist decision reads, `requestPersist()`
 *    is the act; one fact, one act, no second writer.
 *  - No `reason` on `interrupted`, no payload on `completed`, no `retryable`
 *    on `failed`. Every cause of stopping is the runtime's own evidence; the
 *    final text and structured output are already folded onto the rows;
 *    Temporal never retries a returned activity, so a retryable flag would
 *    have no reader.
 *  - No token-rotation hook. `Config.stigmerTokenRef` is the canonical
 *    mutable ref; an adapter's transport reads it per request.
 *  - No `TurnInput.status` or `TurnInput.rows`. The runtime seeds
 *    `TurnSink.rows` with a reinvocation's asks from the session's log; a
 *    second copy on the input is the drift the single-source-of-truth
 *    mandate forbids.
 *  - No execution context. "This activity is execution X" is the runtime's
 *    ambient fact for the WHOLE activity (`shared/execution-context.ts`, an
 *    `AsyncLocalStorage` the runtime enters before anything runs); the
 *    interceptors read it per request, so no adapter establishes or
 *    propagates it.
 *  - No persist cadence. The runtime's chokepoint is single-flight and
 *    unconditional at settle; WHEN a streaming turn asks for a write is the
 *    adapter's (`shared/persist-decision.ts` over the builder's `dirty`
 *    flag, since WHEN to ask is engine cadence). Revisited with
 *    both loops in view in #1096 and kept: the cadence RULE is
 *    shared, the timing is the engine's.
 *  - No capture. The file-review capture is the runtime's whole
 *    (`harness/capture.ts`): the baseline before `runTurn`, the candidate
 *    after it, the stamp, the review decision. The one capture fact an
 *    adapter holds — what its engine observed touching CAS-owned paths — it
 *    binds through `TurnSink.bindCasObservations`.
 *
 * Module shape follows `shared/checkpointer/`: `types.ts`, `capabilities.ts`,
 * `registry.ts`, no barrel.
 */

import type { TranscriptMessage } from "@stigmer/eval-runtime";
import type { Run, RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import type { Config } from "../config.js";
import type { NormalizedActivityInput } from "../shared/activity-input.js";
import type { ArtifactStorage } from "../shared/artifact-storage.js";
import type { TimingRecorder } from "../shared/cold-start-timing.js";
import type { ResolvedBlueprint } from "../shared/blueprint-resolver.js";
import type { SessionWorkspaceProvision } from "../shared/workspace/session-provision.js";
import type { ResolvedMcpServer } from "../shared/mcp-resolver.js";
import type { ChannelMessagingInfo } from "../shared/channel-attachment.js";
import type { ActiveLeases, McpApprovalDefault } from "../shared/approval-policy.js";
import type { ToolScope } from "../shared/tool-lists.js";
import type { SkillMetadata } from "../shared/skill-resolver.js";
import type { MountedPlugin } from "../shared/plugin-mount.js";
import type { HookFormatName } from "../shared/hooks/hook-set.js";
import type { HookServerName } from "../shared/hooks/tool-view.js";
import type { McpToolListing } from "../shared/mcp-tool-listing.js";
import type { HookGroup } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import type { ListedFile, MessageFile, MountedFile } from "../shared/file-mount.js";
import type { NotViewableEntry, VisionImage } from "../shared/attachment-vision.js";
import type { EffectiveServiceTier } from "../shared/service-tier.js";
import type { EffectiveThinkingMode } from "../shared/thinking-mode.js";
import type { SenderIdentity } from "../shared/sender-identity.js";
import type { DeclaredPreferencesContent } from "../shared/declared-preferences.js";
import type { RecalledMemoriesContent } from "../shared/recalled-memories.js";
import type { RunValues } from "../shared/run-values.js";
import type { CasTouchedReader } from "../shared/filereview/cas-touched.js";
import type { HarnessCapabilities } from "./capabilities.js";
import type { ApprovalAsk } from "./approval-answers.js";
import type { TranscriptBuilder } from "./transcript/builder.js";
import type { ApprovalAction } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import type { TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

/**
 * One harness, as the runtime sees it. ONE adapter object exists per worker
 * process; it serves every concurrent turn of its harness and holds no
 * per-turn state (per-turn state lives in the `runTurn` frame). Three
 * lifetimes meet here — worker (`boot`/`shutdown`), session
 * (`releaseSession`) and turn (`runTurn`) — because the Cursor harness parks
 * an engine per SESSION between turns, longer than a turn and shorter than
 * the worker.
 *
 * `name` is a diagnostic identity (log lines, kit messages, the registry's
 * duplicate check). It is NOT the activity the harness is bound to: the wire
 * binding is the registry row's (`registry.ts` `HARNESS_ACTIVITY_NAMES`),
 * so an adapter never declares a byte-pinned wire name and a test double can
 * implement this interface under its own name.
 */
export interface HarnessAdapter {
  readonly name: string;
  readonly capabilities: HarnessCapabilities;

  /**
   * Worker lifetime, once per process, run by the registry in declaration
   * order in BOTH composition roots (`runner.ts`, `runner-manager.ts`). Runs
   * BEFORE bootstrap resolution — the Cursor interceptors must patch
   * `node:http2` before the control plane is dialled — so `config` carries
   * no Temporal coordinates yet. Vendor SDKs are imported lazily inside, so a
   * harness that is not selected costs nothing at boot. A rejection here
   * fails the worker's boot; a worker that cannot boot a harness must not
   * start.
   */
  boot(config: Config): Promise<void>;

  /**
   * Worker lifetime, once per process, after the Temporal worker has drained.
   * Releases everything the adapter still holds (the Cursor harness closes
   * every parked agent). Must resolve even when nothing is held.
   */
  shutdown(): Promise<void>;

  /**
   * Session lifetime: the session is done on this host, release anything
   * parked for it (the Cursor harness: the parked agent, its executor and the
   * MCP subprocesses the lease pins, #215). Called by the registry from the
   * manager's `removeSession`. A harness that parks nothing per session
   * resolves as a no-op and says so in its header. Unknown session ids are a
   * no-op, never an error: the runtime does not track which host parked what.
   */
  releaseSession(sessionId: string): Promise<void>;

  /**
   * Turn lifetime: run ONE engine turn against the resolved input, folding
   * the engine's transcript rows into `sink.rows` as they arrive, and
   * settle with a {@link TurnOutcome}.
   *
   * The rules every implementation is held to (the kit's invariants):
   *
   *  - Resolves, never rejects. A vendor failure becomes
   *    `{ kind: "failed", message, surface }` with the user-facing sentence
   *    the adapter's classifier produced. A `CancelledFailure` never escapes:
   *    the runtime, not the adapter, decides what is a pause and what is a
   *    shutdown, and it throws exactly where Temporal semantics require.
   *  - Stops promptly when `sink.stopSignal` aborts, whatever the cause,
   *    settling `interrupted`. Every call the adapter makes is bounded: the
   *    runtime's heartbeat is live for the whole activity, and a live
   *    heartbeat over an unbounded call keeps a dead activity alive forever.
   *  - Yields when `sink.yieldSignal` aborts: stops at the engine's next
   *    DURABLE step boundary and settles `interrupted`, never cutting a
   *    running tool to do so. Where a step is durable is the engine's own
   *    fact (the step's result is saved where the next invocation resumes
   *    from), so the adapter owns where; the runtime owns when, and why.
   *  - Proposes, never adjudicates. A gated side effect surfaces as a
   *    WAITING_APPROVAL row on `sink.rows` and the turn ends
   *    `awaiting_approval`; the decision arrives on the next invocation in
   *    `input.approvalDecisions`. APPROVE executes exactly once; REJECT and
   *    SKIP never execute.
   *  - Owns its own per-turn teardown in a `finally` inside this method.
   *  - Imports nothing from `@temporalio/*`: the kit runs an adapter outside
   *    any activity context, and every Temporal fact it needs arrives through
   *    the sink (`execute-cursor/__tests__/adapter-is-temporal-free.test.ts`).
   */
  runTurn(input: TurnInput, sink: TurnSink): Promise<TurnOutcome>;
}

// ---------------------------------------------------------------------------
// The resolved record
// ---------------------------------------------------------------------------

/** The provisioned workspace (phase 2c) and the capture posture derived from it. */
export interface TurnWorkspace {
  /** The directories the agent operates in; never empty (`provisionSessionWorkspace` guarantees it). */
  readonly dirs: readonly string[];
  /** `dirs[0]`, the tree the turn's lock, gate, capture and skill mount all key on. */
  readonly primaryDir: string;
  /** True when `primaryDir` is a git work tree: selects the git-diff capture substrate over CAS. */
  readonly gitWorkspace: boolean;
  /**
   * Whether the workspace can capture file edits at all (a git tree, or storage
   * for CAS): the input to the secret-path rule, whatever review says; see
   * `shared/filereview/capture.ts` `deriveCaptureSubstrate`.
   */
  readonly captureSubstrate: boolean;
  /**
   * Whether this turn's file edits are offered for review after it: the
   * session's `file_review` switch, or a eval-run try. Off, a built-in
   * write or delete flows and nothing is captured.
   */
  readonly fileReview: boolean;
  /**
   * Apply-then-review capture runs this turn: review is on and the workspace
   * has a substrate. Review on without a substrate is the classic deny-gate;
   * see `shared/filereview/capture.ts` `deriveCaptureMode`.
   */
  readonly captureMode: boolean;
  /** `${executionId}:${turnSeq}`: the deterministic id of the change set this turn may produce. */
  readonly changeSetId: string;
  readonly provision: SessionWorkspaceProvision;
}

/** The tool surface (phases 4 to 4b): the resolved servers with the attachments folded in, the approval default's MCP half, and the agent's tool scope. */
export interface TurnMcp {
  /** Every resolved server, synthesized attachments included; the harness projects its SDK config from this list. */
  readonly servers: readonly ResolvedMcpServer[];
  /** Serving proactive channels and their templates (the discovery read). */
  readonly channelMessaging: readonly ChannelMessagingInfo[];
  readonly leases: ActiveLeases;
  /**
   * Which MCP tools ask (their server marks them destructive) and which
   * servers a lease cleared. For an engine that reads its tools' marks
   * itself (`capabilities.readsToolMarks`) it carries only the leases, and
   * the engine completes it from the tools it loads.
   */
  readonly mcpDefault: McpApprovalDefault;
  /** What the turn start listed of each server's tools but the platform's; absent for an engine that reads its tools itself. */
  readonly listing: McpToolListing | undefined;
  /**
   * The slugs of the platform's own servers among `servers` (the
   * synthesized attachments, outside every tool list), derived from their
   * homes (`platformServerSlugsOf`), never kept apart from them.
   */
  readonly platformServerSlugs: ReadonlySet<string>;
  /**
   * The main agent's tool scope, from its `tools` and `disallowed_tools`,
   * narrowed by the turn's own (`RunSpec.tools`, `RunSpec.disallowed_tools`;
   * `shared/tool-lists.ts`); unrestricted when neither carries a list. A
   * plugin subagent's scope narrows this one; a saved subagent's is its own
   * ({@link TurnSubagent.toolScope}).
   */
  readonly toolScope: ToolScope;
}

/**
 * The mounted skills (phase 5), each under the session's platform dir and
 * reachable from the workspace through its `.stigmer` link; the harness
 * renders them into its prompt shapes. Resolved per OWNER, because a
 * plugin subagent's skills are its own prompt's, not the root's: the
 * root's are `blueprint.mergedSkillRefs` (agent plus session) and the
 * turn's plugins' skills, a plugin subagent's the ones its file's
 * `skills:` names, keyed by its `<plugin>:<agent>` name (the key its
 * compiler uses). A plugin subagent with no skills has no entry, and the
 * map is empty for a harness whose `capabilities.subAgents` is false. A
 * saved subagent's skills are in its own context
 * ({@link TurnSubagent.skills}).
 */
export interface TurnSkills {
  readonly root: readonly SkillMetadata[];
  readonly bySubAgent: ReadonlyMap<string, readonly SkillMetadata[]>;
}

/**
 * A saved agent the turn's agent lists as a subagent, resolved as an agent
 * of its own (phase 5c, `turn-context.ts` `resolveSubagents`): what the
 * main agent's context is spread over `blueprint`, `mcp`, `skills`, `hooks`
 * and `values`, one value per subagent. It runs as the turn's person, on
 * the turn's budget and under the conversation's hooks, which run before
 * its own; it reports to the main agent, which alone speaks to the person
 * or the channel, so it gets none of the conversation's own plugins and
 * none of the platform's own servers, and it cannot hand work on.
 */
export interface TurnSubagent {
  /** Its name in the turn: the listed agent's slug, the `task` tool's type. */
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  /**
   * The model it runs on: its own run defaults' model when they name this
   * conversation's engine and the engine lists the model; undefined runs
   * the turn's model.
   */
  readonly model: string | undefined;
  /**
   * Its own lists, then the turn's (`RunSpec.tools`, `RunSpec.disallowed_tools`)
   * as a cap, then `Agent` denied: never the main agent's lists, which
   * govern the main agent alone.
   */
  readonly toolScope: ToolScope;
  /** Its plugins' MCP servers, resolved; a server the main agent also has is the same one, by slug. */
  readonly servers: readonly ResolvedMcpServer[];
  /** Its own skills and its plugins', mounted; empty when its scope hides skills. */
  readonly skills: readonly SkillMetadata[];
  /** Its plugins' hooks, then its own block: run after the conversation's ({@link TurnHooks}) on its calls. */
  readonly hooks: readonly TurnHookSource[];
  /** Its own values (`ExecutionValues.subagents`): its shell's and its own hooks', never the main agent's. */
  readonly values: Readonly<Record<string, string>>;
  /** What it brings of its own beyond instructions, model and skills: an engine that cannot keep them to it refuses the turn. */
  readonly bringsOwn: { readonly plugins: boolean; readonly hooks: boolean; readonly lists: boolean; readonly mcpServers: boolean };
}

/** One source of the agent's hooks: a mounted plugin and its recorded groups, or the agent's own block. */
export interface TurnHookSource {
  /** The plugin, mounted and verified; `null` for the hooks block written in the agent. */
  readonly plugin: MountedPlugin | null;
  /** The format the groups are written in: a plugin's recorded format, or the agent's own block's. */
  readonly format: HookFormatName;
  readonly groups: readonly HookGroup[];
}

/**
 * The agent's hooks (phase 5a), resolved for a harness whose
 * `capabilities.runsHooks` is true: each source in the agent's order, every
 * referenced plugin mounted from its verified archive, and the names Claude
 * Code gives the turn's servers (a plugin's and the agent's own). Empty for
 * an agent with no hooks.
 * What a hook's values are (the run's, through the agent shell's filter) is
 * the harness's to read: the shell's environment is the harness's.
 */
export interface TurnHooks {
  readonly sources: readonly TurnHookSource[];
  /** By server slug; filled only when the agent has hooks. */
  readonly serverNames: ReadonlyMap<string, HookServerName>;
}

/**
 * The turn's files (phase 5b): the conversation's Files as the File mount
 * placed them (`shared/file-mount.ts`), split into this message's and the
 * rest, an eval case's reference files, and the vision facts derived once
 * from this message's images.
 */
export interface TurnFiles {
  /** The Files this turn's message carried (`status.message_files`), in its order. */
  readonly message: readonly MessageFile[];
  /** The conversation's other Files, in its resources' order. */
  readonly conversation: readonly MountedFile[];
  /** An eval case's reference folders' files, under `.stigmer/inputs/`; empty on every other run. */
  readonly references: readonly ListedFile[];
  /** The message's images the model sees inline, in the message's order. */
  readonly visionImages: readonly VisionImage[];
  /** The message's images that degraded to path-only, disclosed in the prompt. */
  readonly visionNotViewable: readonly NotViewableEntry[];
}

/** The model the turn runs with (phase 6, the harness-agnostic half): the resolved model name and the effective tier and thinking mode. */
export interface TurnModelPreferences {
  /** `status.runConfig.modelName` (the control plane's resolution), or `"default"`; the harness validates it against its own catalog. */
  readonly requested: string;
  /** Never UNSPECIFIED: `resolveEffectiveServiceTier` is where the platform default is applied. */
  readonly serviceTier: EffectiveServiceTier;
  /** Never UNSPECIFIED: `resolveEffectiveThinkingMode` is where the platform default is applied. */
  readonly thinkingMode: EffectiveThinkingMode;
}

/**
 * The standing context a first prompt carries (phase 9c) and the per-turn
 * catchup, read once from the session metadata and the execution spec.
 */
export interface TurnStandingContext {
  readonly contextBridge: string | undefined;
  readonly senderIdentity: SenderIdentity | undefined;
  readonly sessionContext: string | undefined;
  readonly declaredPreferences: DeclaredPreferencesContent | undefined;
  readonly conversationCatchup: string | undefined;
  /**
   * The semantic memory selection, memoized to at most one run per
   * invocation and stamping `rows.recalledMemoriesReport` once. A thunk
   * because only the harness knows whether its prompt carries standing
   * context (a successfully resumed engine already holds it).
   */
  readonly selectRecalledMemories: () => Promise<RecalledMemoriesContent | undefined>;
}

/**
 * Everything the runtime resolved for this turn, as small named groups
 * (`turn-context.ts` produces one per phase; `run-turn.ts` composes them).
 * This is the whole record: the runtime keeps nothing "private" beside it —
 * the lock release and the write-back coordinator are the finally's
 * resources (`run-turn.ts` `TurnFrame`), not facts about the turn.
 *
 * `threadId` is the engine's state id as the runtime knows it: empty on an
 * `engine-minted` harness's first turn (nothing minted yet) and the id the
 * adapter bound through {@link TurnSink.bindHarnessState} on every later
 * invocation; the runtime-minted id on every turn of a `deterministic`
 * harness. An adapter derives create-vs-resume for its ENGINE from it and its
 * own state; the runtime derives its own reinvocation fact (the seed, the
 * reconcile) in `turn-context.ts`'s `isReinvocation`, one arm per
 * `stateIdSource`. The contract carries no flag because the two readings
 * answer different questions ("does the engine hold state for this session"
 * vs "does this execution have a transcript") and one name over two meanings
 * would be the divergence a contract exists to prevent.
 *
 * Adapter-only facts (the Cursor mode, the service-tier params, the seeded
 * sub-agent rows) are read by the adapter from these records, never resolved
 * by the runtime.
 */
export interface TurnInput extends NormalizedActivityInput {
  /**
   * The session this turn belongs to. Read by the runtime from the fetched
   * execution; the adapter needs it to key anything it parks per session and
   * to recognise a later {@link HarnessAdapter.releaseSession}.
   */
  readonly sessionId: string;
  /**
   * The answers a person gave this execution's WAITING rows, keyed by
   * tool-call id: read by the runtime from the session's log on every
   * reinvocation (`approval-answers.ts`), never stored. An adapter reads the
   * ROW for the call itself (its args), this map for the verdict and
   * {@link approvalAsks} for what the call was asked under; it never
   * re-derives the verdict from the rows itself.
   */
  readonly approvalDecisions: ReadonlyMap<string, ApprovalAction>;
  /**
   * The reason a person gave with a deny, by tool-call id (only denies that
   * carry one): what the model reads with the refusal, on every engine
   * (`shared/hooks/messages.ts` `personDecisionSentence`).
   */
  readonly approvalDenyMessages: ReadonlyMap<string, string>;
  /**
   * What each of the run's asked calls was asked under, by tool use id
   * (`events/ids.ts` `toolUseEventId` of the run and the row): the rule that
   * asked and the content digest of an edit identified by its content, read
   * from the run's `stigmer.permission.asked` events with the answers
   * (`approval-answers.ts`). Empty on a fresh turn.
   */
  readonly approvalAsks: ReadonlyMap<string, ApprovalAsk>;
  readonly execution: Run;
  /** The same object as `blueprint.session`; `bindHarnessState` writes it. */
  readonly session: Session;
  readonly blueprint: ResolvedBlueprint;
  /** The run's values (phase 2b), per declarer (`shared/run-values.ts`). */
  readonly values: RunValues;
  readonly workspace: TurnWorkspace;
  readonly mcp: TurnMcp;
  readonly skills: TurnSkills;
  readonly hooks: TurnHooks;
  /** The saved agents the turn's agent lists, each resolved as an agent of its own, in its order. */
  readonly subagents: readonly TurnSubagent[];
  readonly files: TurnFiles;
  /** Approved whole-file writes the runtime applied itself this turn (exact-apply); the harness issues no grant for them. */
  readonly appliedToolCallIds: ReadonlySet<string>;
  readonly model: TurnModelPreferences;
  /** `spec.structuredOutputSchema`, when this message asks for structured output. */
  readonly structuredOutputSchema: Record<string, unknown> | undefined;
  /**
   * `spec.appendSystemPrompt`: text this message appends to the system
   * prompt, after the agent's instructions and the platform's sections, for
   * this turn only; "" for none. Each harness places it at the end of what
   * it sends as the system prompt; on Cursor, which sends it with the
   * turn's message, a structured-output directive still follows it.
   */
  readonly appendSystemPrompt: string;
  readonly standing: TurnStandingContext;
  /** Resolved once by the runtime before any phase; absent when no substrate works. */
  readonly artifactStorage: ArtifactStorage | undefined;
  /**
   * Every event of this run in the session's log as it stands when called,
   * oldest first: what an adapter reads to tell the turn's story so far (a
   * replacement agent's recovery digest). Read on call, never cached, so an
   * adapter that needs none costs no read; it throws when the log cannot be
   * read.
   */
  readonly readRunEvents: () => Promise<readonly SessionEvent[]>;
  /**
   * A eval-run try's recorded conversation, which the native engine
   * resumes ahead of this turn's message on a thread that holds none
   * (`shared/eval-case/prepare-case.ts`); absent on every other turn. The
   * server never plans such a try on an engine that cannot resume one.
   */
  readonly resumedHistory?: readonly TranscriptMessage[];
}

// ---------------------------------------------------------------------------
// The sink
// ---------------------------------------------------------------------------

/**
 * The runtime's face during one turn: what an adapter may ask of it, the
 * rows it folds into and the status the runtime writes. One sink per turn,
 * owned by the runtime; the adapter never constructs one.
 *
 * Field ownership on `rows` and `status` (since #1097, the canonical
 * transcript; the rows are the runner's own `TurnRows`, written to the
 * session's log and never sent with the status):
 *
 *  - Transcript rows — messages, tool-call rows, sub-agent rows, todos — are
 *    CREATED through `transcript` and nowhere else: the adapter translates
 *    its engine's events and applies them; a reinvocation's asks are seeded
 *    through it by the runtime from the session's log. The one exception, the runtime's own
 *    terminal system rows (`harness/terminal-table.ts`), is the second name
 *    on the writer fence's allow-list (`__tests__/transcript-writers.test.ts`).
 *  - Write-backs a turn produces register through `transcript` too (the
 *    runtime's write-back coordinator), the dedupe rule owned once. What a
 *    turn returns to the person is never on the status: the runtime's
 *    outputs collector returns it as Files (`shared/outputs.ts`).
 *  - Rows may be AMENDED by identity, never created, by the modules that own
 *    a fact the builder cannot know, and this is the whole list: the runtime's
 *    `harness/approval-decisions.ts` (a SKIP or REJECT settles its row),
 *    `harness/capture.ts` (the change-set stamp on a flowed edit row),
 *    `shared/exact-apply.ts` (an approved whole-file write applied by the
 *    runtime completes its row), `shared/subagent-rows.ts` (a stopped turn's
 *    sub-agents CANCELLED); the Cursor boundary (`execute-cursor/
 *    boundary-rows.ts`: the identity-token collapses, #205, #965, the
 *    unattended stamp); the native settle (`execute-deep-agent/hitl.ts`: the
 *    gate's unattended skips). A harness that amends says so in its settle's
 *    header.
 *  - The runtime alone writes the phase, `startedAt`, `completedAt`,
 *    `error`, the terminal system rows, `streamingUsage`,
 *    `fileChangeProgress`, the file-review ledger events and the change-set
 *    stamp (`harness/capture.ts`, since #1096), and closes every streaming flag
 *    once `runTurn` returns. An adapter never writes a phase or a terminal
 *    copy: those are Temporal semantics the runtime owns once.
 */
export interface TurnSink {
  /**
   * The one execution status this turn writes: lifecycle, stamps,
   * write-backs and the file record. It carries no rows.
   */
  readonly status: RunStatus;

  /**
   * The turn's rows, which `transcript` folds into. On a reinvocation the
   * runtime has seeded them with the asks the engine resumes onto, read
   * from the session's log, each carrying the log's answer, so the WAITING
   * rows the adapter wrote last time, and their decisions, are already on
   * them. Every other row is this invocation's own.
   */
  readonly rows: TurnRows;

  /**
   * The one transcript builder over `rows`, constructed by the runtime
   * per turn and already holding a reinvocation's seeded rows. The ONE way
   * a transcript row is created: a harness translates its engine's events
   * into `TranscriptEvent`s and `apply`s them; its post-stream facts (a
   * gate parked by a boundary, a disclosure) go in as events too. Write-backs
   * a turn produces register here as well (`addWriteBack`, one dedupe rule). Read `dirty` to decide a
   * streaming persist and call `markPersisted()` as you request it; read
   * `awaitingApproval` to learn a proposal was parked. The runtime calls
   * `finalize()` once `runTurn` returns, on every path, so no streaming flag
   * outlives a turn; a harness may call it earlier when it persists on the
   * settled rows itself. A source-walking fence
   * (`harness/__tests__/transcript-writers.test.ts`) refuses any other
   * creator of a row.
   */
  readonly transcript: TranscriptBuilder;

  /**
   * The ONE way a turn is told to stop, whatever the cause: user pause,
   * worker shutdown, stall, cost cap, platform STOP. The runtime knows why
   * and maps the outcome; the adapter's only job is to settle promptly as
   * `interrupted`. `stopSignal.reason` is the runtime's own evidence — an
   * adapter never branches on it. Check `aborted` at every step boundary and
   * listen for `abort` inside anything long-running (the Cursor adapter
   * cancels its SDK run from that listener). May already be aborted when
   * `runTurn` is entered; then return `interrupted` before doing any work.
   */
  readonly stopSignal: AbortSignal;

  /**
   * "Stop at your next durable step boundary": the runner is draining, and
   * the next runner continues this turn where it was (stigmer#2428). Not a
   * stop: the running step finishes first, inside the worker's drain grace,
   * so a build in flight is not cut and repeated. When it aborts, settle
   * `interrupted` at the first boundary where everything the engine did so
   * far is saved where its next invocation resumes from, and never cut a
   * running tool to get there; the native engine yields as its next model
   * round starts (its steps are saved synchronously), the Cursor engine once
   * no tool call is open. Abort before `runTurn` is entered means no work.
   * If the grace runs out first, `stopSignal` aborts too, and stopping is
   * then the only rule. The runtime records why it asked; the adapter never
   * branches on it.
   */
  readonly yieldSignal: AbortSignal;

  /**
   * The runtime's cold-start timeline for this turn, a live handle like
   * `status`. The runtime marked its own resolution segments on it before
   * `runTurn`; the adapter marks its setup segments (skills, gate, engine
   * resolve) and emits the `execution_setup` line once its engine is ready,
   * so the one timeline reads end to end (`shared/cold-start-timing.ts`).
   * Diagnostics only; nothing branches on it.
   */
  readonly setupTiming: TimingRecorder;

  /**
   * "Persist the status": a write through the runtime's single persist
   * chokepoint (tool-output offload, size cap, secret withholding,
   * `streamingUsage`). Single-flight: a request while a write is in flight
   * coalesces into the next write. Resolves when the state as of the request
   * has been written, so an adapter that needs ordering MAY await it (the
   * Cursor loop awaits before pulling the next event, so a platform STOP
   * answered by that write stops the turn before the next event, as it
   * always has); an adapter never MUST await it, because the runtime
   * persists unconditionally when the turn settles. Never rejects.
   */
  requestPersist(): Promise<void>;

  /**
   * "I made progress": resets the runtime's stall watchdog and is carried
   * into the next Temporal heartbeat. Call it on every engine event, every
   * token delta, and every step boundary of the adapter's own setup (engine
   * resolved, send returned, boundary done) — a long generation emits deltas
   * but few discrete events, and resetting only on events false-positives a
   * stall. `detail` names what progressed (the Cursor loop passes the tool
   * name of a `tool_call` event); the runtime quotes the last detail in the
   * stall diagnostic (`last tool: shell`). Never throws.
   */
  recordActivity(detail?: string): void;

  /**
   * Token counts for one engine turn, priced by the adapter against its own
   * vendor's table. The runtime accumulates and enforces `max_cost_usd`; an
   * adapter reports and never accounts. Every count is a non-negative delta
   * since the previous report.
   */
  reportUsage(delta: UsageDelta): void;

  /**
   * The user-visible setup label (`status.setupProgress.currentPhase`) for a
   * step only the adapter knows ("Initializing Cursor agent"). The runtime
   * reports its own resolution labels itself; the adapter reports the labels
   * of its setup steps exactly as the orchestrator did, so the UI's spinner
   * copy is unchanged by the extraction. Resolves once the label is
   * written; the write carries no phase, so it never advances the execution.
   */
  reportProgress(label: string): Promise<void>;

  /**
   * The engine-minted state id, the moment it exists and BEFORE the turn
   * proceeds, so a crash mid-turn still resumes on the next invocation. The
   * runtime records it in the session's status through the session's
   * `bindHarnessState` door, the one writer of that field. Called only by
   * adapters whose `capabilities.stateIdSource` is `"engine-minted"`, and
   * before their first
   * `requestPersist`; a `deterministic` harness never calls it. Rejects when
   * the session write fails; the adapter then ends the turn `failed` with
   * that error and executes nothing further.
   */
  bindHarnessState(harnessStateId: string): Promise<void>;

  /**
   * What the engine observed touching CAS-owned paths this turn — gitignored
   * paths in a git tree, every path in a non-git one: the pre-turn bytes of
   * each first-touched path and the paths the gate blocked as secrets
   * (`shared/filereview/cas-touched.ts`). The one fact about a turn's file
   * changes the runtime cannot read from the tree: the pre-edit bytes exist
   * only at mutation time, in whatever sits between the engine and the disk
   * (the deep-agent's filesystem backend and gate, the Cursor hook's
   * sidecar). The runtime reads the AFTER bytes itself and owns everything
   * else of the capture (`harness/capture.ts`): the baseline, the progress,
   * the candidate, the stamp, the review decision.
   *
   * Bound once, before the first persist, as `bindHarnessState` is; the
   * runtime pulls it at each progress refresh and at the turn boundary, so
   * it must return an atomic snapshot (copy live state before any await). A
   * harness that observes nothing binds nothing and gets git-only capture.
   * Never throws.
   */
  bindCasObservations(read: CasTouchedReader): void;
}

/**
 * Token counts for one engine turn, priced. The four counts are what the
 * Cursor loop reads from the SDK's `turn-ended` delta; `estimatedCostUsd` is
 * the adapter's price for them at its vendor's rates (the runtime cannot
 * price without the vendor's table and must not import it), and
 * `model` / `requestedModelParams` name the basis it priced against, which
 * the runtime records into `streamingUsage` (`model` is the catalog-validated
 * id, `requestedModelParams` the JSON of the params sent — a string on the
 * proto, so the SDK type stays inside the adapter). Every field is optional
 * because engines report different subsets; a missing count means zero,
 * never "unknown"; a missing basis inherits the previous delta's.
 */
export interface UsageDelta {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly estimatedCostUsd?: number;
  readonly model?: string;
  readonly requestedModelParams?: string;
}

/**
 * Which of the runtime's three failure copies a `failed` outcome takes. A
 * classification, never copy: the runtime owns the words
 * (`terminal-table.ts`), the adapter says what kind of thing failed.
 *
 *  - `engine`: the engine reported its run as failed. The transcript already
 *    tells the story, so the runtime writes `status.error` and no system row
 *    (the Cursor `run.wait()` error arm).
 *  - `actionable`: the user can fix it (a foreign hook blocked a tool). One
 *    `Execution failed: …` row, the same shape the runtime's own settlements
 *    use.
 *  - `internal`: the runner or its transport broke unexpectedly (a thrown
 *    SDK error, an exception in the adapter). The boilerplate row and an
 *    `Error details:` row.
 */
export type FailureSurface = "engine" | "actionable" | "internal";

/**
 * How one turn ended, carrying ONLY what the runtime cannot read from
 * `sink.rows`, `sink.status` or its own evidence.
 *
 *  - `completed`: the engine finished. The final text and any structured
 *    output are already folded onto the rows; nothing rides here.
 *  - `cancelled`: the engine ended its own run cancelled and there is nothing
 *    to wait for — an SDK-side cancel, or a deny-and-retry adapter that
 *    stopped its run to gate a call and then found nothing to pause for
 *    (an unattended denial settled as skipped). Not `interrupted`: the
 *    runtime's `stopSignal` never fired. The runtime writes
 *    `RUN_CANCELLED` with no copy and completes the turn.
 *  - `awaiting_approval`: the engine proposed at least one gated side effect
 *    and stopped. The WAITING_APPROVAL rows are already on the rows; the
 *    runtime persists them and returns to the workflow, which reinvokes with
 *    the decisions.
 *  - `failed`: the engine or its transport failed in a way the adapter can
 *    name. `message` is the user-facing sentence, `surface` which copy it
 *    takes, `cause` is for the log. The runtime persists FAILED and RETURNS
 *    (Temporal does not retry a returned activity; re-running the same
 *    prompt would fail the same way).
 *  - `tool_call_limit`: the engine exhausted the tool-round budget the
 *    execution set (`max_tool_rounds`, `shared/tool-rounds.ts`) and stopped
 *    at a step boundary with its work checkpointed. Not `failed`: the
 *    platform deliberately stopped the run, and the conversation continues
 *    on the next message. The runtime writes TERMINATED with the cross-repo
 *    prefix and the user copy, and RETURNS (a retry would spend the same
 *    budget again). Every surveyed SDK ends a turn on a budget with a
 *    distinct outcome (Claude's `maxTurns` subtype, Codex's turn reason), so
 *    this is a cross-harness fact, not an engine quirk.
 *  - `interrupted`: `sink.stopSignal` aborted and the adapter stopped. WHY it
 *    aborted is the runtime's evidence (its watchdog, its accounting, its
 *    chokepoint, the cancellation it was delivered), so no reason rides here;
 *    the runtime classifies and applies the throw-vs-return table.
 */
export type TurnOutcome =
  | { readonly kind: "completed" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "awaiting_approval" }
  | { readonly kind: "tool_call_limit" }
  | { readonly kind: "failed"; readonly message: string; readonly surface: FailureSurface; readonly cause?: unknown }
  | { readonly kind: "interrupted" };
