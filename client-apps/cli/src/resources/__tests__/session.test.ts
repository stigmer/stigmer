// Unit tests for the session read helpers resume is built on: a session is
// read by its id, and its runs are listed for that session, every page
// followed, returned in the server's order (newest first). A session's events are
// listed oldest first, every page followed, optionally only one run's; a run
// names its session by its target, and a run that names none is refused. The
// client is a double recording what it was asked.

import { create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { ListRunsBySessionRequest } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { ListSessionEventsRequest } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../../errors/index.js";
import { phase, user } from "../__test-utils__/session-events.js";
import { getSessionById, listRunsBySession, listSessionEvents, sessionOfRun } from "../session.js";

describe("session reads", () => {
  it("reads a session by its id", async () => {
    const asked: string[] = [];
    const client = {
      session: {
        get: async (id: string) => {
          asked.push(id);
          return create(SessionSchema, { metadata: { id } });
        },
      },
    } as unknown as Stigmer;

    const session = await getSessionById(client, "ses_1");

    expect(asked).toEqual(["ses_1"]);
    expect(session.metadata?.id).toBe("ses_1");
  });

  it("lists a session's runs following every page, in the server's order", async () => {
    const requests: ListRunsBySessionRequest[] = [];
    const client = {
      run: {
        listBySession: async (req: ListRunsBySessionRequest) => {
          requests.push(req);
          return req.pageToken === ""
            ? { entries: [create(RunSchema, { metadata: { id: "aex_3" } })], nextPageToken: "page-2" }
            : {
                entries: [
                  create(RunSchema, { metadata: { id: "aex_2" } }),
                  create(RunSchema, { metadata: { id: "aex_1" } }),
                ],
                nextPageToken: "",
              };
        },
      },
    } as unknown as Stigmer;

    const runs = await listRunsBySession(client, "ses_1");

    expect(requests.map((r) => [r.sessionId, r.pageToken])).toEqual([
      ["ses_1", ""],
      ["ses_1", "page-2"],
    ]);
    expect(runs.map((r) => r.metadata?.id)).toEqual(["aex_3", "aex_2", "aex_1"]);
  });

  it("lists a session's events oldest first, following every page", async () => {
    const requests: ListSessionEventsRequest[] = [];
    const first = user("run_1", "hi");
    const second = phase("run_1", "completed");
    const client = {
      session: {
        listEvents: async (req: ListSessionEventsRequest) => {
          requests.push(req);
          return req.pageToken === ""
            ? { events: [first], nextPageToken: "page-2" }
            : { events: [second], nextPageToken: "" };
        },
      },
    } as unknown as Stigmer;

    const events = await listSessionEvents(client, "ses_1", "run_1");

    expect(events).toEqual([first, second]);
    expect(requests.map((r) => [r.sessionId, r.runId, r.pageSize, r.pageToken])).toEqual([
      ["ses_1", "run_1", 1000, ""],
      ["ses_1", "run_1", 1000, "page-2"],
    ]);
  });

  it("names a run's session, and refuses a run that names none", () => {
    expect(sessionOfRun(create(RunSchema, { spec: { target: { case: "sessionId", value: "ses_1" } } }))).toBe("ses_1");
    const orphan = create(RunSchema, { metadata: { id: "run_1" } });
    expect(() => sessionOfRun(orphan)).toThrow(CliExitError);
    expect(() => sessionOfRun(orphan)).toThrow("run run_1 names no session");
  });
});
