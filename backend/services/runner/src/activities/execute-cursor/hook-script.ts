/**
 * Template for the approval hook script that Cursor spawns.
 *
 * This module doesn't execute as a hook itself — it generates the shell script
 * written to the HITL dir as stigmer-approval.sh. Cursor invokes that ONE script
 * for THREE events (registered in .cursor/hooks.json by workspace-setup.ts):
 *   - `preToolUse`         — fires for built-in tools (Write/Shell/Delete/…), and
 *                            for MCP calls as `MCP:<tool>`, which it leaves to:
 *   - `beforeMCPExecution` — the only event Cursor enforces for MCP tool calls,
 *                            and the one whose payload names the server
 *                            (`mcp_server_name`). MCP is therefore gated in
 *                            exactly ONE place, so a denial is never
 *                            double-recorded.
 *   - `subagentStart`      — documented to fire before a sub-agent starts,
 *                            with its `subagent_type`; only the scope arm
 *                            answers it. The 1.0.31 local runtime does not
 *                            fire it for a `task` call (live probe,
 *                            2026-10-05), so it is a second line for a
 *                            runtime that does, never the guard: an
 *                            `Agent(type, …)` type list is refused at setup
 *                            (`turn-setup.ts` `checkToolScope`).
 * The script branches on the payload's `hook_event_name`.
 *
 * The hook script:
 * 1. Reads the tool call JSON from stdin
 * 2. Reads the approval state JSON file written by the cursor-runner
 * 3. Evaluates, in order: the agent's tool lists (any event), then
 *    auto-approve, approved grants (reinvocation) and — by event — gated
 *    built-in tools (preToolUse) or destructive MCP tools (beforeMCPExecution)
 * 4. On a deny, appends the call's identity token to the denial ledger
 *    (denials.jsonl) — EVERY deny path records, each tagged with a `kind`
 *    (see below), so the ledger is the complete, authoritative record of what
 *    this hook blocked this turn. The runner marks approval-kind denials as
 *    WAITING_APPROVAL; the full ledger is its attribution set for
 *    distinguishing our denials from a FOREIGN hook's (issue #205): a
 *    hook-blocked tool with NO ledger entry of any kind was not blocked by us.
 * 5. Returns { "permission": "allow" } or { "permission": "deny" } on stdout
 *
 * Denial kinds (the attribution taxonomy, mirrored in approval-state.ts):
 *   - "approval"      — the normal gate: pauses the run for user approval.
 *   - "secret"        — secret hard-block: the agent continues, no pause.
 *   - "capture-error" — CAS staging failed, write kept on the deny-gate.
 *   - "fail-closed"   — approval state file missing, everything gated denies.
 *   - "disabled"      — the agent's tool lists exclude the tool (or the
 *                       sub-agent type): the agent continues, no pause,
 *                       permanent for the run.
 * Only approval-kind records carry the captured tool_input: a secret write's
 * content must never be persisted, a capture-error's content is
 * UNCLASSIFIED (the staging error means secret classification may never have
 * run), and fail-closed has no state to classify against.
 *
 * Identity extraction runs on the SAME Node.js binary as the runner (its
 * absolute path — process.execPath — is baked into the script at generation
 * time), because the identity token must be byte-identical to the one the
 * runner computes from the parsed stream event. The original grep/cut
 * extraction is kept only as a best-effort fallback if that binary cannot run:
 * grep's `"command":"[^"]*"` truncates at the first JSON-escaped quote, so for
 * a shell command like `printf '%s' "x" > file` the fallback token will NOT
 * match the runner's — the call is still denied (the gate holds) but the
 * denial cannot be overlaid onto the real streamed tool call and a grant for
 * it will not match on reinvocation. All policy decisions are pre-computed by
 * the runner into the state file (and into this generated script); the hook
 * only performs mechanical field extraction and string lookups — the policy
 * itself is authored once in TypeScript (approval-policy.ts /
 * approval-state.ts).
 *
 * Cross-taxonomy identity (the crux):
 * The preToolUse hook and the SDK event stream name the same operation
 * differently — the hook receives PascalCase `tool_name` (`Write` for any file
 * create/edit, `Shell`, `Delete`) while the stream emits lowercase `event.name`
 * (`edit`, `shell`, `delete`). They also name the salient argument differently
 * (`file_path` in the hook input vs `path` in the stream). So the hook and the
 * runner cannot correlate on the raw name. Instead both reduce a tool call to a
 * canonical identity — `base64(category \n salient)` — where `category` is the
 * approval category (`write`/`delete`/`shell`, baked into the case statement
 * below from approval-policy.ts) and `salient` is the resource VALUE (the file
 * path or shell command), which is identical on both sides. The runner mirrors
 * this exactly in approval-state.ts (toolIdentity + grantToken), so a denial
 * recorded here correlates to the streamed tool call, and an approval grant
 * matches the agent's re-attempt on reinvocation.
 *
 * Content-exact identity (the sibling-hole fix): for a file edit the coarse
 * (category, salient) is not enough — approving one edit to a file must not let
 * a DIFFERENT edit to the SAME file ride through. So the hook ALSO computes a
 * CONTENT token `base64(category \n salient \n contentDigest)`, where
 * contentDigest is a sha256 over the edit content (mirror of file-tools.ts
 * contentDigest; see buildContentDigestScript). It allows a built-in when EITHER
 * the content token (a file edit approved with this exact content) OR the coarse
 * token (shell/delete, or a content-less degrade) is granted, and records the
 * content token as the denial identity. The runner grants the content token when
 * it has the approved content (the persisted approval_content_digest), so a
 * sibling edit re-gates; it degrades to the coarse grant only when the content is
 * unrecoverable.
 *
 * Policy evaluation order (first match wins). The approval half is "gate the
 * dangerous set, allow the rest", matching the native harness:
 * 0. Scope guard: not the runner's own agent → allow (never touch the ledger)
 * 1. Missing state file → deny (fail-closed)
 * 1a. Tool lists (the state's `toolScope`, compiled by hook-scope.ts): a tool,
 *     MCP server tool or sub-agent type the agent's lists exclude → record
 *     kind "disabled", deny with the lists' refusal. Deliberately BEFORE the
 *     capture arms, autoApproveAll and every grant: a list says what the agent
 *     may call at all, so no approval posture may resurrect an excluded tool
 *     and no human is ever offered "approve" on one. The Node snippet only
 *     looks names up in the runner's tables; if it cannot run while the agent
 *     has lists, the call is denied (fail-closed).
 * 1b. subagentStart event that survived 1a → allow (no approval arm applies)
 * 1c. autoApproveAll (the pre-armed spec.auto_approve_all global bypass) →
 *     allow
 * 2. beforeMCPExecution event → the server's tool listed in mcpDestructiveTools:
 *    a. name token in approvedGrantTokens → allow (reinvocation grant)
 *    b. otherwise → record denial, deny
 *    (every other MCP tool falls through → allow; a server lease leaves its
 *     server's tools out of mcpDestructiveTools, so they fall through)
 * 3. preToolUse event → gated built-in (category non-empty):
 *    a. identity token in approvedGrantTokens → allow (reinvocation grant)
 *    b. category in leasedCategories → allow (run-lifetime scoped lease)
 *    c. otherwise → record denial, deny
 *    (read-only / ungated built-ins fall through → allow)
 */

