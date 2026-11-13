#!/usr/bin/env node

/**
 * The coding-agent door, end to end: the prompt the console hands a person,
 * pasted into a real coding agent in a clean scratch app, ends with an agent
 * made, run once, and its chat on the app's own page (the UX bar's CLI-18).
 *
 * It needs a coding agent signed in to its own model, so it runs by hand,
 * never in CI (`make door-coding-agent`); what it rests on is held in CI by
 * the CLI's own suites (the commands, the guide's drift test, the sign-in
 * smoke). The release walk reruns it.
 *
 * The stage, all on this machine and hermetic on Stigmer's side:
 *   - test/support's hermetic issuer, and a server from the built shipped
 *     entry that signs its callers in through it and announces a native
 *     client (so `stigmer auth login` finds it), with Temporal and a runner
 *     whose model is test/support's fake (lib/fake-model.mjs): the agent's
 *     first run saves a scripted file, and every later turn (the chat in the
 *     app) gets the fake's default reply;
 *   - the CLI from this checkout behind a `stigmer` on PATH that runs it with
 *     a scratch HOME (its config lives under HOME, with no other override)
 *     and a stand-in `BROWSER` that follows the authorize address, so the
 *     issuer's auto-consent finishes the sign-in; npm's global prefix is a
 *     scratch folder too, so an install the coding agent makes lands there;
 *   - a scratch Next.js app with its own stand-in sign-in (a cookie read by
 *     `getSession()` in lib/session.ts), committed to a fresh git repository.
 *
 * The coding agent is Claude Code (`claude -p`, stream-json kept): given
 * exactly the console's prompt (the shared words plus "Use the Stigmer at
 * <address>."), with its tools granted as a person would allow them, and
 * answered "yes, go ahead" whenever it stops to ask, up to a bound. Its own
 * sign-in and settings are the person's; nothing of their Stigmer config is
 * read or written, and the user-level settings and MCP servers are left out
 * (`--setting-sources project`, `--strict-mcp-config`).
 *
 * Pass when: the CLI signed in (the scratch config keeps the issuer); a
 * manifest is under stigmer/ and its agent exists on the server; one run's
 * file is in stigmer-output/, which .gitignore names; the env file holds
 * STIGMER_API_KEY and no line of the stream shows it; the token route and
 * the chat are in the app, the route reading the app's own session; and a
 * browser signs in through the app's stand-in, opens the page, sends a
 * message and gets the fake's reply in the chat. The app's Stigmer packages
 * are the ones packed from this checkout (the registry's may predate the
 * handover), installed before the browser step.
 *
 * With `--local`, the server trusts every caller, as `stigmer up` does: the
 * guide skips signing in, the key and the service account, and hands over the
 * development chat alone. Pass then needs no sign-in, no key and no route;
 * the manifest, the run's file and the chat answering on the page are the
 * same.
 *
 * Usage:
 *   node test/install/coding-agent-door.mjs [--local] [--keep] [--max-turns=<n>]
 *   --local           a server that trusts every caller (the development chat)
 *   --keep            keep the scratch folder (app, stream, CLI home)
 *   --max-turns=<n>   how many times to answer the coding agent (default 8)
 * Needs `claude` signed in, and `make build-server build-runner build-libs`.
 */

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { anthropicText, anthropicToolUse } from "../support/src/llm-wire.ts";
import { startLocalOidcIssuer } from "../support/src/local-oidc-issuer.ts";
import { runnerEntryPath } from "../support/src/runner-build.ts";
import { spawnRunner } from "../support/src/runner-process.ts";
import { spawnServer } from "../support/src/server-process.ts";
import { spawnTemporal } from "../support/src/temporal.ts";
import { tsServerEntryPath } from "../support/src/ts-build.ts";
import { FAKE_MODEL_REPLY_TEXT, fakeModelEnv, isTitleCall, startFakeModel } from "./lib/fake-model.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliEntry = join(repoRoot, "client-apps", "cli", "src", "cli", "stigmer.ts");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const AUDIENCE = "https://door.stigmer.test/api";
const NATIVE_CLIENT = "stigmer-door";
/** The console's prompt, as sdk/react's first question writes it (CODING_AGENT_PROMPT). */
export const PROMPT =
  "Set up Stigmer for this project. Install its command line (`npm install -g @stigmer/cli`, or `brew install stigmer/tap/stigmer`), run `stigmer coding-agent`, and follow what it prints.";
const ANSWER = "Yes, go ahead with what you suggest. I'm happy with your choices; keep going until the chat is on the page.";
const DOOR_FILE = "door-report.md";

