// The reader's side of docs/getting-started/embed-agent.mdx, and of the pages
// that build on its app (make-the-chat-your-own.mdx): their steps run as the
// pages show them, in one fresh folder, read from the pages themselves through
// test/install/lib/doc-steps.mjs, so there is no copy of a page here to keep
// in step. A reader who does two pages starts the servers once, from the last
// page's run step, so the strict build covers every page's files.
//
// The lines the page names as the install's (doc-steps.mjs HARNESS_LINES)
// the harness performs its own way:
//   - "vite-app": the Vite React app the page makes with `npm create vite`,
//     written from the template's files at the versions this repository
//     locks, so the run never depends on what `create-vite@latest` is today;
//   - "react-sdk": the page's install line, its @stigmer/* packages from the
//     kit, client and stubs this checkout packs (scripts/publish-libs.mjs
//     --pack-dir, prebuilt) and the rest of the line from the registry
//     (`registryPackagesOf`), as the reader's npm would;
//   - "backend" and "dev-server": the page's two long-running commands,
//     started in the background with the page's environment, and stopped
//     when the run ends; from the last page of a run only.
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
import { expect, type Page } from "@playwright/test";
import { create } from "@bufbuild/protobuf";
import { parseManifest } from "@stigmer/client";
import { createNodeClient } from "@stigmer/client/node";
import { CreateServiceAccountInputSchema, ListServiceAccountsInputSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/io_pb";
import { CreateServiceAccountKeyInputSchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/io_pb";
import {
  ListMyOrganizationsInputSchema,
  UpdateOrganizationEmbeddingInputSchema,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
// @ts-expect-error -- plain Node module without types, shared with the getting-started smoke
import { docSteps, registryPackagesOf } from "../../install/lib/doc-steps.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
/** The embedding tutorial, the page every run starts from. */
export const EMBED_PAGE = join(REPO_ROOT, "docs/getting-started/embed-agent.mdx");
/** The page that makes the tutorial's chat the reader's own, on the same app. */
export const MAKE_IT_YOURS_PAGE = join(REPO_ROOT, "docs/getting-started/make-the-chat-your-own.mdx");
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

/** A page's steps, in order. */
export function tutorialSteps(page = EMBED_PAGE): readonly Step[] {
  return docSteps(readFileSync(page, "utf8")) as Step[];
}

/** The page's lines that start a server the reader leaves running. */
const LONG_RUNNING = new Set(["backend", "dev-server"]);

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

/** A host app's stylesheet as its tool writes it, from test/fixtures/host-styles. */
function hostStyle(name: string): string {
  return readFileSync(join(REPO_ROOT, "test/fixtures/host-styles", name), "utf8");
}

/** The version this repository locks for `name`, from the root's packages or a workspace member's own. */
function locked(name: string, from = ""): string {
  return (JSON.parse(readFileSync(join(REPO_ROOT, from, "node_modules", name, "package.json"), "utf8")) as { version: string }).version;
}

/**
 * The files `npm create vite -- --template react-ts` writes that the page
 * keeps, its stylesheet and the line that imports it included: the page
 * replaces only `src/App.tsx`, so the reader's app still carries the
 * template's `src/index.css` (vendored with its version in
 * test/fixtures/host-styles), and the chat is drawn under it.
 */
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
      'import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport "./index.css";\nimport App from "./App.tsx";\n\ncreateRoot(document.getElementById("root")!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);\n',
    "src/index.css": hostStyle("create-vite-9.4.0.css"),
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
 * The @stigmer/* packages an app installs: this checkout's tarballs, or a
 * published version from a registry, as a reader of a deployed Stigmer
 * installs them (the first-hour journey's deployed target).
 */
export type Kit = readonly string[] | { readonly version: string; readonly registry?: string };

/**
 * Installs what the `npm install` lines name: their @stigmer/* packages from
 * the kit (this checkout's tarballs, or each named package at the published
 * version), the rest from the registry as the reader's npm would
 * (`registryPackagesOf`), so a line that names one more package needs no
 * edit here.
 */
function installAsLine(kit: Kit, lines: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const registry = [...new Set(lines.flatMap((line) => registryPackagesOf(line) as string[]))];
  const stigmer = Array.isArray(kit)
    ? (kit as readonly string[])
    : [...new Set(lines.flatMap((line) => line.split(/\s+/).filter((word) => word.startsWith("@stigmer/"))))].map(
        (name) => `${name}@${(kit as { version: string }).version}`,
      );
  const from = Array.isArray(kit) || (kit as { registry?: string }).registry === undefined ? "" : ` --@stigmer:registry=${(kit as { registry: string }).registry}`;
  run(`npm install${from} ${[...stigmer, ...registry].map((arg) => JSON.stringify(arg)).join(" ")}`, cwd, env);
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
 * Runs `pages` in order in `folder` against the stack in `env`, up to the
 * last page's two servers running, and checks the app the pages made builds
 * and typechecks (strict) as written. `cd` carries from page to page, and an
 * earlier page's servers are not started: the reader starts them once, as
 * the last page says, so the build sees every page's files.
 */
export async function runTutorial(
  folder: string,
  tarballs: Kit,
  env: TutorialEnv,
  pages: readonly string[] = [EMBED_PAGE],
): Promise<TutorialRun> {
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
    const steps = pages.flatMap((page, at) =>
      tutorialSteps(page).filter((step) => at === pages.length - 1 || step.kind !== "harness" || !LONG_RUNNING.has(step.performs)),
    );
    for (const step of steps) {
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
        installAsLine(tarballs, [step.line], cwd, shellEnv);
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

/** What the earlier pages left a reader of the embedding tutorial: their Organization and the service account's key. */
export interface Reader {
  readonly org: string;
  readonly apiKey: string;
}

/** Signs in to the console as the issuer's person and returns the bearer its RPCs carry to `apiPort`. */
export async function ownerBearer(page: Page, apiPort: string): Promise<string> {
  let bearer: string | undefined;
  page.on("request", (request) => {
    const authorization = request.headers()["authorization"];
    if (new URL(request.url()).port === apiPort && authorization?.startsWith("Bearer ")) bearer = authorization.slice(7);
  });
  await page.goto("/");
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => bearer, { timeout: 15_000 }).toBeDefined();
  return bearer!;
}

/**
 * The state the embedding tutorial's earlier pages leave, made through the
 * API as the console's signed-in owner (`page` is a console page): the
 * quickstart's Agent applied from its file, the `report-backend` service
 * account and a key of its own, and account creation turned on in the
 * embedding settings with the member role. A second reader in the same run
 * finds the account the first made (a name is the organization's once) and
 * gets a key of their own for it, named `keyName` (a key's name is its
 * owner's once).
 */
export async function prepareReader(page: Page, apiUrl: string, keyName = "report-backend"): Promise<Reader> {
  const bearer = await ownerBearer(page, new URL(apiUrl).port);
  const owner = createNodeClient({ baseUrl: apiUrl, getAccessToken: () => bearer });
  const [org] = (await owner.organization.listMine(create(ListMyOrganizationsInputSchema, {}))).entries;
  const orgSlug = org?.metadata?.slug ?? "";
  expect(orgSlug, "the server made its one organization").not.toBe("");
  for (const document of parseManifest(quickstartFile("variance-reporter.yaml").replace("metadata:\n", `metadata:\n  org: ${orgSlug}\n`))) {
    await owner.manifest.apply(document);
  }
  const made = (await owner.identityAccount.listServiceAccounts(create(ListServiceAccountsInputSchema, { org: orgSlug, pageSize: 100 }))).entries;
  const account =
    made.find((entry) => entry.metadata?.name === "report-backend") ??
    (await owner.identityAccount.createServiceAccount(
      create(CreateServiceAccountInputSchema, { org: orgSlug, name: "report-backend", role: IamRole.admin }),
    ));
  const key = await owner.apiKey.createForServiceAccount(
    create(CreateServiceAccountKeyInputSchema, { serviceAccountId: account.metadata?.id ?? "", name: keyName, neverExpires: true }),
  );
  await owner.organization.updateEmbedding(
    create(UpdateOrganizationEmbeddingInputSchema, {
      orgId: orgSlug,
      embedding: { createAccountsOnSignIn: true, signInRole: IamRole.member },
    }),
  );
  return { org: orgSlug, apiKey: key.spec?.keyHash ?? "" };
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
  /** The install lines the tab names for the route and for the chat's React app. */
  readonly installs: { readonly route: string; readonly chat: string };
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
 * mounted by the page it hands over to try it, `src/App.tsx`), installs what
 * the route's and the chat's install lines name (one folder holds both), from
 * the kit this checkout packs and the registry, checks it builds and typechecks (strict), and
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
    installAsLine(tarballs, [handedOver.installs.route, handedOver.installs.chat], appDir, shellEnv);
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

/** `create-next-app`'s `app/globals.css` without Tailwind, as the template ships it (test/fixtures/host-styles). */
export const CREATE_NEXT_APP_GLOBALS = hostStyle("create-next-app.css");

/** The one install line the tab hands a Next.js app; the run installs the same packages from this checkout. */
export const NEXT_APP_INSTALL = "npm install @stigmer/client @stigmer/react-sdk @stigmer/apis @bufbuild/protobuf @connectrpc/connect-node";

/**
 * Builds a stock Next.js app from exactly what the console handed over:
 * every file at the path the tab names it by (the route, the chat, the page
 * that tries it, and the settings file `.env.local` holding the key and the
 * development user), with nothing about Stigmer in the environment, so the
 * app runs on what the settings file says. Installs what the one install
 * line names, its @stigmer/* packages from the kit, client and stubs this
 * checkout packs and the rest from the registry; checks it
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
    installAsLine(tarballs, [install], appDir, shellEnv);
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
