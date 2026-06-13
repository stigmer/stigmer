import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionListSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { describe, expect, it } from "vitest";
import { isSessionAlias, renderSessionList } from "./session.js";

describe("isSessionAlias", () => {
  it.each([
    ["session", true],
    ["sessions", true],
    ["  Session ", true],
    ["execution", false],
    ["agent", false],
  ])("%j -> %s", (type, expected) => {
    expect(isSessionAlias(type)).toBe(expected);
  });
});

describe("renderSessionList", () => {
  const list = create(SessionListSchema, {
    totalPages: 1,
    entries: [
      create(SessionSchema, {
        metadata: { id: "ses_1" },
        spec: { agentInstanceId: "agi_1", subject: "Fix the build" },
      }),
    ],
  });
  const result = { schema: SessionListSchema, message: list };

  it("renders the full list envelope as protojson for json", () => {
    const json = JSON.parse(renderSessionList(result, "json"));
    expect(json.entries[0].metadata.id).toBe("ses_1");
  });

  it("renders a table with the session columns", () => {
    const table = renderSessionList(result, "table");
    expect(table).toContain("SESSION ID");
    expect(table).toContain("ses_1");
    expect(table).toContain("agi_1");
    expect(table).toContain("Fix the build");
  });

  it("renders an empty notice for no sessions", () => {
    const empty = { schema: SessionListSchema, message: create(SessionListSchema, {}) };
    expect(renderSessionList(empty, "table").toLowerCase()).toContain("no sessions");
  });
});
