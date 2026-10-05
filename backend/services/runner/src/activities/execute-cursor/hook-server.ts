/**
 * The Cursor engine's hook server: where an agent's hooks run on this
 * engine. The turn's evaluator (`shared/hooks/evaluate.ts`) runs inside the
 * runner, and the approval gate's bash script (`hook-script.ts`) reaches it
 * over a local socket for every call it is asked about.
 *
 * WHY IN THE RUNNER. Everything the evaluator needs already lives here: the
 * plugins' tamper guards, whose reference is kept in memory because the
 * agent's shell can rewrite any file on disk; the hook leases; the run's
 * values; the turn's stop; and the activity the stall watchdog reads, which
 * a hook's pulses must reach so a long hook is not taken for a hung engine.
 * A separate process would need all of that written to disk.
 *
 * THE SOCKET. A Unix socket (`hooks.sock`, mode 0600) in a directory of
 * its own under the system's temporary directory, created for the turn
 * (mode 0700) and removed with the server, which opens when the gate is
 * installed for an agent with hooks and closes with it. Not in the gate's
 * directory under the home directory: a socket's path has a short platform
 * limit, and a home directory can be long. The script finds the socket
 * through the active-turn pointer, and a request carries a per-turn random
 * token from the same pointer; one without it is refused. The agent's shell
 * can read that pointer too, and all the token gains it is running the
 * agent's own hooks on calls it makes up: a real call's answer is the
 * script's to act on, and the script is not the shell's. Requests are
 * served independently: the evaluator keeps no per-call state.
 *
 * THE PROTOCOL. One JSON line in, one JSON line out. A `pre` request carries
 * the hook payload of a `preToolUse` (a built-in) or `beforeMCPExecution`
 * (an MCP tool, the event that names its server), and the identity token
 * the script computed for the call; the reply is the decision and the
 * ready-made answers the script prints for each outcome, so the bash side
 * only chooses. A `post` request carries a `postToolUse` payload and is
 * answered with the context the hooks hand back to the model, under the
 * same heading the native engine appends.
 *
 * A call a person skipped or rejected earlier this run is answered
 * `refused` when a hook would allow it or ask on it again, with the
 * person's own decision as the model's reason: a person's refusal binds on
 * the model's retry, as on the native engine. Only a hook's deny comes
 * before it.
 *
 * A hook that moves a write or a deletion to another file is checked
 * again, as the native engine checks a rewrite: onto a secret-like path the
 * call is blocked as the gate blocks such a write; in capture mode it is
 * refused, since capture reviewed the path the model wrote.
 *
 * A hook that asks and also rewrites the call is refused unless the run is
 * trusted whole: this engine's card is the model's own call, so a person
 * would approve arguments other than the ones that run, and the grant that
 * approval leaves would let the rewrite through on the retry.
 *
 * Every allow and ask is recorded ({@link HookDecisionLog}) under the
 * call's identity, so the translator can name the deciding hook on the row
 * of a call that ran.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PolicySource } from "../../shared/approval-policy.js";
import type { HookEvaluator, HookToolCall } from "../../shared/hooks/evaluate.js";
import { HOOK_FEEDBACK_HEADING, hookAskMessage, hookLabel, hookRefusalMessage, personDecisionSentence } from "../../shared/hooks/messages.js";
import { grantToken, toolIdentity, type PersonRefusal } from "./approval-state.js";
import { rowNameOf } from "./hook-views.js";
import { isSecretLikePath } from "../../shared/filereview/secret-paths.js";
import { APPROVAL_REQUIRED_AGENT_MESSAGE, SECRET_BLOCKED_AGENT_MESSAGE, UNATTENDED_SKIP_AGENT_MESSAGE } from "./hook-script.js";

const SOCKET_FILE = "hooks.sock";

/** The longest socket path the platform takes (`sun_path`: 104 bytes on macOS, 108 on Linux). */
const MAX_SOCKET_PATH_BYTES = process.platform === "darwin" ? 103 : 107;

/** The most a request may carry; a call's payload is far smaller. */
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

/** A hook's decision on a call that may run, as the row of that call is stamped. */
export interface HookDecisionRecord {
  readonly provenance: PolicySource;
  readonly hook: string;
}

/**
 * The hooks' decisions on the calls of this turn, by the call's coarse
 * identity (`grantToken` of its key and salient), oldest first. The
 * translator takes each when the call's row shows up on the stream; a call
 * whose arguments the stream spells differently from the hook is matched by
 * its key alone.
 */
export class HookDecisionLog {
  private readonly records: { readonly token: string; readonly key: string; readonly record: HookDecisionRecord }[] = [];

