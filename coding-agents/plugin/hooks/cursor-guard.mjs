// Cursor's beforeMCPExecution and beforeShellExecution hook for Stigmer's
// plugin: reads the call from stdin and prints decideCursor()'s answer
// (decide.mjs). It fails open: on any error of its own it prints `{}`, which
// leaves the call to Cursor's own permissions, and exits 0. `failClosed`
// stays off in cursor-hooks.json for the same reason: a fault in the guard
// must not stop every `stigmer` command.
import { decideCursor } from "./decide.mjs";

/* v8 ignore start -- @preserve: Cursor's entry, which __tests__/guard.test.ts runs in a child process that this suite's coverage can't see */
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let answer = {};
  try {
    answer = decideCursor(JSON.parse(input));
  } catch {
    // Fail open: Cursor's own permissions still decide.
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
  process.exitCode = 0;
});
/* v8 ignore stop */