import { SALIENT_ARG_FIELDS, getBuiltInGatedCategories } from "./approval-policy.js";
import { normalizeSubAgentType } from "../../shared/tool-lists.js";
import {
  CURSOR_HOOK_MCP_PREFIX,
  ENGINE_EXTRA_SCOPE_KEY,
  AGENT_SCOPE_KEY,
  READ_SCOPE_KEY,
  SCOPE_KEY_PREFIX,
  TOOL_NAME_PLACEHOLDER,
} from "./hook-scope.js";
import {
  EDIT_OLD_FIELDS,
  EDIT_NEW_FIELDS,
  WRITE_CONTENT_FIELDS,
} from "../../shared/file-tools.js";
import { buildObservationStagingScript, buildSecretClassifyScript, CAS_OBSERVATIONS_DIRNAME } from "./cas-observations.js";

// Shown to the model when the gate denies a tool call. It must NOT teach the
// model to ask for permission in prose or to "stop and wait" — that framing
// makes the model narrate approval requests instead of invoking tools (the
// platform's approval surface is driven by tool invocation; see
// formatToolApprovalProtocol in prompt-builder.ts). Instead it tells the model
// the approval is automatic and that it should not retry or work around THIS
// action. Embedded verbatim into the generated hook script inside a
// single-quoted bash echo of a JSON object, so the text must contain no double
// quotes, apostrophes, or backslashes.
const APPROVAL_REQUIRED_AGENT_MESSAGE =
  "This action has been submitted to the user for approval automatically; you " +
  "do not need to ask for permission. This is the platform approval gate working " +
  "as intended — it is not an error and not a Cursor misconfiguration, so never " +
  "tell the user to change Cursor settings or enable hooks. Do not retry it or " +
  "attempt a workaround for this action. The platform will resume you " +
  "automatically after the user responds — continue with the rest of the task.";

// Shown to the model when the gate denies a tool call under UNATTENDED
// approval mode: the creating surface (a messaging channel, a guest
// share) has no approver, so — unlike APPROVAL_REQUIRED_AGENT_MESSAGE — this
// must NOT promise a resume: the deny is final for this turn and the model
// must adapt. It also enforces the anti-leak posture: the end user hears a
// plain-language explanation, never tool/approval vocabulary. Same embedding
// constraint (single-quoted bash echo of a JSON object): no double quotes,
// apostrophes, or backslashes. Mirrors the native gate skip message
// (middleware/approval-gate.ts unattendedSkipMessage) in intent.
const UNATTENDED_SKIP_AGENT_MESSAGE =
  "This action was skipped automatically because it requires an approval that " +
  "is not available in this conversation. This is the platform approval gate " +
  "working as intended — it is not an error and not a Cursor misconfiguration. " +
  "Do not retry it or attempt a workaround; it will not be resumed. Adapt your " +
  "plan, and explain to the user in plain language what you could not do and " +
  "what they can do instead — never mention tools, approvals, or platform " +
  "mechanics.";

// Shown to the model when a secret-like gitignored write is hard-blocked.
// Unlike APPROVAL_REQUIRED_AGENT_MESSAGE, this must NOT promise a resume:
// the write is discarded and never captured for review, so the model must move on
// rather than wait or retry. Same embedding constraint (single-quoted bash echo
// of a JSON object): no double quotes, apostrophes, or backslashes.
const SECRET_BLOCKED_AGENT_MESSAGE =
  "This file was blocked for security because its path matches a secret-like " +
  "pattern Stigmer will not capture for review. Nothing was written. This is the " +
  "platform safety gate working as intended — it is not an error and not a Cursor " +
  "misconfiguration, so never tell the user to change Cursor settings or enable " +
  "hooks. Do not retry this write or attempt a workaround; the write will not be " +
  "applied. Continue with the rest of the task.";

// Shown to the model when the agent has tool lists but the hook could not
// evaluate them (the runner's Node binary would not run, or the state would
// not parse): the call is refused, since a list the hook cannot read must not
// widen to "every tool". Same embedding constraint (single-quoted bash echo of
// a JSON object): no double quotes, apostrophes, or backslashes.
const SCOPE_UNAVAILABLE_AGENT_MESSAGE =
  "This tool call was refused because the platform could not check it against " +
  "this agent tool lists. Do not retry it; continue without it and tell the " +
  "user plainly what you could not do.";

/**
 * Build the bash `case` arms that map an incoming hook `tool_name` to its
 * canonical approval category. Generated from approval-policy.ts so the hook and
 * the runner never disagree on which built-ins are gated or how they categorize.
 */
function buildCategoryCaseArms(): string {
  const byCategory = new Map<string, string[]>();
  for (const [name, category] of getBuiltInGatedCategories()) {
    const names = byCategory.get(category) ?? [];
    names.push(name);
    byCategory.set(category, names);
  }
  const arms: string[] = [];
  for (const [category, names] of byCategory) {
    const pattern = names.map((n) => `"${n}"`).join("|");
    arms.push(`      ${pattern}) CATEGORY="${category}" ;;`);
  }
  return arms.join("\n");
}

/**
 * Build the inline content-digest extractor — a BYTE-IDENTICAL MIRROR of
 * {@link file://../../shared/file-tools.ts} `contentDigest()`.
 *
 * Computes the same `sha256(JSON.stringify(["w", content]))` /
 * `sha256(JSON.stringify(["e", old, new]))` from the parsed tool_input `a`,
 * using the SAME union field lists injected from file-tools.ts (so the
 * file_path/path & content/contents cross-layer name divergence is normalized
 * identically) and the SAME Node binary as the runner — so the hook-side and
 * runner-side digests agree. Any change to the format here or in
 * file-tools.ts MUST be mirrored in the other. Empty (`dig===""`) for a tool
 * with no edit content (shell/delete/read/MCP).
 *
 * Authored as part of a single-quoted bash string, so the JS must not contain
 * single quotes (JSON.stringify emits double quotes).
 */
function buildContentDigestScript(): string {
  const wc = JSON.stringify(WRITE_CONTENT_FIELDS);
  const eo = JSON.stringify(EDIT_OLD_FIELDS);
  const en = JSON.stringify(EDIT_NEW_FIELDS);
  return [
    `const pick=(fl)=>{for(const f of fl){const v=a[f];if(typeof v==="string")return v;}return null;};`,
    `const sha=(x)=>require("crypto").createHash("sha256").update(x,"utf8").digest("hex");`,
    `let dig="";`,
    `const _wc=pick(${wc});`,
    `if(_wc!==null){dig=sha(JSON.stringify(["w",_wc]));}`,
    `else{const _o=pick(${eo}),_n=pick(${en});if(_o!==null||_n!==null){dig=sha(JSON.stringify(["e",_o===null?"":_o,_n===null?"":_n]));}}`,
  ].join("");
}

