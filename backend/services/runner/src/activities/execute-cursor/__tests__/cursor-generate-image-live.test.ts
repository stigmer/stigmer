/**
 * Live ground-truth capture for Cursor's native `generateImage` tool (issue
 * #965) — the Phase-0 discipline from cursor_hitl_test.go applied to the
 * interaction-channel tool family.
 *
 * WHY THIS EXISTS. Production incident aex_01m1a6ww3nmp4952ar5v0g4g85: an
 * agent invoked `generateImage`, the call hung twice and settled
 * TOOL_CALL_INTERRUPTED, and the model told the user a write approval was
 * pending — an approval the platform never held (the run had
 * auto_approve_all ON, so nothing was ever denied). The block happened
 * inside the Cursor agent runtime, in a layer no Stigmer seam touches:
 * `generateImage` rides the SDK's interaction-query channel
 * (generateImageRequestQuery), not the ordinary tool path, and the SDK
 * exposes no public interaction-listener seam the runner could answer it
 * from. This test is the standing instrument that answers, against the REAL
 * SDK the runner ships:
 *
 *  1. Does `generateImage` complete AT ALL in the runner's headless local
 *     arrangement (Agent.create({ local }), project setting sources)?
 *  2. Does the `preToolUse` hook fire for it — i.e. CAN the Stigmer HITL
 *     gate see it — and under which `tool_name`?
 *  3. What exact error/result does the model see when it fails?
 *
 * The answers decide the #965 fix shape: hook visible + capability works →
 * classify + gate behind the standard write approval; otherwise → the
 * honest-unavailability posture (there is no seam to gate or deny it).
 *
 * Skipped without CURSOR_API_KEY (the cursor-sdk-auth-smoke.test.ts
 * convention) — it spends real credits for one short turn. Findings are
 * PRINTED, not asserted: like the Phase-0 capture, this documents upstream
 * behavior we do not own; the only hard assertion is that the run itself
 * reaches a terminal outcome (no infinite hang at the SDK boundary).
 *
 * Run with: CURSOR_API_KEY=<key> npx vitest run cursor-generate-image-live
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CURSOR_API_KEY = process.env.CURSOR_API_KEY ?? "";
const describeWithCursorKey = CURSOR_API_KEY ? describe : describe.skip;

/**
 * A minimal observation-only preToolUse/beforeMCPExecution hook: appends every
 * invocation's stdin JSON to a log file and ALLOWS everything. Proves whether
 * the hook layer sees `generateImage` at all (question 2) without gating the
 * run — the capability question (1) needs the tool to actually attempt.
 */
function installObservationHook(workspaceRoot: string, logPath: string): void {
  const hooksDir = join(workspaceRoot, ".cursor");
  mkdirSync(hooksDir, { recursive: true });
  const scriptPath = join(hooksDir, "observe-hook.sh");
  writeFileSync(
    scriptPath,
    `#!/bin/bash\nINPUT=$(cat)\nprintf '%s\\n' "$INPUT" >> "${logPath}" 2>/dev/null || true\necho '{"permission":"allow"}'\n`,
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
  writeFileSync(
    join(hooksDir, "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{ command: scriptPath }],
        beforeMCPExecution: [{ command: scriptPath }],
      },
    }),
    "utf-8",
  );
}

describeWithCursorKey("generateImage live ground truth (issue #965)", () => {
  it("captures whether generateImage completes headless and whether preToolUse sees it", async () => {
    const { Agent } = await import("@cursor/sdk");

    const workspaceRoot = mkdtempSync(join(tmpdir(), "stigmer-genimage-spike-"));
    const stateRoot = join(workspaceRoot, ".sdk-state");
    mkdirSync(stateRoot, { recursive: true });
    const hookLog = join(workspaceRoot, "hook-invocations.jsonl");
    installObservationHook(workspaceRoot, hookLog);

    // Mirror the runner's arrangement (session-lifecycle.ts createAgent):
    // local cwd + the "project" setting source that loads .cursor/hooks.json.
    // The model is pinned to the incident's (aex_01m1a6ww billed composer-2.5).
    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "composer-2.5" },
      local: { cwd: workspaceRoot, settingSources: ["project"] },
      platform: { workspaceRef: `genimage-spike-${Date.now()}`, stateRoot },
    });

    // The runner's exact consumption shape (index.ts / turn-stream.ts):
    // send() registers the run; run.stream() is the event source; run.wait()
    // is the terminal result.
    const run = await agent.send(
      "Use your generateImage tool to generate a simple image of a solid red " +
        "circle on a white background and save it to red-circle.png in the " +
        "workspace. Do not ask questions; invoke the tool directly. If the " +
        "tool fails, state the exact error text you received and stop.",
    );

    const events: Array<Record<string, unknown>> = [];
    for await (const event of run.stream()) {
      const e = event as unknown as Record<string, unknown>;
      if (e && typeof e === "object" && "type" in e) events.push(e);
    }
    const result = await run.wait();

    // ---- Findings dump (the deliverable of this instrument) ----
    console.log(`[genimage-spike] run status: ${result.status} (durationMs=${result.durationMs})`);

    for (const ev of events) {
      if (ev.type === "tool_call" || ev.type === "status") {
        console.log(`[genimage-spike] event: ${JSON.stringify(ev).slice(0, 800)}`);
      }
    }
    const finalAssistant = events.filter((e) => e.type === "assistant").at(-1);
    if (finalAssistant) {
      console.log(`[genimage-spike] final assistant: ${JSON.stringify(finalAssistant).slice(0, 800)}`);
    }

    const hookInvocations: Array<Record<string, unknown>> = [];
    if (existsSync(hookLog)) {
      for (const line of readFileSync(hookLog, "utf-8").split("\n")) {
        if (!line.trim()) continue;
        try { hookInvocations.push(JSON.parse(line)); } catch { /* partial line */ }
      }
    }
    console.log(
      `[genimage-spike] hook invocations: ${hookInvocations.length} — tool_names=` +
        JSON.stringify(hookInvocations.map((h) => `${h.hook_event_name}:${h.tool_name}`)),
    );
    const hookSawGenerateImage = hookInvocations.some(
      (h) => typeof h.tool_name === "string" && /generate.?image/i.test(h.tool_name),
    );
    console.log(`[genimage-spike] preToolUse saw generateImage: ${hookSawGenerateImage}`);

    const imageOnDisk = readdirSync(workspaceRoot).filter((f) => f.endsWith(".png"));
    console.log(`[genimage-spike] png files in workspace: ${JSON.stringify(imageOnDisk)}`);

    // The one hard assertion: the SDK boundary itself must not hang — a
    // terminal run outcome is required for the findings above to be trustable.
    expect(["finished", "error", "cancelled"]).toContain(result.status);
  }, 300_000);
});