  record(token: string, record: HookDecisionRecord): void {
    const key = keyOfToken(token);
    this.records.push({ token, key, record });
  }

  /** The decision on a streamed call, consumed; `undefined` when no hook decided it. */
  take(name: string, mcpServerSlug: string, input: Record<string, unknown>): HookDecisionRecord | undefined {
    const id = toolIdentity(name, mcpServerSlug, input);
    const token = grantToken(id.key, id.salient);
    let index = this.records.findIndex((r) => r.token === token);
    if (index === -1) index = this.records.findIndex((r) => r.key === id.key);
    if (index === -1) return undefined;
    const [taken] = this.records.splice(index, 1);
    return taken!.record;
  }
}

/** Why a hook's ask with a rewrite is refused; the agent reads it. */
export function askWithRewriteMessage(hook: string): string {
  return `${hookLabel(hook)} asked for approval of this call and rewrote it too. An approval here would show the call as written, not as rewritten, so the call was refused.`;
}

/** How a hook's allow or ask is stamped on its row, as the native gate stamps it. */
function provenanceOf(decision: "allow" | "ask", leased: boolean, globalBypass: boolean): PolicySource {
  if (decision === "ask" && globalBypass) return "auto_approve_all";
  return leased ? "approval_lease" : "hook";
}

function keyOfToken(token: string): string {
  const decoded = Buffer.from(token, "base64").toString("utf-8");
  const newline = decoded.indexOf("\n");
  return newline === -1 ? decoded : decoded.slice(0, newline);
}

/** What the script receives for a `pre` request; every answer is the JSON it prints. */
export interface PreReply {
  readonly decision: "allow" | "deny" | "ask" | "refused" | "none";
  /** The deciding plugin's slug (`""` for the agent's own block); absent when no hook decided, or for `refused`. */
  readonly hook?: string;
  readonly allow?: string;
  readonly deny?: string;
  readonly approval?: string;
  readonly unattended?: string;
  /** The refusal (deny, refused) or the card's message (ask), for the ledger. */
  readonly message?: string;
}

/** The turn's hook server. */
export interface HookServer {
  readonly socketPath: string;
  readonly token: string;
  readonly decisions: HookDecisionLog;
  /** Stops serving and removes the socket; idempotent. */
  close(): Promise<void>;
}

/** What of the turn's approval state the server's answers depend on. */
export interface HookTurnMode {
  /** The turn captures its file changes for review (`TurnWorkspace.captureMode`). */
  readonly captureMode: boolean;
  /** "Trust this whole run" is armed: every ask is satisfied, and its row says so. */
  readonly globalBypass: boolean;
}

export interface HookServerParams extends HookTurnMode {
  readonly evaluator: HookEvaluator;
  /** The calls a person skipped or rejected this run, by identity token (`buildPersonRefusals`). */
  readonly refusals: ReadonlyMap<string, PersonRefusal>;
}

/** A socket path the platform cannot bind: an infrastructure fault, never a silent skip. */
export class HookSocketPathError extends Error {
  constructor(path: string) {
    super(`the hook server's socket path is longer than this platform allows (${Buffer.byteLength(path)} bytes): ${path}`);
    this.name = "HookSocketPathError";
  }
}