/**
 * Build the inline tool-lists evaluator (policy arm 1a), part of the identity
 * extractor below. It reads the turn's state file (`process.argv[1]`), decodes
 * `toolScope` (`encodeHookToolScope`) and looks the call up in the tables `hook-scope.ts` compiled from
 * the runner's `ToolScope`: it decides nothing those tables do not already
 * say, so the list rules stay in `shared/tool-lists.ts` alone. Sets:
 *  - `sv`: "" (in scope, or no lists), "E" (could not evaluate), else
 *    base64(JSON) of the deny response, the refusal naming the tool;
 *  - `stk`: the ledger token a refusal is recorded under, the scope token
 *    (`approval-state.ts` `scopeRefusalToken`): keyed by the built-in's
 *    `scopeKey` (every engine extra shares one), by `server/tool` for an MCP
 *    call (the `mcpToolKey` form), by the `Task` key for a sub-agent start;
 *    and, for a tool the lists may exclude only in part (`READ_SCOPE_KEY`,
 *    `AGENT_SCOPE_KEY`), discriminated by the call: the path as given, the
 *    normalized sub-agent type;
 *  - `smsg`: base64 of the refusal text, which the ledger carries so the turn
 *    boundary can write the very words the model read onto the refused row.
 * An excluded `Read` is let through only when the file's REAL path lies
 * inside `readRoot` (the platform dir's real path, "" on a turn with no
 * platform link), the path resolved against the payload's `cwd`, else the
 * baked workspace root (`process.argv[2]`); a missing file is refused. A
 * `Task` call naming its `subagent_type` is held to `Agent(type, …)` here as
 * well as at `subagentStart`, refused under the same discriminator. Both are a
 * second line for a runtime that fires them, never the guard: the 1.0.31
 * local runtime fires neither for a `task` call (live probe, 2026-10-05), so
 * an `Agent(type, …)` type list is refused at setup (`turn-setup.ts`). A
 * sub-agent type is normalized by the source of `normalizeSubAgentType`
 * itself, embedded, so the hook and the resolver share one rule. Expects `t`, `name`, `a`, `s`, `b`, `ev`
 * and `srv` in scope.
 */
function buildScopeEvalScript(): string {
  const placeholder = JSON.stringify(TOOL_NAME_PLACEHOLDER);
  const mcpPrefix = JSON.stringify(CURSOR_HOOK_MCP_PREFIX);
  const keyPrefix = JSON.stringify(SCOPE_KEY_PREFIX);
  const extraKey = JSON.stringify(ENGINE_EXTRA_SCOPE_KEY);
  const readKey = JSON.stringify(READ_SCOPE_KEY);
  const agentKey = JSON.stringify(AGENT_SCOPE_KEY);
  return [
    `let sv="",stk="",smsg="",disc="";`,
    `try{`,
    `const st=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));`,
    `const sc=st.toolListsRestricted===true?JSON.parse(Buffer.from(String(st.toolScope),"base64").toString("utf8")):null;`,
    `if(sc&&sc.restricted===true){`,
    `const own=(o,k)=>o!==null&&typeof o==="object"&&Object.prototype.hasOwnProperty.call(o,k);`,
    `let ok=true,label=name,key=name;`,
    `const nt=(${normalizeSubAgentType.toString()});`,
    `const typeOk=(lt)=>own(sc.subAgentTypes.types,lt)?sc.subAgentTypes.types[lt]===true:sc.subAgentTypes.otherTypes===true;`,
    `if(ev==="subagentStart"){`,
    `const ty=typeof t.subagent_type==="string"?t.subagent_type:"";`,
    `const lt=nt(ty);`,
    `ok=typeOk(lt);`,
    `label="Agent("+ty+")";`,
    `disc=lt;`,
    `key=own(sc.builtins,"Task")?sc.builtins.Task.key:"Task";`,
    `}else if(ev==="beforeMCPExecution"){`,
    `const sm=own(sc.mcp.servers,srv)?sc.mcp.servers[srv]:null;`,
    `ok=sm?(own(sm.tools,name)?sm.tools[name]===true:sm.otherTools===true):sc.mcp.otherServers===true;`,
    `key=srv+"/"+name;`,
    `}else if(!name.startsWith(${mcpPrefix})){`,
    `const e=own(sc.builtins,name)?sc.builtins[name]:null;`,
    `ok=e?e.allowed===true:sc.otherBuiltins===true;`,
    `key=e?e.key:${extraKey};`,
    `if(key===${readKey})disc=s;`,
    `if(ok&&key===${agentKey}&&typeof a.subagent_type==="string"&&a.subagent_type!==""){`,
    `const lt=nt(a.subagent_type);`,
    `if(!typeOk(lt)){ok=false;label="Agent("+a.subagent_type+")";disc=lt;}`,
    `}`,
    `if(!ok&&key===${readKey}&&s&&typeof sc.readRoot==="string"&&sc.readRoot!==""){`,
    `const pth=require("path");`,
    `const base=typeof t.cwd==="string"&&t.cwd?t.cwd:(process.argv[2]||"/");`,
    `try{ok=require("fs").realpathSync(pth.resolve(base,s)).startsWith(sc.readRoot+pth.sep);}catch(e){ok=false;}`,
    `}`,
    `}`,
    `if(!ok){`,
    `const msg=String(sc.refusal).split(${placeholder}).join(label);`,
    `sv=b(JSON.stringify(ev==="subagentStart"?{permission:"deny",user_message:msg}:{permission:"deny",agent_message:msg,user_message:msg}));`,
    `stk=b(${keyPrefix}+key+"\\n"+disc);`,
    `smsg=b(msg);`,
    `}`,
    `}`,
    `}catch(e){sv="E";stk="";smsg="";}`,
  ].join("");
}

/**
 * Build the inline Node.js identity extractor embedded in the hook script.
 *
 * Parses the hook's stdin JSON properly (the bash fallback's grep truncates
 * string values at the first escaped quote) and emits TWELVE lines: tool_name,
 * canonical category, coarse identity token, MCP name-token, hook_event_name
 * (the event discriminator: `preToolUse` for built-ins, `beforeMCPExecution`
 * for MCP), base64(JSON(tool_input)) — the authoritative pre-execution args the
 * runner overlays onto the gated tool call for the approval preview — the
 * CONTENT token (base64(category \n salient \n contentDigest), empty when the
 * tool has no edit content), base64(salient), and mcp_server_name (the MCP
 * server slug the beforeMCPExecution payload carries; empty for built-ins),
 * then the tool-lists verdict, its ledger token and its refusal text
 * ({@link buildScopeEvalScript}).
 * It runs with two arguments: the turn's state file and the baked workspace
 * root. The token encodings must stay byte-identical to
 * grantToken()/contentToken()/scopeRefusalToken() in approval-state.ts.
 *
 * Authored as a single-quoted bash string, so the JS must not contain single
 * quotes. The category map, salient field list, and edit/content field lists are
 * baked from approval-policy.ts / file-tools.ts — the same source the runner
 * uses — so the two sides can never disagree.
 */
