/**
 * Template for the approval hook script that Cursor spawns.
 *
 * This module doesn't execute as a hook itself — it generates the shell script
 * written to the HITL dir as stigmer-approval.sh. Cursor invokes that ONE script
 * for TWO events (registered in .cursor/hooks.json by workspace-setup.ts):
 *   - `preToolUse`         — fires for built-in tools (Write/Shell/Delete/…).
 *   - `beforeMCPExecution` — the only event Cursor enforces for MCP tool calls;
 *                            `preToolUse` does NOT gate MCP (confirmed by a live
 *                            payload capture). MCP is therefore gated in exactly
 *                            ONE place, so a denial is never double-recorded.
 * The script branches on the payload's `hook_event_name`: MCP tools are gated on
 * the beforeMCPExecution invocation, built-ins on the preToolUse invocation.
 *
 * The hook script:
 * 1. Reads the tool call JSON from stdin
 * 2. Reads the approval state JSON file written by the cursor-runner
 * 3. Evaluates the policy: auto-approve, approved grants (reinvocation), then —
 *    by event — gated built-in tools (preToolUse) or MCP require-approval
 *    policies (beforeMCPExecution)
 * 4. On a deny, appends the call's identity token to the denial ledger
 *    (stigmer-denials.jsonl) so the runner can mark the gated tool call as
 *    WAITING_APPROVAL — the hook is the only place the deny decision is made,
 *    so its ledger is the authoritative record of what was gated this turn
 * 5. Returns { "permission": "allow" } or { "permission": "deny" } on stdout
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
 * Policy evaluation order (first match wins). The model is "gate the dangerous
 * set, allow the rest" — matching the native harness and avoiding denial of
 * auto-approved MCP tools (which are absent from mcpToolPolicies):
 * 0. Scope guard: not the runner's own agent → allow (never touch the ledger)
 * 1. Missing state file → deny (fail-closed); autoApproveAll (the pre-armed
 *    spec.auto_approve_all global bypass) → allow
 * 2. beforeMCPExecution event → MCP tool present in mcpToolPolicies
 *    (require-approval):
 *    a. name token in approvedGrantTokens → allow (reinvocation grant)
 *    b. otherwise → record denial, deny
 *    (auto-approved / unlisted MCP tools fall through → allow; a server-scoped
 *     lease drops the server's tools from mcpToolPolicies, so they fall through)
 * 3. preToolUse event → gated built-in (category non-empty):
 *    a. identity token in approvedGrantTokens → allow (reinvocation grant)
 *    b. category in leasedCategories → allow (run-lifetime scoped lease)
 *    c. otherwise → record denial, deny
 *    (read-only / ungated built-ins fall through → allow)
 */

