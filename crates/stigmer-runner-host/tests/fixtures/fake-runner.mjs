// A stand-in for the Node runner in manager mode, for tests/runner_process.rs.
//
// It speaks the runner's side of the IPC protocol (src/protocol.rs): one JSON
// line per message on stdout, one command per line on stdin. FAKE_RUNNER_MODE
// picks its behaviour; FAKE_RUNNER_LOG names a file it appends everything it
// receives to, one line each, after its pid and the environment it was given.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.FAKE_RUNNER_MODE ?? "ready";
const log = process.env.FAKE_RUNNER_LOG;
const record = (line) => {
  if (log) appendFileSync(log, `${line}\n`);
};
const say = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

record(`pid ${process.pid}`);
record(
  `env ${JSON.stringify({
    mode: process.env.STIGMER_RUNNER_MODE,
    token: process.env.STIGMER_TOKEN,
    endpoint: process.env.STIGMER_BACKEND_ENDPOINT,
  })}`,
);

switch (mode) {
  case "exit-before-ready":
    process.exit(3);
    break;
  case "startup-error":
    say({
      type: "error",
      message: "cannot reach the control plane",
      fatal: true,
    });
    // Stay alive: the host must reap a child whose handshake failed.
    setInterval(() => {}, 1000);
    break;
  case "newer-protocol":
    say({ type: "ready", protocolVersion: 99 });
    setInterval(() => {}, 1000);
    break;
  case "wedged":
    // Ready, then never reads stdin and never exits: a stop must escalate.
    say({ type: "ready", protocolVersion: 1 });
    process.stdin.pause();
    setInterval(() => {}, 1000);
    break;
  default: {
    say({ type: "ready", protocolVersion: 1 });
    const lines = createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      record(line);
      const command = JSON.parse(line);
      if (command.type === "shutdown") process.exit(0);
      if (mode === "fatal-on-first-command") {
        say({ type: "error", message: "worker crashed", fatal: true });
      }
    });
    // The runner's real rule: stdin EOF (the host died) means exit.
    lines.on("close", () => process.exit(0));
  }
}
