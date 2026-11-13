#!/usr/bin/env node

/**
 * `stigmer auth login` signs a person in where the server says
 * (stigmer#1077): the CLI from source, in a scratch home, against a server
 * that signs its callers in through test/support's hermetic issuer and
 * announces a client for installed apps (lib/signed-in-server.mjs). Nothing
 * about the issuer is given to the CLI: it reads it from the server.
 *
 * The cases:
 *   1. The browser: a self-hosted backend added by address alone, then
 *      `stigmer auth login` with `BROWSER` naming a stand-in browser that
 *      follows the authorize address to the CLI's loopback callback (the
 *      issuer consents as its person). The login says it authenticated with
 *      that server, the config file keeps the sign-in beside its issuer, and
 *      `stigmer auth whoami` answers as the issuer's person.
 *   2. `stigmer auth logout` clears it, and `stigmer auth whoami` is refused.
 *   3. A code on any device: `stigmer auth login --device` with no browser
 *      prints the address and a code, the issuer approves it, and the
 *      sign-in works again.
 *
 * Usage:
 *   node test/install/smoke-cli-sign-in.mjs
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnCommand } from "./lib/install-cli.mjs";
import { startSignedInServer } from "./lib/signed-in-server.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliEntry = join(repoRoot, "client-apps", "cli", "src", "cli", "stigmer.ts");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const NATIVE_CLIENT = "stigmer-cli-smoke";
const COMMAND_TIMEOUT_MS = 120_000;

/** What the CLI says, restated here: the install layer imports no CLI source. */
export const SAYS = {
  loggedOut: 'Logged out from backend "smoke"',
  deviceCode: /To sign in, open (\S+) and enter ([0-9A-F]{4}-[0-9A-F]{4})/,
};

// The stand-in browser: follows the authorize address, then its redirect to
// the CLI's callback, as a person's browser does once they sign in.
const FOLLOWER = `
const [url] = process.argv.slice(2);
const authorize = await fetch(url, { redirect: "manual" });
const location = authorize.headers.get("location");
if (location === null) { console.error("authorize answered " + authorize.status); process.exit(1); }
await fetch(location);
`;

/** Whether a command said `text`: a result goes to stdout on a terminal and to stderr off one. */
function said(result, text) {
  return `${result.stdout}${result.stderr}`.includes(text);
}

function log(step) {
  process.stdout.write(`smoke-cli-sign-in: ${step}\n`);
}

function check(condition, message, result) {
  if (condition) return;
  const detail = result === undefined ? "" : `\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
  throw new Error(`${message}${detail}`);
}

async function main() {
  if (!existsSync(tsxBin)) throw new Error(`tsx not installed: ${tsxBin} (npm ci)`);
  const server = await startSignedInServer({ log, nativeClientId: NATIVE_CLIENT });
  const home = mkdtempSync(join(tmpdir(), "stigmer-sign-in-"));
  try {
    const follower = join(home, "browser.mjs");
    writeFileSync(follower, FOLLOWER);
    const env = { ...process.env, HOME: home };
    for (const key of ["STIGMER_SERVER_ADDRESS", "STIGMER_API_KEY", "STIGMER_ORG", "BROWSER"]) delete env[key];
    const stigmer = (args, extra = {}) =>
      spawnCommand([tsxBin, cliEntry], args, { ...env, ...extra }, COMMAND_TIMEOUT_MS).done;
    const endpoint = new URL(server.baseUrl).host;

    for (const args of [["config", "backend", "add", "smoke", "--endpoint", endpoint], ["config", "backend", "use", "smoke"]]) {
      const result = await stigmer(args);
      check(result.status === 0, `stigmer ${args.join(" ")} exited ${result.status}`, result);
    }

    log("case 1: auth login through the browser");
    const login = await stigmer(["auth", "login"], { BROWSER: `"${process.execPath}" "${follower}"` });
    check(login.status === 0, `auth login exited ${login.status}`, login);
    check(said(login, `Authenticated with ${endpoint}`), "auth login did not say it authenticated with the server", login);
    const config = readFileSync(join(home, ".stigmer", "config.yaml"), "utf8");
    check(config.includes(`oidc_issuer: ${server.issuer.issuer}`), "the config keeps no issuer beside the sign-in");
    check(config.includes(`oidc_client_id: ${NATIVE_CLIENT}`), "the config keeps no client beside the sign-in");
    const whoami = await stigmer(["auth", "whoami"]);
    check(whoami.status === 0 && said(whoami, server.issuer.person.email), "whoami did not answer as the issuer's person", whoami);

    log("case 2: auth logout");
    const logout = await stigmer(["auth", "logout"]);
    check(logout.status === 0 && said(logout, SAYS.loggedOut), "auth logout did not clear the sign-in", logout);
    const refused = await stigmer(["auth", "whoami"]);
    check(refused.status !== 0, "whoami answered after logout", refused);

    log("case 3: auth login --device");
    const device = await stigmer(["auth", "login", "--device"]);
    check(device.status === 0, `auth login --device exited ${device.status}`, device);
    const code = SAYS.deviceCode.exec(device.stderr);
    check(code !== null && code[1] === `${server.issuer.issuer}/activate`, "auth login --device printed no address and code", device);
    const again = await stigmer(["auth", "whoami"]);
    check(again.status === 0 && said(again, server.issuer.person.email), "whoami did not answer after the device sign-in", again);
    log("passed");
  } catch (error) {
    process.stderr.write(`server log:\n${server.logTail()}\n`);
    throw error;
  } finally {
    await server.stop();
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`smoke-cli-sign-in: FAILED\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
