/**
 * The locked host's lock (`fence.ts`): the flag Node takes, the one folder
 * it may read in each shape the runner ships in, the heap cap, the fence the
 * host reports and the runner's judgment of it. The spawned locked host shows Node
 * enforcing it (`fenced-host.test.ts`); the built entry's boot under it is
 * `scripts/verify-agent-host-boot.mjs --fenced`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  FenceRefusedError,
  currentFence,
  fenceReadRoot,
  fencedHostEnvironment,
  NO_LANGSMITH_PROFILE,
  fencedHostLaunch,
  heapCapFlag,
  judgeFence,
  permissionFlag,
  type HostFenceReport,
} from "../fence.js";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh folder with `files` (relative paths) created in it; real path, so `/tmp` links do not differ. */
function layout(files: readonly string[], links: readonly (readonly [string, string])[] = []): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fence-root-")));
  made.push(root);
  for (const file of files) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  for (const [link, target] of links) {
    mkdirSync(join(root, link, ".."), { recursive: true });
    symlinkSync(join(root, target), join(root, link));
  }
  return root;
}

const PACKAGES = ["deepagents", "@langchain/core", "@stigmer/apis", "@temporalio/common"];

describe("the permission flag", () => {
  it("is --permission where this Node takes it, else the experimental spelling, else none", () => {
    expect(permissionFlag(new Set(["--permission", "--experimental-permission"]))).toBe("--permission");
    expect(permissionFlag(new Set(["--experimental-permission"]))).toBe("--experimental-permission");
    expect(permissionFlag(new Set(["--inspect"]))).toBeNull();
  });
});

describe("the install root the locked host may read", () => {
  it("is the slim artifact's own folder, which holds every package it loads (the bundle inlined the stubs)", () => {
    const root = layout([
      "runner/dist/main.js",
      "runner/dist/node_modules/deepagents/package.json",
      "runner/dist/node_modules/@langchain/core/package.json",
      "runner/dist/node_modules/@temporalio/common/package.json",
    ]);
    expect(fenceReadRoot(join(root, "runner/dist/main.js"), PACKAGES)).toBe(join(root, "runner/dist"));
  });

  it("is the repository root for the compiled build in a checkout, whose workspace packages are links into it", () => {
    const root = layout(
      [
        "repo/backend/services/runner/dist/main.js",
        "repo/backend/services/runner/node_modules/deepagents/package.json",
        "repo/backend/services/runner/node_modules/@langchain/core/package.json",
        "repo/backend/services/runner/node_modules/@temporalio/common/package.json",
        "repo/apis/stubs/ts/package.json",
      ],
      [["repo/backend/services/runner/node_modules/@stigmer/apis", "repo/apis/stubs/ts"]],
    );
    expect(fenceReadRoot(join(root, "repo/backend/services/runner/dist/main.js"), PACKAGES)).toBe(join(root, "repo"));
  });

  it("is the folder an embedder's node_modules sits in, found up the lookup chain", () => {
    const root = layout([
      "app/node_modules/@stigmer/runner/dist/main.js",
      "app/node_modules/deepagents/package.json",
      "app/node_modules/@langchain/core/package.json",
      "app/node_modules/@stigmer/apis/package.json",
      "app/node_modules/@temporalio/common/package.json",
    ]);
    expect(fenceReadRoot(join(root, "app/node_modules/@stigmer/runner/dist/main.js"), PACKAGES)).toBe(join(root, "app/node_modules"));
  });

  it("finds a package by its folder, so an exports map hiding its package.json is no obstacle", () => {
    const root = layout(["a/dist/main.js", "a/node_modules/deepagents/dist/index.js"]);
    expect(fenceReadRoot(join(root, "a/dist/main.js"), ["deepagents"])).toBe(join(root, "a"));
  });
});

