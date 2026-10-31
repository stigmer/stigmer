// Proves the seam a missing resource's next step reads: `get`, `delete` and
// `download` record the type they resolved, as `stigmer list` spells it,
// so a NotFound from the server points at the list of that type. A run (the
// pre-gate alias) records `run`; a type the verb matrix gives no List
// records nothing, and its NotFound keeps the general line. The program,
// the registry and the commands are real; the backend is a stub whose every
// call answers NotFound.

import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { classify } from "../../errors/index.js";
import { buildProgram } from "../../program.js";
import { actionResourceType, setActionResourceType } from "../../runtime.js";

const CONFIG: Config = { backend: {} };

// Every sub-client's every method answers NotFound, as a server that holds
// no such resource would.
const stigmer = vi.hoisted(() => {
  const notFound = async (): Promise<never> => {
    const { Code: C, ConnectError: E } = await import("@connectrpc/connect");
    throw new E("not found", C.NotFound);
  };
  const subClient = new Proxy({}, { get: () => notFound });
  return new Proxy({}, { get: (_target, key) => (key === "then" ? undefined : subClient) });
});

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer }),
}));

async function failureOf(...args: string[]): Promise<unknown> {
  const program = buildProgram();
  program.exitOverride();
  return program.parseAsync(["node", "stigmer", "--standalone", ...args]).then(
    () => undefined,
    (err: unknown) => err,
  );
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => {
  setActionResourceType("");
  vi.restoreAllMocks();
});

describe("CLI-04 a missing resource points at the list of the type the command resolved", () => {
  const cases: ReadonlyArray<readonly [string, readonly string[], string]> = [
    ["get", ["get", "AGENT", "demo/reviewer"], "agent"],
    ["get run", ["get", "runs", "run_01abc"], "run"],
    ["delete", ["delete", "skill", "demo/triage", "--force"], "skill"],
    ["delete run", ["delete", "run", "run_01abc", "--force"], "run"],
    ["download", ["download", "session", "ses_01abc"], "session"],
    ["download run", ["download", "run", "run_01abc"], "run"],
  ];

  it.each(cases)("%s records its type and the error names its list", async (_name, args, type) => {
    const error = await failureOf(...args);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.NotFound);
    expect(actionResourceType()).toBe(type);
    expect(classify(error)?.hints).toEqual([`Check the reference: stigmer list ${type}`]);
  });

  it.each([
    ["get", ["get", "score", "scr_01abc"]],
    ["delete", ["delete", "evalrun", "evr_01abc", "--force"]],
  ] as const)("%s of a type with no list records none, and the error keeps the general line", async (_name, args) => {
    const error = await failureOf(...args);
    expect((error as ConnectError).code).toBe(Code.NotFound);
    expect(actionResourceType()).toBe("");
    expect(classify(error)?.hints).toEqual(["Check the reference and the organization (--org)."]);
  });
});
