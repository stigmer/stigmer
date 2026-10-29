// Command-level contract for `stigmer up`'s result card: it says where the
// console is and whether agents can run.
//
//   - The console URL is printed whenever the server answers the console
//     probe, read once the server serves (stigmer#2649: the daemon's own
//     record of that probe lands too late for the card), and never for a
//     server with no bundled console or under `--no-web`.
//   - The agents line names the providers the started runner reaches, the
//     answer the launcher computed over the runner's environment, or says
//     to run `stigmer setup` when it reaches none (stigmer#1084).
//   - A foreground stack that does not start ends with why: the failure the
//     daemon recorded under this process's PID, or, with none, the pointer
//     to the logs (stigmer#1845).
//
// The daemon launcher and the console probe are replaced (nothing boots, no
// port is dialled); everything after them is real: the result card and the
// JSON and human renderers. The human card is frozen as goldens beside this
// file, colour off.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { expectGolden } from "../../__test-utils__/golden.js";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { SERVER_PORT } from "../../local/constants.js";
import type { UpReport } from "../../local/daemon/launch.js";
import { buildProgram } from "../../program.js";

const launched = vi.hoisted(() => ({
  runs: [] as unknown[],
  report: { runnerReach: [] } as UpReport,
  consoleServed: false,
  probes: 0,
  foregroundCode: 0,
  failure: null as Error | null,
  failureAskedFor: [] as number[],
}));

vi.mock("../../local/daemon/launch.js", () => ({
  up: async (run: unknown): Promise<UpReport> => {
    launched.runs.push(run);
    return launched.report;
  },
  // The foreground shape renders the card when the stack serves, then
  // stays up; the stub serves at once and returns as a clean shutdown.
  upForeground: async (
    run: unknown,
    _home: string,
    hooks: { readonly onReady: (report: UpReport) => Promise<void> },
  ): Promise<number> => {
    launched.runs.push(run);
    if (launched.foregroundCode !== 0) return launched.foregroundCode;
    await hooks.onReady(launched.report);
    return 0;
  },
  startupFailure: (_data: string, daemonPid: number): Error | null => {
    launched.failureAskedFor.push(daemonPid);
    return launched.failure;
  },
}));

vi.mock("../../local/webconsole/index.js", () => ({
  isWebConsoleAvailable: async (): Promise<boolean> => {
    launched.probes += 1;
    return launched.consoleServed;
  },
}));

interface UpCard {
  readonly status: string;
  readonly message: string;
  readonly hints?: readonly string[];
  readonly sections?: ReadonlyArray<{ title?: string; fields?: ReadonlyArray<{ key: string; value: string }> }>;
}

let noColor: string | undefined;
beforeAll(() => {
  noColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});