const FOLLOWER = `
const [url] = process.argv.slice(2);
const authorize = await fetch(url, { redirect: "manual" });
const location = authorize.headers.get("location");
if (location !== null) await fetch(location);
`;

function log(step) {
  process.stdout.write(`coding-agent-door: ${step}\n`);
}

function parseArgs() {
  const out = { keep: false, local: false, maxTurns: 8 };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--keep") out.keep = true;
    else if (arg === "--local") out.local = true;
    else if (arg.startsWith("--max-turns=")) out.maxTurns = Number(arg.slice("--max-turns=".length));
    else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

/** The scratch app: an invoicing product with its own stand-in sign-in. */
function writeApp(dir) {
  const files = {
    "package.json": JSON.stringify(
      {
        name: "ledgerly",
        private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { next: "15.5.4", react: "19.1.1", "react-dom": "19.1.1" },
        devDependencies: { typescript: "5.9.3", "@types/react": "19.1.13", "@types/node": "22.18.6" },
      },
      null,
      2,
    ),
    "README.md":
      "# Ledgerly\n\nInvoicing for small wholesalers. Customers upload purchase orders and supplier invoices; Ledgerly matches them and pays the ones that agree.\n\n- `app/invoices`: the invoices page, where a customer reviews what came in.\n- `lib/session.ts`: who is signed in (`getSession()`).\n",
    ".gitignore": "node_modules\n.next\n.env*.local\n",
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["dom", "dom.iterable", "esnext"],
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          jsx: "preserve",
          noEmit: true,
          esModuleInterop: true,
          skipLibCheck: true,
          incremental: true,
          resolveJsonModule: true,
          isolatedModules: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"],
      },
      null,
      2,
    ),
    "lib/session.ts": `import { cookies } from "next/headers";

/** Who is signed in to Ledgerly: the demo sign-in keeps the person in a cookie. */
export interface Session {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export async function getSession(): Promise<Session | null> {
  const value = (await cookies()).get("ledgerly_user")?.value;
  if (value === undefined || value === "") return null;
  return { userId: \`user-\${value}\`, email: \`\${value}@ledgerly.test\`, name: value };
}
`,
    "app/layout.tsx": `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    "app/page.tsx": `import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Ledgerly</h1>
      <p>
        <Link href="/invoices">Invoices</Link>
      </p>
    </main>
  );
}
`,
    "app/invoices/page.tsx": `import { getSession } from "@/lib/session";

export default async function InvoicesPage() {
  const session = await getSession();
  return (
    <main>
      <h1>Invoices</h1>
      <p>{session === null ? "Sign in at /login?user=<name>." : \`Signed in as \${session.name}.\`}</p>
    </main>
  );
}
`,
    "app/login/route.ts": `import { NextResponse, type NextRequest } from "next/server";

/** The demo sign-in: /login?user=dana signs Dana in and goes to the invoices. */
export function GET(request: NextRequest) {
  const user = request.nextUrl.searchParams.get("user") ?? "";
  const response = NextResponse.redirect(new URL("/invoices", request.url));
  response.cookies.set("ledgerly_user", user);
  return response;
}
`,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.name=door", "-c", "user.email=door@stigmer.test", "commit", "-qm", "Ledgerly"], { cwd: dir });
}

/** The model's script: the first run saves a file; every other turn gets the default reply. */
function scriptFirstRun(fake) {
  fake.enqueue({ kind: "anthropic", body: anthropicText("First run"), matches: isTitleCall });
  const turn = (request) => !isTitleCall(request);
  fake.enqueue({
    kind: "anthropic",
    matches: turn,
    body: anthropicToolUse("toolu_door", "write_file", {
      file_path: `/.stigmer/outputs/${DOOR_FILE}`,
      content: "# The agent's report\n\nEvery line matched its purchase order but one: line 3, 40 units billed, 36 ordered.\n",
    }),
  });
  fake.enqueue({ kind: "anthropic", body: anthropicText(`Saved ${DOOR_FILE}.`), matches: turn });
}

/**
 * One `claude -p` turn, asynchronous: the issuer and the fake model live in
 * this process, so its event loop must keep answering while the coding agent
 * works. The stream is appended to `streamPath`; `signal` stops the turn.
 * The turn ends at its `result` event: a coding agent that started the app's
 * dev server in the background keeps its process alive after it, so that
 * process (and what it started) is ended then.
 */
function runClaude(appDir, env, sessionId, message, first, streamPath, signal) {
  const args = [
    "-p",
    message,
    "--output-format",
    "stream-json",
    "--verbose",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    "Bash(stigmer *)",
    "Bash(printenv *)",
    "Bash(npm *)",
    "Bash(npx *)",
    "Bash(git *)",
    "Bash(ls *)",
    "Bash(cat *)",
    "Bash(mkdir *)",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    ...(first ? ["--session-id", sessionId] : ["--resume", sessionId]),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"], signal, detached: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      writeFileSync(streamPath, chunk, { flag: "a" });
      if (/"type":"result"/.test(chunk)) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (status) => {
      const lines = stdout.split("\n").filter((line) => line.trim() !== "");
      let result = "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "result" && typeof event.result === "string") result = event.result;
        } catch {
          // A partial line; the stream file keeps it.
        }
      }
      resolve({ status, result, stderr });
    });
  });
}

