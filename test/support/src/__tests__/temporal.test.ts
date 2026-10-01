// Unit arms for how the Temporal harness survives a port another listener
// took (stigmer#1469): the death is recognised from what the pinned CLI
// really prints, both its pre-check's exit and the frontend's panic; any other
// death is not mistaken for one and keeps its first panic line; only this
// child's own banner proves its frontend; and the attempt loop retries a lost
// port on a fresh one, loudly, a bounded number of times, while anything an
// attempt throws ends it at once.
// Pure: captured CLI output and scripted attempts. No Temporal is started, so
// the file carries no service word (test/README.md, "Names").
// Domain: test support (stack spawns).
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bannerNamesPort,
  bootTemporal,
  classifyTemporalExit,
  type RunningTemporal,
  type TemporalBootAttempt,
} from "../temporal.ts";

// The CLI version the captured output came from; temporal-cli-<version>/ is
// the folder it lives in.
const CAPTURED_WITH = "1.5.1";
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const CAPTURED = `${FIXTURES}temporal-cli-${CAPTURED_WITH}/`;
const captured = (name: string): string => readFileSync(`${CAPTURED}${name}`, "utf8");

// The pin `make install-temporal-cli` and both execution lanes install.
const PIN_SOURCE = fileURLToPath(new URL("../../../../client-apps/cli/src/local/temporal/download.ts", import.meta.url));

describe("the captured output matches the pinned CLI", () => {
  it("was captured from the version the gate installs", () => {
    const pinned = /DEFAULT_TEMPORAL_VERSION = "([^"]+)"/.exec(readFileSync(PIN_SOURCE, "utf8"))?.[1];
    expect(
      pinned,
      "the Temporal CLI pin moved: capture the fixtures again with the new CLI (hold a port and start " +
        "`start-dev --port <it>`; boot it once cleanly) into fixtures/temporal-cli-<version>/, then update CAPTURED_WITH",
    ).toBe(CAPTURED_WITH);
    expect(readdirSync(FIXTURES)).toContain(`temporal-cli-${CAPTURED_WITH}`);
    expect(captured("clean-boot.txt").startsWith(`CLI ${CAPTURED_WITH} `)).toBe(true);
  });
});

describe("classifyTemporalExit", () => {
  it("recognises the CLI's pre-check refusing a taken frontend port", () => {
    expect(classifyTemporalExit(captured("frontend-port-taken.txt"))).toEqual({
      kind: "port-collision",
      line: expect.stringContaining("can't set frontend port 53518: listen tcp 127.0.0.1:53518: bind: address already in use"),
    });
  });

  it("recognises the CLI's pre-check refusing a taken HTTP port", () => {
    expect(classifyTemporalExit(captured("http-port-taken.txt")).kind).toBe("port-collision");
  });

  it("recognises the frontend's panic over a port it binds after the pre-check", () => {
    // The message shape of temporal v1.29.1 service/frontend/http_api_server.go:91-92
    // ("failed listening for HTTP API on %v: %w" over Go's net error), as the
    // dev server's panic prints it ahead of its stack: the death the issue's
    // CI run lost the first line of.
    const panic = [
      "panic: failed listening for HTTP API on 127.0.0.1:41287: listen tcp 127.0.0.1:41287: bind: address already in use",
      "",
      "goroutine 1 [running]:",
      "go.temporal.io/server/service/frontend.HTTPAPIServerProvider(...)",
    ].join("\n");
    expect(classifyTemporalExit(panic)).toEqual({
      kind: "port-collision",
      line: "panic: failed listening for HTTP API on 127.0.0.1:41287: listen tcp 127.0.0.1:41287: bind: address already in use",
    });
  });

  it("does not mistake another death for a lost port, and keeps its first panic line", () => {
    const crash = ["panic: runtime error: invalid memory address or nil pointer dereference", "goroutine 7 [running]:"].join("\n");
    expect(classifyTemporalExit(crash)).toEqual({
      kind: "other",
      panicLine: "panic: runtime error: invalid memory address or nil pointer dereference",
    });
    expect(classifyTemporalExit('{"level":"ERROR","msg":"namespace registration failed"}')).toEqual({
      kind: "other",
      panicLine: undefined,
    });
  });
});

describe("bannerNamesPort", () => {
  it("proves the frontend only on the port this child was given", () => {
    const banner = captured("clean-boot.txt");
    expect(bannerNamesPort(banner, 54124)).toBe(true);
    // The metrics line names another port, and a sibling's port is not ours.
    expect(bannerNamesPort(banner, 54126)).toBe(false);
    expect(bannerNamesPort(banner, 7233)).toBe(false);
    expect(bannerNamesPort("", 54124)).toBe(false);
  });
});

describe("bootTemporal", () => {
  const ready = (hostPort: string): TemporalBootAttempt => ({
    kind: "ready",
    temporal: { hostPort, namespace: "default", logTail: () => "", stop: async () => {} } satisfies RunningTemporal,
  });
  const lost = (port: number): TemporalBootAttempt => ({
    kind: "port-lost",
    reason: `listen tcp 127.0.0.1:${port}: bind: address already in use`,
  });

  // Hands out the given ports in order and records which attempt got which.
  function script(ports: number[], outcomes: Array<(port: number) => TemporalBootAttempt>) {
    const tried: number[] = [];
    const warnings: string[] = [];
    return {
      tried,
      warnings,
      opts: {
        nextPort: async () => ports[tried.length] ?? 0,
        attempt: async (port: number) => {
          const outcome = outcomes[tried.length];
          tried.push(port);
          if (outcome === undefined) throw new Error("an attempt the script did not expect");
          return outcome(port);
        },
        maxAttempts: 3,
        warn: (line: string) => warnings.push(line),
      },
    };
  }

  it("retries a lost port on a fresh one, and says so", async () => {
    const run = script([41001, 41002], [lost, () => ready("127.0.0.1:41002")]);
    const temporal = await bootTemporal(run.opts);
    expect(temporal.hostPort).toBe("127.0.0.1:41002");
    expect(run.tried).toEqual([41001, 41002]);
    expect(run.warnings).toEqual([
      "temporal dev server lost a port to another listener (listen tcp 127.0.0.1:41001: bind: address already in use); " +
        "retrying with a fresh port, attempt 2 of 3",
    ]);
  });

  it("fails naming the last loss once every attempt has lost its port", async () => {
    const run = script([41001, 41002, 41003], [lost, lost, lost]);
    await expect(bootTemporal(run.opts)).rejects.toThrow(
      "temporal dev server lost a port to another listener on all 3 attempts; " +
        "the last: listen tcp 127.0.0.1:41003: bind: address already in use",
    );
    expect(run.tried).toEqual([41001, 41002, 41003]);
    expect(run.warnings).toHaveLength(2);
  });

  it("never retries a failure that is not a lost port", async () => {
    const run = script([41001, 41002], [
      () => {
        throw new Error("temporal dev server exited before becoming ready (code=1, signal=null)");
      },
    ]);
    await expect(bootTemporal(run.opts)).rejects.toThrow("temporal dev server exited before becoming ready");
    expect(run.tried).toEqual([41001]);
    expect(run.warnings).toEqual([]);
  });
});
