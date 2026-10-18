/**
 * Pins the Environment's install (`install.ts`):
 *
 *   - the commands each manager runs, as argv, in the order apt, cargo,
 *     gem, go, npm, pip: apt updates then installs after `--`; cargo
 *     installs into the prefix; gem installs its unpinned entries together
 *     and each `name:ver` as `name -v ver`; go runs one `go install` per
 *     module with GOBIN, GOPATH and GOCACHE in the prefix; npm installs
 *     globally into the prefix after `--`; pip makes the venv, then installs
 *     with the venv's pip after `--`; only apt runs as root;
 *   - the environment a command runs with: an agent command never carries a
 *     runner secret, carries the agent's HOME and the CA variables, and its
 *     PATH starts with the prefix's folders; apt's is only the PATH, the
 *     proxies, the CA variables and DEBIAN_FRONTEND;
 *   - `installEnvironment`, with a stand-in command runner and a temporary
 *     prefix: an agent command runs through `setpriv` with the agent's
 *     arguments, root starts every program by the absolute path its own
 *     PATH gives, never one the agent planted in the prefix, and root's
 *     commands never see the prefix on their PATH; a clean install writes its digest beside the prefix, never in it, and the same set is then
 *     skipped, running nothing, while a changed set installs again; a
 *     non-zero exit, a command killed at its deadline, a deadline already
 *     passed and a missing program each fail naming the manager and why; an
 *     empty set installs nothing;
 *   - `spawnCommand`, over a real `sh`: a command past its deadline is
 *     killed and reported so, and the output it keeps is its tail, bounded;
 *   - the boot's install: started once, awaited by every turn, a failure
 *     kept for them and never an unhandled rejection.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentIdentity } from "../../shared/agent-identity.js";
import { RUNNER_SECRET_ENV_KEYS } from "../../shared/runner-credential-keys.js";
import {
  commandEnvironment,
  COMMAND_DEADLINE_MS,
  EnvironmentInstallError,
  environmentInstalled,
  installCommands,
  installEnvironment,
  OUTPUT_TAIL_BYTES,
  packageDigest,
  resetEnvironmentInstallForTests,
  spawnCommand,
  startEnvironmentInstall,
  type CommandRunner,
  type InstallCommand,
} from "../install.js";
import type { PackageSet, SandboxEnvironment } from "../spec.js";

const EMPTY: PackageSet = { apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] };
const PREFIX = "/opt/stigmer/environment";

function packages(set: Partial<PackageSet>): PackageSet {
  return { ...EMPTY, ...set };
}

function environment(set: Partial<PackageSet>): SandboxEnvironment {
  return { network: "unrestricted", packages: packages(set) };
}

/** An identity that is this process's own user, so the install's chown of the prefix is a no-op. */
function ownIdentity(home = "/home/agent"): AgentIdentity {
  return { name: "agent", uid: process.getuid!(), gid: process.getgid!(), home };
}

interface RecordedRun {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly deadlineMs: number;
}

/** A command runner that records each call and answers from `result`. */
function recordingRunner(
  result: (argv: readonly string[]) => Awaited<ReturnType<CommandRunner>> = () => ({ exitCode: 0, timedOut: false, output: "" }),
): { readonly run: CommandRunner; readonly calls: RecordedRun[] } {
  const calls: RecordedRun[] = [];
  const run: CommandRunner = async (argv, env, deadlineMs) => {
    calls.push({ argv, env, deadlineMs });
    return result(argv);
  };
  return { run, calls };
}

