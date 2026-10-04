// Command-level contract for `stigmer config context set --org`: an
// organization the caller belongs to on the active backend, named by slug or
// id, is persisted as the context by its id (with its slug for output) and
// then resolved by every command; a value the backend does not
// list among the caller's own is refused as not found and the config file is
// left byte-for-byte as it was; an empty slug clears the context without
// asking the backend; no `--org` at all is a usage error. Only a lookup the
// server refuses as NotFound or PermissionDenied reads as "not one you belong
// to"; any other failure is reported as itself. And `context show` names the
// active backend, not the legacy local/cloud switch the file also carries,
// and says its slug is the one `set` stored. A real Connect backend over h2c serves findMyOrganizations; the
// config file (HOME redirected) points a selfhost backend at it.

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
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationsSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { load, resolveOrganization } from "../../../config/index.js";
import { classify, ExitCode } from "../../../errors/index.js";
import { buildProgram } from "../../../program.js";

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

let backend: Http2Server;
let port: number;
const openSessions = new Set<ServerHttp2Session>();
let lookups: number;

let home: string;
let originalHome: string | undefined;

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(OrganizationQueryController, {
      // The server resolves a slug acme was renamed from, as the serving
      // chain's resolver does.
      get: ({ value }) => {
        if (value === "hidden-org") throw new ConnectError("permission denied", Code.PermissionDenied);
        if (value === "flaky-org") throw new ConnectError("backend unavailable", Code.Unavailable);
        if (value !== "acme-old" && value !== "acme" && value !== ACME_ID) {
          throw new ConnectError("not found", Code.NotFound);
        }
        return create(OrganizationSchema, { metadata: { id: ACME_ID, slug: "acme" } });
      },
      findMyOrganizations: () => {
        lookups += 1;
        return create(OrganizationsSchema, {
          entries: [create(OrganizationSchema, { metadata: { id: ACME_ID, slug: "acme" } })],
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
      "backend:",
      "  type: cloud",
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
  readonly stdout: string;
  /** Where human output goes. */
  readonly stderr: string;
}

async function run(...args: string[]): Promise<RunOutcome> {
  return runContext("set", ...args);
}

async function runContext(...args: string[]): Promise<RunOutcome> {
  const program = buildProgram();
  program.exitOverride();
  let stdout = "";
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  let stderr = "";
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    await program.parseAsync(["node", "stigmer", "config", "context", ...args]);
    return { exitCode: ExitCode.Success, message: "", stdout, stderr };
  } catch (err) {
    return {
      exitCode: classify(err)?.exitCode ?? -1,
      message: err instanceof Error ? err.message : String(err),
      stdout,
      stderr,
    };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe("config context set --org", () => {
  it("persists an organization the caller belongs to by its id, which every command then resolves", async () => {
    const outcome = await run("--org", "acme");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(lookups).toBe(1);
    expect(resolveOrganization(load())).toBe(ACME_ID);
    expect(load().context?.org_slug).toBe("acme");
  });

  it("accepts the organization's id as well as its slug", async () => {
    const outcome = await run("--org", ACME_ID);
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(resolveOrganization(load())).toBe(ACME_ID);
    expect(load().context?.org_slug).toBe("acme");
  });

  it("accepts a slug the organization was renamed from, while the server still resolves it, and stores the current one", async () => {
    const outcome = await run("--org", "acme-old");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(resolveOrganization(load())).toBe(ACME_ID);
    expect(load().context?.org_slug).toBe("acme");
  });

  it("refuses a slug the backend does not list as the caller's and leaves the config untouched", async () => {
    const before = readFileSync(configFile(), "utf8");
    const outcome = await run("--org", "acmee");
    expect(outcome.exitCode).toBe(ExitCode.NotFound);
    expect(outcome.message).toMatch(/organization 'acmee' is not one you belong to on the 'team' backend/);
    expect(readFileSync(configFile(), "utf8")).toBe(before);
  });

  it("refuses an organization the server will not show the caller as one they do not belong to", async () => {
    const before = readFileSync(configFile(), "utf8");
    const outcome = await run("--org", "hidden-org");
    expect(outcome.exitCode).toBe(ExitCode.NotFound);
    expect(outcome.message).toMatch(/organization 'hidden-org' is not one you belong to/);
    expect(readFileSync(configFile(), "utf8")).toBe(before);
  });

  it("reports a failed lookup as itself, not as an organization the caller does not belong to", async () => {
    const before = readFileSync(configFile(), "utf8");
    const outcome = await run("--org", "flaky-org");
    expect(outcome.exitCode).toBe(ExitCode.Connection);
    expect(outcome.message).toMatch(/backend unavailable/);
    expect(outcome.message).not.toMatch(/not one you belong to/);
    expect(readFileSync(configFile(), "utf8")).toBe(before);
  });

  it("clears the context with an empty slug, without asking the backend", async () => {
    await run("--org", "acme");
    const outcome = await run("--org", "");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(lookups).toBe(1);
    expect(resolveOrganization(load())).toBe("");
    expect(load().context?.org_slug).toBeUndefined();
  });

  it("is a usage error without --org", async () => {
    const outcome = await run();
    expect(outcome.exitCode).toBe(ExitCode.Usage);
    expect(outcome.message).toMatch(/--org is required/);
  });
});

describe("config context show", () => {
  it("names the active backend, not the legacy local/cloud switch", async () => {
    await run("--org", "acme");
    const outcome = await runContext("show", "--json");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    const fields = JSON.parse(outcome.stdout).sections[0].fields as { key: string; value: string }[];
    expect(fields).toEqual([
      { key: "Organization", value: "acme" },
      { key: "Organization ID", value: ACME_ID },
      { key: "Backend", value: "team" },
    ]);
  });

  it("says the slug it shows is the one `set` stored, and where the current one is", async () => {
    await run("--org", "acme");
    const outcome = await runContext("show");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(outcome.stderr).toContain(
      "Organization shows the slug as of `context set`; `stigmer auth whoami` shows the current one",
    );
    expect(lookups).toBe(1);
  });

  it("adds no such hint when no slug is stored beside the value", async () => {
    writeFileSync(configFile(), `${readFileSync(configFile(), "utf8")}context:\n  org: acme\n`);
    const outcome = await runContext("show");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(outcome.stderr).toContain("acme");
    expect(outcome.stderr).not.toContain("auth whoami");
  });
});
