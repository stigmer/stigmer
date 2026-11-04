// Command-level contract for `stigmer run <text>` when the agent lookup
// fails (stigmer/stigmer#2799): only an answer that the text names no agent
// stands in a picker or "No agent found" for the lookup. That is NotFound (no
// agent has that slug) or InvalidArgument (the text is not a slug, such as
// `Reviewer` or `code review`, so it is a search). Every other failure is
// the command's own error, rethrown unchanged so the one exit point words it
// as for every other command: a server that cannot be reached, an expired
// sign-in, or an agent that exists and is not the caller's.
//
// The lookup throws what the SDK throws: a StigmerError carrying the status
// code, its cause the ConnectError (as the SDK's wrapError builds it). The
// backend client, the lookup, the terminal gate and the picker are replaced
// at their modules, so the test is offline and deterministic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/client";
import type { Config } from "../../config/index.js";
import type { BackendClient } from "../../client/index.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: {},
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const state = vi.hoisted(() => ({
  lookupError: undefined as unknown,
  terminal: false,
  pickerQueries: [] as string[],
  executed: 0,
}));

vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  return { ...actual, load: () => CONFIG };
});

vi.mock("../../backend.js", () => ({
  connectBackend: (): BackendClient =>
    ({
      stigmer: { run: {} },
      config: CONFIG,
      isResourceAvailable: () => Promise.resolve(false),
    }) as unknown as BackendClient,
}));

vi.mock("../../resources/run/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../resources/run/resolve.js")>();
  return {
    ...actual,
    resolveAgentRef: () => Promise.reject(state.lookupError),
  };
});

vi.mock("../../resources/picker/tty.js", () => ({
  interactiveBrowseEnabled: () => state.terminal,
}));

vi.mock("../../resources/picker/ink.js", () => ({
  pickAgent: (input: { readonly initialQuery: string }) => {
    state.pickerQueries.push(input.initialQuery);
    return Promise.resolve(undefined);
  },
}));

vi.mock("../../resources/run/agent-exec.js", () => ({
  executeResolvedAgent: () => {
    state.executed += 1;
    return Promise.resolve();
  },
}));

// The SDK's error for a failed call: the StigmerError over its ConnectError.
function sdkError(name: StigmerError["code"], message: string, code: Code, cause?: unknown): StigmerError {
  const connect = new ConnectError(message, code, undefined, undefined, cause);
  return new StigmerError(name, connect.rawMessage, code, { cause: connect });
}

const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" });

const FAILURES = {
  unreachable: () => sdkError("unavailable", "fetch failed", Code.Unavailable, refused),
  signedOut: () => sdkError("unauthenticated", "token expired", Code.Unauthenticated),
  notYours: () => sdkError("permission-denied", "not allowed", Code.PermissionDenied),
  noSuchAgent: () => sdkError("not-found", "agent not found", Code.NotFound),
  notASlug: () => sdkError("invalid-argument", "value does not match regex pattern", Code.InvalidArgument),
};

async function run(...args: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--org", "acme", "run", ...args]);
}

beforeEach(() => {
  state.lookupError = undefined;
  state.terminal = false;
  state.pickerQueries.length = 0;
  state.executed = 0;
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stigmer run <text> off a terminal", () => {
  it.each([
    ["the server cannot be reached", FAILURES.unreachable],
    ["the sign-in has expired", FAILURES.signedOut],
    ["the agent exists and is not the caller's", FAILURES.notYours],
  ])("rejects with the lookup's own error when %s", async (_, failure) => {
    const err = failure();
    state.lookupError = err;
    await expect(run("reviewer", "-m", "hi")).rejects.toBe(err);
    expect(state.executed).toBe(0);
  });

  it.each([
    ["no agent has that slug", FAILURES.noSuchAgent],
    ["the text is not a slug", FAILURES.notASlug],
  ])('says "No agent found" when %s', async (_, failure) => {
    state.lookupError = failure();
    await expect(run("reviewer", "-m", "hi")).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringMatching(/^No agent found for "reviewer"\n/),
    });
  });
});

describe("stigmer run <text> on a terminal", () => {
  beforeEach(() => {
    state.terminal = true;
  });

  it("opens the picker with the typed text when no agent has that slug", async () => {
    state.lookupError = FAILURES.noSuchAgent();
    await run("reviewer", "-m", "hi");
    expect(state.pickerQueries).toEqual(["reviewer"]);
  });

  it("opens the picker with the typed text when the text is a search, not a slug", async () => {
    state.lookupError = FAILURES.notASlug();
    await run("Reviewer", "-m", "hi");
    expect(state.pickerQueries).toEqual(["Reviewer"]);
  });

  it("never opens the picker when the server cannot be reached", async () => {
    const err = FAILURES.unreachable();
    state.lookupError = err;
    await expect(run("reviewer", "-m", "hi")).rejects.toBe(err);
    expect(state.pickerQueries).toEqual([]);
  });
});