function buildNodeIdentityScript(): string {
  const categoryMap: Record<string, string> = {};
  for (const [name, category] of getBuiltInGatedCategories()) {
    categoryMap[name] = category;
  }
  const categories = JSON.stringify(categoryMap);
  const fields = JSON.stringify(SALIENT_ARG_FIELDS);
  return [
    `const t=JSON.parse(require("fs").readFileSync(0,"utf8"));`,
    `const name=typeof t.tool_name==="string"?t.tool_name:"";`,
    `const cat=(${categories})[name]||"";`,
    // tool_input is an object for built-ins (preToolUse) but a JSON STRING for
    // MCP tools (beforeMCPExecution). Parse the string form so the captured
    // input is the same object shape on both paths.
    `let a={};`,
    `if(t.tool_input&&typeof t.tool_input==="object"){a=t.tool_input;}`,
    `else if(typeof t.tool_input==="string"){try{const p=JSON.parse(t.tool_input);if(p&&typeof p==="object")a=p;}catch(e){}}`,
    `let s="";`,
    `for(const f of ${fields}){const v=a[f];if(typeof v==="string"&&v){s=v;break;}}`,
    `const b=(x)=>Buffer.from(x,"utf8").toString("base64");`,
    // Content digest of the edit (mirror of file-tools.ts contentDigest); `dig`
    // is "" for a non-edit tool, in which case the content token (line 7) is "".
    buildContentDigestScript(),
    `const ev=typeof t.hook_event_name==="string"?t.hook_event_name:"";`,
    `const srv=typeof t.mcp_server_name==="string"?t.mcp_server_name:"";`,
    buildScopeEvalScript(),
    // Line 6 is base64(JSON(tool_input)): the AUTHORITATIVE pre-execution args
    // the runner overlays onto the gated tool call so the approval card can show
    // the proposed change before the user approves. Base64 keeps the bash side
    // free of quoting/escaping concerns even for large multi-line file content.
    // Line 7 is the CONTENT token (empty when no digest) — the exact-identity
    // grant the runner authorizes for a file edit. Line 8 is base64(salient) —
    // the raw resource value (file path / command) capture mode needs to run
    // `git check-ignore` on a file path; base64 keeps newlines/quotes out of the
    // line-oriented bash parse. Line 9 is mcp_server_name — the server half of
    // the destructive-tool key (a bare slug, never quoted/escaped, so it rides
    // as a plain line).
    // Lines 10 to 12 are the tool-lists verdict, its ledger token and its
    // refusal text (buildScopeEvalScript), each a single base64 line or a
    // sentinel.
    `process.stdout.write(name+"\\n"+cat+"\\n"+b(cat+"\\n"+s)+"\\n"+b(name+"\\n")+"\\n"+ev+"\\n"+b(JSON.stringify(a))+"\\n"+(dig?b(cat+"\\n"+s+"\\n"+dig):"")+"\\n"+b(s)+"\\n"+srv+"\\n"+sv+"\\n"+stk+"\\n"+smsg);`,
  ].join("");
}

/**
 * Generates the STABLE bash hook script content.
 *
 * The script is STABLE across executions in a runner process — its only inputs
 * are the absolute path of the active-turn pointer (and the runner's Node
 * binary), both constant for a given workspace. This is deliberate and
 * load-bearing: the Cursor SDK loads `<workspace>/.cursor/hooks.json` (the hook
 * script PATH) ONCE per runner process and caches it, ignoring later
 * per-execution rewrites. A per-session script with per-session baked paths
 * therefore gets cached at the FIRST execution and reused for every later one,
 * recording their denials into the FIRST session's ledger while each later runner
 * reads its own (empty) ledger and silently completes — the no-approval-button /
 * "execution completed" regression. Keeping the script stable and resolving the
 * CURRENT turn's artifacts from the pointer (which bash re-reads every
 * invocation; see {@link ActiveTurnPointer}/writeActiveTurnPointer) makes a
 * long-lived multi-session runner correct.
 *
 * From the pointer the script reads the current turn's approval-state file (the
 * single source of truth for the dynamic inputs: autoApproveAll, leasedCategories,
 * mcpDestructiveTools, toolScope, approvedGrantTokens), denial ledger, and
 * runner PID. The
 * static policy (which built-ins are gated, their categories, the salient arg
 * fields) is baked at generation time from approval-policy.ts.
 *
 * The identity token encoding (`base64(key \n salient)`) must stay byte-identical
 * to grantToken() in approval-state.ts.
 *
 * Scope guard (the crux of issue #173): the Cursor SDK loads project hooks from
 * `<workspace>/.cursor/hooks.json`, the SAME per-repo surface every Cursor client
 * reads. When a session runs against the user's real repo, the user's own
 * interactive Cursor IDE would otherwise load and run this hook too — gating the
 * IDE, polluting the denial ledger, and (in multi-root windows) failing closed.
 * We make the gate apply ONLY to the runner's own agent by checking, on every
 * invocation, whether the runner PID (FROM THE POINTER) is an ancestor of the
 * hook process. The SDK runs hooks in-process via child_process, so the runner's
 * own agent (and its delegated sub-agents) spawn the hook as a descendant of the
 * runner; any other Cursor client spawns it under a different process tree. A
 * non-descendant invocation is allowed immediately and never touches the ledger.
 * Combined with pointer teardown, a leftover hooks.json is self-neutralizing:
 * once the turn ends (pointer removed) or the runner exits (PID dead), no
 * invocation gates, so the gate is inert.
 */
