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
//
// The same Vite app and processes serve a second reader: a builder who copies
// what the console's "In your app" tab hands over (`runHandedOverApp`). A
// third is that builder on Next.js (`runHandedOverNextApp`): a stock
// create-next-app, the handed-over files at the paths the tab names, and the
// settings file it hands over, with nothing set in the environment.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Page } from "@playwright/test";
// @ts-expect-error -- plain Node module without types, shared with the getting-started smoke
import { docSteps } from "../../install/lib/doc-steps.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const PAGE = join(REPO_ROOT, "docs/getting-started/embed-agent.mdx");
/** The ports the page's backend and Vite listen on. */
export const BACKEND_PORT = 3001;
export const APP_PORT = 5173;
/** The port the handed-over Next.js app listens on, beside the console's. */
export const NEXT_APP_PORT = 3100;
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

/** The version this repository locks for `name`, from the root's packages or a workspace member's own. */
function locked(name: string, from = ""): string {
  return (JSON.parse(readFileSync(join(REPO_ROOT, from, "node_modules", name, "package.json"), "utf8")) as { version: string }).version;
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

/** What the console's "In your app" tab handed over, as read from its code blocks. */
export interface HandedOver {
  /** The Node token route, `server.ts`. */
  readonly route: string;
  /** The chat, `src/StigmerAgentChat.tsx`. */
  readonly chat: string;
  /** The page that tries it, `src/App.tsx`. */
  readonly page: string;
  /** The settings file, `.env`, as the tab held it with the key on screen. */
  readonly settings: string;
}

/** The command a handed-over route's own comment says to run it with. */
export function runLineOf(route: string): string {
  const line = /Run it with: (.+)$/m.exec(route)?.[1]?.trim();
  if (line === undefined) throw new Error("the handed-over route names no run line");
  return line;
}

/**
 * Builds a Vite React app from exactly the text the console handed over (the
 * route as `server.ts` beside it, the chat as `src/StigmerAgentChat.tsx`,
 * mounted by the page it hands over to try it, `src/App.tsx`), installs the
 * kit this checkout packs, checks it builds and typechecks (strict), and
 * starts the route with the line its own comment names, reading the
 * handed-over `.env` and nothing from the environment, and the app, with
 * the app's `/api` proxied to the route as the tab says. The settings'
 * development user is `devUser`: the person the run signs in, as a builder
 * names the one they try their app as.
 */
export async function runHandedOverApp(
  folder: string,
  tarballs: readonly string[],
  handedOver: HandedOver,
  env: { readonly devUser: string },
): Promise<TutorialRun> {
  const appDir = join(folder, "my-app");
  viteApp(appDir);
  const shellEnv: NodeJS.ProcessEnv = { ...process.env, npm_config_yes: "true" };
  delete shellEnv.STIGMER_API_KEY;
  delete shellEnv.STIGMER_DEV_USER;
  const files: Record<string, string> = {
    ".env": handedOver.settings.replace(/^STIGMER_DEV_USER=.*$/m, `STIGMER_DEV_USER=${env.devUser}`),
    "server.ts": handedOver.route,
    "src/StigmerAgentChat.tsx": handedOver.chat,
    "src/App.tsx": handedOver.page,
    "vite.config.ts": `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { proxy: { "/api": "http://localhost:${BACKEND_PORT}" } },\n});\n`,
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(appDir, path)), { recursive: true });
    writeFileSync(join(appDir, path), content);
  }
  const running: ChildProcess[] = [];
  const stop = () => {
    for (const child of running) stopGroup(child);
  };
  try {
    run("npm install", appDir, shellEnv);
    run(`npm install ${[...tarballs, "@bufbuild/protobuf"].map((arg) => JSON.stringify(arg)).join(" ")}`, appDir, shellEnv);
    run("npm run build", appDir, shellEnv);
    running.push(await background(runLineOf(handedOver.route), appDir, shellEnv, BACKEND_PORT));
    running.push(await background("npm run dev", appDir, shellEnv, APP_PORT));
  } catch (error) {
    stop();
    throw error;
  }
  return { appDir, stop };
}

/**
 * The files a stock `create-next-app` (TypeScript, App Router, no Tailwind,
 * no ESLint, no `src` folder) writes that the run keeps, at the versions this
 * repository locks: its stylesheet as the template ships it, light with a
 * near-black page and light text when the system is dark, and its layout
 * without `next/font`, whose font download would make the run depend on the
 * network.
 */
