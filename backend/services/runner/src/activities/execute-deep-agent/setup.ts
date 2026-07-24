/**
 * Execution setup pipeline for the deep agent activity.
 *
 * Hydrates the execution from the database, resolves the full resource
 * chain (session -> agentInstance -> agent), provisions workspace, loads
 * MCP servers / environment, creates the LangGraph agent graph with the
 * full middleware stack, and returns a SetupResult containing everything
 * the streaming phase needs.
 */

import { createDeepAgent, type FilesystemPermission } from "deepagents";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentGraph = any;

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { DynamicStructuredTool } from "@langchain/core/tools";

import type { Config } from "../../config.js";
import type { StigmerClient } from "../../client/stigmer-client.js";
import { createCheckpointer } from "../../shared/checkpointer/factory.js";
import { readContextBridge } from "../../shared/context-bridge.js";
import { readSenderIdentity } from "../../shared/sender-identity.js";
import { readSessionContext } from "../../shared/session-context.js";
import { connectMcpServers, type McpConnectionResult } from "../../shared/mcp-manager.js";
import { resolveMcpServers } from "../../shared/mcp-resolver.js";
import { backfillMcpServersIfNeeded } from "../../shared/connect-backfill.js";
import {
  formatDatastoresSection,
  injectDatastoreAttachment,
  synthesizeDatastoreAttachment,
} from "../../shared/datastore-attachment.js";
import { WorkspaceProvisioner } from "../../shared/workspace/provisioner.js";
import { LocalWorkspaceBackend } from "../../shared/workspace/local-backend.js";
import type { WorkspaceBackend, ProvisionResult } from "../../shared/workspace/types.js";
import { createCasCaptureBackend } from "./cas-capture-backend.js";
import { buildShellEnv } from "./shell-env.js";
import { CasCaptureObserver } from "./cas-capture-observer.js";
import { isGitWorkTree, isPathCapturable } from "../../shared/filereview/git-substrate.js";
import { deriveCaptureMode } from "../../shared/filereview/capture.js";
import { resolveWorkspacePath } from "../../shared/file-change.js";
import { ensurePlatformDir, ensureCheckpointDbPath } from "../../shared/workspace/platform-dir.js";
import { resolveSessionWorkspaceRoot } from "../../shared/workspace/session-root.js";
import { buildWorkspaceFileTree } from "../../shared/workspace/file-tree.js";
import { reportSetupProgress } from "../../shared/status.js";
import { resolveEnvironment, type EnvironmentResult } from "./environment.js";
import { buildEnhancedSystemPrompt } from "./prompt-builder.js";
import { buildMiddlewareStack, createThinkTool } from "../../middleware/index.js";
import type { GracefulStopMiddleware } from "../../middleware/index.js";
import type { ApprovalGateConfig } from "../../middleware/approval-gate.js";
import { deriveExecutionFingerprintKey } from "../../shared/approval-fingerprint.js";
import { getRunnerHitlMasterSecret } from "../../shared/fingerprint-secret.js";
import { getModelPricing, ensureLoaded as ensurePricingLoaded } from "../../shared/model-pricing.js";
import { getDefaultModel } from "../../shared/model-registry.js";
import { buildChatModel } from "../../shared/model-client.js";
import {
  loadArtifactStorageConfig,
  resolveUsableArtifactStorage,
  type ArtifactStorage,
} from "../../shared/artifact-storage.js";
import {
  mergeApprovalPolicies,
  deriveActiveLeases,
  isUnattendedApprovalMode,
  type MergedToolPolicy,
} from "../../shared/approval-policy.js";
import type { ToolApprovalCategory } from "../../shared/tool-kind.js";
import {
  mergeSkillRefs,
  fetchSkillsByRefs,
  writeSkills,
  computeSkillPaths,
  checkSkillIntegrity,
  generatePromptSection,
  generateAlsoAvailableSection,
  fetchSkillArtifacts,
} from "../../shared/skill-writer.js";
import { filterSkills, SKILL_COUNT_THRESHOLD } from "../../shared/skill-relevance.js";
import { injectAttachments } from "./attachment-injector.js";
import { transformAndCompileSubagents } from "./subagent-transformer.js";
import {
  resolveRecursionLimit,
  UNBOUNDED_ADVISORY_RECURSION_LIMIT,
} from "../../shared/tool-rounds.js";

