// Command-level contract for `stigmer bootstrap`: against the configured
// backend it ensures the organization the CLI falls back to (`stigmer`) and
// installs nothing, so the command creates the organization and renders one
// Organization section; a second run over a ready backend reports the org
// present and creates nothing. A real Connect backend over h2c serves the org
// controllers; the config file (HOME redirected) points a selfhost backend at
// it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import {
  type Organization,
  OrganizationSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationsSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DEFAULT_LOCAL_ORG } from "../config/index.js";
import { classify, ExitCode } from "../errors/index.js";
import { buildProgram } from "../program.js";

let backend: Http2Server;
let port: number;
const openSessions = new Set<ServerHttp2Session>();

let orgs: Map<string, Organization>;
let creates: number;

let home: string;
let originalHome: string | undefined;

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(OrganizationQueryController, {
      findMyOrganizations: () =>
        create(OrganizationsSchema, { entries: [...orgs.values()] }),
    });
    router.service(OrganizationCommandController, {
      create: (org) => {
        creates += 1;
        const row = create(OrganizationSchema, org);
        if (row.metadata !== undefined) row.metadata.id = "org_1";
        orgs.set(row.metadata?.slug ?? "", row);
        return row;
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
  orgs = new Map();
  creates = 0;
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "stigmer-bootstrap-cmd-"));
  process.env.HOME = home;
  mkdirSync(join(home, ".stigmer"), { recursive: true });
  writeFileSync(
    join(home, ".stigmer", "config.yaml"),
    [
      "backend:",
      "  type: cloud",
      "backends:",
      "  test:",
      "    type: selfhost",
      `    endpoint: 127.0.0.1:${port}`,
      "current_backend: test",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

interface RunOutcome {
  readonly exitCode: number;
  readonly message: string;
  readonly stdout: string;
}

async function run(...args: string[]): Promise<RunOutcome> {
  const program = buildProgram();
  program.exitOverride();
  let stdout = "";
  const outSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
  const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await program.parseAsync(["node", "stigmer", "bootstrap", ...args]);
    return { exitCode: ExitCode.Success, message: "", stdout };
  } catch (err) {
    return {
      exitCode: classify(err)?.exitCode ?? -1,
      message: err instanceof Error ? err.message : String(err),
      stdout,
    };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

interface JsonSection {
  title?: string;
  fields?: { key: string; value: string }[];
}

function section(payload: { sections?: JsonSection[] }, title: string) {
  return payload.sections?.find((s) => s.title === title);
}

describe("bootstrap", () => {
  it("creates the organization, installs nothing, and reports it", async () => {
    const outcome = await run("--json");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(orgs.has(DEFAULT_LOCAL_ORG)).toBe(true);

    const payload = JSON.parse(outcome.stdout);
    expect(payload.status).toBe("success");
    expect(payload.message).toBe("Backend is ready");
    expect(payload.sections?.map((s: JsonSection) => s.title)).toEqual(["Organization"]);
    expect(section(payload, "Organization")?.fields).toEqual([
      { key: "Slug", value: DEFAULT_LOCAL_ORG },
      { key: "State", value: "created" },
    ]);
  });

  it("is a no-op the second time: org present, nothing created", async () => {
    await run("--json");
    const outcome = await run("--json");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(creates).toBe(1);
    const payload = JSON.parse(outcome.stdout);
    expect(section(payload, "Organization")?.fields).toContainEqual({
      key: "State",
      value: "present",
    });
  });
});
