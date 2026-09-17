// Command-level contract for `stigmer install`: a ref resolves through the
// configured marketplaces to one entry, whose folder is pushed exactly as
// `push plugin` would push it (the archive the backend receives is the one
// the folder prepares to); --dry-run pushes nothing; a version pin, a path,
// an unknown name and an ambiguous name refuse with their sentences. A real
// Connect backend over h2c serves the plugin controllers; the config file
// (HOME redirected) points a selfhost backend at it.

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
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import {
  ListPluginMembersResponseSchema,
  type PushPluginRequest,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginState } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
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
import { writeCursorMarketplace } from "../marketplace/__fixtures__/cursor-marketplace.js";
import { preparePluginPush } from "../resources/plugin.js";
import { buildProgram } from "../program.js";

let backend: Http2Server;
let port: number;
const openSessions = new Set<ServerHttp2Session>();
let pushes: PushPluginRequest[] = [];

let home: string;
let fixture: string;
let originalHome: string | undefined;

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(PluginCommandController, {
      push: (req) => {
        pushes.push(req);
        return create(PluginSchema, {
          metadata: { id: "plg_1", slug: "thermos", org: "acme" },
          spec: { name: "thermos", version: "1.0.0" },
          status: {
            digest: "a".repeat(64),
            state: PluginState.READY,
            materialized: { skills: 1, agents: 1 },
          },
        });
      },
    });
    router.service(PluginQueryController, {
      listMembers: () =>
        create(ListPluginMembersResponseSchema, {
          members: [
            {
              kind: ApiResourceKind.skill,
              id: "skl_1",
              slug: "warm",
              name: "warm",
            },
            {
              kind: ApiResourceKind.agent,
              id: "agt_1",
              slug: "thermos",
              name: "thermos",
            },
          ],
        }),
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
  pushes = [];
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "stigmer-install-cmd-"));
  fixture = mkdtempSync(join(tmpdir(), "stigmer-install-cmd-fixture-"));
  writeCursorMarketplace(fixture);
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
      "context:",
      "  organization: acme",
      "marketplaces:",
      "  cursor-plugins:",
      "    type: local",
      `    path: ${fixture}`,
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(fixture, { recursive: true, force: true });
});

interface RunOutcome {
  readonly exitCode: number;
  readonly message: string;
  readonly stdout: string;
}

/** `stigmer [globals] install <args>`: the program's own flags (`--org`) go before the verb. */
async function run(
  args: string[] | string,
  ...rest: string[]
): Promise<RunOutcome> {
  const [globals, local] = Array.isArray(args)
    ? [args, rest]
    : [[], [args, ...rest]];
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
    await program.parseAsync([
      "node",
      "stigmer",
      ...globals,
      "install",
      ...local,
    ]);
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

describe("install", () => {
  it("pushes the entry's folder as push plugin would, into the context org, and renders the install", async () => {
    const outcome = await run("cursor-plugins/thermos", "--json");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(pushes).toHaveLength(1);
    const expected = await preparePluginPush(join(fixture, "thermos"));
    expect(pushes[0]?.org).toBe("acme");
    expect(
      Buffer.from(pushes[0]?.artifact ?? []).equals(
        Buffer.from(expected.archive),
      ),
    ).toBe(true);
    expect(pushes[0]?.message).toBe(
      "installed from marketplace 'cursor-plugins'",
    );

    const payload = JSON.parse(outcome.stdout);
    expect(payload.message).toMatch(
      /^Installed plugin 'thermos' \(1 skill, 0 MCP servers, 1 agent\)/,
    );
    const about = payload.sections.find(
      (s: { title: string }) => s.title === "Plugin",
    );
    expect(about.fields).toContainEqual({
      key: "Marketplace",
      value: `cursor-plugins (${fixture})`,
    });
    expect(payload.data.members).toHaveLength(2);
  });

  it("finds a bare name across the configured marketplaces and honours --org, --visibility and --message", async () => {
    const outcome = await run(
      ["--org", "other"],
      "github",
      "--visibility",
      "org",
      "-m",
      "hello",
    );
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(pushes[0]?.org).toBe("other");
    expect(pushes[0]?.message).toBe("hello");
    expect(pushes[0]?.visibility).toBeGreaterThan(0);
  });

  it("--dry-run reads the marketplace and describes the plugin without pushing", async () => {
    const outcome = await run(
      "cursor-plugins/thermos@1.0.0",
      "--dry-run",
      "--json",
    );
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(pushes).toHaveLength(0);
    const payload = JSON.parse(outcome.stdout);
    expect(payload.message).toBe(
      "Dry run: 'cursor-plugins/thermos' would install plugin 'thermos'",
    );
    expect(payload.data.plugin.name).toBe("thermos");
  });

  it("refuses a version the marketplace does not offer, naming the one it does", async () => {
    const outcome = await run("cursor-plugins/thermos@9.9.9");
    expect(outcome.exitCode).toBe(ExitCode.Usage);
    expect(outcome.message).toMatch(
      /pins version 9\.9\.9, but the marketplace offers 'thermos' at 1\.0\.0/,
    );
    expect(pushes).toHaveLength(0);
  });

  it("refuses a path toward push plugin, an unknown name, and an unknown marketplace", async () => {
    expect((await run("./thermos")).message).toMatch(
      /is a path.*stigmer push plugin \.\/thermos/s,
    );
    expect((await run("nope")).message).toMatch(
      /no configured marketplace offers a plugin named 'nope'/,
    );
    expect((await run("nowhere/thermos")).message).toMatch(
      /no marketplace named 'nowhere' is configured/,
    );
    expect(pushes).toHaveLength(0);
  });

  it("refuses a bare name two marketplaces offer, naming each qualified ref", async () => {
    const second = mkdtempSync(join(tmpdir(), "stigmer-install-cmd-second-"));
    try {
      writeCursorMarketplace(second);
      const { load, save } = await import("../config/index.js");
      const config = load();
      save({
        ...config,
        marketplaces: {
          ...config.marketplaces,
          second: { type: "local", path: second },
        },
      });
      const outcome = await run("thermos");
      expect(outcome.exitCode).toBe(ExitCode.Usage);
      expect(outcome.message).toMatch(
        /offered by more than one marketplace: cursor-plugins, second\n\nName the one you mean: cursor-plugins\/thermos or second\/thermos/,
      );
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });
});
