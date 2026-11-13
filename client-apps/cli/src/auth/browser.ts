// Opening the person's browser at a sign-in address, and knowing when none can open.
//
// `BROWSER` names the command that opens an address, as `git` and `gh` read
// it: the CLI runs it through the shell with the address as its one argument
// (`$1`, never pasted into the command line), so `BROWSER="firefox
// --new-tab"` works and an address can never become shell syntax. Without
// it, the `open` package picks the system's opener.
//
// `canOpenBrowser` says whether a browser can open here at all: `BROWSER`
// set, or a desktop session (macOS and Windows outside an SSH session, Linux
// with a display). Where none can, `stigmer auth login` signs in with a code
// typed on any device instead.

import { spawn } from "node:child_process";

/** Opens an address in a browser; rejects when it cannot. */
export type BrowserOpener = (url: string) => Promise<void>;

/** Whether a browser can open on this machine. */
export function canOpenBrowser(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (isSet(env.BROWSER)) return true;
  const overSsh = isSet(env.SSH_CONNECTION) || isSet(env.SSH_TTY);
  if (platform === "darwin" || platform === "win32") return !overSsh;
  return isSet(env.DISPLAY) || isSet(env.WAYLAND_DISPLAY);
}

/** Open `url` with `BROWSER` when it is set, else with the system's opener. */
export async function openBrowser(url: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const command = env.BROWSER;
  if (isSet(command) && process.platform !== "win32") {
    await runBrowserCommand(command as string, url);
    return;
  }
  const { default: open } = await import("open");
  await open(url);
}

function runBrowserCommand(command: string, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", `${command} "$1"`, "stigmer-browser", url], {
      stdio: "ignore",
      detached: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}