afterAll(() => {
  if (noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColor;
});

beforeEach(() => {
  launched.runs.length = 0;
  launched.report = { runnerReach: [] };
  launched.consoleServed = false;
  launched.probes = 0;
  launched.foregroundCode = 0;
  launched.failure = null;
  launched.failureAskedFor.length = 0;
});

/** Run `stigmer up …` and return what it wrote to stdout and stderr. */
async function runUp(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const program = buildProgram();
  program.exitOverride();
  let stdout = "";
  let stderr = "";
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    await program.parseAsync(["node", "stigmer", "up", ...args]);
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { stdout, stderr };
}

async function upCard(...args: string[]): Promise<UpCard> {
  return JSON.parse((await runUp(...args, "--json")).stdout) as UpCard;
}

function fields(card: UpCard, title: string): Record<string, string> {
  const section = card.sections?.find((s) => s.title === title);
  return Object.fromEntries((section?.fields ?? []).map((f) => [f.key, f.value]));
}

describe("stigmer up — the endpoints card", () => {
  it("reports the console on the server's own origin when the server serves one", async () => {
    launched.consoleServed = true;

    const card = await upCard();

    expect(launched.runs).toEqual([{ serverOnly: false, noWeb: false, foreground: false }]);
    expect(card.message).toBe("Stigmer local stack is up");
    expect(fields(card, "Endpoints")).toEqual({
      server: `http://localhost:${SERVER_PORT}`,
      console: `http://localhost:${SERVER_PORT}`,
    });
  });

  it("omits the console when the server has none bundled", async () => {
    const card = await upCard("server");

    expect(card.message).toBe("Stigmer control plane is up");
    expect(fields(card, "Endpoints")).toEqual({ server: `http://localhost:${SERVER_PORT}` });
  });

  it("neither probes nor reports the console under --no-web", async () => {
    launched.consoleServed = true;

    const card = await upCard("--no-web");

    expect(launched.probes).toBe(0);
    expect(fields(card, "Endpoints")).toEqual({ server: `http://localhost:${SERVER_PORT}` });
  });
});

describe("stigmer up — the agents line", () => {
  it("names each provider the runner reaches and how", async () => {
    launched.report = {
      runnerReach: [
        { provider: "anthropic", via: "vertex" },
        { provider: "openai", via: "key" },
      ],
    };

    expect(fields(await upCard(), "Agents")).toEqual({ ready: "anthropic (vertex), openai (key)" });
  });

  it("sends a person with no provider to stigmer setup and a restart", async () => {
    const card = await upCard();

    expect(fields(card, "Agents")).toEqual({ "not ready": "no model provider" });
    expect(card.hints).toContain(
      "Add a model provider: stigmer setup, then stigmer down && stigmer up",
    );
  });

  it("renders the same card in the foreground once the stack serves", async () => {
    launched.consoleServed = true;
    launched.report = { runnerReach: [{ provider: "anthropic", via: "key" }] };
    const card = await upCard("--foreground");
    expect(fields(card, "Endpoints").console).toBe("http://localhost:7234");
    expect(Object.keys(fields(card, "Agents"))).toEqual(["ready"]);
  });

  it("says there is no runner when only the control plane started", async () => {
    launched.report = { runnerReach: undefined };

    expect(fields(await upCard("--server-only"), "Agents")).toEqual({ "not ready": "no local runner (control plane only)" });
  });
});

describe("CLI-14 stigmer up says where the console is and whether agents can run", () => {
  it("prints the console and the providers agents run on", async () => {
    launched.consoleServed = true;
    launched.report = {
      runnerReach: [
        { provider: "anthropic", via: "key" },
        { provider: "openai", via: "key" },
      ],
    };

    await expectGolden((await runUp()).stderr, "up-ready");
  });

  it("prints the console and sends a person with no model provider to stigmer setup", async () => {
    launched.consoleServed = true;

    await expectGolden((await runUp()).stderr, "up-no-provider");
  });

  it("prints no console for a server with none bundled, and the providers agents run on", async () => {
    launched.report = { runnerReach: [{ provider: "anthropic", via: "gateway" }] };

    await expectGolden((await runUp()).stderr, "up-no-console");
  });

  it("prints the control plane alone, with no runner", async () => {
    launched.consoleServed = true;
    launched.report = { runnerReach: undefined };

    await expectGolden((await runUp("--server-only")).stderr, "up-server-only");
  });
});

describe("stigmer up --foreground — a stack that does not start", () => {
  it("ends with the failure the daemon recorded under this process", async () => {
    launched.foregroundCode = 1;
    launched.failure = new CliExitError("stigmer-server did not start: the server exited with code 1 before it was ready", 1, [
      "  boot failed: bad setting",
    ]);

    await expect(runUp("--foreground")).rejects.toBe(launched.failure);
    expect(launched.failureAskedFor).toEqual([process.pid]);
  });

  it("points at the logs when nothing was recorded", async () => {
    launched.foregroundCode = 1;

    await expect(runUp("--foreground")).rejects.toThrow("the local stack did not start");
  });
});
