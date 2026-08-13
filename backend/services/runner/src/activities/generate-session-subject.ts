/**
 * GenerateSessionSubject Temporal activity — replaces the sentinel subject of
 * an auto-created session with a concise LLM-generated conversation title.
 *
 * Called fire-and-forget by the Go InvokeAgentExecutionWorkflow (Step 1.5 of
 * BOTH the deep-agent and cursor flows) on the runner task queue, with a 60 s
 * deadline and a single attempt. Failures are non-critical by contract: the
 * session simply keeps its sentinel subject, and the workflow logs a warning.
 *
 * Cross-edition parity: this is the behavioral twin of stigmer-cloud's
 * GenerateSessionSubjectActivityImpl (Java, runs in-process on the server
 * because the Java server owns an LLM call service; the OSS LLM stack lives
 * here in the runner). The system prompt, skip rules, 50-char cap, and the
 * heuristic fallback are kept in lockstep so both editions title sessions
 * identically. The previous owner was the retired Python agent-runner
 * (stigmer/stigmer#665).
 *
 * Model + credential resolution follows ClassifyToolApprovals: the economy
 * model for the configured primary (registry costTier=economy, graceful
 * degrade to the primary), routed through the Stigmer proxy when one is
 * configured, else called directly with the operator's provider key. Unlike
 * classification — a security gate that fails closed — a missing credential
 * here degrades to a heuristic title (the first words of the user message):
 * a title is worth having even when no model is reachable.
 *
 * Activity contract (the Go stub dispatches exactly ONE argument — the cloud
 * Java signature carries a second, invokerIdentityAccountId, that never
 * crosses this wire):
 *   Name:   "GenerateSessionSubject"
 *   Input:  (executionId: string)
 *   Output: void
 */

import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { ConnectError, Code } from "@connectrpc/connect";
import { activityStarted, activityFinished } from "../idle-watchdog.js";
import { StigmerClient } from "../client/stigmer-client.js";
import { getSummarizationModel } from "../shared/model-registry.js";
import { buildChatModel } from "../shared/model-client.js";
import { checkDirectCredentials } from "../shared/llm-backend.js";
import { tryInferProvider } from "../shared/llm-proxy.js";
import type { Config } from "../config.js";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";

/**
 * The sentinel written by the server on auto-created sessions — byte-identical
 * to `autoCreatedSessionSubject` in stigmer-server's agentexecution create
 * pipeline and to AUTO_CREATED_SUBJECT in the cloud activity. Only sessions
 * still carrying it (or an empty subject) are ever titled.
 */
export const AUTO_CREATED_SUBJECT = "Auto-created session";

const MAX_SUBJECT_LENGTH = 50;
/** Titles are tiny; matches the cloud activity's completion budget. */
const MAX_COMPLETION_TOKENS = 100;
const TEMPERATURE = 0.7;

/** Kept verbatim in lockstep with the cloud activity's SYSTEM_PROMPT. */
const SYSTEM_PROMPT = `\
You are a session title generator. Given a user's message and agent context, \
produce a concise conversation title.

Rules:
- 3 to 7 words, maximum 50 characters
- Capture the user's core intent or topic
- Be specific (e.g. "PostgreSQL Multi-AZ Setup" not "Database Help")
- No filler words ("help with", "question about", "I need")
- No quotes, no punctuation at the end
- Output ONLY the title, nothing else`;

// ─────────────────────────────────────────────────────────────────────────────
// Core logic (no Temporal coupling)
// ─────────────────────────────────────────────────────────────────────────────

/** The client surface this activity needs — StigmerClient satisfies it. */
export interface SessionSubjectClient {
  getExecution(executionId: string): Promise<AgentExecution>;
  getSession(sessionId: string): Promise<Session>;
  getAgent(agentId: string): Promise<Agent>;
  getAgentInstance(instanceId: string): Promise<AgentInstance>;
  updateSessionSubject(sessionId: string, subject: string): Promise<Session>;
}

