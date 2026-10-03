// Command-level contract for `stigmer up`'s result card: the console URL is
// printed only when the daemon's own probe recorded the web console as
// running, so a dev-tree server with no bundled console never advertises a
// dead URL.
//
// The daemon launcher is replaced (nothing boots); everything after it is
// real: the result card, the health-state read under the data dir, and the
// JSON renderer. HOME is redirected to a temp directory so the health-state
// file this suite writes is the one `up` reads.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataDir } from "../../config/paths.js";
import { HEALTH_STATE_FILE, SERVER_PORT } from "../../local/constants.js";
import { type HealthState, writeHealthState } from "../../local/state/health-state.js";
import { buildProgram } from "../../program.js";

const launched = vi.hoisted(() => ({ runs: [] as unknown[] }));

vi.mock("../../local/daemon/launch.js", () => ({
  up: async (run: unknown) => {
    launched.runs.push(run);
  },
}));

interface UpCard {
  readonly status: string;
  readonly message: string;
  readonly sections?: ReadonlyArray<{ title?: string; fields?: ReadonlyArray<{ key: string; value: string }> }>;
}

let home: string;
let savedHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "stigmer-up-"));
  savedHome = process.env.HOME;
  process.env.HOME = home;
  launched.runs.length = 0;
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

function recordConsole(state: "running" | "failed"): void {
  const dir = dataDir(home);
  mkdirSync(dir, { recursive: true });
  const health: HealthState = {
    daemon_pid: 1,
    started_at: "2026-10-03T00:00:00Z",
    components: {
      "web-console": { pid: 1, state, started_at: "2026-10-03T00:00:00Z", restart_count: 0 },
    },
  };
  writeHealthState(join(dir, HEALTH_STATE_FILE), health);
}

async function runUp(...args: string[]): Promise<UpCard> {
  const program = buildProgram();
  program.exitOverride();
  let stdout = "";
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await program.parseAsync(["node", "stigmer", "up", ...args, "--json"]);
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return JSON.parse(stdout) as UpCard;
}

function endpoints(card: UpCard): Record<string, string> {
  const section = card.sections?.find((s) => s.title === "Endpoints");
  return Object.fromEntries((section?.fields ?? []).map((f) => [f.key, f.value]));
}

describe("stigmer up — the endpoints card", () => {
  it("reports the console on the server's own origin when the daemon recorded it running", async () => {
    recordConsole("running");

    const card = await runUp();

    expect(launched.runs).toEqual([{ serverOnly: false, noWeb: false, foreground: false }]);
    expect(card.message).toBe("Stigmer local stack is up");
    expect(endpoints(card)).toEqual({
      server: `http://localhost:${SERVER_PORT}`,
      console: `http://localhost:${SERVER_PORT}`,
    });
  });

  it("omits the console when the daemon's probe found none running", async () => {
    recordConsole("failed");

    const card = await runUp("server");

    expect(card.message).toBe("Stigmer control plane is up");
    expect(endpoints(card)).toEqual({ server: `http://localhost:${SERVER_PORT}` });
  });

  it("omits the console when no health state was written at all", async () => {
    const card = await runUp();

    expect(endpoints(card)).toEqual({ server: `http://localhost:${SERVER_PORT}` });
  });
});
