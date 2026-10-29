// Tests for openSession's organization (stigmer/stigmer#1580): a resumed
// session is continued in the session's own organization, never the CLI's
// context organization, both when the latest turn is still live (re-attach)
// and when the session is replayed into the interactive composer. The mode
// a resume continues in is the explicit --mode, else plan when the latest
// turn ran in plan mode, else the agent default. A session with no runs
// says so and opens nothing. A live turn is re-attached with no
// --approve-default. A finished session off a terminal replays its stored
// events: each as a Managed Agents JSON line with --json, else the plaintext
// transcript. The session reads, the stream and the Ink view are doubles.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { BackendClient } from "../../../client/index.js";
import { phase, said, user } from "../../__test-utils__/session-events.js";

const session = vi.hoisted(() => ({ get: vi.fn(), executions: vi.fn(), events: vi.fn() }));
const stream = vi.hoisted(() => vi.fn());
const ink = vi.hoisted(() => vi.fn());
const tty = vi.hoisted(() => ({ supported: false }));

vi.mock("../../session.js", () => ({
  getSessionById: session.get,
  listRunsBySession: session.executions,
  listSessionEvents: session.events,
}));
vi.mock("../stream.js", () => ({ streamAgentRun: stream }));
vi.mock("../../stream/ink.js", () => ({ runInkSession: ink }));
vi.mock("../../stream/tty.js", () => ({ isInkSupported: () => tty.supported }));

import { openSession } from "../resume.js";

const client = { stigmer: {} } as unknown as BackendClient;

function executionIn(
  phase: RunPhase,
  interactionMode: InteractionMode = InteractionMode.UNSPECIFIED,
) {
  return create(RunSchema, {
    metadata: { id: "run_1", org: "acme" },
    spec: { interactionMode },
    status: { phase },
  });
}

beforeEach(() => {
  session.get.mockResolvedValue(
    create(SessionSchema, { metadata: { id: "ses_1", org: "acme" } }),
  );
  tty.supported = false;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("openSession", () => {
  it("re-attaches a live turn in the session's organization", async () => {
    session.executions.mockResolvedValue([
      executionIn(RunPhase.RUN_IN_PROGRESS),
    ]);

    await openSession({
      client,
      sessionId: "ses_1",
      mode: "",
      outputMode: "json",
    });

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "ses_1", org: "acme", runId: "run_1", approveDefault: "" }),
    );
  });

  describe("a finished session off a terminal", () => {
    let stdout: string[];
    let stderr: string[];
    const history = [user("run_1", "hi"), said("run_1", 0, "Hello."), phase("run_1", "completed")];

    beforeEach(() => {
      stdout = [];
      stderr = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => (stdout.push(String(chunk)), true));
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => (stderr.push(String(chunk)), true));
      session.executions.mockResolvedValue([executionIn(RunPhase.RUN_COMPLETED)]);
      session.events.mockResolvedValue(history);
    });

    it("replays each stored event as a Managed Agents JSON line with --json", async () => {
      await openSession({ client, sessionId: "ses_1", mode: "", outputMode: "json" });

      expect(session.events).toHaveBeenCalledWith(client.stigmer, "ses_1");
      expect(stdout.map((line) => JSON.parse(line).type)).toEqual(["user.message", "agent.message", "stigmer.run.status"]);
      expect(stream).not.toHaveBeenCalled();
      expect(ink).not.toHaveBeenCalled();
    });

    it("replays the plaintext transcript inline", async () => {
      await openSession({ client, sessionId: "ses_1", mode: "", outputMode: "inline" });

      expect(stdout.join("")).toBe("Hello.\n");
      expect(stderr.join("")).toContain("\n> hi\n\n");
    });
  });

  it("opens the interactive composer in the session's organization", async () => {
    session.executions.mockResolvedValue([
      executionIn(RunPhase.RUN_COMPLETED),
    ]);
    tty.supported = true;

    await openSession({
      client,
      sessionId: "ses_1",
      mode: "",
      outputMode: "inline",
    });

    expect(ink).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "ses_1", org: "acme" }),
    );
  });

  it("continues a session whose latest turn ran in plan mode in plan mode", async () => {
    session.executions.mockResolvedValue([
      executionIn(RunPhase.RUN_IN_PROGRESS, InteractionMode.PLAN),
    ]);

    await openSession({ client, sessionId: "ses_1", mode: "", outputMode: "json" });

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ mode: "plan" }));
  });

  it("an explicit --mode outranks the latest turn's plan mode", async () => {
    session.executions.mockResolvedValue([
      executionIn(RunPhase.RUN_IN_PROGRESS, InteractionMode.PLAN),
    ]);

    await openSession({ client, sessionId: "ses_1", mode: "agent", outputMode: "json" });

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ mode: "agent" }));
  });

  it("says the session has no runs and opens nothing", async () => {
    session.executions.mockResolvedValue([]);
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    await openSession({ client, sessionId: "ses_1", mode: "", outputMode: "json" });

    expect(written).toEqual(["Session ses_1 has no runs\n"]);
    expect(stream).not.toHaveBeenCalled();
    expect(ink).not.toHaveBeenCalled();
  });

  it("continues in the agent default when the latest turn named no mode", async () => {
    session.executions.mockResolvedValue([
      executionIn(RunPhase.RUN_IN_PROGRESS),
    ]);

    await openSession({ client, sessionId: "ses_1", mode: "", outputMode: "json" });

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ mode: "" }));
  });
});