function nextApp(dir: string): void {
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify(
      {
        name: "my-next-app",
        version: "0.1.0",
        private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { next: locked("next", "client-apps/web"), react: locked("react"), "react-dom": locked("react-dom") },
        devDependencies: {
          typescript: `^${locked("typescript")}`,
          "@types/node": `^${locked("@types/node")}`,
          "@types/react": `^${locked("@types/react")}`,
          "@types/react-dom": `^${locked("@types/react-dom")}`,
        },
      },
      null,
      2,
    )}\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"],
      },
      null,
      2,
    )}\n`,
    "next-env.d.ts": '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
    "next.config.ts": 'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n',
    "app/globals.css": CREATE_NEXT_APP_GLOBALS,
    "app/layout.tsx":
      'import type { Metadata } from "next";\nimport "./globals.css";\n\nexport const metadata: Metadata = {\n  title: "Create Next App",\n  description: "Generated by create next app",\n};\n\nexport default function RootLayout({\n  children,\n}: Readonly<{\n  children: React.ReactNode;\n}>) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}\n',
    "app/page.tsx": "export default function Home() {\n  return <main>Home</main>;\n}\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

/** `create-next-app`'s `app/globals.css` without Tailwind, as the template ships it. */
export const CREATE_NEXT_APP_GLOBALS = `:root {
  --background: #ffffff;
  --foreground: #171717;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
  }
}

html,
body {
  max-width: 100vw;
  overflow-x: hidden;
}

body {
  color: var(--foreground);
  background: var(--background);
  font-family: Arial, Helvetica, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

a {
  color: inherit;
  text-decoration: none;
}

@media (prefers-color-scheme: dark) {
  html {
    color-scheme: dark;
  }
}
`;

/** The one install line the tab hands a Next.js app; the run installs the same packages from this checkout. */
export const NEXT_APP_INSTALL = "npm install @stigmer/client @stigmer/react-sdk @stigmer/apis @bufbuild/protobuf";

/**
 * Builds a stock Next.js app from exactly what the console handed over:
 * every file at the path the tab names it by (the route, the chat, the page
 * that tries it, and the settings file `.env.local` holding the key and the
 * development user), with nothing about Stigmer in the environment, so the
 * app runs on what the settings file says. Installs what the one install
 * line names, from the kit, client and stubs this checkout packs; checks it
 * builds and typechecks (strict); and starts it on {@link NEXT_APP_PORT}.
 */
export async function runHandedOverNextApp(
  folder: string,
  tarballs: readonly string[],
  install: string,
  files: Readonly<Record<string, string>>,
): Promise<TutorialRun> {
  if (install !== NEXT_APP_INSTALL) throw new Error(`the tab's install line changed: ${install}`);
  const appDir = join(folder, "my-next-app");
  nextApp(appDir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(appDir, path)), { recursive: true });
    writeFileSync(join(appDir, path), content);
  }
  const shellEnv: NodeJS.ProcessEnv = { ...process.env, npm_config_yes: "true", NEXT_TELEMETRY_DISABLED: "1" };
  delete shellEnv.STIGMER_API_KEY;
  delete shellEnv.STIGMER_DEV_USER;
  const running: ChildProcess[] = [];
  const stop = () => {
    for (const child of running) stopGroup(child);
  };
  try {
    run("npm install", appDir, shellEnv);
    run(`npm install ${[...tarballs, "@bufbuild/protobuf"].map((arg) => JSON.stringify(arg)).join(" ")}`, appDir, shellEnv);
    run("npm run build", appDir, shellEnv);
    running.push(await background(`npx next start -p ${NEXT_APP_PORT}`, appDir, shellEnv, NEXT_APP_PORT));
  } catch (error) {
    stop();
    throw error;
  }
  return { appDir, stop };
}

/**
 * The WCAG contrast of the first element whose own text starts with `text`
 * against what is painted behind it: every ancestor's background, from the
 * root down, composited on one canvas pixel, so any colour syntax the
 * browser computes resolves as on screen.
 */
export async function contrastOf(page: Page, text: string): Promise<number> {
  return page.evaluate((wanted) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let element: HTMLElement | null = null;
    for (let node = walker.nextNode(); node !== null && element === null; node = walker.nextNode()) {
      if ((node.textContent ?? "").trim().startsWith(wanted)) element = node.parentElement;
    }
    if (element === null) throw new Error(`no text starts with ${wanted}`);
    const layers: string[] = [];
    for (let at: Element | null = element; at !== null; at = at.parentElement) layers.unshift(getComputedStyle(at).backgroundColor);
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    context.canvas.width = 1;
    context.canvas.height = 1;
    const paint = (stack: readonly string[]): [number, number, number] => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 1, 1);
      for (const layer of stack) {
        context.fillStyle = layer;
        context.fillRect(0, 0, 1, 1);
      }
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!];
    };
    const luminance = (rgb: readonly number[]) => {
      const [r, g, b] = rgb.map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const fore = luminance(paint([...layers, getComputedStyle(element).color]));
    const back = luminance(paint(layers));
    return (Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05);
  }, text);
}