export interface SetupResult {
  readonly agentGraph: AgentGraph;
  /**
   * The checkpoint saver backing agentGraph. Retained so the activity can close
   * it in cleanup — the durable sqlite saver holds an open file handle. Backends
   * without a handle (memory/http) are duck-typed for an optional close().
   */
  readonly checkpointer: BaseCheckpointSaver;
  readonly langgraphConfig: Record<string, unknown>;
  readonly langgraphInput: Record<string, unknown>;
  readonly execution: AgentExecution;
  readonly agent: Agent;
  readonly session: Session;
  readonly workspaceBackend: WorkspaceBackend;
  readonly mcpConnection: McpConnectionResult | null;
  readonly mergedEnvVars: Record<string, string>;
  readonly secretKeys: ReadonlySet<string>;
  readonly modelName: string;
  readonly gracefulStop: GracefulStopMiddleware;
  /**
   * Artifact storage for CAS blobs, tool-output offload, and attachment/plan
   * artifacts. `undefined` only when it cannot be built (proxy transport with a
   * missing token/endpoint — a misconfiguration; local storage never fails). Every
   * consumer must tolerate its absence: capture degrades to the deny-gate (see
   * `captureMode`), offload is disabled (the aggregate size guard still applies),
   * and attachment/plan publishing surface a clear error rather than crashing.
   */
  readonly artifactStorage: ArtifactStorage | undefined;
  readonly provisionResults: readonly ProvisionResult[];
  readonly approvalPolicies: ReadonlyMap<string, MergedToolPolicy>;
  readonly toolServerMap: ReadonlyMap<string, string>;
  /**
   * Built-in approval categories with a run-lifetime scoped lease (from an
   * interactive APPROVE_ALL). Threaded to the StatusBuilder so a leased built-in
   * call is attributed to its lease (approval_lease) rather than the plain
   * category gate. Empty under a global pre-arm or when no lease is active.
   */
  readonly leasedCategories: ReadonlySet<ToolApprovalCategory>;
  /**
   * Pre-armed spec.auto_approve_all — the one unscoped, whole-run bypass. When
   * true the approval gate is not installed at all. Interactive "approve all"
   * decisions are NOT folded in here; they become scoped leases applied inside
   * the gate (see ActiveLeases / deriveActiveLeases).
   */
  readonly globalBypass: boolean;
  /**
   * Unattended approval mode (ExecutionConfig.approval_mode = UNATTENDED,
   * stamped by approver-less surfaces — channels, guest shares). The gate
   * resolves gated tools as automatic skips instead of interrupting; the
   * builders never seed WAITING_APPROVAL. See isUnattendedApprovalMode.
   */
  readonly unattended: boolean;
  /**
   * Tool-call ids the gate auto-skipped under {@link unattended} this turn.
   * Written ONLY by the approval gate (parent + inherited sub-agent gates
   * share this instance); read by reconcileUnattendedSkips after the stream
   * to stamp terminal SKIPPED rows. Empty set when not unattended.
   */
  readonly unattendedSkips: Set<string>;
  readonly hasStructuredOutput: boolean;
  readonly streamVersion: "v2" | "v3";
  /**
   * The single owner of this turn's CAS-capture state (design docs 08/11/12):
   * the pre-turn bytes of first-touched gitignored paths (recorded
   * gate-independently by the CAS-observing backends of the parent AND every
   * sub-agent) plus the gitignored paths the gate hard-blocked as secret-like
   * (DD-E). The turn boundary reads both to compose the CAS change set. Empty in
   * the legacy (non-capture) path, where no CAS-observing backend is installed.
   */
  readonly casObserver: CasCaptureObserver;
  /**
   * Apply-then-review capture mode, decided by {@link deriveCaptureMode} (shared
   * with the Cursor harness so both degrade identically): file edits flow during
   * the turn and are reviewed post-hoc as a captured `FileChangeSet` (the activity
   * authors the baseline/candidate ledger events and reconciles on resume). True
   * whenever there is a capture substrate — a git work tree (needs no storage) OR
   * artifact storage for the non-git CAS path. False for a non-git workspace with
   * no artifact storage (proxy misconfig): capture has no substrate, so file writes
   * fall back to the deny-gate (gated pre-execution) exactly like Cursor's DD-22
   * fallback. When true, the deny-gate covers only shell/MCP/irreversible tools.
   */
  readonly captureMode: boolean;
  /**
   * True when the workspace is a git work tree. Selects the capture SUBSTRATE for
   * this turn: git-diff (pinned baseline/after trees) when true; content-addressed
   * CAS manifest (path-scoped to touched paths) when false. Threaded into the
   * baseline/candidate/reconcile seam (`capture.ts`) and the CAS capture-class.
   */
  readonly gitWorkspace: boolean;
}

