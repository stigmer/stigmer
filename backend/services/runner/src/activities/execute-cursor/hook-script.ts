/**
 * Template for the preToolUse hook script that Cursor spawns.
 *
 * This module doesn't execute as a hook itself — it generates the shell
 * script that is written to .cursor/hooks/stigmer-approval.sh. That script
 * is invoked by Cursor for every tool call via the preToolUse hook.
 *
 * The hook script:
 * 1. Reads the tool call JSON from stdin
 * 2. Reads the approval state JSON file written by the cursor-runner
 * 3. Evaluates the policy: auto-approve, approved grants (reinvocation),
 *    gated built-in tools, MCP require-approval policies
 * 4. On a deny, appends the call's identity token to the denial ledger
 *    (stigmer-denials.jsonl) so the runner can mark the gated tool call as
 *    WAITING_APPROVAL — the hook is the only place the deny decision is made,
 *    so its ledger is the authoritative record of what was gated this turn
 * 5. Returns { "permission": "allow" } or { "permission": "deny" } on stdout
 *
 * The script is self-contained (no Node.js required) for portability. It uses
 * bash + grep/cut for lightweight JSON field extraction. All policy decisions
 * are pre-computed by the runner into the state file (and into this generated
 * script); the hook only performs mechanical field extraction and string
 * lookups — the policy itself is authored once in TypeScript (approval-policy.ts
 * / approval-state.ts).
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
 * Policy evaluation order (first match wins). The model is "gate the dangerous
 * set, allow the rest" — matching the native harness and avoiding denial of
 * auto-approved MCP tools (which are absent from mcpToolPolicies):
 * 1. autoApproveAll → allow
 * 2. Gated built-in (category non-empty):
 *    a. identity token in approvedGrantTokens → allow (reinvocation grant)
 *    b. otherwise → record denial, deny
 * 3. MCP tool present in mcpToolPolicies (require-approval):
 *    a. name token in approvedGrantTokens → allow
 *    b. otherwise → record denial, deny
 * 4. Everything else (read-only built-ins, auto-approved MCP, unknown) → allow
 */

import { SALIENT_ARG_FIELDS, getBuiltInGatedCategories } from "./approval-policy.js";

const APPROVAL_REQUIRED_AGENT_MESSAGE =
  "STIGMER_APPROVAL_REQUIRED: This tool call requires user approval before " +
  "execution. Do not attempt alternative approaches or workarounds (including " +
  "shell commands). Stop and wait — the execution will resume after the user " +
  "reviews and approves this tool call.";

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
    arms.push(`    ${pattern}) CATEGORY="${category}" ;;`);
  }
  return arms.join("\n");
}

/**
 * Generates the bash hook script content.
 *
 * The script reads a JSON state file written by the cursor-runner before
 * each agent.send() call. The state file is the single source of truth
 * for the dynamic approval inputs (autoApproveAll, mcpToolPolicies,
 * approvedGrantTokens). The static policy (which built-ins are gated and their
 * categories, and which arg fields are salient) is baked into the script at
 * generation time from approval-policy.ts.
 *
 * The identity token encoding (`base64(key \n salient)`) must stay byte-identical
 * to grantToken() in approval-state.ts.
 */