describe("the locked host's flags", () => {
  it("are the permission flag and one read grant of the install root, with LangSmith's profile named inside it", () => {
    expect(fencedHostLaunch("/opt/runner/dist/main.js", new Set(["--permission"]), () => "/opt/runner/dist")).toEqual({
      execArgv: ["--permission", "--allow-fs-read=/opt/runner/dist"],
      env: { LANGSMITH_CONFIG_FILE: join("/opt/runner/dist", NO_LANGSMITH_PROFILE) },
    });
  });

  it("grant the network on a Node whose permission model locks it, since reach is the runner's checks", () => {
    expect(fencedHostLaunch("/opt/runner/dist/main.js", new Set(["--permission", "--allow-net"]), () => "/opt/runner/dist").execArgv).toEqual([
      "--permission",
      "--allow-fs-read=/opt/runner/dist",
      "--allow-net",
    ]);
  });

  it("are refused from source, naming the built runner, and on a Node without the model", () => {
    expect(() => fencedHostLaunch("/repo/src/main.ts", new Set(["--permission"]), () => "/repo")).toThrow(FenceRefusedError);
    expect(() => fencedHostLaunch("/repo/src/main.ts", new Set(["--permission"]), () => "/repo")).toThrow(/node dist\/main\.js/);
    expect(() => fencedHostLaunch("/opt/runner/main.js", new Set(), () => "/opt/runner")).toThrow(/no permission model/);
  });
});

describe("a graph step under the real lock", () => {
  // LangChain builds a LangSmith run tree for every graph step, tracing off
  // included, and its client probes for a profile in the home folder. This
  // runs that construction in a Node started with the locked host's flags
  // and environment, the runner's own install as its read grant, and a home
  // folder outside it.
  const runnerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const buildRunTree = (env: Readonly<Record<string, string>>): { status: number | null; output: string } => {
    const launch = fencedHostLaunch(join(runnerDir, "package.json"));
    const home = realpathSync(mkdtempSync(join(tmpdir(), "fence-home-")));
    made.push(home);
    const result = spawnSync(
      process.execPath,
      [...launch.execArgv, "--input-type=module", "-e", 'const { RunTree } = await import("langsmith"); new RunTree({ name: "step", tracingEnabled: false }); console.log("built");'],
      { cwd: runnerDir, env: { PATH: process.env["PATH"] ?? "", HOME: home, ...env }, encoding: "utf8", timeout: 60_000 },
    );
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };

  it("builds with the locked host's environment", () => {
    const launch = fencedHostLaunch(join(runnerDir, "package.json"));
    const built = buildRunTree(launch.env);
    expect(built.output).toContain("built");
    expect(built.status).toBe(0);
  });

  it("is refused a read of the home folder without it (the control: the lock is real)", () => {
    const refused = buildRunTree({});
    expect(refused.output).toContain("ERR_ACCESS_DENIED");
    expect(refused.status).not.toBe(0);
  });
});

describe("the locked host's environment", () => {
  it("drops Node's options, so nothing re-grants, and LangChain's tracer settings", () => {
    expect(
      fencedHostEnvironment({ PATH: "/bin", NODE_OPTIONS: "--allow-addons", LANGSMITH_API_KEY: "k", LANGCHAIN_TRACING_V2: "true", NODE_ENV: "production" }),
    ).toEqual({ PATH: "/bin", NODE_ENV: "production" });
  });
});

const LOCKED: HostFenceReport = {
  permission: true,
  execArgv: ["--permission", "--allow-fs-read=/opt/runner"],
  fsReadHome: false,
  fsWrite: false,
  childProcess: false,
  worker: false,
};

describe("the fence a host reports", () => {
  it("is Node's own answers for the documented scopes, with the home folder as the read probe", () => {
    const asked: string[] = [];
    const permission = {
      has: (scope: string, reference?: string): boolean => {
        asked.push(reference === undefined ? scope : `${scope} ${reference}`);
        return false;
      },
    };
    expect(currentFence(permission, ["--permission"], "/home/agent", 560 * 1024 * 1024)).toEqual({ ...LOCKED, execArgv: ["--permission"], heapLimitMb: 560 });
    expect(asked).toEqual(["fs.read /home/agent", "fs.write", "child", "worker"]);
  });

  it("reads every scope as open without the permission model", () => {
    expect(currentFence(undefined, [], "/home/agent", 4144 * 1024 * 1024)).toEqual({
      permission: false,
      execArgv: [],
      fsReadHome: true,
      fsWrite: true,
      childProcess: true,
      worker: true,
      heapLimitMb: 4144,
    });
  });
});

