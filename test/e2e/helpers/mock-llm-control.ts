import * as fs from "node:fs";
import * as path from "node:path";
import { anthropicText } from "../fixtures/mock-llm";
import type { AnthropicMessageBody } from "../fixtures/mock-llm";

// The e2e state file global-setup writes; carries the mock LLM control URL when
// the stack was booted with STIGMER_E2E_MOCK_LLM.
const STATE_FILE = path.join(__dirname, "..", ".e2e-server-state.json");

/**
 * Reads the deterministic mock LLM proxy's control URL from the e2e state file.
 * Returns `null` when the stack was not booted in mock mode — specs use this to
 * `test.skip` gracefully rather than hang against a real/absent model.
 */
export function getMockControlUrl(): string | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as {
      mockLlmControlUrl?: string;
    };
    return state.mockLlmControlUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * HTTP client for the mock LLM proxy's control API. A Playwright worker runs in
 * a separate process from the proxy (which lives in globalSetup), so it programs
 * the shared FIFO queue over HTTP rather than by direct method calls.
 */
export class MockControl {
  constructor(private readonly baseUrl: string) {}

  /**
   * Append one canned assistant turn to the proxy's queue. `delayMs` holds
   * the turn back before it streams — simulated model latency for tests
   * that assert mid-execution states (sidebar phase, disabled composer).
   */
  async enqueue(body: AnthropicMessageBody, delayMs = 0): Promise<void> {
    const res = await fetch(`${this.baseUrl}/__mock/enqueue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(delayMs > 0 ? { body, delayMs } : body),
    });
    if (!res.ok) {
      throw new Error(`mock enqueue failed: ${res.status} ${await res.text()}`);
    }
  }

  /** Drop any unconsumed turns. Call between tests so leftovers can't leak. */
  async reset(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/__mock/reset`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`mock reset failed: ${res.status} ${await res.text()}`);
    }
  }

  /** Turns still waiting to be served (0 after a run consumed its full script). */
  async remaining(): Promise<number> {
    const res = await fetch(`${this.baseUrl}/__mock/remaining`);
    const body = (await res.json()) as { remaining: number };
    return body.remaining;
  }
}

/**
 * Programs the proxy with a fresh script of plain-text assistant turns — one
 * per LLM call the caller is about to trigger. Resets the FIFO first so a
 * prior test's unconsumed turns can't leak into this script; the flip side of
 * that contract is that every test must DRAIN its script (wait for its
 * executions to complete) before ending, or the next test's reset races the
 * still-running execution (stigmer/stigmer#743).
 *
 * No-op returning false when the stack wasn't booted in mock mode — callers
 * running against a real provider key just let the live model answer.
 */
export async function enqueueCannedTextTurns(
  texts: readonly string[],
  opts?: { readonly delayMs?: number },
): Promise<boolean> {
  const url = getMockControlUrl();
  if (!url) return false;
  const control = new MockControl(url);
  await control.reset();
  for (const text of texts) {
    await control.enqueue(anthropicText(text), opts?.delayMs ?? 0);
  }
  return true;
}