export interface SetupDependencies {
  config: Config;
  client: StigmerClient;
  executionId: string;
  threadId: string;
}

/**
 * Execute all setup phases and return resources for the streaming phase.
 *
 * On failure, partial resources (MCP connections, workspace backend) are
 * cleaned up internally before re-throwing.
 */
export async function performSetup(deps: SetupDependencies): Promise<SetupResult> {
  const { config, client, executionId, threadId } = deps;
  let mcpConnection: McpConnectionResult | null = null;

  try {
    // Step 1: Hydrate execution
    await reportSetupProgress(client, executionId, "Fetching execution…");
    const execution = await client.getExecution(executionId);
    console.log(`[setup] Execution fetched: agent_id=${execution.spec?.agentId}`);

    // Step 2: Resolve chain — execution → session → agentInstance → agent
    await reportSetupProgress(client, executionId, "Resolving agent…");
    const sessionId = execution.spec!.sessionId;
    if (!sessionId) {
      throw new Error(
        `Session ID is required for execution ${executionId}. ` +
        "Execution must have a valid session_id.",
      );
    }

    const session = await client.getSession(sessionId);
    const agentInstance = await client.getAgentInstance(session.spec!.agentInstanceId);
    const agent = await client.getAgent(agentInstance.spec!.agentId);

    const instructions = agent.spec!.instructions || "You are a helpful AI assistant.";
    console.log(
      `[setup] Chain resolved: session=${sessionId}, ` +
      `agent=${agent.metadata!.name}`,
    );

    // Step 3: Resolve model
    const modelName = execution.spec!.executionConfig?.modelName
      || await getDefaultModel();

    // Step 4: Create checkpointer. The durable local (sqlite) backend keys its
    // file per session — a session has exactly one thread (`thread-{sessionId}`),
    // so checkpoint lifetime tracks session lifetime. The saver is closed in the
    // activity cleanup (see index.ts), alongside the MCP connection.
    const checkpointer = await createCheckpointer({
      type: config.checkpointerType,
      proxyEndpoint: config.checkpointerProxyEndpoint ?? undefined,
      authToken: config.stigmerToken ?? undefined,
      sqlitePath: config.checkpointerType === "sqlite"
        ? await ensureCheckpointDbPath(sessionId)
        : undefined,
    });

    // Step 5: Resolve environment
    await reportSetupProgress(client, executionId, "Resolving environment…");
    const envResult: EnvironmentResult = await resolveEnvironment(client, executionId);

    // Step 6: Resolve a usable artifact store (shared with the Cursor harness so
    // both degrade identically). Returns `undefined` — never throws — when there
    // is no working substrate: a proxy misconfig OR an unwritable local path
    // (which `createArtifactStorage` cannot detect, since it just holds a path).
    // An absent store flips capture mode off (deny-gate fallback below) and
    // disables offload, instead of flowing writes then crashing at the boundary.
    const artifactStorage: ArtifactStorage | undefined =
      await resolveUsableArtifactStorage(loadArtifactStorageConfig(config), { executionId });

    // Step 7: Provision workspace
    await reportSetupProgress(client, executionId, "Initializing workspace…");
    const { workspaceBackend, provisionResults } = await provisionWorkspace(
      config,
      session,
      envResult.mergedEnvVars,
      sessionId,
    );

    // Apply-then-review is the file-review model whenever there is a capture
    // SUBSTRATE (DD-21 D2, Slice 2b): file edits flow during the turn and are
    // reviewed post-hoc as a captured `FileChangeSet` (reconciled byte-exactly on
    // resume), never gated before they run. The substrate is selected by
    // `gitWorkspace`:
    //   - a git work tree diffs a pinned baseline -> candidate tree (git-substrate,
    //     needs no artifact storage), and routes its .gitignored edits into the
    //     path-scoped CAS observer;
    //   - a non-git workspace has no git snapshot at all, so EVERY touched path is
    //     captured into the content-addressed CAS manifest (cas-substrate), which
    //     needs artifact storage to persist blobs.
    // So a non-git workspace with NO artifact storage has no substrate: capture
    // degrades to the deny-gate (file writes gated pre-execution), exactly like the
    // Cursor harness (DD-22). `deriveCaptureMode` is the shared decision so both
    // harnesses degrade identically. When capture is on, the deny-gate survives only
    // for shell/MCP/irreversible tools.
    const gitWorkspace = await isGitWorkTree(workspaceBackend.rootDir);
    const captureMode = deriveCaptureMode(
      workspaceBackend.rootDir,
      gitWorkspace,
      !!artifactStorage,
    );

    // Git-tracked capturability, consulted by the gate to route a file write to
    // disk-and-git-diff (tracked) vs into CAS (ignored). Only meaningful in a git
    // work tree. In a non-git workspace nothing is "git-capturable" (there is no
    // snapshot), so this resolves false for every path and the gate routes all
    // file writes through its captureIgnored (CAS) arm.
    const isCapturablePath = gitWorkspace
      ? (rawPath: string): Promise<boolean> =>
          isPathCapturable(
            workspaceBackend.rootDir,
            resolveWorkspacePath(rawPath, workspaceBackend.rootDir, true).path,
          )
      : (_rawPath: string): Promise<boolean> => Promise.resolve(false);

    // CAS capture (design docs 08/11/12): the content-addressed half of
    // apply-then-review. The single per-turn observer owns the before-bytes of
    // first-touched CAS-owned paths AND the secret-blocked paths, keyed
    // workspace-root-relative so they align with the CAS reconcile's
    // `join(workspaceRoot, path)`. It is shared by the parent AND every sub-agent
    // CAS backend, giving race-free first-touch-wins across concurrent graphs.
    // Its ownership predicate is memoized, so `git check-ignore` runs at most once
    // per distinct path.
    const casObserver = new CasCaptureObserver({
      rootDir: workspaceBackend.rootDir,
      // Which touched paths the observer owns (records pre-turn bytes for). In a
      // git work tree that is the .gitignored set only — git captures the tracked
      // ones. In a non-git workspace there is no git substrate, so the observer
      // owns EVERY touched path; the CAS manifest is the sole capture surface.
      isIgnored: gitWorkspace
        ? async (relPath) => !(await isPathCapturable(workspaceBackend.rootDir, relPath))
        : async () => true,
    });

    // Step 7: Resolve and connect MCP servers
    const mcpServerUsages = [
      ...(agent.spec!.mcpServerUsages || []),
      ...(session.spec!.mcpServerUsages || []),
    ];
    const datastoreUsages = agent.spec!.datastoreUsages || [];

    let resolvedMcpServers: Awaited<ReturnType<typeof resolveMcpServers>> | null = null;
    if (mcpServerUsages.length > 0 || datastoreUsages.length > 0) {
      await reportSetupProgress(client, executionId, "Connecting tools…");
      resolvedMcpServers = await resolveMcpServers(
        client, mcpServerUsages, envResult.mergedEnvVars,
      );

      const sessionOrg = session.metadata?.org ?? "";
      let backfilledServers = await backfillMcpServersIfNeeded(
        client,
        resolvedMcpServers.resolvedServers,
        mcpServerUsages,
        envResult.mergedEnvVars,
        sessionOrg,
        undefined,
        envResult.secretKeys,
      );

      // The datastore records attachment (T05) — injected AFTER resolve +
      // backfill so the destructiveHint tightener can never gate it; empty
      // approval maps keep it approval-free by construction (see
      // shared/datastore-attachment.ts).
      if (datastoreUsages.length > 0) {
        const scopedCredential =
          (await client.acquireScopedRunnerToken({ agentExecutionId: executionId }))
          ?? config.stigmerTokenRef?.current
          ?? config.stigmerToken;
        const attachment = synthesizeDatastoreAttachment(datastoreUsages, {
          bridgeEndpoint: config.mcpBridgeEndpoint,
          credential: scopedCredential,
          backendEndpoint: config.stigmerBackendEndpoint,
        });
        if (attachment) {
          backfilledServers = injectDatastoreAttachment(backfilledServers, attachment);
        }
      }
      resolvedMcpServers = { resolvedServers: backfilledServers };

      mcpConnection = await connectMcpServers(
        resolvedMcpServers.resolvedServers,
        { isCloudMode: config.cloudModeEnabled },
      );
    }

    // Step 7b: Resolve and write skills
    const skillRefs = mergeSkillRefs(
      agent.spec!.skillRefs || [],
      session.spec!.skillRefs || [],
    );

    let skillsPromptSection = "";
    if (skillRefs.length > 0) {
      await reportSetupProgress(client, executionId, "Loading skills…");
      const skills = await fetchSkillsByRefs(client, skillRefs);

      if (skills.length > 0) {
        const artifacts = await fetchSkillArtifacts(client, skills);
        const { paths: skillPaths } = await writeSkills(skills, workspaceBackend, artifacts);

        const userMessage = execution.spec!.message || "";
        const skillNames = skills.map(s => s.spec?.name || s.metadata?.slug || "unknown");
        const skillDescriptions = skills.map(s => s.spec?.description || "");

        if (skills.length >= SKILL_COUNT_THRESHOLD) {
          const filterResult = filterSkills(userMessage, skillNames, skillDescriptions);
          if (filterResult.excludedNames.length > 0) {
            const includedSkills = filterResult.includedIndices.map(i => skills[i]);
            console.log(
              `[setup] Skill relevance filter: ${includedSkills.length} included, ` +
              `${filterResult.excludedNames.length} excluded: ${filterResult.excludedNames.join(", ")}`,
            );
            skillsPromptSection =
              generatePromptSection(includedSkills, skillPaths) +
              generateAlsoAvailableSection(filterResult.excludedNames);
          } else {
            skillsPromptSection = generatePromptSection(skills, skillPaths);
          }
        } else {
          skillsPromptSection = generatePromptSection(skills, skillPaths);
        }

        console.log(
          `[setup] Skills loaded: ${skills.length} total, prompt section ${skillsPromptSection.length} chars`,
        );
      }
    }

    // Step 7c: Inject attachments
    const attachments = execution.spec!.attachments || [];
    const injectedFiles = await injectAttachments({
      backend: workspaceBackend,
      attachments,
      storage: artifactStorage,
      isLocalMode: config.mode === "local",
    });

    // Step 8: Build enhanced system prompt
    const systemPrompt = buildEnhancedSystemPrompt({
      instructions,
      provisionResults,
      containerRoot: workspaceBackend.rootDir,
      skillsPromptSection,
      datastoresPromptSection: datastoreUsages.length > 0
        ? formatDatastoresSection(datastoreUsages)
        : undefined,
      workspaceFileRefs: execution.spec!.workspaceFileRefs || [],
      workspaceRoot: workspaceBackend.rootDir,
      injectedFiles,
      interactionMode: execution.spec!.executionConfig?.interactionMode,
      buildFromPlan: execution.spec!.executionConfig?.buildFromPlan,
      contextBridge: readContextBridge(session.spec!.metadata),
      senderIdentity: readSenderIdentity(session.spec!.metadata),
      sessionContext: readSessionContext(session.spec!.metadata),
    });

    // Step 9: Construct the LLM model. Resolution to the provider API id
    // happens inside buildChatModel; modelName stays the registry id for
    // pricing, the native-thinking heuristic, and sub-agent inheritance.
    const requestTimeoutMs =
      parseInt(process.env.STIGMER_LLM_REQUEST_TIMEOUT_MS ?? "0") || undefined;
    const { model } = await buildChatModel({
      modelName,
      proxyEndpoint: config.proxyEndpoint ?? undefined,
      stigmerToken: config.stigmerToken ?? undefined,
      headerScope: { executionId },
      timeoutMs: requestTimeoutMs,
    });

    // Step 10: Build middleware stack
    await ensurePricingLoaded();
    const pricing = getModelPricing(modelName);
    const execConfig = execution.spec!.executionConfig;
    const isPlanMode = execConfig?.interactionMode === InteractionMode.PLAN;
    const shellEnv = isPlanMode ? undefined : buildShellEnv(envResult.mergedEnvVars);

    const toolServerMap = new Map<string, string>();
    if (mcpConnection) {
      for (const [serverName, serverTools] of Object.entries(mcpConnection.serverToolMap)) {
        for (const t of serverTools) {
          toolServerMap.set(t.name, serverName);
        }
      }
    }

    // Step 10b: Resolve approval policies + leases.
    //
    // Two distinct bypasses (see ActiveLeases): the pre-armed
    // spec.auto_approve_all is the one whole-run global bypass; an interactive
    // APPROVE_ALL grants a run-lifetime lease scoped to that action's class (its
    // built-in category, or its MCP server). Server leases shape the policy map
    // (leased servers dropped); built-in category leases are applied inside the
    // gate. Both flow into sub-agents via the shared config below.
    const leases = deriveActiveLeases(execution);
    const globalBypass = leases.global;
    const agentOverrides = agent.spec!.mcpServerUsages?.flatMap(
      u => u.toolApprovalOverrides ?? [],
    ) ?? [];
    const approvalPolicies = mergeApprovalPolicies(
      resolvedMcpServers?.resolvedServers ?? [],
      agentOverrides,
      leases,
    );

    // Unattended approval mode (DD-014): approver-less surfaces (channels,
    // guest shares) stamp APPROVAL_MODE_UNATTENDED, and the gate resolves
    // gated tools as automatic skips instead of interrupting. The registry is
    // the gate→reconciler channel for the skipped tool-call ids; one instance
    // is shared with sub-agent gates via the inherited config.
    const unattended = isUnattendedApprovalMode(execution);
    const unattendedSkips = new Set<string>();

    // The approval gate config is the single source of truth for HITL gating,
    // built once and inherited verbatim by sub-agents (so a mutating tool inside
    // a sub-agent is gated identically to one in the parent). Null under the
    // global pre-arm, where the gate is inert; under scoped leases the gate stays
    // active and clears only leased categories. The per-execution fingerprint key
    // (runner master secret + execution_id) drives the shadow ExecutionReceipt.
    const approvalGateConfig: ApprovalGateConfig | null = !globalBypass
      ? {
          policies: approvalPolicies,
          leasedCategories: leases.categories,
          toolServerMap,
          fingerprintKey: deriveExecutionFingerprintKey(
            getRunnerHitlMasterSecret(),
            executionId,
          ),
          executionId,
          // Capture mode: file edits flow and are reviewed post-hoc. In a git work
          // tree, git-tracked edits flow to the git diff and .gitignored edits flow
          // into CAS (captureIgnored) on THIS parent gate; in a non-git workspace
          // isCapturablePath is always false, so ALL file writes take the CAS arm.
          // Secret-like paths are hard-blocked (DD-E) and recorded for a
          // DIFF_UNREVIEWABLE entry. shell/MCP stay gated. Sub-agents inherit this
          // config; buildSubAgentMiddleware sets their captureIgnored explicitly
          // from whether a CAS observer backs the sub-agent (Session 26, DD-19),
          // so their captured edits flow into the SAME observer.
          //
          // When captureMode is false (no substrate — non-git + no storage),
          // fileCaptureMode is false so file writes take the plain deny-gate. The
          // CAS arm additionally requires storage: captureIgnored gates gitignored
          // writes onto CAS only when a store exists to persist their blobs (the
          // git+no-storage case), matching the Cursor harness's
          // `captureMode && !!artifactStorage`.
          fileCaptureMode: captureMode,
          isCapturablePath,
          captureIgnored: captureMode && !!artifactStorage,
          recordBlockedSecret: (rawPath: string) => casObserver.recordBlockedSecret(rawPath),
          unattended,
          unattendedSkips,
        }
      : null;

    const maxCostUsd = execConfig?.maxCostUsd ?? 0;
    // max_tool_rounds → recursion limit (proto contract: 0/unset = unlimited,
    // set = clamped 10–1000 and enforced). One resolved value feeds BOTH the
    // hard stop on the invoke config below and the budget middleware's ~80%
    // wrap-up advisory, so the warning and the enforcement can never disagree.
    const recursionLimit = resolveRecursionLimit(execConfig?.maxToolRounds);
    const { middleware, gracefulStop, costCap: costCapMiddleware } = buildMiddlewareStack({
      loopDetection: {
        historySize: 20,
        consecutiveThreshold: 7,
        totalThreshold: 20,
      },
      executionBudget: {
        recursionLimit: recursionLimit ?? UNBOUNDED_ADVISORY_RECURSION_LIMIT,
        warningPct: 80,
      },
      toolTruncation: {
        maxChars: execConfig?.maxToolResultChars || 30_000,
      },
      costCap: maxCostUsd > 0 ? {
        maxCostUsd,
        inputPricePerMillion: pricing.inputPricePerMillion,
        outputPricePerMillion: pricing.outputPricePerMillion,
        cacheReadPricePerMillion: pricing.cacheReadPricePerMillion,
        warningPct: 80,
      } : null,
      otelSpans: { toolServerMap },
      approvalGate: approvalGateConfig,
    });

    // Step 11: Build tools list (MCP tools + think tool)
    const tools = [
      ...(mcpConnection?.tools as DynamicStructuredTool[] ?? []),
      createThinkTool(),
    ];

    // Step 11b: Transform and compile subagents
    const subAgentProtos = agent.spec!.subAgents || [];
    let compiledSubagents: Awaited<ReturnType<typeof transformAndCompileSubagents>> | undefined;

    if (subAgentProtos.length > 0 || workspaceBackend.rootDir) {
      await reportSetupProgress(client, executionId, "Configuring sub-agents…");

      const parentMcpServerToolMap = new Map<string, DynamicStructuredTool[]>();
      if (mcpConnection) {
        for (const [serverName, serverTools] of Object.entries(mcpConnection.serverToolMap)) {
          parentMcpServerToolMap.set(serverName, serverTools as DynamicStructuredTool[]);
        }
      }

      compiledSubagents = await transformAndCompileSubagents({
        subAgents: subAgentProtos,
        parentMcpTools: mcpConnection?.tools as DynamicStructuredTool[] ?? [],
        parentMcpServerToolMap,
        parentMcpUsages: mcpServerUsages,
        skillClient: client,
        workspaceBackend,
        approvalGate: approvalGateConfig,
        // Capture is universal (Slice 2b), so every sub-agent gets a CAS-observing
        // backend wired to the SAME per-turn observer as the parent — their
        // captured writes (.gitignored in a git tree, all touched paths in a
        // non-git one) compose into the parent's change set (Session 26, DD-19).
        casObserver,
        parentModelName: modelName,
        parentHasNativeThinking: _modelHasNativeThinking(modelName),
        costCap: costCapMiddleware ?? undefined,
        modelFactory: async (m: string) =>
          (await buildChatModel({
            modelName: m,
            proxyEndpoint: config.proxyEndpoint ?? undefined,
            stigmerToken: config.stigmerToken ?? undefined,
            headerScope: { executionId },
          })).model,
        // Presence of shellEnv is the shell-capability switch for sub-agent
        // backends too (undefined in plan mode; see buildShellEnv above).
        shellEnv,
      });
    }

    // Step 12: Create the agent graph with middleware
    await reportSetupProgress(client, executionId, "Creating agent…");

    const outputSchema = execution.spec!.executionConfig?.structuredOutputSchema;
    let responseFormat: z.ZodType | undefined;
    if (outputSchema) {
      responseFormat = jsonSchemaToZod(outputSchema as unknown as Record<string, unknown>);
    }

    // Plan mode is read-only. Deny every filesystem write operation at the tool
    // level so write_file/edit_file/etc. cannot mutate the workspace — enforcing
    // the InteractionMode.PLAN contract by construction, not by prompt. Rules are
    // first-match-wins with a permissive default, so a single deny-all-writes
    // rule is sufficient. (The Cursor harness enforces plan mode via its prompt
    // prefix; the native harness enforces it here.)
    const planModePermissions: FilesystemPermission[] = [
      { operations: ["write"], paths: ["/**"], mode: "deny" },
    ];

    // File capture point. Apply-then-review is universal (Slice 2b), so the
    // CAS-observing backend: git-tracked edits flow to disk (the turn-boundary
    // git diff is authoritative), and the shared CAS observer records the pre-turn
    // bytes of every CAS-owned path — .gitignored paths in a git work tree, all
    // touched paths in a non-git one — so the boundary can capture them into CAS.
    // It is gate-independent, so it holds even under the global bypass.
    const fileBackend = await createCasCaptureBackend({
      rootDir: workspaceBackend.rootDir,
      observer: casObserver,
      shellEnv,
    });
    const agentGraph = await createDeepAgent({
      model,
      checkpointer: checkpointer as any,
      backend: fileBackend,
      systemPrompt,
      tools,
      middleware: middleware as any,
      subagents: compiledSubagents ?? undefined,
      ...(responseFormat ? { responseFormat } : {}),
      ...(isPlanMode ? { permissions: planModePermissions } : {}),
    } as Parameters<typeof createDeepAgent>[0]);

    // Step 11: Prepare invocation input and config
    let userMessage = execution.spec!.message;
    if (outputSchema) {
      userMessage += `\n\n---\nIMPORTANT: When your analysis is complete, provide your findings as structured output matching the required schema. The system will capture your structured response automatically.`;
    }
    const langgraphInput = {
      messages: [{ role: "user", content: userMessage }],
    };

    const langgraphConfig: Record<string, unknown> = {
      configurable: { thread_id: threadId },
      // Hard enforcement of max_tool_rounds (null = unlimited, the default):
      // when the graph exhausts this, the streaming loop's GraphRecursionError
      // handler terminates gracefully with work saved ("send another message
      // to continue"). The middleware's wrap-up advisory fires at ~80% of the
      // same value, so a healthy run finishes normally before ever hitting it.
      ...(recursionLimit !== null ? { recursionLimit } : {}),
    };

    const streamVersion: "v2" | "v3" =
      process.env.LANGGRAPH_STREAM_EVENTS_VERSION === "v2" ? "v2" : "v3";

    console.log(
      `[setup] Complete: model=${modelName}, ` +
      `tools=${tools.length}, middleware=${middleware.length}, ` +
      `thread_id=${threadId}, streamVersion=${streamVersion}`,
    );

    return {
      agentGraph,
      checkpointer,
      langgraphConfig,
      langgraphInput,
      execution,
      agent,
      session,
      workspaceBackend,
      mcpConnection,
      mergedEnvVars: envResult.mergedEnvVars,
      secretKeys: envResult.secretKeys,
      modelName,
      gracefulStop,
      artifactStorage,
      provisionResults,
      approvalPolicies,
      toolServerMap,
      leasedCategories: leases.categories,
      globalBypass,
      unattended,
      unattendedSkips,
      hasStructuredOutput: !!outputSchema,
      streamVersion,
      casObserver,
      captureMode,
      gitWorkspace,
    };
  } catch (err) {
    if (mcpConnection) {
      try { await mcpConnection.client.close(); } catch { /* swallow */ }
    }
    throw err;
  }
}

