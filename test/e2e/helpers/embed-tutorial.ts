// The reader's side of docs/getting-started/embed-agent.mdx: its steps run as
// the page shows them, in a fresh folder, read from the page itself through
// test/install/lib/doc-steps.mjs, so there is no copy of the page here to
// keep in step.
//
// The lines the page names as the install's (doc-steps.mjs HARNESS_LINES)
// the harness performs its own way:
//   - "vite-app": the Vite React app the page makes with `npm create vite`,
//     written from the template's files at the versions this repository
//     locks, so the run never depends on what `create-vite@latest` is today;
//   - "react-sdk": the page's install line, from the kit, client and stubs
//     this checkout packs (scripts/publish-libs.mjs --pack-dir, prebuilt);
//   - "backend" and "dev-server": the page's two long-running commands,
//     started in the background with the page's environment, and stopped
//     when the run ends.
// Every other line runs in bash as written, `cd` carried to the next.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
// @ts-expect-error -- plain Node module without types, shared with the getting-started smoke
import { docSteps } from "../../install/lib/doc-steps.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const PAGE = join(REPO_ROOT, "docs/getting-started/embed-agent.mdx");
/** The ports the page's backend and Vite listen on. */
export const BACKEND_PORT = 3001;
export const APP_PORT = 5173;
/** Never a published version: the tarballs are this checkout's. */
const PACKED_VERSION = "0.0.0-embed-tutorial";

type Step =
  | { readonly kind: "file"; readonly path: string; readonly content: string }
  | { readonly kind: "command"; readonly line: string }
  | { readonly kind: "harness"; readonly line: string; readonly performs: string };

/** The page's steps, in order. */
export function tutorialSteps(): readonly Step[] {
  return docSteps(readFileSync(PAGE, "utf8")) as Step[];
}

/** A file the page's agent and ledger come from: the quickstart's own. */
export function quickstartFile(name: string): string {
  const steps = docSteps(readFileSync(join(REPO_ROOT, "docs/getting-started/quickstart.mdx"), "utf8")) as Step[];
  const file = steps.find((step): step is Extract<Step, { kind: "file" }> => step.kind === "file" && step.path === name);
  if (file === undefined) throw new Error(`the quickstart has no ${name}`);
  return file.content;
}

/** Packs the kit's install closure from the prebuilt libraries; returns the tarballs. */
export function packKit(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const packed = spawnSync(
    process.execPath,
    [join(REPO_ROOT, "scripts/publish-libs.mjs"), "--version", PACKED_VERSION, "--skip-build", "--pack-dir", dir, "--only", "@stigmer/react-sdk"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (packed.status !== 0) throw new Error(`publish-libs.mjs --pack-dir exited ${packed.status}:\n${packed.stderr}${packed.stdout}`);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".tgz"))
    .map((name) => join(dir, name));
}

/** The version this repository locks for `name`. */
function locked(name: string): string {
  return (JSON.parse(readFileSync(join(REPO_ROOT, "node_modules", name, "package.json"), "utf8")) as { version: string }).version;
}