/** A free loopback port: bound once on port 0 to learn the number, then closed. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)).map((f) => join(entry.name, f)) : [entry.name],
  );
}

async function main() {
  const args = parseArgs();
  for (const [what, path] of [
    ["server", tsServerEntryPath()],
    ["runner", runnerEntryPath()],
    ["tsx", tsxBin],
  ]) {
    check(existsSync(path), `${what} not built: ${path} (make build-server build-runner build-libs)`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "stigmer-door-"));
  const appDir = join(scratch, "ledgerly");
  const cliHome = join(scratch, "cli-home");
  const binDir = join(scratch, "bin");
  const npmPrefix = join(scratch, "npm-global");
  const streamPath = join(scratch, "stream.jsonl");
  for (const dir of [appDir, cliHome, binDir, npmPrefix]) mkdirSync(dir, { recursive: true });
  log(`scratch=${scratch}`);

  // Stopped by hand (Ctrl-C, a kill), the run still tears its stack down.
  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop.abort(new Error(`stopped by ${signal}`)));
  const fake = await startFakeModel();
  const issuer = await startLocalOidcIssuer({ audience: AUDIENCE });
  const temporal = await spawnTemporal();
  let server;
  let runner;
  let app;
  try {
    server = await spawnServer(process.execPath, {
      args: [tsServerEntryPath()],
      temporalHostPort: temporal.hostPort,
      env: args.local
        ? {}
        : {
            STIGMER_OIDC_ISSUER: issuer.issuer,
            STIGMER_OIDC_AUDIENCE: AUDIENCE,
            STIGMER_OIDC_NATIVE_CLIENT_ID: NATIVE_CLIENT,
          },
    });
    runner = await spawnRunner({
      entryPath: runnerEntryPath(),
      temporalHostPort: temporal.hostPort,
      backendEndpoint: server.baseUrl,
      registryOrigin: server.baseUrl,
      artifactDir: server.artifactBaseDir,
      env: fakeModelEnv(fake),
    });
    log(`a server that ${args.local ? "trusts every caller" : "signs its callers in"} is serving on ${server.baseUrl}, its runner on the fake model`);
    scriptFirstRun(fake);

    writeFileSync(join(scratch, "browser.mjs"), FOLLOWER);
    const stigmer = join(binDir, "stigmer");
    writeFileSync(
      stigmer,
      `#!/bin/sh\nHOME='${cliHome}' BROWSER='"${process.execPath}" "${join(scratch, "browser.mjs")}"' exec '${tsxBin}' '${cliEntry}' "$@"\n`,
    );
    chmodSync(stigmer, 0o755);
    writeApp(appDir);

    const env = { ...process.env, PATH: `${binDir}:${join(npmPrefix, "bin")}:${process.env.PATH ?? ""}`, npm_config_prefix: npmPrefix };
    for (const key of ["STIGMER_SERVER_ADDRESS", "STIGMER_API_KEY", "STIGMER_ORG", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"]) delete env[key];
    const sessionId = randomUUID();
    const prompt = `${PROMPT} Use the Stigmer at ${server.baseUrl}.`;
    log(`claude -p in ${appDir}: ${prompt}`);
    let turn = await runClaude(appDir, env, sessionId, prompt, true, streamPath, stop.signal);
    const handedOver = () =>
      args.local
        ? filesUnder(join(appDir, "app")).some((f) => f.endsWith("page.tsx") && readFileSync(join(appDir, "app", f), "utf8").includes("StigmerAgentChat"))
        : existsSync(join(appDir, "app", "api", "stigmer-token", "route.ts"));
    for (let i = 0; i < args.maxTurns && !handedOver(); i++) {
      log(`the coding agent stopped (${turn.result.slice(0, 160).replace(/\n/g, " ")}); answering`);
      turn = await runClaude(appDir, env, sessionId, ANSWER, false, streamPath, stop.signal);
    }
    log(`the coding agent's last word: ${turn.result.slice(0, 300).replace(/\n/g, " ")}`);

    // What the door must have left behind.
    const config = readFileSync(join(cliHome, ".stigmer", "config.yaml"), "utf8");
    if (!args.local) check(config.includes(`oidc_issuer: ${issuer.issuer}`), "the CLI never signed in through the server's issuer");
    const manifests = filesUnder(join(appDir, "stigmer")).filter((f) => f.endsWith(".yaml"));
    check(manifests.length > 0, "no agent manifest under stigmer/");
    const outputs = filesUnder(join(appDir, "stigmer-output"));
    check(outputs.some((f) => f.endsWith(DOOR_FILE)), `the first run's ${DOOR_FILE} is not in stigmer-output/ (found: ${outputs.join(", ") || "nothing"})`);
    check(readFileSync(join(appDir, ".gitignore"), "utf8").includes("stigmer-output"), ".gitignore does not name stigmer-output/");
    const envFile = [".env.local", ".env"].map((f) => join(appDir, f)).find((p) => existsSync(p) && readFileSync(p, "utf8").includes("STIGMER_API_KEY="));
    if (args.local) {
      check(!existsSync(join(appDir, "app", "api", "stigmer-token", "route.ts")), "a token route on a server that trusts every caller");
    } else {
      check(envFile !== undefined, "no env file holds STIGMER_API_KEY");
      const key = /STIGMER_API_KEY=(\S+)/.exec(readFileSync(envFile, "utf8"))?.[1] ?? "";
      check(key.length > 8 && !readFileSync(streamPath, "utf8").includes(key), "the key appears in the coding agent's stream");
      const route = readFileSync(join(appDir, "app", "api", "stigmer-token", "route.ts"), "utf8");
      check(/getSession/.test(route), "the token route does not read the app's own session (getSession)");
    }
    const chatPage = filesUnder(join(appDir, "app")).find((f) => f.endsWith("page.tsx") && readFileSync(join(appDir, "app", f), "utf8").includes("StigmerAgentChat"));
    check(chatPage !== undefined, "no page renders <StigmerAgentChat />");
    log(`left behind: ${manifests.join(", ")}; stigmer-output/${DOOR_FILE}; ${args.local ? "the development chat" : `the key in ${envFile}; the route; the chat`} on app/${chatPage}`);

    // The app, with this checkout's packages, and its chat in a browser.
    const packDir = join(scratch, "packs");
    execFileSync(process.execPath, [join(repoRoot, "scripts", "publish-libs.mjs"), "--version", "0.0.0-door", "--pack-dir", packDir, "--only", "@stigmer/react-sdk", "--skip-build"], { cwd: repoRoot, stdio: "inherit" });
    const tarballs = readdirSync(packDir).filter((f) => f.endsWith(".tgz")).map((f) => join(packDir, f));
    execFileSync("npm", ["install", "--no-audit", "--no-fund", ...tarballs], { cwd: appDir, stdio: "inherit", env: { ...env, npm_config_prefix: undefined } });
    const appPort = await freePort();
    app = spawn("npx", ["next", "dev", "-p", String(appPort)], { cwd: appDir, env: { ...process.env, PORT: String(appPort) }, stdio: "ignore", detached: true });
    const appUrl = `http://localhost:${appPort}`;
    for (let i = 0; i < 120; i++) {
      if (await fetch(appUrl).then((r) => r.ok).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const { chromium } = createRequire(join(repoRoot, "package.json"))("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${appUrl}/login?user=dana`);
      await page.goto(`${appUrl}/${chatPage.replace(/(^|\/)page\.tsx$/, "").replace(/\([^)]*\)\/?/g, "")}`);
      const box = page.getByRole("textbox").first();
      await box.waitFor({ timeout: 60_000 });
      await box.fill("Hello, can you check this month's invoices?");
      await box.press("Enter");
      await page.getByText(FAKE_MODEL_REPLY_TEXT).first().waitFor({ timeout: 120_000 });
      log("the app's page signed Dana in through its own sign-in, and the chat answered");
    } finally {
      await browser.close();
    }
    log("passed");
  } finally {
    if (app?.pid !== undefined) {
      try {
        process.kill(-app.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    await runner?.stop();
    await server?.stop();
    await temporal.stop();
    await issuer.close();
    await fake.close();
    if (!args.keep) rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`coding-agent-door: FAILED\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