export interface GenerateSessionSubjectOptions {
  /** Null when the deployment has no proxy — the runner calls providers directly. */
  proxyEndpoint: string | null;
  stigmerToken: string | null;
  primaryModel: string;
}

export async function generateSessionSubject(
  executionId: string,
  client: SessionSubjectClient,
  options: GenerateSessionSubjectOptions,
): Promise<void> {
  const execution = await getOrSkip(
    () => client.getExecution(executionId),
    `execution not found: ${executionId}`,
  );
  if (execution === undefined) return;

  const sessionId = execution.spec?.sessionId ?? "";
  const userMessage = execution.spec?.message ?? "";
  if (sessionId === "") {
    log(`no session_id on execution ${executionId}, skipping`);
    return;
  }
  if (userMessage === "") {
    log(`no user message on execution ${executionId}, skipping`);
    return;
  }

  const session = await getOrSkip(
    () => client.getSession(sessionId),
    `session not found: ${sessionId}`,
  );
  if (session === undefined) return;

  const currentSubject = session.spec?.subject ?? "";
  if (currentSubject !== "" && currentSubject !== AUTO_CREATED_SUBJECT) {
    log(`subject is '${currentSubject}' (already set), skipping`);
    return;
  }

  const agentId = await resolveAgentId(execution, session, client);
  if (agentId === "") {
    log(`cannot resolve agent_id for execution ${executionId}, skipping`);
    return;
  }

  const agent = await getOrSkip(
    () => client.getAgent(agentId),
    `agent not found: ${agentId}`,
  );
  if (agent === undefined) return;

  const subject = await generateTitle({
    userMessage,
    agentName: agent.metadata?.name ?? "",
    agentDescription: agent.spec?.description ?? "",
    executionId,
    options,
  });

  if (subject === "") {
    log("subject is empty after generation, skipping");
    return;
  }

  try {
    await client.updateSessionSubject(sessionId, subject);
  } catch (err) {
    log(`failed to persist subject for session ${sessionId}: ${message(err)}`);
    return;
  }

  log(`updated session ${sessionId} subject to '${subject}'`);
}

/**
 * The agent behind the execution: the direct agent_id when the execution
 * carries one, else resolved through the session's agent-instance chain.
 * Empty string when unresolvable. Mirrors the cloud activity's resolveAgentId.
 */
export async function resolveAgentId(
  execution: AgentExecution,
  session: Session,
  client: Pick<SessionSubjectClient, "getAgentInstance">,
): Promise<string> {
  const direct = execution.spec?.agentId ?? "";
  if (direct !== "") return direct;

  const instanceId = session.spec?.agentInstanceId ?? "";
  if (instanceId === "") return "";

  const instance = await getOrSkip(
    () => client.getAgentInstance(instanceId),
    `agent instance not found: ${instanceId}`,
  );
  return instance?.spec?.agentId ?? "";
}

interface GenerateTitleParams {
  userMessage: string;
  agentName: string;
  agentDescription: string;
  executionId: string;
  options: GenerateSessionSubjectOptions;
}

/**
 * LLM title with heuristic degrade. Every unavailability class — no direct
 * credential, model build failure, provider error, empty completion — lands on
 * the heuristic, matching the cloud activity (its LlmCallService swallows
 * provider failures into a null completion; heuristicSubject documents the
 * same "expired API key, rate limit, registry miss" cases).
 */