/** The files `npm create vite -- --template react-ts` writes that the page keeps. */
function viteApp(dir: string): void {
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify(
      {
        name: "my-app",
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: { dev: "vite", build: "tsc -b && vite build" },
        dependencies: { react: `^${locked("react")}`, "react-dom": `^${locked("react-dom")}` },
        devDependencies: {
          "@types/react": `^${locked("@types/react")}`,
          "@types/react-dom": `^${locked("@types/react-dom")}`,
          "@vitejs/plugin-react": `^${locked("@vitejs/plugin-react")}`,
          typescript: `~${locked("typescript")}`,
          vite: `^${locked("vite")}`,
        },
      },
      null,
      2,
    )}\n`,
    "index.html":
      '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>my-app</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
    "src/main.tsx":
      'import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App.tsx";\n\ncreateRoot(document.getElementById("root")!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);\n',
    "src/App.tsx": "export default function App() {\n  return null;\n}\n",
    "src/vite-env.d.ts": '/// <reference types="vite/client" />\n',
    "tsconfig.json": `${JSON.stringify(
      { files: [], references: [{ path: "./tsconfig.app.json" }] },
      null,
      2,
    )}\n`,
    "tsconfig.app.json": `${JSON.stringify(
      {
        compilerOptions: {
          tsBuildInfoFile: "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          skipLibCheck: true,
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          verbatimModuleSyntax: true,
          moduleDetection: "force",
          noEmit: true,
          jsx: "react-jsx",
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

/** What the page's environment holds while its steps run. */
export interface TutorialEnv {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly org: string;
}

/** A run of the page: its folder, and the processes it left running. */
export interface TutorialRun {
  readonly appDir: string;
  stop(): void;
}

function run(line: string, cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync("bash", ["-c", line], { cwd, env, encoding: "utf8", timeout: 600_000 });
  if (result.status !== 0) {
    throw new Error(`the page's command failed (exit ${result.status}): ${line}\n${result.stderr}${result.stdout}`);
  }
}

/**
 * Whether `localhost:port` answers HTTP, as the reader's browser reaches it:
 * Vite listens on `localhost`, which can be IPv6 alone.
 */
async function answers(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

/** Stops a background line and everything it started. */
function stopGroup(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

/** Starts a long-running command and resolves once `port` answers. */
async function background(line: string, cwd: string, env: NodeJS.ProcessEnv, port: number): Promise<ChildProcess> {
  // Its own process group, so stopping it stops what the line started (npm's child, tsx's).
  const child = spawn("bash", ["-c", line], { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  let exited: number | null | undefined;
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.on("exit", (code) => (exited = code));
  const deadline = Date.now() + 120_000;
  while (!(await answers(port))) {
    if (exited !== undefined) throw new Error(`the page's command exited ${exited} before it listened on :${port}: ${line}\n${output}`);
    if (Date.now() > deadline) {
      stopGroup(child);
      throw new Error(`the page's command never listened on :${port}: ${line}\n${output}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  return child;
}

/**
 * Runs the page in `folder` against the stack in `env`, up to its two
 * servers running, and checks the app the page made builds and typechecks
 * (strict) as written.
 */
export async function runTutorial(folder: string, tarballs: readonly string[], env: TutorialEnv): Promise<TutorialRun> {
  const shellEnv: NodeJS.ProcessEnv = {
    ...process.env,
    STIGMER_API_KEY: env.apiKey,
    STIGMER_ORG: env.org,
    // "For a server of your own, set STIGMER_URL and VITE_STIGMER_URL to its address."
    STIGMER_URL: env.apiUrl,
    VITE_STIGMER_URL: env.apiUrl,
    npm_config_yes: "true",
  };
  const running: ChildProcess[] = [];
  const stop = () => {
    for (const child of running) stopGroup(child);
  };
  let cwd = folder;
  try {
    for (const step of tutorialSteps()) {
      if (step.kind === "file") {
        mkdirSync(dirname(join(cwd, step.path)), { recursive: true });
        writeFileSync(join(cwd, step.path), step.content);
      } else if (step.kind === "command") {
        const cd = /^cd\s+(\S+)$/.exec(step.line);
        if (cd) cwd = join(cwd, cd[1]!);
        else run(step.line, cwd, shellEnv);
      } else if (step.performs === "vite-app") {
        viteApp(join(cwd, "my-app"));
      } else if (step.performs === "react-sdk") {
        run(`npm install ${[...tarballs, "@bufbuild/protobuf"].map((arg) => JSON.stringify(arg)).join(" ")}`, cwd, shellEnv);
      } else if (step.performs === "backend") {
        running.push(await background(step.line, cwd, shellEnv, BACKEND_PORT));
      } else if (step.performs === "dev-server") {
        // The app as the page leaves it builds, its strict typecheck included.
        run("npm run build", cwd, shellEnv);
        running.push(await background(step.line, cwd, shellEnv, APP_PORT));
      } else {
        throw new Error(`the page names a harness line this run does not perform: ${step.line}`);
      }
    }
  } catch (error) {
    stop();
    throw error;
  }
  return { appDir: cwd, stop };
}
