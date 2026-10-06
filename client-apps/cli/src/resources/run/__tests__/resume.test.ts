// Tests for openSession's organization (stigmer/stigmer#1580): a resumed
// session is continued in the session's own organization, never the CLI's
// context organization, both when the latest turn is still live (re-attach)
// and when the session is replayed into the interactive composer. The mode
// a resume continues in is the explicit --mode, else plan when the latest
// turn ran in plan mode, else the agent default. The session reads, the stream and the Ink view are doubles, so only the
// organization handed onward is observed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase, InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { BackendClient } from "../../../client/index.js";

const session = vi.hoisted(() => ({ get: vi.fn(), executions: vi.fn() }));
const stream = vi.hoisted(() => vi.fn());
const ink = vi.hoisted(() => vi.fn());
const tty = vi.hoisted(() => ({ supported: false }));

vi.mock("../../session.js", () => ({
  getSessionById: session.get,
  listExecutionsBySession: session.executions,
}));
vi.mock("../stream.js", () => ({ streamAgentExecution: stream }));
vi.mock("../../stream/ink.js", () => ({ runInkSession: ink }));
vi.mock("../../stream/tty.js", () => ({ isInkSupported: () => tty.supported }));

import { openSession } from "../resume.js";

const client = { stigmer: {} } as unknown as BackendClient;

function executionIn(
  phase: RunPhase,
  interactionMode: InteractionMode = InteractionMode.UNSPECIFIED,
) {
  return create(AgentRunSchema, {
    metadata: { id: "aex_1", org: "acme" },
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
      expect.objectContaining({ sessionId: "ses_1", org: "acme" }),
    );
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

  it("continues in the agent default when the latest turn named no mode", async () => {
    session.executions.mockResolvedValue([
      executionIn(RunPhase.RUN_IN_PROGRESS),
    ]);

    await openSession({ client, sessionId: "ses_1", mode: "", outputMode: "json" });

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ mode: "" }));
  });
});
