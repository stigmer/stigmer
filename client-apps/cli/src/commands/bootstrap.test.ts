// Command-level contract for `stigmer bootstrap`: against the configured
// backend it ensures the system org and installs the official defaults (the
// repo tree's catalogue in dev), whose list is EMPTY — a fresh install needs
// no default content because a session with no agent runs the built-in
// assistant — so the command creates the organization, pushes nothing, and
// renders both outcomes; a second run over a converged backend reports the
// org present and still pushes nothing. The failing-default arm is pinned at
// the function level (local/bootstrap.test.ts), where a synthetic list can
// stage it. A real Connect backend over h2c serves the org and plugin
// controllers; the config file (HOME redirected) points a selfhost backend
// at it.

import { createHash } from "node:crypto";
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
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  type Plugin,
  PluginSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { ListPluginMembersResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginState } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
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
import { classify, ExitCode } from "../errors/index.js";
import { prepareDefaultPlugins } from "../local/plugins/defaults.js";
import { SYSTEM_ORG } from "../local/system-org.js";
import { buildProgram } from "../program.js";

let backend: Http2Server;
let port: number;
const openSessions = new Set<ServerHttp2Session>();

let orgs: Map<string, Organization>;
let plugins: Map<string, Plugin>;
let pushes: number;

let home: string;
let originalHome: string | undefined;

/** The catalogue's defaults by archive digest: how this backend names what it is sent. */
let nameByDigest: Map<string, string>;

beforeAll(async () => {
  nameByDigest = new Map(
    (await prepareDefaultPlugins()).map((entry) => [entry.push.digest, entry.name]),
  );
  const routes = (router: ConnectRouter) => {
    router.service(OrganizationQueryController, {
      findMyOrganizations: () =>
        create(OrganizationsSchema, { entries: [...orgs.values()] }),
    });
    router.service(OrganizationCommandController, {
      create: (org) => {
        const row = create(OrganizationSchema, org);
        if (row.metadata !== undefined) row.metadata.id = "org_1";
        orgs.set(row.metadata?.slug ?? "", row);
        return row;
      },
    });
    router.service(PluginCommandController, {
      push: (req) => {
        pushes += 1;
        const digest = createHash("sha256").update(req.artifact).digest("hex");
        const slug = nameByDigest.get(digest);
        if (slug === undefined) {
          throw new ConnectError("archive is not a catalogue default", Code.InvalidArgument);
        }
        const row = create(PluginSchema, {
          metadata: { id: `plg_${slug}`, slug, org: req.org, visibility: req.visibility },
          spec: { name: slug },
          status: { digest, state: PluginState.READY },
        });
        plugins.set(slug, row);
        return row;
      },
    });
    router.service(PluginQueryController, {
      getByReference: (ref) => {
        const row = plugins.get(ref.slug);
        if (row === undefined) {
          throw new ConnectError(`plugin ${ref.slug} not found`, Code.NotFound);
        }
        return row;
      },
      listMembers: () =>
        create(ListPluginMembersResponseSchema, { members: [] }),
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
  plugins = new Map();
  pushes = 0;
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
  it("creates the system org, installs nothing (the catalogue has no defaults), and reports both", async () => {
    const outcome = await run("--json");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(orgs.has(SYSTEM_ORG)).toBe(true);
    expect(pushes).toBe(0);

    const payload = JSON.parse(outcome.stdout);
    expect(payload.status).toBe("success");
    expect(payload.message).toBe("Backend is ready");
    expect(section(payload, "System organization")?.fields).toEqual([
      { key: "Slug", value: SYSTEM_ORG },
      { key: "State", value: "created" },
    ]);
    expect(section(payload, "Default plugins")?.fields ?? []).toEqual([]);
  });

  it("is a no-op the second time: org present, nothing pushed", async () => {
    await run("--json");
    const pushedFirst = pushes;
    const outcome = await run("--json");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(pushes).toBe(pushedFirst);
    const payload = JSON.parse(outcome.stdout);
    expect(section(payload, "System organization")?.fields).toContainEqual({
      key: "State",
      value: "present",
    });
    expect(
      (section(payload, "Default plugins")?.fields ?? []).every(
        (f) => f.value === "up-to-date",
      ),
    ).toBe(true);
  });
});