/**
 * Provision workspace from session workspace entries.
 *
 * A session with no entries gets its own empty per-session directory (see
 * shared/workspace/session-root.ts) — never the shared root, which would
 * leak other sessions' files into it. Mirrors the Cursor harness's
 * provisionCursorWorkspace exactly.
 */
async function provisionWorkspace(
  config: Config,
  session: Session,
  mergedEnvVars: Record<string, string>,
  sessionId: string,
): Promise<{ workspaceBackend: WorkspaceBackend; provisionResults: ProvisionResult[] }> {
  const platformDir = await ensurePlatformDir(sessionId);

  const workspaceEntries = session.spec!.workspaceEntries || [];
  if (workspaceEntries.length === 0) {
    const sessionRoot = await resolveSessionWorkspaceRoot(
      config.workspaceRootDir, workspaceEntries, sessionId,
    );
    return {
      workspaceBackend: new LocalWorkspaceBackend(sessionRoot, platformDir),
      provisionResults: [],
    };
  }

  const workspaceBackend = new LocalWorkspaceBackend(config.workspaceRootDir, platformDir);
  const provisioner = new WorkspaceProvisioner();
  const provisionResults = await provisioner.provisionAll(
    workspaceEntries.map(entry => ({
      name: entry.name,
      source: entry.source,
    })),
    workspaceBackend,
    mergedEnvVars,
    config.mode === "local",
    config.mode !== "local",
  );

  // If single entry changed root dir, create a new backend with the same platformDir
  if (
    provisionResults.length === 1 &&
    provisionResults[0].rootDir !== workspaceBackend.rootDir
  ) {
    return {
      workspaceBackend: new LocalWorkspaceBackend(provisionResults[0].rootDir, platformDir),
      provisionResults,
    };
  }

  return { workspaceBackend, provisionResults };
}

// Shared JSON Schema → Zod converter (consolidated from 3 duplicate copies).
import { jsonSchemaToZod } from "../../shared/json-schema-to-zod.js";

/**
 * Heuristic check for native extended thinking support.
 * Models with thinking support don't need the explicit think tool.
 */
function _modelHasNativeThinking(modelId: string): boolean {
  const lower = modelId.toLowerCase();

  if (lower.includes("haiku")) return false;
  if (lower.includes("gpt-4o-mini")) return false;

  if (lower.includes("claude") && (
    lower.includes("sonnet") || lower.includes("opus")
  )) return true;

  if (lower.includes("o1") || lower.includes("o3") || lower.includes("o4")) {
    return true;
  }

  return false;
}