import { SALIENT_ARG_FIELDS, getBuiltInGatedCategories } from "./approval-policy.js";
import {
  EDIT_OLD_FIELDS,
  EDIT_NEW_FIELDS,
  WRITE_CONTENT_FIELDS,
} from "../../shared/file-tools.js";

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
 * Build the inline Node.js identity extractor embedded in the hook script.
 *
 * Parses the hook's stdin JSON properly (the bash fallback's grep truncates
 * string values at the first escaped quote) and emits SEVEN lines: tool_name,
 * canonical category, coarse identity token, MCP name-token, hook_event_name
 * (the event discriminator: `preToolUse` for built-ins, `beforeMCPExecution`
 * for MCP), base64(JSON(tool_input)) — the authoritative pre-execution args the
 * runner overlays onto the gated tool call for the approval preview — and the
 * CONTENT token (base64(category \n salient \n contentDigest), empty when the
 * tool has no edit content). The token encodings must stay byte-identical to
 * grantToken()/contentToken() in approval-state.ts.
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
    // Line 6 is base64(JSON(tool_input)): the AUTHORITATIVE pre-execution args
    // the runner overlays onto the gated tool call so the approval card can show
    // the proposed change before the user approves. Base64 keeps the bash side
    // free of quoting/escaping concerns even for large multi-line file content.
    // Line 7 is the CONTENT token (empty when no digest) — the exact-identity
    // grant the runner authorizes for a file edit. Line 8 is base64(salient) —
    // the raw resource value (file path / command) capture mode needs to run
    // `git check-ignore` on a file path; base64 keeps newlines/quotes out of the
    // line-oriented bash parse.
    `process.stdout.write(name+"\\n"+cat+"\\n"+b(cat+"\\n"+s)+"\\n"+b(name+"\\n")+"\\n"+ev+"\\n"+b(JSON.stringify(a))+"\\n"+(dig?b(cat+"\\n"+s+"\\n"+dig):"")+"\\n"+b(s));`,
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
 * mcpToolPolicies, approvedGrantTokens), denial ledger, and runner PID. The
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
  const nodeBin = process.execPath;
  return `#!/bin/bash
# Stigmer HITL approval hook for Cursor (preToolUse + beforeMCPExecution).
# Generated by cursor-runner — do not edit manually.
#
# Reads a tool call from stdin (JSON), checks the approval state file, returns a
# permission decision on stdout (JSON). Branches on hook_event_name: MCP tools
# are gated on beforeMCPExecution, built-ins on preToolUse (preToolUse does not
# enforce MCP). On a deny, appends the call's canonical identity token to the
# denial ledger so the runner can mark the gated tool call as WAITING_APPROVAL.
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
IDENTITY=$(printf '%s' "$INPUT" | ELECTRON_RUN_AS_NODE=1 "$NODE_BIN" -e '${nodeIdentityScript}' 2>/dev/null || true)
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
else
  # Fallback when the Node binary cannot run: grep/cut extraction. Best-effort
  # only — '"field":"[^"]*"' truncates at the first JSON-escaped quote, so the
  # token may not match the runner's for values containing escapes. Gating still
  # holds (deny goes out); only denial correlation and grant precision degrade.
  # Every extraction ends with '|| true': under 'set -e' a non-matching grep
  # would otherwise abort the script and emit no decision.
  TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  HOOK_EVENT=$(echo "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
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
fi

# --- Failsafe: missing state file → deny (fail-closed) ---
if [ ! -f "$STATE_FILE" ]; then
  echo '{"permission":"deny","agent_message":"${APPROVAL_REQUIRED_AGENT_MESSAGE}","user_message":"Tool requires approval: '"$TOOL_NAME"'"}'
  exit 0
fi

STATE=$(cat "$STATE_FILE")

# Capture mode (git workspaces): file mutations flow during the turn and are
# captured/gated per-file by the runner at the turn boundary (see
# shadow-capture.ts). Read once; consulted only in the gated-built-in arm below.
CAPTURE_MODE=false
if echo "$STATE" | grep -q '"captureMode":true'; then
  CAPTURE_MODE=true
fi

# --- 1. Auto-approve all ---
if echo "$STATE" | grep -q '"autoApproveAll":true'; then
  echo '{"permission":"allow"}'
  exit 0
fi

# Append a denial record to the ledger. Best-effort: a ledger write failure must
# never abort the decision (the deny still goes out on stdout). toolName is raw
# for human-readable debugging; token drives correlation in the runner; input is
# base64(JSON(tool_input)) — the authoritative pre-execution args the runner
# overlays for the approval preview (empty on the grep fallback path). Written
# with printf (a builtin, so no ARG_MAX limit) because the input can be a large
# multi-MB file body.
record_denial() {
  printf '{"toolName":"%s","token":"%s","input":"%s"}\\n' "$TOOL_NAME" "$1" "$INPUT_B64" >> "$LEDGER_FILE" 2>/dev/null || true
}

# --- 2. MCP tools (beforeMCPExecution event) ---
# preToolUse does NOT enforce gating for MCP calls — beforeMCPExecution does — so
# MCP is gated here and ONLY here (never double-recorded). mcpToolPolicies holds
# only require-approval tools (auto-approved MCP tools are absent), so presence
# means "deny" unless an entry is explicitly false. MCP tool names are consistent
# across the hook and the stream, so the identity token is name-only:
# base64("$TOOL_NAME\\n").
if [ "$HOOK_EVENT" = "beforeMCPExecution" ]; then
  if echo "$STATE" | grep -q "\\"mcpToolPolicies\\"" && [ -n "$TOOL_NAME" ]; then
    TOOL_POLICY=$(echo "$STATE" | grep -o "\\"$TOOL_NAME\\":{[^}]*}" | head -1 || true)
    if [ -n "$TOOL_POLICY" ] && ! echo "$TOOL_POLICY" | grep -q '"requiresApproval":false'; then
      # Reinvocation grant: this tool was approved earlier → allow.
      if echo "$STATE" | grep -qF "\\"$MCP_TOKEN\\""; then
        echo '{"permission":"allow"}'
        exit 0
      fi
      MSG=$(echo "$TOOL_POLICY" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
      if [ -z "$MSG" ]; then
        MSG="Tool requires approval: $TOOL_NAME"
      fi
      record_denial "$MCP_TOKEN"
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
  # Capture mode: a file mutation (write/edit/delete) flows freely — the runner
  # captures the whole change set with git at the turn boundary and gates it
  # per-file for review. The ONE exception is a gitignored path, which the git
  # snapshot cannot capture or revert, so it stays on the deny-gate below. shell
  # (category "shell") never takes this branch and stays gated as always.
  if [ "$CAPTURE_MODE" = "true" ] && { [ "$CATEGORY" = "write" ] || [ "$CATEGORY" = "delete" ]; }; then
    if ! __stigmer_is_gitignored "$SALIENT"; then
      echo '{"permission":"allow"}'
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
  if [ -n "$CONTENT_TOKEN" ]; then
    record_denial "$CONTENT_TOKEN"
  else
    record_denial "$TOKEN"
  fi
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
