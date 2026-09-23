// Command-level contract for `stigmer config context set --org`: an
// organization the caller belongs to on the active backend is persisted as
// the context and then resolved by every command; a slug the backend does not
// list among the caller's own is refused as not found and the config file is
// left byte-for-byte as it was; an empty slug clears the context without
// asking the backend; no `--org` at all is a usage error. A real Connect
// backend over h2c serves findMyOrganizations; the config file (HOME
// redirected) points a selfhost backend at it.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  createServer as createHttp2Server,
  type Http2Server,
  type ServerHttp2Session,
} from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationsSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { load, resolveOrganization } from "../../config/index.js";
import { classify, ExitCode } from "../../errors/index.js";
import { buildProgram } from "../../program.js";

let backend: Http2Server;
let port: number;
const openSessions = new Set<ServerHttp2Session>();
let lookups: number;

let home: string;
let originalHome: string | undefined;

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(OrganizationQueryController, {
      findMyOrganizations: () => {
        lookups += 1;
        return create(OrganizationsSchema, {
          entries: [create(OrganizationSchema, { metadata: { id: "acme", slug: "acme" } })],
        });
      },
    });
  };
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  port = (backend.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

beforeEach(() => {
  lookups = 0;
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "stigmer-context-cmd-"));
  process.env.HOME = home;
  mkdirSync(join(home, ".stigmer"), { recursive: true });
  writeFileSync(
    configFile(),
    [
      "backends:",
      "  team:",
      "    type: selfhost",
      `    endpoint: 127.0.0.1:${port}`,
      "current_backend: team",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

function configFile(): string {
  return join(home, ".stigmer", "config.yaml");
}

interface RunOutcome {
  readonly exitCode: number;
  readonly message: string;
}

async function run(...args: string[]): Promise<RunOutcome> {
  const program = buildProgram();
  program.exitOverride();
  const outSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await program.parseAsync(["node", "stigmer", "config", "context", "set", ...args]);
    return { exitCode: ExitCode.Success, message: "" };
  } catch (err) {
    return {
      exitCode: classify(err)?.exitCode ?? -1,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe("config context set --org", () => {
  it("persists an organization the caller belongs to, which every command then resolves", async () => {
    const outcome = await run("--org", "acme");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(lookups).toBe(1);
    expect(resolveOrganization(load())).toBe("acme");
  });

  it("refuses a slug the backend does not list as the caller's and leaves the config untouched", async () => {
    const before = readFileSync(configFile(), "utf8");
    const outcome = await run("--org", "acmee");
    expect(outcome.exitCode).toBe(ExitCode.NotFound);
    expect(outcome.message).toMatch(/organization 'acmee' is not one you belong to on the 'team' backend/);
    expect(readFileSync(configFile(), "utf8")).toBe(before);
  });

  it("clears the context with an empty slug, without asking the backend", async () => {
    await run("--org", "acme");
    const outcome = await run("--org", "");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(lookups).toBe(1);
    expect(resolveOrganization(load())).toBe("stigmer");
  });

  it("is a usage error without --org", async () => {
    const outcome = await run();
    expect(outcome.exitCode).toBe(ExitCode.Usage);
    expect(outcome.message).toMatch(/--org is required/);
  });
});