export function generateHookScript(stateFilePath: string, ledgerFilePath: string): string {
  const salientFields = SALIENT_ARG_FIELDS.join(" ");
  const categoryCaseArms = buildCategoryCaseArms();
  return `#!/bin/bash
# Stigmer HITL approval hook for Cursor preToolUse
# Generated by cursor-runner — do not edit manually.
#
# Reads tool call from stdin (JSON), checks approval state file, returns a
# permission decision on stdout (JSON). On a deny, appends the call's canonical
# identity token to the denial ledger so the runner can mark the gated tool call
# as WAITING_APPROVAL. See hook-script.ts for the cross-taxonomy identity design.

set -euo pipefail

INPUT=$(cat)

# Extract tool_name from the hook input JSON. The hook receives PascalCase names
# (Write/Shell/Delete/Read/...). Every extraction ends with '|| true': under
# 'set -e' a non-matching grep would otherwise abort the script and emit no
# decision.
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

STATE_FILE="${stateFilePath}"
LEDGER_FILE="${ledgerFilePath}"

# --- Failsafe: missing state file → deny (fail-closed) ---
if [ ! -f "$STATE_FILE" ]; then
  echo '{"permission":"deny","agent_message":"${APPROVAL_REQUIRED_AGENT_MESSAGE}","user_message":"Tool requires approval: '"$TOOL_NAME"'"}'
  exit 0
fi

STATE=$(cat "$STATE_FILE")

# --- 1. Auto-approve all ---
if echo "$STATE" | grep -q '"autoApproveAll":true'; then
  echo '{"permission":"allow"}'
  exit 0
fi

# --- Salient resource value (file path / command), spanning both taxonomies'
# arg field names (file_path here, path on the stream side). First match wins. ---
SALIENT=""
for field in ${salientFields}; do
  v=$(echo "$INPUT" | grep -o "\\"$field\\":\\"[^\\"]*\\"" | head -1 | cut -d'"' -f4 || true)
  if [ -n "$v" ]; then SALIENT="$v"; break; fi
done

# --- Canonical approval category for this hook tool_name (baked from
# approval-policy.ts). Empty for non-gated tools. ---
CATEGORY=""
case "$TOOL_NAME" in
${categoryCaseArms}
    *) CATEGORY="" ;;
esac

# Append a denial record to the ledger. Best-effort: a ledger write failure must
# never abort the decision (the deny still goes out on stdout). toolName is raw
# for human-readable debugging; token drives correlation in the runner.
record_denial() {
  echo '{"toolName":"'"$TOOL_NAME"'","token":"'"$1"'"}' >> "$LEDGER_FILE" 2>/dev/null || true
}

# --- 2. Gated built-in tools (category non-empty) ---
if [ -n "$CATEGORY" ]; then
  # Canonical identity token: base64("$CATEGORY\\n$SALIENT").
  TOKEN=$(printf '%s\\n%s' "$CATEGORY" "$SALIENT" | base64 | tr -d '\\n')
  # Reinvocation grant: this exact resource was approved earlier → allow.
  if echo "$STATE" | grep -qF "\\"$TOKEN\\""; then
    echo '{"permission":"allow"}'
    exit 0
  fi
  record_denial "$TOKEN"
  echo '{"permission":"deny","agent_message":"${APPROVAL_REQUIRED_AGENT_MESSAGE}","user_message":"Tool requires approval: '"$TOOL_NAME"'"}'
  exit 0
fi

# --- 3. MCP tools that require approval → deny ---
# mcpToolPolicies holds only require-approval tools (auto-approved MCP tools are
# absent), so presence means "deny" unless an entry is explicitly false. MCP tool
# names are consistent across the hook and the stream, so the identity token is
# name-only: base64("$TOOL_NAME\\n").
if echo "$STATE" | grep -q "\\"mcpToolPolicies\\"" && [ -n "$TOOL_NAME" ]; then
  TOOL_POLICY=$(echo "$STATE" | grep -o "\\"$TOOL_NAME\\":{[^}]*}" | head -1 || true)
  if [ -n "$TOOL_POLICY" ] && ! echo "$TOOL_POLICY" | grep -q '"requiresApproval":false'; then
    MCP_TOKEN=$(printf '%s\\n' "$TOOL_NAME" | base64 | tr -d '\\n')
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

# --- 4. Everything else → allow ---
# Read-only built-ins, auto-approved MCP tools, and anything not explicitly
# gated. Fail-open mirrors the native harness (gate the dangerous set, allow the
# rest) and prevents denying auto-approved MCP tools the state cannot enumerate.
echo '{"permission":"allow"}'
exit 0
`;
}