describe("installCommands", () => {
  it("installs every manager's set, in the managers' order, only apt as root", () => {
    const commands = installCommands(
      packages({
        pip: ["sqlalchemy==2.0.30", "requests[socks]"],
        npm: ["express@4.18.0", "@angular/cli"],
        go: ["golang.org/x/tools/cmd/goimports@latest", "github.com/a/b/cmd/c@v1.2.3"],
        gem: ["rails:7.1.0", "nokogiri", "rspec", "rake:13.0.6"],
        cargo: ["hyperfine@1.18.0", "ripgrep"],
        apt: ["poppler-utils=22.02.0-2", "jq"],
      }),
      PREFIX,
    );
    const bin = `${PREFIX}/bin`;
    const gemArgs = ["gem", "install", "--no-document", "--install-dir", `${PREFIX}/gem`, "--bindir", bin];
    expect(commands.map((command) => [command.manager, command.argv, command.asAgent])).toEqual([
      ["apt", ["apt-get", "update"], false],
      ["apt", ["apt-get", "install", "-y", "--no-install-recommends", "--", "poppler-utils=22.02.0-2", "jq"], false],
      ["cargo", ["cargo", "install", "--root", PREFIX, "hyperfine@1.18.0", "ripgrep"], true],
      ["gem", [...gemArgs, "nokogiri", "rspec"], true],
      ["gem", [...gemArgs, "rails", "-v", "7.1.0"], true],
      ["gem", [...gemArgs, "rake", "-v", "13.0.6"], true],
      ["go", ["go", "install", "golang.org/x/tools/cmd/goimports@latest"], true],
      ["go", ["go", "install", "github.com/a/b/cmd/c@v1.2.3"], true],
      ["npm", ["npm", "install", "--global", "--prefix", PREFIX, "--no-fund", "--no-audit", "--", "express@4.18.0", "@angular/cli"], true],
      ["pip", ["python3", "-m", "venv", "--system-site-packages", `${PREFIX}/python`], true],
      ["pip", [`${PREFIX}/python/bin/pip`, "install", "--disable-pip-version-check", "--", "sqlalchemy==2.0.30", "requests[socks]"], true],
    ]);
  });

  it("gives each manager the variables it installs by", () => {
    const commands = installCommands(packages({ apt: ["jq"], cargo: ["ripgrep"], gem: ["rails"], go: ["golang.org/x/tools/cmd/goimports@latest"] }), PREFIX);
    const envOf = (manager: string) => commands.find((command) => command.manager === manager)?.env;
    expect(envOf("apt")).toEqual({ DEBIAN_FRONTEND: "noninteractive" });
    expect(envOf("cargo")).toEqual({ CARGO_HOME: `${PREFIX}/cargo` });
    expect(envOf("gem")).toEqual({ GEM_HOME: `${PREFIX}/gem` });
    expect(envOf("go")).toEqual({ GOBIN: `${PREFIX}/bin`, GOPATH: `${PREFIX}/go`, GOCACHE: `${PREFIX}/go/cache` });
  });

  it("runs only pinned gems one by one when none is unpinned, and nothing for an empty set", () => {
    expect(installCommands(packages({ gem: ["rails:7.1.0"] }), PREFIX).map((command) => command.argv.slice(-3))).toEqual([["rails", "-v", "7.1.0"]]);
    expect(installCommands(EMPTY, PREFIX)).toEqual([]);
  });
});

