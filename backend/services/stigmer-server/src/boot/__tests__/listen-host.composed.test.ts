/**
 * Pins the bind a composed server chooses (boot/listen-host.ts), read from
 * its own "listening" log line: a server without sign-in listens on
 * loopback when nobody chose a host, so the network cannot reach the
 * operator it treats every tokenless caller as (stigmer#2945); an
 * operator's wider choice is kept, and the boot says what it exposes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { baseConfig } from "../../extensions/__tests__/composed-support.js";
import { loadConfig } from "../config.js";
import { composeServer } from "../compose.js";
import type { ComposedServer } from "../compose.js";
import { createLogger } from "../logger.js";

type LogLine = Readonly<Record<string, unknown>> & { readonly msg?: string; readonly message?: string };

let server: ComposedServer | undefined;
let dir: string | undefined;

afterEach(async () => {
  await server?.shutdown();
  server = undefined;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function bootWithoutSignIn(env: Record<string, string>): Promise<LogLine[]> {
  dir = mkdtempSync(path.join(tmpdir(), "listen-host-"));
  const lines: LogLine[] = [];
  server = await composeServer({
    config: loadConfig({ ...baseConfig(dir), ...env }),
    logger: createLogger({ level: "info", pretty: false, write: (line) => lines.push(JSON.parse(line) as LogLine) }),
    portOverride: 0,
  });
  await server.start();
  return lines;
}

const textOf = (line: LogLine): string => String(line.msg ?? line.message ?? "");

describe("the bind a server without sign-in chooses", () => {
  it("is loopback when nobody chose a host", async () => {
    const lines = await bootWithoutSignIn({});
    const listening = lines.find((line) => textOf(line) === "stigmer-server listening");
    expect(listening?.host).toBe("127.0.0.1");
    expect(lines.some((line) => textOf(line).includes("without sign-in"))).toBe(false);
  });

  it("is the operator's GRPC_HOST when set, and the boot warns what a wider bind exposes", async () => {
    const lines = await bootWithoutSignIn({ GRPC_HOST: "0.0.0.0" });
    const listening = lines.find((line) => textOf(line) === "stigmer-server listening");
    expect(listening?.host).toBe("0.0.0.0");
    const warning = lines.find((line) => textOf(line).startsWith("listening on 0.0.0.0 without sign-in"));
    expect(warning, "the boot warns about a wider bind without sign-in").toBeDefined();
    expect(warning?.level).toBe("warn");
  });
});