describe("the runner's judgment of a reported fence", () => {
  it("accepts exactly the lock it built", () => {
    expect(judgeFence(LOCKED, LOCKED.execArgv)).toBeNull();
  });

  it("refuses a host without the model, or one that may still write, start processes or workers, or read the home folder", () => {
    expect(judgeFence(undefined, LOCKED.execArgv)).toMatch(/did not report/);
    expect(judgeFence({ ...LOCKED, permission: false }, LOCKED.execArgv)).toMatch(/without Node's permission model/);
    expect(judgeFence({ ...LOCKED, fsWrite: true }, LOCKED.execArgv)).toMatch(/write files/);
    expect(judgeFence({ ...LOCKED, childProcess: true }, LOCKED.execArgv)).toMatch(/start processes/);
    expect(judgeFence({ ...LOCKED, worker: true }, LOCKED.execArgv)).toMatch(/worker threads/);
    expect(judgeFence({ ...LOCKED, fsReadHome: true }, LOCKED.execArgv)).toMatch(/read the home folder/);
  });

  it("refuses any flag beyond the runner's, since Node cannot be asked about an addon or WASI grant", () => {
    expect(judgeFence({ ...LOCKED, execArgv: [...LOCKED.execArgv, "--allow-addons"] }, LOCKED.execArgv)).toMatch(/not the lock the runner built/);
    expect(judgeFence({ ...LOCKED, execArgv: ["--permission", "--allow-fs-read=/"] }, LOCKED.execArgv)).toMatch(/not the lock the runner built/);
  });
});

describe("the heap cap", () => {
  it("is the last flag of the lock when the runner asks for one, and absent otherwise", () => {
    expect(fencedHostLaunch("/opt/runner/dist/main.js", new Set(["--permission", "--allow-net"]), () => "/opt/runner/dist", 512).execArgv).toEqual([
      "--permission",
      "--allow-fs-read=/opt/runner/dist",
      "--allow-net",
      "--max-old-space-size=512",
    ]);
    expect(fencedHostLaunch("/opt/runner/dist/main.js", new Set(["--permission"]), () => "/opt/runner/dist").execArgv).not.toContain(heapCapFlag(512));
  });

  it("is proved by V8's own heap limit in the hello: the cap and the young generation beside it, no more", () => {
    const capped = [...LOCKED.execArgv, heapCapFlag(512)];
    expect(judgeFence({ ...LOCKED, execArgv: capped, heapLimitMb: 560 }, capped), "512 MB of old space and V8's 48 MB young generation").toBeNull();
    expect(judgeFence({ ...LOCKED, execArgv: capped, heapLimitMb: 4144 }, capped)).toBe(
      "the locked agent program's heap is not held to its memory cap of 512 MB (V8 reports 4144 MB)",
    );
    expect(judgeFence({ ...LOCKED, execArgv: capped }, capped), "a hello that reports no limit").toMatch(/not held to its memory cap of 512 MB \(V8 reports null MB\)/);
    expect(judgeFence({ ...LOCKED, heapLimitMb: 560 }, capped), "a host started without the flag").toMatch(/not the lock the runner built/);
  });

  it("is reported by a real Node started under it", () => {
    const run = spawnSync(process.execPath, [heapCapFlag(256), "--input-type=module", "-e", "import { getHeapStatistics } from 'node:v8'; console.log(getHeapStatistics().heap_size_limit)"], { encoding: "utf8" });
    const limitMb = Math.round(Number(run.stdout.trim()) / (1024 * 1024));
    const capped = [...LOCKED.execArgv, heapCapFlag(256)];
    expect(judgeFence({ ...LOCKED, execArgv: capped, heapLimitMb: limitMb }, capped), `V8 reported ${limitMb} MB`).toBeNull();
  });
});