describe("commandEnvironment", () => {
  const planted = Object.fromEntries(RUNNER_SECRET_ENV_KEYS.map((name) => [name, `canary-${name}`]));
  const source: NodeJS.ProcessEnv = {
    ...planted,
    PATH: "/usr/bin:/bin",
    HOME: "/root",
    LANG: "C.UTF-8",
    HTTPS_PROXY: "http://proxy:3128",
    no_proxy: "localhost",
    SSL_CERT_FILE: "/etc/ssl/gateway.pem",
    NODE_EXTRA_CA_CERTS: "/etc/ssl/gateway.pem",
    REQUESTS_CA_BUNDLE: "/etc/ssl/gateway.pem",
    CURL_CA_BUNDLE: "/etc/ssl/gateway.pem",
    GIT_SSL_CAINFO: "/etc/ssl/gateway.pem",
    AWS_SECRET_ACCESS_KEY: "aws-canary",
    KUBERNETES_SERVICE_HOST: "10.0.0.1",
  };
  const [apt, , npm] = installCommands(packages({ apt: ["jq"], npm: ["express"] }), PREFIX) as [InstallCommand, InstallCommand, InstallCommand];

  it("never gives an agent command a runner secret", () => {
    expect(RUNNER_SECRET_ENV_KEYS).toEqual(expect.arrayContaining(["ANTHROPIC_API_KEY", "STIGMER_TOKEN"]));
    for (const identity of [ownIdentity(), null]) {
      const env = commandEnvironment(npm, source, identity, PREFIX);
      for (const name of RUNNER_SECRET_ENV_KEYS) expect(env[name], name).toBeUndefined();
      expect(JSON.stringify(env)).not.toContain("canary-");
    }
  });

  it("gives an agent command the agent's HOME, the CA variables, and the prefix first on PATH", () => {
    const env = commandEnvironment(npm, source, ownIdentity("/home/stigmer-agent"), PREFIX);
    expect(env["HOME"]).toBe("/home/stigmer-agent");
    for (const name of ["SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "GIT_SSL_CAINFO"]) {
      expect(env[name], name).toBe("/etc/ssl/gateway.pem");
    }
    expect(env["PATH"]).toBe([`${PREFIX}/python/bin`, `${PREFIX}/bin`, "/usr/bin:/bin"].join(delimiter));
    expect(env["AWS_SECRET_ACCESS_KEY"], "the separating host's allow-list holds").toBeUndefined();
    expect(env["KUBERNETES_SERVICE_HOST"]).toBeUndefined();
    expect(env["HTTPS_PROXY"]).toBe("http://proxy:3128");
  });

  it("keeps this user's HOME on a runner that does not separate", () => {
    expect(commandEnvironment(npm, source, null, PREFIX)["HOME"]).toBe("/root");
  });

  it("gives apt only the system's PATH, the proxies, the CA variables and DEBIAN_FRONTEND: never the agent's folders", () => {
    const env = commandEnvironment(apt, source, ownIdentity(), PREFIX);
    expect(env).toEqual({
      PATH: "/usr/bin:/bin",
      HTTPS_PROXY: "http://proxy:3128",
      no_proxy: "localhost",
      SSL_CERT_FILE: "/etc/ssl/gateway.pem",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/gateway.pem",
      REQUESTS_CA_BUNDLE: "/etc/ssl/gateway.pem",
      CURL_CA_BUNDLE: "/etc/ssl/gateway.pem",
      GIT_SSL_CAINFO: "/etc/ssl/gateway.pem",
      DEBIAN_FRONTEND: "noninteractive",
    });
  });
});

describe("packageDigest", () => {
  it("names a set: equal sets agree, a changed entry or order does not", () => {
    expect(packageDigest(packages({ npm: ["a", "b"] }))).toBe(packageDigest(packages({ npm: ["a", "b"] })));
    expect(packageDigest(packages({ npm: ["a", "b"] }))).not.toBe(packageDigest(packages({ npm: ["b", "a"] })));
    expect(packageDigest(packages({ npm: ["a"] }))).not.toBe(packageDigest(packages({ pip: ["a"] })));
    expect(packageDigest(EMPTY)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("installEnvironment", () => {
  let dir: string;
  let prefix: string;
  let programs: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "environment-install-"));
    prefix = join(dir, "prefix");
    programs = join(dir, "programs");
    mkdirSync(programs);
    // The programs the managers need, as executables on the install's PATH; the stand-in runner never starts them.
    for (const program of ["apt-get", "cargo", "gem", "go", "npm", "python3", "setpriv"]) {
      writeFileSync(join(programs, program), "#!/bin/sh\nexit 0\n");
      chmodSync(join(programs, program), 0o755);
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const log = (): void => {};

  it("runs agent commands through setpriv with the agent's arguments, and apt as itself, each root program by its absolute path", async () => {
    const { run, calls } = recordingRunner();
    const identity = ownIdentity();
    const set = environment({ apt: ["jq"], npm: ["express"] });
    expect(await installEnvironment(set, { identity, prefix, env: { PATH: programs }, run, log })).toBe("installed");
    expect(calls.map((call) => call.argv)).toEqual([
      [join(programs, "apt-get"), "update"],
      [join(programs, "apt-get"), "install", "-y", "--no-install-recommends", "--", "jq"],
      [
        join(programs, "setpriv"),
        `--reuid=${identity.uid}`,
        `--regid=${identity.gid}`,
        "--clear-groups",
        "--inh-caps=-all",
        "--no-new-privs",
        "--",
        "npm",
        "install",
        "--global",
        "--prefix",
        prefix,
        "--no-fund",
        "--no-audit",
        "--",
        "express",
      ],
    ]);
    expect(calls[2]!.env["HOME"]).toBe(identity.home);
    // Root's own commands never see the agent's folders on their PATH.
    expect(calls[0]!.env["PATH"]).toBe(programs);
    expect(calls.every((call) => call.deadlineMs <= COMMAND_DEADLINE_MS)).toBe(true);
  });

  it("never runs, as root, a program the agent planted in its own folders", async () => {
    const { run, calls } = recordingRunner();
    const identity = ownIdentity();
    const planted = join(prefix, "bin");
    mkdirSync(planted, { recursive: true });
    for (const program of ["apt-get", "setpriv"]) {
      writeFileSync(join(planted, program), "#!/bin/sh\nexit 0\n");
      chmodSync(join(planted, program), 0o755);
    }
    await installEnvironment(environment({ apt: ["jq"], npm: ["express"] }), { identity, prefix, env: { PATH: programs }, run, log });
    const started = calls.map((call) => call.argv[0]!);
    expect(started).toEqual([join(programs, "apt-get"), join(programs, "apt-get"), join(programs, "setpriv")]);
    expect(started.some((program) => program.startsWith(prefix))).toBe(false);
    expect(calls[0]!.env["PATH"]!.split(delimiter)).not.toContain(planted);
  });

  it("runs commands as they are when the runner does not separate", async () => {
    const { run, calls } = recordingRunner();
    await installEnvironment(environment({ npm: ["express"] }), { identity: null, prefix, env: { PATH: programs }, run, log });
    expect(calls.map((call) => call.argv[0])).toEqual(["npm"]);
  });

  it("writes the set's digest, skips the same set after, and installs a changed one", async () => {
    const { run, calls } = recordingRunner();
    const deps = { identity: null, prefix, env: { PATH: programs }, run, log };
    const first = environment({ npm: ["express"], pip: ["sqlalchemy"] });
    expect(await installEnvironment(first, deps)).toBe("installed");
    // Beside the prefix, in its parent: never inside the agent's own folder.
    expect(readFileSync(`${prefix}.digest`, "utf8")).toBe(`${packageDigest(first.packages)}\n`);
    expect(readdirSync(prefix)).not.toContain(".digest");
    const ran = calls.length;
    expect(ran).toBe(3);

    expect(await installEnvironment(first, deps)).toBe("already-installed");
    expect(calls, "an installed set runs nothing").toHaveLength(ran);

    const changed = environment({ npm: ["express", "typescript"], pip: ["sqlalchemy"] });
    expect(await installEnvironment(changed, deps)).toBe("installed");
    expect(calls.length).toBeGreaterThan(ran);
    expect(readFileSync(`${prefix}.digest`, "utf8").trim()).toBe(packageDigest(changed.packages));
  });

  it("fails on a non-zero exit, naming the manager with its output's tail, and writes no digest", async () => {
    const { run, calls } = recordingRunner((argv) =>
      argv[0] === "npm" ? { exitCode: 1, timedOut: false, output: "npm ERR! 404 Not Found - express-nope" } : { exitCode: 0, timedOut: false, output: "" },
    );
    const failing = installEnvironment(environment({ cargo: ["ripgrep"], npm: ["express-nope"], pip: ["sqlalchemy"] }), { identity: null, prefix, env: { PATH: programs }, run, log });
    await expect(failing).rejects.toBeInstanceOf(EnvironmentInstallError);
    await expect(failing).rejects.toMatchObject({
      manager: "npm",
      message: "the environment's npm packages did not install: `npm install` exited 1\nnpm ERR! 404 Not Found - express-nope",
    });
    expect(calls.map((call) => call.argv[0]), "the managers after it never run").toEqual(["cargo", "npm"]);
    expect(existsSync(`${prefix}.digest`)).toBe(false);
  });

  it("names a command killed by its signal", async () => {
    const { run } = recordingRunner(() => ({ exitCode: null, timedOut: false, output: "" }));
    await expect(installEnvironment(environment({ gem: ["rails"] }), { identity: null, prefix, env: { PATH: programs }, run, log })).rejects.toThrow(
      "the environment's gem packages did not install: `gem install` exited on a signal",
    );
  });

  it("fails a command killed at its deadline, saying so", async () => {
    const { run } = recordingRunner(() => ({ exitCode: null, timedOut: true, output: "Compiling ripgrep v14.1.0" }));
    await expect(installEnvironment(environment({ cargo: ["ripgrep"] }), { identity: null, prefix, env: { PATH: programs }, run, log })).rejects.toMatchObject({
      manager: "cargo",
      message: "the environment's cargo packages did not install: `cargo install` was killed at its deadline\nCompiling ripgrep v14.1.0",
    });
  });

  it("fails before running a command once the install's deadline has passed", async () => {
    const { run, calls } = recordingRunner();
    // The deadline is read at the start; every later reading is 16 minutes on.
    let readings = 0;
    const now = (): number => (readings++ === 0 ? 0 : 16 * 60_000);
    await expect(installEnvironment(environment({ go: ["golang.org/x/tools/cmd/goimports@latest"] }), { identity: null, prefix, env: { PATH: programs }, run, now, log })).rejects.toMatchObject({
      manager: "go",
      message: "the environment's go packages did not install: the install passed its 15-minute deadline",
    });
    expect(calls).toEqual([]);
  });

  it("gives a command no more than the install's time left", async () => {
    const { run, calls } = recordingRunner();
    await installEnvironment(environment({ npm: ["express"] }), { identity: null, prefix, env: { PATH: programs }, run, now: () => 1_000, deadlineMs: 5_000, log });
    expect(calls[0]!.deadlineMs).toBe(5_000);
  });

  it("fails naming the remedy when the image lacks a manager's program", async () => {
    rmSync(join(programs, "python3"));
    const { run, calls } = recordingRunner();
    await expect(installEnvironment(environment({ pip: ["sqlalchemy"] }), { identity: null, prefix, env: { PATH: programs }, run, log })).rejects.toMatchObject({
      manager: "pip",
      message: "the environment's pip packages did not install: this sandbox's image has no python3; add python3-venv to the environment's apt packages, or use an image with Python",
    });
    await expect(installEnvironment(environment({ npm: ["express"] }), { identity: null, prefix, env: {}, run, log })).rejects.toThrow(
      "this sandbox's image has no npm; add npm to the environment's apt packages, or use an image with Node.js",
    );
    expect(calls).toEqual([]);
  });

  it("does not count a program that is not executable", async () => {
    chmodSync(join(programs, "cargo"), 0o644);
    const { run } = recordingRunner();
    await expect(installEnvironment(environment({ cargo: ["ripgrep"] }), { identity: null, prefix, env: { PATH: programs }, run, log })).rejects.toThrow("this sandbox's image has no cargo");
  });

  it("refuses apt on a runner that neither separates nor runs as root", async () => {
    const { run, calls } = recordingRunner();
    const installing = installEnvironment(environment({ apt: ["jq"] }), { identity: null, prefix, env: { PATH: programs }, run, log });
    if (process.getuid?.() === 0) {
      // A root runner that does not separate installs apt itself.
      await expect(installing).resolves.toBe("installed");
      return;
    }
    await expect(installing).rejects.toThrow(
      "the environment's apt packages did not install: apt packages install as root, and this runner does not run as root",
    );
    expect(calls).toEqual([]);
  });

  it("installs nothing for an empty set, and touches no prefix", async () => {
    const { run, calls } = recordingRunner();
    expect(await installEnvironment(environment({}), { identity: null, prefix, env: { PATH: programs }, run, log })).toBe("nothing");
    expect(calls).toEqual([]);
    expect(existsSync(prefix)).toBe(false);
  });

  it("logs each manager's time, and an install it skipped", async () => {
    const lines: string[] = [];
    const deps = { identity: null, prefix, env: { PATH: programs }, run: recordingRunner().run, log: (line: string) => lines.push(line) };
    await installEnvironment(environment({ npm: ["express", "typescript"] }), deps);
    await installEnvironment(environment({ npm: ["express", "typescript"] }), deps);
    expect(lines[0]).toMatch(/^\[environment\] npm: 2 package\(s\) installed in \d+ ms$/);
    expect(lines[1]).toMatch(/^\[environment\] packages already installed \([0-9a-f]{12}\)$/);
  });
});

describe("spawnCommand", () => {
  const env = { PATH: process.env["PATH"] ?? "/usr/bin:/bin" };

  it("reports a command's exit and its output", async () => {
    expect(await spawnCommand(["sh", "-c", "echo out; echo err >&2; exit 3"], env, 10_000)).toEqual({ exitCode: 3, timedOut: false, output: "out\nerr\n" });
  });

  it("kills a command past its deadline, and keeps its output's tail, bounded", async () => {
    // More than the tail holds, then a marker, then a sleep the deadline cuts short.
    const script = `i=0; while [ $i -lt 120 ]; do printf '%0100d' 0; i=$((i+1)); done; printf END; sleep 30`;
    const started = Date.now();
    const result = await spawnCommand(["sh", "-c", script], env, 500);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toHaveLength(OUTPUT_TAIL_BYTES);
    expect(result.output.endsWith("END")).toBe(true);
  });
});

describe("the boot's install", () => {
  let dir: string;
  let programs: string;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "environment-boot-"));
    programs = join(dir, "programs");
    mkdirSync(programs);
    writeFileSync(join(programs, "npm"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(programs, "npm"), 0o755);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    resetEnvironmentInstallForTests();
    consoleError.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const deps = (run: CommandRunner) => ({ identity: null, prefix: join(dir, "prefix"), env: { PATH: programs }, run, log: () => {} });
  const failingRun: CommandRunner = async () => ({ exitCode: 1, timedOut: false, output: "E404" });

  it("resolves at once when no install started", async () => {
    await expect(environmentInstalled()).resolves.toBeUndefined();
    startEnvironmentInstall(undefined, deps(failingRun));
    await expect(environmentInstalled()).resolves.toBeUndefined();
  });

  it("starts once: a second start is ignored", async () => {
    const first = recordingRunner();
    const second = recordingRunner();
    startEnvironmentInstall(environment({ npm: ["express"] }), deps(first.run));
    startEnvironmentInstall(environment({ npm: ["typescript"] }), deps(second.run));
    await expect(environmentInstalled()).resolves.toBeUndefined();
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toEqual([]);
  });

  it("keeps a failure for every turn that awaits it", async () => {
    startEnvironmentInstall(environment({ npm: ["express"] }), deps(failingRun));
    await expect(environmentInstalled()).rejects.toBeInstanceOf(EnvironmentInstallError);
    await expect(environmentInstalled()).rejects.toThrow("the environment's npm packages did not install: `npm install` exited 1\nE404");
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("[environment] the environment's npm packages did not install"));
  });

  it("never leaves an install no turn awaits as an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      startEnvironmentInstall(environment({ npm: ["express"] }), deps(failingRun));
      await new Promise((settle) => setTimeout(settle, 50));
      expect(unhandled).toEqual([]);
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
