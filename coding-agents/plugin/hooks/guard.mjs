// Claude Code's PreToolUse hook for Stigmer's plugin: reads the call from
// stdin and prints decide()'s answer (decide.mjs). It fails open: on any
// error of its own it prints nothing and exits 0, never 2, which Claude Code
// would read as a block.
import { decide } from "./decide.mjs";

/* v8 ignore start -- @preserve: Claude Code's entry, which __tests__/guard.test.ts runs in a child process that this suite's coverage can't see */
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const answer = decide(JSON.parse(input));
    if (answer !== null) process.stdout.write(`${JSON.stringify(answer)}\n`);
  } catch {
    // Fail open: Claude Code's own permissions still decide.
  }
  process.exitCode = 0;
});
/* v8 ignore stop */
