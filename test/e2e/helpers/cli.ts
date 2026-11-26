// The CLI as a developer runs it, for a browser journey that meets it: the
// first Playwright helper to drive `stigmer` (test/install/smoke-cli-sign-in.mjs
// is the plain-node precedent). The terminal and the browser meet at one
// login page, so a journey needs both in one place.
//
// What it gives a spec:
//   - a scratch HOME (its own ~/.stigmer) and a working folder, so nothing
//     of the machine's own CLI configuration is read or written;
//   - `stigmer` on PATH as the build under test: this checkout's CLI from
//     source (`checkout`), or a published version installed from a
//     registry into the scratch folder (`registry`), as a developer installs
//     it;
//   - `BROWSER` set to a stand-in that hands every address the CLI opens to
//     the journey (appended to a file), which opens it in the person's own
//     browser context, so a login page sees the person's session and a
//     machine's real browser never opens;
//   - `line`: one command line run in bash as a page shows it, its browser
//     addresses answered by `onBrowser` while it runs;
//   - `terminal`: the same on a pseudo-terminal, for a command that signs
//     in only on an interactive terminal (`stigmer connect plugin`).

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { JourneyPackages } from "./first-hour/target";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const TSX = join(REPO_ROOT, "node_modules/.bin/tsx");
const CLI_ENTRY = join(REPO_ROOT, "client-apps/cli/src/cli/stigmer.ts");

/** The variables of the machine's own CLI and browser that a scratch person never inherits. */
const MACHINE_VARIABLES = ["STIGMER_SERVER_ADDRESS", "STIGMER_API_KEY", "STIGMER_ORG", "STIGMER_CONSOLE_URL", "BROWSER", "SSH_CONNECTION", "SSH_TTY"];

/** What a finished command printed and how it ended. */
export interface CliResult {
  readonly line: string;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Answers one address the CLI opened in a browser. */
export type BrowserHandler = (url: string) => Promise<void>;

export interface LineOptions {
  /** Where the line runs; the working folder by default. */
  readonly cwd?: string;
  /** Answers each address the line opens in a browser; without it an address fails the line. */
  readonly onBrowser?: BrowserHandler;
  readonly timeoutMs?: number;
  /** Extra variables for this line. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface JourneyCli {
  /** The person's scratch HOME. */
  readonly home: string;
  /** The folder the docs' files are written in and their commands run from. */
  readonly workDir: string;
  /** Runs one command line in bash, as a page shows it. */
  line(line: string, options?: LineOptions): Promise<CliResult>;
  /** Runs one command line on a pseudo-terminal: stdout and stderr arrive together, as `stdout`. */
  terminal(line: string, options?: LineOptions): Promise<CliResult>;
  /** Removes the scratch folders. */
  dispose(): void;
}

// The stand-in browser: appends the address it is asked to open to the file
// it names, one per line, and exits at once, as `open` does.
const HANDOFF = `import { appendFileSync } from "node:fs";
const [file, url] = process.argv.slice(2);
appendFileSync(file, url + "\\n");
`;

/** Makes the scratch person's CLI: HOME, working folder, `stigmer` on PATH, and the browser stand-in. */
export function journeyCli(packages: JourneyPackages): JourneyCli {
  const root = mkdtempSync(join(tmpdir(), "stigmer-first-hour-"));
  const home = join(root, "home");
  const workDir = join(root, "work");
  const bin = join(root, "bin");
  for (const dir of [home, workDir, bin]) mkdirSync(dir, { recursive: true });
  const handoff = join(root, "browser.mjs");
  writeFileSync(handoff, HANDOFF);
  const opened = join(root, "opened.txt");
  writeFileSync(opened, "");

  const stigmer = join(bin, "stigmer");
  if (packages.kind === "checkout") {
    writeFileSync(stigmer, `#!/bin/sh\nexec "${TSX}" "${CLI_ENTRY}" "$@"\n`);
    chmodSync(stigmer, 0o755);
  } else {
    const prefix = join(root, "cli");
    const install = spawnSync(
      "npm",
      ["install", "--global", "--prefix", prefix, `@stigmer/cli@${packages.version}`, ...(packages.registry === undefined ? [] : [`--@stigmer:registry=${packages.registry}`])],
      { encoding: "utf8", timeout: 300_000 },
    );
    if (install.status !== 0) throw new Error(`npm install @stigmer/cli@${packages.version} exited ${install.status}:\n${install.stderr}`);
    writeFileSync(stigmer, `#!/bin/sh\nexec "${join(prefix, "bin", "stigmer")}" "$@"\n`);
    chmodSync(stigmer, 0o755);
  }

  const baseEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const name of MACHINE_VARIABLES) delete baseEnv[name];
  Object.assign(baseEnv, {
    HOME: home,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    BROWSER: `"${process.execPath}" "${handoff}" "${opened}"`,
    NO_COLOR: "1",
  });

  let answered = 0;
  const run = async (argv: readonly string[], line: string, options: LineOptions): Promise<CliResult> => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: options.cwd ?? workDir,
      env: { ...baseEnv, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    let status: number | null | undefined;
    const exited = new Promise<void>((resolveExit) =>
      child.on("exit", (code) => {
        status = code;
        resolveExit();
      }),
    );
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    let failure: unknown;
    while (status === undefined && failure === undefined) {
      const addresses = readFileSync(opened, "utf8").split("\n").filter((url) => url !== "");
      for (const url of addresses.slice(answered)) {
        answered += 1;
        if (options.onBrowser === undefined) {
          failure = new Error(`\`${line}\` opened a browser at ${url}, which this step does not expect`);
          break;
        }
        try {
          await options.onBrowser(url);
        } catch (error) {
          failure = error;
          break;
        }
      }
      if (Date.now() > deadline) failure = new Error(`\`${line}\` did not finish within ${options.timeoutMs ?? 120_000} ms`);
      if (failure === undefined) await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 250))]);
    }
    if (failure !== undefined) {
      if (child.pid !== undefined && status === undefined) process.kill(-child.pid, "SIGTERM");
      await exited;
      throw new Error(`${failure instanceof Error ? failure.message : String(failure)}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    return { line, status: status ?? null, stdout, stderr };
  };

  return {
    home,
    workDir,
    line: (line, options = {}) => run(["bash", "-c", line], line, options),
    terminal: (line, options = {}) => run(onTerminal(line), line, options),
    dispose: () => {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * `line` on a pseudo-terminal through `script`, whose flags differ: BSD's
 * (macOS) takes the command as arguments, util-linux's (the Gate's runners)
 * takes it with `-c` and needs `-e` to exit with the command's status.
 */
export function onTerminal(line: string, platform: NodeJS.Platform = process.platform): string[] {
  return platform === "darwin"
    ? ["script", "-q", "/dev/null", "bash", "-c", line]
    : ["script", "-q", "-e", "-c", `bash -c '${line.replaceAll("'", `'\\''`)}'`, "/dev/null"];
}