async function generateTitle(params: GenerateTitleParams): Promise<string> {
  const { userMessage, agentName, agentDescription, executionId, options } = params;

  const model = await getSummarizationModel(options.primaryModel);

  // Direct mode with no credential path degrades up front with one actionable
  // message (the ClassifyToolApprovals idiom — the provider follows the
  // economy-model resolution, not the operator's key, so the log names it).
  if (!options.proxyEndpoint) {
    const provider = tryInferProvider(model);
    const missing = provider === null ? null : checkDirectCredentials(provider);
    if (missing !== null) {
      log(
        `title model '${model}' (${provider}) has no credential path — ` +
        `using heuristic fallback. ${missing}`,
      );
      return heuristicSubject(userMessage);
    }
  }

  try {
    const { model: llm } = await buildChatModel({
      modelName: model,
      proxyEndpoint: options.proxyEndpoint ?? undefined,
      stigmerToken: options.stigmerToken ?? undefined,
      headerScope: { executionId },
      maxTokens: MAX_COMPLETION_TOKENS,
      temperature: TEMPERATURE,
    });

    const result = await llm.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(buildUserPrompt(userMessage, agentName, agentDescription)),
    ]);

    const generated = contentToString(result.content).trim();
    if (generated === "") {
      log("LLM returned empty content, using heuristic fallback");
      return heuristicSubject(userMessage);
    }
    return cleanSubject(generated);
  } catch (err) {
    log(`LLM title generation failed, using heuristic fallback: ${message(err)}`);
    return heuristicSubject(userMessage);
  }
}

/** Kept in lockstep with the cloud activity's buildUserPrompt. */
export function buildUserPrompt(
  userMessage: string,
  agentName: string,
  agentDescription: string,
): string {
  let prompt = `User's first message:\n"${userMessage}"\n\n`;
  prompt += `Agent: ${agentName}\n`;
  if (agentDescription !== "") {
    prompt += `Agent purpose: ${agentDescription}\n`;
  }
  prompt += "\nGenerate the title:";
  return prompt;
}

/**
 * Best-effort subject from the first few words of the user message. Used when
 * the LLM is unavailable. Kept in lockstep with the cloud activity.
 */
export function heuristicSubject(userMessage: string): string {
  const words = userMessage.trim().split(/\s+/);
  let subject = words.slice(0, 7).join(" ");
  if (subject.length > MAX_SUBJECT_LENGTH) {
    subject = subject.slice(0, MAX_SUBJECT_LENGTH - 3) + "...";
  }
  return subject;
}

/**
 * Strip one layer of wrapping quotes and enforce the length cap. Kept in
 * lockstep with the cloud activity.
 */
export function cleanSubject(raw: string): string {
  let subject = raw.trim();
  if (subject.length > 1 && subject.startsWith('"') && subject.endsWith('"')) {
    subject = subject.slice(1, -1);
  }
  if (subject.length > 1 && subject.startsWith("'") && subject.endsWith("'")) {
    subject = subject.slice(1, -1);
  }
  subject = subject.trim();
  if (subject.length > MAX_SUBJECT_LENGTH) {
    subject = subject.slice(0, MAX_SUBJECT_LENGTH - 3) + "...";
  }
  return subject;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a lookup, translating NOT_FOUND into a logged skip (undefined) — the
 * cloud activity's Optional.isEmpty branches. Anything else propagates as a
 * genuine activity failure; the workflow's fire-and-forget wrapper logs it
 * as non-critical.
 */
async function getOrSkip<T>(
  fetch: () => Promise<T>,
  skipMessage: string,
): Promise<T | undefined> {
  try {
    return await fetch();
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.NotFound) {
      log(`${skipMessage}, skipping`);
      return undefined;
    }
    throw err;
  }
}

/** LangChain message content is a string or an array of typed parts. */
function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part
          ? String((part as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return "";
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function log(msg: string): void {
  console.log(`[GenerateSessionSubject] ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Temporal Activity Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createGenerateSessionSubjectActivities(config: Config) {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
    tokenRef: config.stigmerTokenRef,
    runnerTokenRef: config.stigmerRunnerTokenRef,
  });

  return {
    GenerateSessionSubject: async (executionId: string): Promise<void> => {
      activityStarted();
      try {
        log(`started: execution=${executionId}`);
        await generateSessionSubject(executionId, client, {
          proxyEndpoint: config.proxyEndpoint,
          stigmerToken: config.stigmerToken,
          primaryModel: config.primaryModel,
        });
      } finally {
        activityFinished();
      }
    },
  };
}