export function generateHookScript(activePointerPath: string, workspaceRoot = ""): string {
  const salientFields = SALIENT_ARG_FIELDS.join(" ");
  const categoryCaseArms = buildCategoryCaseArms();
  const nodeIdentityScript = buildNodeIdentityScript();
  const observationStagingScript = buildObservationStagingScript();
  const secretClassifyScript = buildSecretClassifyScript();
  const nodeBin = process.execPath;
  return `#!/bin/bash
# Stigmer HITL approval hook for Cursor (preToolUse + beforeMCPExecution).
# Generated by cursor-runner — do not edit manually.
#
# Reads a tool call from stdin (JSON), checks the approval state file, returns a
# permission decision on stdout (JSON). Branches on hook_event_name: MCP tools
# are gated on beforeMCPExecution, built-ins on preToolUse (preToolUse does not
# enforce MCP), sub-agent types on subagentStart. On a deny, appends the call's
# canonical identity token to the denial ledger so the runner can mark the
# gated tool call as WAITING_APPROVAL.
# See hook-script.ts for the cross-taxonomy identity design.

set -euo pipefail

INPUT=$(cat)

NODE_BIN="${nodeBin}"
ACTIVE_FILE="${activePointerPath}"
# Baked workspace root for capture-mode's gitignore check (empty in unit tests
# that don't exercise capture mode; the check then falls back to the path's dir).
GIT_ROOT="${workspaceRoot}"

# --- Resolve the CURRENT turn from the runner-written pointer ----------------
# The Cursor SDK caches .cursor/hooks.json (the hook script PATH) for the runner
# process, so THIS script is stable across executions and the per-turn pointer
# (active.json) — which bash re-reads on every invocation — is the only thing
# that changes. It names the CURRENT turn's approval-state, denial ledger, and
# runner PID. This indirection is what makes a long-lived runner correct: a
# per-session script baked with per-session paths would be cached at the FIRST
# execution and reused for every later one, recording their denials to the FIRST
# session's ledger while each later runner reads its own empty ledger and
# silently completes (the no-approval-button / "completed" regression).
#
# A missing/garbled pointer means no active Stigmer turn (between turns, after
# teardown, or a dead runner) -> allow (inert), matching the
# leftover-hooks.json-is-inert invariant (issue #173).
if [ ! -f "$ACTIVE_FILE" ]; then
  echo '{"permission":"allow"}'
  exit 0
fi
PTR=$(ELECTRON_RUN_AS_NODE=1 "$NODE_BIN" -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((p.stateFile||"")+"\\n"+(p.ledgerFile||"")+"\\n"+((p.runnerPid==null)?"":String(p.runnerPid)))' "$ACTIVE_FILE" 2>/dev/null || true)
if [ -n "$PTR" ]; then
  STATE_FILE=$(printf '%s\\n' "$PTR" | sed -n 1p)
  LEDGER_FILE=$(printf '%s\\n' "$PTR" | sed -n 2p)
  RUNNER_PID=$(printf '%s\\n' "$PTR" | sed -n 3p)
else
  # Node unavailable: the pointer holds plain ~/.stigmer paths and an integer
  # (no JSON-escaped quotes), so grep/cut is reliable here.
  STATE_FILE=$(grep -o '"stateFile":"[^"]*"' "$ACTIVE_FILE" | head -1 | cut -d'"' -f4 || true)
  LEDGER_FILE=$(grep -o '"ledgerFile":"[^"]*"' "$ACTIVE_FILE" | head -1 | cut -d'"' -f4 || true)
  RUNNER_PID=$(grep -o '"runnerPid":[0-9]*' "$ACTIVE_FILE" | head -1 | cut -d: -f2 || true)
fi
if [ -z "$RUNNER_PID" ]; then
  # Pointer unreadable -> no scope owner to gate for; stay inert.
  echo '{"permission":"allow"}'
  exit 0
fi

# --- Scope guard: gate ONLY the runner's own agent (issue #173) -------------
# The Cursor SDK runs hooks in-process, so the runner's own agent invocations
# spawn this script as a DESCENDANT of the runner process (RUNNER_PID); the
# user's interactive IDE — sharing the same repo .cursor/hooks.json — spawns it
# under a different process tree. Walk the parent-PID chain: if the runner is an
# ancestor, apply the gate; otherwise allow immediately and DO NOT write the
# ledger (so foreign tool calls never appear as phantom approvals). Pure bash so
# it works even when the Node identity binary below is unavailable.
__stigmer_ppid() {
  _p="$1"
  if [ -r "/proc/$_p/status" ]; then
    awk '/^PPid:/{print $2; exit}' "/proc/$_p/status" 2>/dev/null || true
  else
    ps -o ppid= -p "$_p" 2>/dev/null | tr -d ' ' || true
  fi
}
__stigmer_is_own_agent() {
  _cur="$$"
  _i=0
  while [ "$_i" -lt 64 ]; do
    if [ -z "$_cur" ]; then return 1; fi
    if [ "$_cur" = "$RUNNER_PID" ]; then return 0; fi
    if [ "$_cur" = "1" ] || [ "$_cur" = "0" ]; then return 1; fi
    _cur="$(__stigmer_ppid "$_cur")"
    _i=$((_i + 1))
  done
  return 1
}
if ! __stigmer_is_own_agent; then
  echo '{"permission":"allow"}'
  exit 0
fi

# --- Capture-mode helper: is a path gitignored? -----------------------------
# In capture mode the runner snapshots the working tree with git and reconciles
# it to the user's per-file decisions on resume, but a gitignored path (e.g.
# .env, build output) is invisible to that snapshot — so it can be neither
# captured for review nor reverted on reject. Such writes/deletes therefore stay
# on the deny-gate. Returns 0 (true) when the path is ignored. A non-git context
# or a missing path returns non-zero (treated as not-ignored -> allow).
__stigmer_is_gitignored() {
  _p="$1"
  [ -z "$_p" ] && return 1
  if [ -n "$GIT_ROOT" ]; then
    git -C "$GIT_ROOT" check-ignore -q -- "$_p" 2>/dev/null
  else
    git -C "$(dirname "$_p")" check-ignore -q -- "$_p" 2>/dev/null
  fi
}

# --- Canonical identity: tool_name / category / identity token / MCP token ---
# Computed by the same Node.js binary that runs the cursor-runner (absolute path
# baked at generation time) so JSON string values — file paths and especially
# shell commands containing quotes, newlines, or unicode escapes — decode to the
# exact bytes the runner sees in the stream event. ELECTRON_RUN_AS_NODE makes
# the invocation safe when the runner is embedded in an Electron app (where
# process.execPath is the Electron binary). NODE_BIN is defined once near the top
# (it also parses the active-turn pointer).
IDENTITY=$(printf '%s' "$INPUT" | ELECTRON_RUN_AS_NODE=1 "$NODE_BIN" -e '${nodeIdentityScript}' "$STATE_FILE" "$GIT_ROOT" 2>/dev/null || true)
if [ -n "$IDENTITY" ]; then
  TOOL_NAME=$(printf '%s\\n' "$IDENTITY" | sed -n 1p)
  CATEGORY=$(printf '%s\\n' "$IDENTITY" | sed -n 2p)
  TOKEN=$(printf '%s\\n' "$IDENTITY" | sed -n 3p)
  MCP_TOKEN=$(printf '%s\\n' "$IDENTITY" | sed -n 4p)
  HOOK_EVENT=$(printf '%s\\n' "$IDENTITY" | sed -n 5p)
  # base64(JSON(tool_input)) — the authoritative args the runner overlays onto
  # the gated tool call. A single unwrapped base64 line (Node does not wrap), so
  # sed reads it whole even for large file content.
  INPUT_B64=$(printf '%s\\n' "$IDENTITY" | sed -n 6p)
  # Content token (base64 of category\\nsalient\\ndigest), empty for a non-edit
  # tool. The exact-identity grant the runner authorizes for a file edit.
  CONTENT_TOKEN=$(printf '%s\\n' "$IDENTITY" | sed -n 7p)
  # Raw salient (base64) — the file path / command. Capture mode decodes it to
  # run git check-ignore on a file path.
  SALIENT=$(printf '%s\\n' "$IDENTITY" | sed -n 8p | base64 -d 2>/dev/null || true)
  # MCP server slug (beforeMCPExecution payloads only; empty for built-ins).
  MCP_SERVER=$(printf '%s\\n' "$IDENTITY" | sed -n 9p)
  # Tool-lists verdict: empty (in scope), E (could not evaluate), or the
  # base64 deny response; and the ledger token a refusal is recorded under.
  SCOPE_VERDICT=$(printf '%s\\n' "$IDENTITY" | sed -n 10p)
  SCOPE_TOKEN=$(printf '%s\\n' "$IDENTITY" | sed -n 11p)
  SCOPE_MESSAGE=$(printf '%s\\n' "$IDENTITY" | sed -n 12p)
else
  # Fallback when the Node binary cannot run: grep/cut extraction. Best-effort
  # only — '"field":"[^"]*"' truncates at the first JSON-escaped quote, so the
  # token may not match the runner's for values containing escapes. Gating still
  # holds (deny goes out); only denial correlation and grant precision degrade.
  # Every extraction ends with '|| true': under 'set -e' a non-matching grep
  # would otherwise abort the script and emit no decision.
  TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  HOOK_EVENT=$(echo "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  # Server slugs are plain identifiers (no JSON-escaped quotes), so the grep
  # fallback extracts mcp_server_name reliably.
  MCP_SERVER=$(echo "$INPUT" | grep -o '"mcp_server_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  SALIENT=""
  for field in ${salientFields}; do
    v=$(echo "$INPUT" | grep -o "\\"$field\\":\\"[^\\"]*\\"" | head -1 | cut -d'"' -f4 || true)
    if [ -n "$v" ]; then SALIENT="$v"; break; fi
  done
  CATEGORY=""
  case "$TOOL_NAME" in
${categoryCaseArms}
      *) CATEGORY="" ;;
  esac
  TOKEN=$(printf '%s\\n%s' "$CATEGORY" "$SALIENT" | base64 | tr -d '\\n')
  MCP_TOKEN=$(printf '%s\\n' "$TOOL_NAME" | base64 | tr -d '\\n')
  # The grep fallback cannot reliably capture full multi-line tool_input, so the
  # gated call degrades to today's stream-recovered args (no authoritative input)
  # and cannot compute a content digest — the coarse token is the only identity.
  INPUT_B64=""
  CONTENT_TOKEN=""
  # Without Node the tool lists cannot be evaluated; the scope arm refuses
  # every call when the agent has lists (fail-closed).
  SCOPE_VERDICT="E"
  SCOPE_TOKEN=""
  SCOPE_MESSAGE=""
fi
# The single identity a deny is recorded under: content-exact when the input
# carried edit content, else coarse — the same PRIMARY-token choice the runner
# grants on approval (approval-state.ts primaryToken).
if [ -n "$CONTENT_TOKEN" ]; then
  PRIMARY_TOKEN="$CONTENT_TOKEN"
else
  PRIMARY_TOKEN="$TOKEN"
fi

# Append a denial record to the ledger: $1 = identity token, $2 = kind (the
# attribution taxonomy — see the module doc in hook-script.ts). EVERY deny arm
# below records, so the ledger is the complete record of what THIS hook blocked
# and the runner can tell its own denials from a foreign hook's (issue #205).
# Best-effort: a ledger write failure must never abort the decision (the deny
# still goes out on stdout). ONLY approval-kind records carry the captured
# tool_input (secret or unclassified content must never be persisted);
# input is base64(JSON(tool_input)) — the authoritative pre-execution args the
# runner overlays for the approval preview (empty on the grep fallback path).
# A tool-list refusal passes $3, base64 of the refusal text the model read,
# which the turn boundary writes onto the refused row. Written with printf (a builtin, so no ARG_MAX limit) because the input can be
# a large multi-MB file body. Defined BEFORE the first deny arm: bash resolves
# function calls at execution time, and under 'set -euo pipefail' with our
# failClosed hooks.json registration a call-before-define would abort with no
# decision and block EVERY tool.
record_denial() {
  if [ "$2" = "approval" ]; then
    printf '{"toolName":"%s","token":"%s","kind":"%s","input":"%s"}\\n' "$TOOL_NAME" "$1" "$2" "$INPUT_B64" >> "$LEDGER_FILE" 2>/dev/null || true
  elif [ -n "\${3:-}" ]; then
    printf '{"toolName":"%s","token":"%s","kind":"%s","message":"%s"}\\n' "$TOOL_NAME" "$1" "$2" "$3" >> "$LEDGER_FILE" 2>/dev/null || true
  else
    printf '{"toolName":"%s","token":"%s","kind":"%s"}\\n' "$TOOL_NAME" "$1" "$2" >> "$LEDGER_FILE" 2>/dev/null || true
  fi
}

# --- Failsafe: missing state file → deny (fail-closed) ---
# Recorded as kind "fail-closed" so the runner attributes the blocked call to
# its own (broken) gate instead of misdiagnosing a foreign hook. The ledger
# path comes from the POINTER, not the state file, so it is recordable here.
if [ ! -f "$STATE_FILE" ]; then
  if [ "$HOOK_EVENT" = "beforeMCPExecution" ]; then
    record_denial "$MCP_TOKEN" "fail-closed"
  else
    record_denial "$PRIMARY_TOKEN" "fail-closed"
  fi
  echo '{"permission":"deny","agent_message":"${APPROVAL_REQUIRED_AGENT_MESSAGE}","user_message":"Tool requires approval: '"$TOOL_NAME"'"}'
  exit 0
fi

STATE=$(cat "$STATE_FILE")

# Capture mode (git workspaces): file mutations flow during the turn and are
# captured/gated per-file by the runner at the turn boundary (see
# shared/filereview/git-substrate.ts). Read once; consulted only in the
# gated-built-in arm below.
CAPTURE_MODE=false
if echo "$STATE" | grep -q '"captureMode":true'; then
  CAPTURE_MODE=true
fi
# CAS capture of gitignored writes (the deep-agent parity switch). Set only when
# capture mode is on AND an artifact storage is configured (to persist blobs). It
# governs whether a non-secret gitignored write is staged+flowed for review vs.
# kept on the deny-gate. Read here; consulted only in the gitignored-capture arm
# below, which runs BEFORE auto-approve-all (capture is a turn property).
CAPTURE_IGNORED=false
if echo "$STATE" | grep -q '"captureIgnored":true'; then
  CAPTURE_IGNORED=true
fi
# gitWorkspace selects the capture substrate. Default true when the
# key is absent (older state files). When false the workspace is NOT a git tree:
# there is no git snapshot, so EVERY file write/delete is CAS-staged below (not
# only gitignored ones) and the git-tracked flow arm is skipped.
GIT_WORKSPACE=true
if echo "$STATE" | grep -q '"gitWorkspace":false'; then
  GIT_WORKSPACE=false
fi
# Unattended approval mode: the surface has no approver. Same gate,
# different RESOLUTION — the approval-deny arms below record kind "unattended"
# (non-pausing) with an adapt-and-explain message instead of kind "approval"
# (pausing). Secret/fail-closed/capture-error arms are mode-independent.
UNATTENDED_SKIP=false
if echo "$STATE" | grep -q '"unattendedSkip":true'; then
  UNATTENDED_SKIP=true
fi

# --- 1a. Tool lists: what this agent may call at all ------------------------
# Runs BEFORE the capture arms, the auto-approve-all shortcut and every grant:
# a list is not an approval gate, so no bypass may resurrect an excluded tool
# and no human may be offered approval on one. The Node snippet looked the call
# up in the runner's compiled scope (toolScope, hook-scope.ts) and handed back
# the deny response; this arm only records and replies. Kind "disabled":
# attributable, non-pausing (the model adapts), permanent for the run.
if [ "$SCOPE_VERDICT" = "E" ]; then
  if echo "$STATE" | grep -q '"toolListsRestricted":true'; then
    record_denial "$PRIMARY_TOKEN" "fail-closed"
    echo '{"permission":"deny","agent_message":"${SCOPE_UNAVAILABLE_AGENT_MESSAGE}","user_message":"Refused: the tool lists could not be checked"}'
    exit 0
  fi
elif [ -n "$SCOPE_VERDICT" ]; then
  record_denial "$SCOPE_TOKEN" "disabled" "$SCOPE_MESSAGE"
  printf '%s' "$SCOPE_VERDICT" | base64 -d
  echo
  exit 0
fi

# --- 1b. A sub-agent start the lists allow ----------------------------------
# subagentStart reaches this script only for the scope arm above; no approval
# arm below applies to it.
if [ "$HOOK_EVENT" = "subagentStart" ]; then
  echo '{"permission":"allow"}'
  exit 0
fi

# --- Capture mode: observe CAS-owned writes for review ----------------------
# Runs BEFORE the auto-approve-all shortcut and the grant/lease checks because
# capture is a property of the TURN, not authorization: a non-secret CAS-owned
# write must be staged and reviewed even under the global bypass, and a
# secret-like one must be hard-blocked in every mode. WHICH writes are CAS-owned
# depends on the substrate: in a git tree it is only the GITIGNORED writes (git
# captures the tracked ones); in a NON-GIT workspace it is EVERY write (there is
# no git snapshot). Only a built-in write/edit (category "write") takes THIS arm;
# deletes take their own staging arm just below (issue #303), shell/MCP stay on
# the deny-gate (parity with the deep-agent approval gate). The staging runs on
# the runner's own Node binary (the
# disk-backed mirror of CasCaptureFilesystemBackend.recordBefore): the salient
# path rides stdin (no argv escaping), the workspace root and the per-turn
# cas-observations dir ride argv. "captured" -> allow (apply-then-review);
# "secret" -> hard-block; "error"/Node-unavailable -> fail closed (deny, since a
# write we cannot capture cannot be reviewed).
if [ "$CAPTURE_IGNORED" = "true" ] && [ "$CATEGORY" = "write" ] && [ -n "$SALIENT" ] && { [ "$GIT_WORKSPACE" = "false" ] || __stigmer_is_gitignored "$SALIENT"; }; then
  OBS_DIR="$(dirname "$STATE_FILE")/${CAS_OBSERVATIONS_DIRNAME}"
  OBS_RESULT=$(printf '%s' "$SALIENT" | ELECTRON_RUN_AS_NODE=1 "$NODE_BIN" -e '${observationStagingScript}' "$GIT_ROOT" "$OBS_DIR" 2>/dev/null || echo error)
  if [ "$OBS_RESULT" = "captured" ]; then
    echo '{"permission":"allow"}'
    exit 0
  elif [ "$OBS_RESULT" = "secret" ]; then
    # Kind "secret": attributable but deliberately non-pausing (the agent moves
    # on) and content-free (the token is the only identity recorded).
    record_denial "$PRIMARY_TOKEN" "secret"
    echo '{"permission":"deny","agent_message":"${SECRET_BLOCKED_AGENT_MESSAGE}","user_message":"Blocked for security: this file matches a secret-like path and was not written or captured for review."}'
    exit 0
  else
    # Node unavailable or a staging error: fail closed. A gitignored write we
    # cannot stage cannot be captured for review, so keep gating it (today's
    # behavior) rather than letting unreviewable bytes flow. Kind
    # "capture-error" and content-free: the staging error means secret
    # classification may never have run, so the content is UNCLASSIFIED.
    record_denial "$PRIMARY_TOKEN" "capture-error"
    echo '{"permission":"deny","agent_message":"${APPROVAL_REQUIRED_AGENT_MESSAGE}","user_message":"Tool requires approval: '"$TOOL_NAME"'"}'
    exit 0
  fi
fi

# --- Capture mode: observe CAS-owned deletes for review (issue #303) --------
# The delete twin of the write arm above — a non-secret CAS-owned delete stages
# its before-bytes (the one moment they still exist on disk) and flows; the
# turn boundary then reads after=null and authors a reviewable, restorable
# DELETE entry. One deliberate difference from the write arm: the path is
# classified for secret-likeness BEFORE any staging touches the sidecar. A
# secret-like delete must stay on the deny-gate below where a human may still
# approve it (its args expose no secret content, unlike a write) — staging it
# would both persist the secret before-bytes and mark the sidecar "secret",
# making the boundary author a blocking DIFF_UNREVIEWABLE for a merely-gated
# delete. Every failure mode (secret, classify error, staging error) falls
# through to the deny-gate rather than denying here, so grants and leases keep
# applying to a gated delete exactly as before this arm existed; the eventual
# resolution records its own ledger kind.
if [ "$CAPTURE_IGNORED" = "true" ] && [ "$CATEGORY" = "delete" ] && [ -n "$SALIENT" ] && { [ "$GIT_WORKSPACE" = "false" ] || __stigmer_is_gitignored "$SALIENT"; }; then
  DELETE_SECRET_RESULT=$(printf '%s' "$SALIENT" | ELECTRON_RUN_AS_NODE=1 "$NODE_BIN" -e '${secretClassifyScript}' 2>/dev/null || echo error)
  if [ "$DELETE_SECRET_RESULT" = "ok" ]; then
    OBS_DIR="$(dirname "$STATE_FILE")/${CAS_OBSERVATIONS_DIRNAME}"
    OBS_RESULT=$(printf '%s' "$SALIENT" | ELECTRON_RUN_AS_NODE=1 "$NODE_BIN" -e '${observationStagingScript}' "$GIT_ROOT" "$OBS_DIR" 2>/dev/null || echo error)
    if [ "$OBS_RESULT" = "captured" ]; then
      echo '{"permission":"allow"}'
      exit 0
    fi
  fi
fi

# --- 1c. Auto-approve all ---
if echo "$STATE" | grep -q '"autoApproveAll":true'; then
  echo '{"permission":"allow"}'
  exit 0
fi

# --- 2. MCP tools (beforeMCPExecution event) ---
# preToolUse does NOT enforce gating for MCP calls — beforeMCPExecution does — so
# MCP is gated here and ONLY here (never double-recorded). mcpDestructiveTools
# holds only the tools that ask, keyed "server/tool" from the payload's
# mcp_server_name, so presence means "deny" and an equal tool name on another
# server is never caught. MCP tool names are consistent across the hook and the
# stream, so the identity token is name-only: base64("$TOOL_NAME\\n").
if [ "$HOOK_EVENT" = "beforeMCPExecution" ]; then
  if [ -n "$MCP_SERVER" ] && [ -n "$TOOL_NAME" ]; then
    TOOL_POLICY=$(echo "$STATE" | grep -o "\\"$MCP_SERVER/$TOOL_NAME\\":{[^}]*}" | head -1 || true)
    if [ -n "$TOOL_POLICY" ]; then
      # Reinvocation grant: this tool was approved earlier → allow.
      if echo "$STATE" | grep -qF "\\"$MCP_TOKEN\\""; then
        echo '{"permission":"allow"}'
        exit 0
      fi
      MSG=$(echo "$TOOL_POLICY" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
      if [ -z "$MSG" ]; then
        MSG="Tool requires approval: $TOOL_NAME"
      fi
      if [ "$UNATTENDED_SKIP" = "true" ]; then
        # Unattended resolution: non-pausing kind, final for this
        # turn — the model adapts and the turn boundary stamps SKIPPED.
        record_denial "$MCP_TOKEN" "unattended"
        echo '{"permission":"deny","agent_message":"${UNATTENDED_SKIP_AGENT_MESSAGE}","user_message":"Skipped (approval not available on this surface): '"$TOOL_NAME"'"}'
        exit 0
      fi
      record_denial "$MCP_TOKEN" "approval"
      echo '{"permission":"deny","agent_message":"${APPROVAL_REQUIRED_AGENT_MESSAGE}","user_message":"'"$MSG"'"}'
      exit 0
    fi
  fi
  # Auto-approved or unlisted MCP tool → allow.
  echo '{"permission":"allow"}'
  exit 0
fi

# --- 3. Gated built-in tools (preToolUse event, category non-empty) ---
if [ -n "$CATEGORY" ]; then
  # Capture mode (GIT tree only): a git-tracked file mutation (write/edit/delete)
  # flows freely — the runner captures the whole change set with git at the turn
  # boundary and gates it per-file for review. A gitignored path is invisible to
  # that git snapshot: a non-secret gitignored WRITE or DELETE was already
  # handled above (staged + allowed, hard-blocked, or left to fall through) when
  # captureIgnored is on; here it only reaches the deny-gate when captureIgnored
  # is off (no artifact storage), or it is a secret-like DELETE (approvable, but
  # never staged — issue #303). shell (category "shell") never takes this branch
  # and stays gated as always. In a NON-GIT workspace this arm is skipped
  # entirely (there is no git diff): writes and deletes were CAS-staged above.
  if [ "$CAPTURE_MODE" = "true" ] && [ "$GIT_WORKSPACE" = "true" ] && { [ "$CATEGORY" = "write" ] || [ "$CATEGORY" = "delete" ]; }; then
    if ! __stigmer_is_gitignored "$SALIENT"; then
      echo '{"permission":"allow"}'
      exit 0
    fi
  fi
  # Deny-gate secret hard-block: a secret-like WRITE that reaches the
  # deny-gate (no capture substrate for it — capture off, or captureIgnored off in
  # a git-no-storage workspace) must not surface its content for approval. Classify
  # byte-identically to isSecretLikePath (no staging) and, on a match, hard-block
  # with the security message: the agent continues, nothing is written, and NO
  # content is recorded to the ledger. Placed before the grant/lease checks so a
  # write-category lease can never bypass it; only writes are content-bearing
  # (deletes stay gated). Fail-open on a classify error — the write falls to the
  # normal deny-gate and the runner-side backstop still withholds any secret
  # content before persist.
  if [ "$CATEGORY" = "write" ] && [ -n "$SALIENT" ]; then
    SECRET_RESULT=$(printf '%s' "$SALIENT" | ELECTRON_RUN_AS_NODE=1 "$NODE_BIN" -e '${secretClassifyScript}' 2>/dev/null || echo ok)
    if [ "$SECRET_RESULT" = "secret" ]; then
      # Kind "secret": attributable but non-pausing and content-free (only
      # the identity token is recorded, never the proposed content).
      record_denial "$PRIMARY_TOKEN" "secret"
      echo '{"permission":"deny","agent_message":"${SECRET_BLOCKED_AGENT_MESSAGE}","user_message":"Blocked for security: this file matches a secret-like path and was not written."}'
      exit 0
    fi
  fi
  # Reinvocation grant: allow when the CONTENT-exact token (a file edit approved
  # earlier with this exact content) OR the COARSE token (a shell/delete, or the
  # content-less degrade) is in approvedGrantTokens. A sibling edit to the same
  # file has a different content token and no coarse grant, so it re-gates.
  if { [ -n "$CONTENT_TOKEN" ] && echo "$STATE" | grep -qF "\\"$CONTENT_TOKEN\\""; } || echo "$STATE" | grep -qF "\\"$TOKEN\\""; then
    echo '{"permission":"allow"}'
    exit 0
  fi
  # Run-lifetime category lease: the user chose "approve all <category>" earlier
  # in this run (the scoped successor to autoApproveAll), so every built-in of
  # this category is allowed for the rest of the run. Matched within the extracted
  # leasedCategories array so a category word elsewhere in the state can't grant.
  LEASED_CATEGORIES=$(echo "$STATE" | grep -o '"leasedCategories":\\[[^]]*\\]' | head -1 || true)
  if [ -n "$LEASED_CATEGORIES" ] && echo "$LEASED_CATEGORIES" | grep -q "\\"$CATEGORY\\""; then
    echo '{"permission":"allow"}'
    exit 0
  fi
  # Record the PRIMARY token (content-exact when available, else coarse) so the
  # runner's denial correlation keys on the SAME identity it grants on approval.
  if [ "$UNATTENDED_SKIP" = "true" ]; then
    # Unattended resolution: non-pausing kind, final for this turn —
    # the model adapts and the turn boundary stamps SKIPPED.
    record_denial "$PRIMARY_TOKEN" "unattended"
    echo '{"permission":"deny","agent_message":"${UNATTENDED_SKIP_AGENT_MESSAGE}","user_message":"Skipped (approval not available on this surface): '"$TOOL_NAME"'"}'
    exit 0
  fi
  record_denial "$PRIMARY_TOKEN" "approval"
  echo '{"permission":"deny","agent_message":"${APPROVAL_REQUIRED_AGENT_MESSAGE}","user_message":"Tool requires approval: '"$TOOL_NAME"'"}'
  exit 0
fi

# --- 4. Everything else → allow ---
# Read-only built-ins and anything not explicitly gated. Fail-open mirrors the
# native harness (gate the dangerous set, allow the rest).
echo '{"permission":"allow"}'
exit 0
`;
}
