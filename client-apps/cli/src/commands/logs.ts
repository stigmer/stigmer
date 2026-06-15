// `stigmer logs` — view daemon component logs, with `kubectl logs`-style
// defaults: follow all components live, showing a tail snapshot first.
//
//   stigmer logs                       # follow all components
//   stigmer logs --no-follow --tail 100
//   stigmer logs --component runner    # just the runner

import type { Command } from "commander";
import { homedir } from "node:os";

interface LogsFlags {
  follow?: boolean; // false when --no-follow is passed
  tail?: string;
  component?: string;
  all?: boolean; // false when --no-all is passed
}

export function registerLogs(program: Command): void {
  program
    .command("logs")
    .description("view logs from the local Stigmer stack")
    .option("-f, --no-follow", "do not stream new log lines (show the tail and exit)")
    .option("-n, --tail <lines>", "number of recent lines to show before streaming", "50")
    .option("-c, --component <name>", "show a single component (stigmer-server, runner, or temporal)")
    .option("--no-all", "with --component unset, restrict to the default component")
    .action((options: LogsFlags) => runLogs(options));
}

async function runLogs(options: LogsFlags): Promise<void> {
  const { allComponents, componentByName, followAll, printTail } = await import("../local/logs/view.js");
  const { logDir } = await import("../local/paths.js");
  const { CliExitError } = await import("../errors/cli-exit-error.js");
  const { ExitCode } = await import("../errors/exit-codes.js");

  const dir = logDir(homedir());
  const tail = Number.parseInt(options.tail ?? "50", 10);
  const tailLines = Number.isNaN(tail) ? 50 : tail;
  const follow = options.follow !== false;

  // A single component is selected explicitly; otherwise show all unless the
  // user opted out of the all-view (then fall back to the server's logs).
  const useAll = options.component === undefined && options.all !== false;
  const components = useAll
    ? allComponents(dir)
    : [
        componentByName(dir, options.component ?? "stigmer-server") ??
          (() => {
            throw new CliExitError(`unknown component: ${options.component}`, ExitCode.Usage, [
              "Valid components: stigmer-server, runner, temporal",
            ]);
          })(),
      ];

  printTail(components, tailLines, process.stdout);

  if (!follow) return;
  await streamUntilInterrupt(() => followAll(components, process.stdout));
}

// Follow until SIGINT, then stop cleanly. Resolves on Ctrl-C so the process can
// exit 0 rather than dumping a stack trace.
function streamUntilInterrupt(start: () => { stop(): void }): Promise<void> {
  return new Promise((resolve) => {
    const handle = start();
    const onSignal = (): void => {
      handle.stop();
      process.removeListener("SIGINT", onSignal);
      process.stderr.write("\n");
      resolve();
    };
    process.on("SIGINT", onSignal);
  });
}