/** Start serving the turn's hooks. */
export async function startHookServer(params: HookServerParams): Promise<HookServer> {
  const socketDir = await mkdtemp(join(tmpdir(), "stigmer-hooks-"));
  const socketPath = join(socketDir, SOCKET_FILE);
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) {
    await rm(socketDir, { recursive: true, force: true });
    throw new HookSocketPathError(socketPath);
  }

  const token = randomBytes(32).toString("hex");
  const decisions = new HookDecisionLog();
  const handler = new HookRequestHandler(params.evaluator, params.refusals, decisions, token, {
    captureMode: params.captureMode,
    globalBypass: params.globalBypass,
  });
  const server = createServer((socket) => handler.serve(socket));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await chmod(socketPath, 0o600);

  let closed = false;
  return {
    socketPath,
    token,
    decisions,
    close: async () => {
      if (closed) return;
      closed = true;
      await closeServer(server);
      await rm(socketDir, { recursive: true, force: true });
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Answers the script's requests; exported for the module's tests. */
export class HookRequestHandler {
  private readonly tokenBytes: Buffer;
  /** Each MCP call's server, by tool and arguments, from its `beforeMCPExecution`: `postToolUse` names no server. */
  private readonly mcpServers = new Map<string, string[]>();

  constructor(
    private readonly evaluator: HookEvaluator,
    private readonly refusals: ReadonlyMap<string, PersonRefusal>,
    private readonly decisions: HookDecisionLog,
    token: string,
    private readonly turn: HookTurnMode = { captureMode: false, globalBypass: false },
    private readonly maxRequestBytes = MAX_REQUEST_BYTES,
  ) {
    this.tokenBytes = Buffer.from(token, "utf-8");
  }

  serve(socket: Socket): void {
    let buffer = "";
    socket.setEncoding("utf-8");
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > this.maxRequestBytes) {
        socket.destroy();
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = "";
      socket.pause();
      void this.answer(line).then(
        (reply) => socket.end(`${JSON.stringify(reply)}\n`),
        (err: unknown) => {
          console.warn(`[hooks] the hook server could not answer: ${err instanceof Error ? err.message : String(err)}`);
          socket.destroy();
        },
      );
    });
  }

  /** One request line to its reply; a request without the turn's token is refused. */
  async answer(line: string): Promise<unknown> {
    const request = parseObject(line);
    if (request === undefined || !this.authorized(request["token"])) return { error: "unauthorized" };
    const payload = request["payload"];
    if (!isObject(payload)) return { error: "no payload" };
    if (request["mode"] === "post") return { response: await this.post(payload) };
    const identity = typeof request["identity"] === "string" ? request["identity"] : "";
    const coarse = typeof request["coarse"] === "string" ? request["coarse"] : "";
    return this.pre(payload, identity, coarse);
  }

  private authorized(token: unknown): boolean {
    if (typeof token !== "string") return false;
    const given = Buffer.from(token, "utf-8");
    return given.length === this.tokenBytes.length && timingSafeEqual(given, this.tokenBytes);
  }

  private async pre(payload: Record<string, unknown>, identity: string, coarse: string): Promise<PreReply> {
    const call = this.callOf(payload);
    if (call === undefined) return { decision: "none" };
    const outcome = await this.evaluator.preToolUse(call, {});
    const toolName = this.evaluator.viewOf(call)?.toolName ?? call.name;
    const context = outcome.additionalContext.length > 0 ? `${HOOK_FEEDBACK_HEADING}\n${outcome.additionalContext.join("\n\n")}` : undefined;
    const allow = JSON.stringify({
      permission: "allow",
      ...(outcome.updatedArgs !== undefined ? { updated_input: outcome.updatedArgs } : {}),
      ...(context !== undefined ? { additional_context: context } : {}),
    });

    switch (outcome.decision) {
      case undefined:
        return { decision: "none" };
      case "deny": {
        const message = hookRefusalMessage(outcome.hook, outcome.reason);
        return { decision: "deny", hook: outcome.hook, deny: denyAnswer(message), message };
      }
      case "allow":
      case "ask": {
        if (outcome.decision === "ask" && outcome.updatedArgs !== undefined && !this.turn.globalBypass) {
          const message = askWithRewriteMessage(outcome.hook);
          return { decision: "deny", hook: outcome.hook, deny: denyAnswer(message), message };
        }
        const moved = this.movedFile(call, outcome.updatedArgs);
        if (moved !== undefined) return moved;
        const refusal = this.refusals.get(identity) ?? this.refusals.get(coarse);
        if (refusal !== undefined) {
          const message = personDecisionSentence(refusal.toolName, refusal.action, "");
          return { decision: "refused", deny: denyAnswer(message), message };
        }
        const record: HookDecisionRecord = { provenance: provenanceOf(outcome.decision, outcome.leased, this.turn.globalBypass), hook: outcome.hook };
        this.decisions.record(coarse || identity, record);
        if (outcome.decision === "allow") return { decision: "allow", hook: outcome.hook, allow };
        const message = outcome.reason || hookAskMessage(outcome.hook, toolName);
        return {
          decision: "ask",
          hook: outcome.hook,
          allow,
          approval: JSON.stringify({ permission: "deny", agent_message: APPROVAL_REQUIRED_AGENT_MESSAGE, user_message: message }),
          unattended: JSON.stringify({
            permission: "deny",
            agent_message: UNATTENDED_SKIP_AGENT_MESSAGE,
            user_message: `Skipped (approval not available on this surface): ${call.name}`,
          }),
          message,
        };
      }
      /* v8 ignore start -- @preserve: the never arm; the compiler proves no decision reaches it */
      default: {
        const exhaustive: never = outcome.decision;
        throw new Error(`hook server: unknown decision ${String(exhaustive)}`);
      }
      /* v8 ignore stop */
    }
  }

  /** A write or a deletion a hook moved to another file, refused or blocked; `undefined` when it stays put. */
  private movedFile(call: HookToolCall, rewrite: Record<string, unknown> | undefined): PreReply | undefined {
    if ((call.name !== "Write" && call.name !== "Delete") || rewrite === undefined) return undefined;
    // A write's or a deletion's rewrite here can only move its path
    // (`hook-views.ts`), and an unchanged one is none (`evaluate.ts`).
    const target = rewrite["file_path"];
    if (typeof target === "string" && isSecretLikePath(target)) {
      return { decision: "deny", deny: JSON.stringify({ permission: "deny", agent_message: SECRET_BLOCKED_AGENT_MESSAGE, user_message: SECRET_BLOCKED_AGENT_MESSAGE }), message: SECRET_BLOCKED_AGENT_MESSAGE };
    }
    if (this.turn.captureMode) {
      const message = "A hook moved this file change to another file, which this turn's review cannot follow, so the call was refused.";
      return { decision: "deny", deny: denyAnswer(message), message };
    }
    return undefined;
  }

  private async post(payload: Record<string, unknown>): Promise<string> {
    const name = typeof payload["tool_name"] === "string" ? payload["tool_name"] : "";
    const input = isObject(payload["tool_input"]) ? payload["tool_input"] : {};
    const output = outputText(payload["tool_output"]);
    let call: HookToolCall;
    if (name.startsWith("MCP:")) {
      const tool = name.slice("MCP:".length);
      const server = this.takeMcpServer(tool, input);
      if (server === undefined) return "{}";
      call = { id: "", name: tool, args: input, serverSlug: server };
    } else {
      const id = typeof payload["tool_use_id"] === "string" ? payload["tool_use_id"] : "";
      call = { id, name, args: input, serverSlug: "" };
    }
    const outcome = await this.evaluator.postToolUse(call, {}, output);
    for (const error of outcome.errors) console.warn(`[hooks] a PostToolUse hook failed: ${error}`);
    const feedback = [...outcome.blockReasons, ...outcome.additionalContext];
    return feedback.length === 0 ? "{}" : JSON.stringify({ additional_context: `${HOOK_FEEDBACK_HEADING}\n${feedback.join("\n\n")}` });
  }

  /** The call a pre-execution payload asks about; `undefined` for an event the server does not answer. */
  private callOf(payload: Record<string, unknown>): HookToolCall | undefined {
    const name = typeof payload["tool_name"] === "string" ? payload["tool_name"] : "";
    if (name === "") return undefined;
    switch (payload["hook_event_name"]) {
      case "preToolUse": {
        const args = isObject(payload["tool_input"]) ? payload["tool_input"] : {};
        const id = typeof payload["tool_use_id"] === "string" ? payload["tool_use_id"] : "";
        const call = { id, name, args, serverSlug: "" };
        return { ...call, rowName: rowNameOf(call) };
      }
      case "beforeMCPExecution": {
        const raw = payload["tool_input"];
        const args = typeof raw === "string" ? (parseObject(raw) ?? {}) : isObject(raw) ? raw : {};
        const server = typeof payload["mcp_server_name"] === "string" ? payload["mcp_server_name"] : "";
        if (server === "") return undefined;
        this.rememberMcpServer(name, args, server);
        return { id: "", name, args, serverSlug: server, rowName: name };
      }
      default:
        return undefined;
    }
  }

  private rememberMcpServer(tool: string, args: Record<string, unknown>, server: string): void {
    const key = `${tool}\n${JSON.stringify(args)}`;
    const servers = this.mcpServers.get(key);
    if (servers) servers.push(server);
    else this.mcpServers.set(key, [server]);
  }

  private takeMcpServer(tool: string, args: Record<string, unknown>): string | undefined {
    const key = `${tool}\n${JSON.stringify(args)}`;
    const servers = this.mcpServers.get(key);
    const server = servers?.shift();
    if (servers !== undefined && servers.length === 0) this.mcpServers.delete(key);
    return server;
  }
}

/** The answer that refuses a call, the reason given to the model and the person alike. */
function denyAnswer(message: string): string {
  return JSON.stringify({ permission: "deny", agent_message: message, user_message: message });
}

/** The text a tool returned, from `postToolUse`'s `tool_output` (a JSON string): a shell's output, an MCP tool's text. */
function outputText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const parsed = parseObject(raw);
  if (parsed === undefined) return raw;
  if (typeof parsed["output"] === "string") return parsed["output"];
  const content = parsed["content"];
  if (Array.isArray(content)) {
    return content
      .flatMap((block) => (isObject(block) && typeof block["text"] === "string" ? [block["text"]] : []))
      .join("\n");
  }
  return raw;
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
