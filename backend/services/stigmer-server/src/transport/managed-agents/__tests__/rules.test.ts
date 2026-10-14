/**
 * The Managed Agents lane's pure rules: the `anthropic-beta` version rule,
 * the Connect-code table and Anthropic's error envelope, the query strings
 * as Anthropic's SDK writes them, the route shapes, which caller headers
 * reach the serving chain, and the send body's whole-list check.
 *
 * Each arm pins a rule a client depends on and nothing else would catch:
 * a version a later client names, a stigmer.* filter, a credential the two
 * SDK options carry, an event Stigmer does not serve.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { errorEnvelope, invalidRequest, isLaneError, laneErrorOf, statusOfCode } from "../errors.js";
import { forwardedHeaders, routeOf } from "../lane.js";
import { MANAGED_AGENTS_EVENT_TYPES } from "../list.js";
import { parseListQuery, parseStreamQuery } from "../query.js";
import { parseSendBody } from "../send.js";
import { MANAGED_AGENTS_VERSION, selectManagedAgentsVersion } from "../version.js";
import type { LaneRequest } from "../../lanes.js";

describe("the anthropic-beta version rule", () => {
  it("serves the current version when the header is absent or names it among other betas", () => {
    expect(selectManagedAgentsVersion(undefined)).toEqual({ served: true, version: MANAGED_AGENTS_VERSION });
    expect(selectManagedAgentsVersion("")).toEqual({ served: true, version: MANAGED_AGENTS_VERSION });
    expect(selectManagedAgentsVersion(`files-api-2025-04-14, ${MANAGED_AGENTS_VERSION}`)).toEqual({
      served: true,
      version: MANAGED_AGENTS_VERSION,
    });
    expect(selectManagedAgentsVersion("files-api-2025-04-14")).toEqual({
      served: true,
      version: MANAGED_AGENTS_VERSION,
    });
  });

  it("refuses any other managed-agents version, alone or beside the served one", () => {
    for (const header of ["managed-agents-2026-09-01", `managed-agents-2026-09-01,${MANAGED_AGENTS_VERSION}`]) {
      const selection = selectManagedAgentsVersion(header);
      expect(selection.served).toBe(false);
      expect(selection.served ? "" : selection.message).toBe(
        `this server serves ${MANAGED_AGENTS_VERSION}, not managed-agents-2026-09-01`,
      );
    }
  });
});

describe("errors", () => {
  it("maps every Connect code to the status and type the plan's table names", () => {
    const table: Array<[Code, number, string]> = [
      [Code.InvalidArgument, 400, "invalid_request_error"],
      [Code.FailedPrecondition, 400, "invalid_request_error"],
      [Code.OutOfRange, 400, "invalid_request_error"],
      [Code.Unauthenticated, 401, "authentication_error"],
      [Code.PermissionDenied, 403, "permission_error"],
      [Code.NotFound, 404, "not_found_error"],
      [Code.AlreadyExists, 409, "invalid_request_error"],
      [Code.Aborted, 409, "invalid_request_error"],
      [Code.ResourceExhausted, 429, "rate_limit_error"],
      [Code.DeadlineExceeded, 504, "timeout_error"],
      [Code.Unavailable, 503, "overloaded_error"],
      [Code.Canceled, 500, "api_error"],
      [Code.Unknown, 500, "api_error"],
      [Code.Unimplemented, 500, "api_error"],
      [Code.Internal, 500, "api_error"],
      [Code.DataLoss, 500, "api_error"],
    ];
    for (const [code, status, type] of table) {
      expect(statusOfCode(code), Code[code]).toEqual({ status, type });
    }
  });

  it("keeps a native refusal's own message and hides a non-Connect fault's", () => {
    expect(laneErrorOf(new ConnectError("session not found: ses_1", Code.NotFound))).toEqual({
      status: 404,
      type: "not_found_error",
      message: "session not found: ses_1",
    });
    expect(laneErrorOf(new Error("ENOENT /var/lib/secret"))).toEqual({
      status: 500,
      type: "api_error",
      message: "internal server error",
    });
    expect(laneErrorOf(new ConnectError("", Code.Internal)).message).toBe("internal server error");
  });

  it("writes Anthropic's envelope with the request id", () => {
    expect(JSON.parse(errorEnvelope(invalidRequest("no"), "req_1"))).toEqual({
      type: "error",
      error: { type: "invalid_request_error", message: "no" },
      request_id: "req_1",
    });
  });
});

describe("list and stream queries", () => {
  it("decodes the SDK's bracketed arrays and created_at bounds, and bare arrays too", () => {
    const params = new URLSearchParams(
      "beta=true&limit=2&page=tok&order=desc&types%5B%5D=agent.message&types%5B%5D=user.message&types=session.status_idle" +
        "&created_at%5Bgt%5D=2026-10-01T00:00:00Z&created_at%5Blte%5D=2026-10-02T00:00:00Z",
    );
    expect(parseListQuery(params)).toEqual({
      limit: 2,
      page: "tok",
      order: "desc",
      types: ["agent.message", "user.message", "session.status_idle"],
      createdAtGt: "2026-10-01T00:00:00Z",
      createdAtGte: "",
      createdAtLt: "",
      createdAtLte: "2026-10-02T00:00:00Z",
    });
    expect(parseListQuery(new URLSearchParams())).toMatchObject({ limit: 0, page: "", order: "", types: [] });
  });

  it("refuses a limit outside 1 to 1000, an unknown order and a Stigmer type, by the client's names", () => {
    for (const limit of ["0", "1001", "2.5", "-1", "ten"]) {
      expect(parseListQuery(new URLSearchParams({ limit }))).toEqual(
        invalidRequest("limit must be an integer from 1 to 1000"),
      );
    }
    expect(parseListQuery(new URLSearchParams({ order: "newest" }))).toEqual(invalidRequest("order must be asc or desc"));
    const refused = parseListQuery(new URLSearchParams("types[]=stigmer.permission.asked"));
    expect(isLaneError(refused) ? refused.message : "").toContain("'stigmer.permission.asked' is a Stigmer event type");
  });

  it("previews only agent.message and agent.thinking", () => {
    expect(parseStreamQuery(new URLSearchParams("event_deltas%5B%5D=agent.message&event_deltas[]=agent.message"))).toEqual(
      { eventDeltas: ["agent.message"] },
    );
    const refused = parseStreamQuery(new URLSearchParams("event_deltas[]=stigmer.tool_output_delta"));
    expect(isLaneError(refused) && refused.status).toBe(400);
  });

  it("asks an unfiltered list for exactly the contract's Managed Agents types", () => {
    expect(MANAGED_AGENTS_EVENT_TYPES).toContain("user.message");
    expect(MANAGED_AGENTS_EVENT_TYPES).toContain("session.status_idle");
    expect(MANAGED_AGENTS_EVENT_TYPES.some((type) => type.startsWith("stigmer."))).toBe(false);
    expect(MANAGED_AGENTS_EVENT_TYPES.length).toBeLessThanOrEqual(64);
  });
});

describe("routes", () => {
  it("serves the two fixed shapes and nothing else under the prefix", () => {
    expect(routeOf("/v1/sessions/ses_1/events")).toEqual({ kind: "events", sessionId: "ses_1" });
    expect(routeOf("/v1/sessions/ses%5F1/events/stream")).toEqual({ kind: "stream", sessionId: "ses_1" });
    for (const path of [
      "/v1/sessions/",
      "/v1/sessions/ses_1",
      "/v1/sessions//events",
      "/v1/sessions/ses_1/events/",
      "/v1/sessions/ses_1/events/stream/x",
      "/v1/sessions/ses_1/threads",
      "/v1/sessions/%E0%A4%A/events",
      "/v1/agents",
    ]) {
      expect(routeOf(path), path).toBeUndefined();
    }
  });
});

function requestWith(headers: Record<string, string | string[]>): LaneRequest {
  return { headers } as unknown as LaneRequest;
}

describe("the caller headers a lane call carries", () => {
  it("turns X-Api-Key into a bearer token and keeps origin, and forwards nothing else", () => {
    const headers = forwardedHeaders(
      requestWith({
        "x-api-key": "stk_key",
        origin: "https://app.example",
        "x-stigmer-inprocess-caller": "forged",
        cookie: "a=b",
      }),
      true,
    );
    expect(isLaneError(headers)).toBe(false);
    expect([...(headers as Headers).entries()]).toEqual([
      ["authorization", "Bearer stk_key"],
      ["origin", "https://app.example"],
    ]);
  });

  it("forwards Authorization as it came, and accepts both headers when they agree", () => {
    expect((forwardedHeaders(requestWith({ authorization: "Bearer stk_a" }), true) as Headers).get("authorization")).toBe(
      "Bearer stk_a",
    );
    expect(
      (forwardedHeaders(requestWith({ authorization: "Bearer stk_a", "x-api-key": "stk_a" }), true) as Headers).get(
        "authorization",
      ),
    ).toBe("Bearer stk_a");
  });

  it("refuses two different credentials rather than choose", () => {
    const refused = forwardedHeaders(requestWith({ authorization: "Bearer stk_a", "x-api-key": "stk_b" }), true);
    expect(isLaneError(refused) && [refused.status, refused.type]).toEqual([401, "authentication_error"]);
  });

  it("forwards no credential where the server requires no sign-in", () => {
    const headers = forwardedHeaders(requestWith({ authorization: "Bearer x", "x-api-key": "local" }), false);
    expect([...(headers as Headers).keys()]).toEqual([]);
  });
});

describe("a send's whole-list check", () => {
  it("reads the three served events, joining a message's text blocks", () => {
    expect(
      parseSendBody({
        events: [
          { type: "user.message", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
          { type: "user.tool_confirmation", tool_use_id: "tu_1", result: "deny", deny_message: "no" },
          { type: "user.tool_confirmation", tool_use_id: "tu_2", result: "allow", deny_message: null },
          { type: "user.interrupt", session_thread_id: null },
        ],
      }),
    ).toEqual([
      { type: "user.message", text: "a\n\nb" },
      { type: "user.tool_confirmation", toolUseId: "tu_1", result: "deny", denyMessage: "no" },
      { type: "user.tool_confirmation", toolUseId: "tu_2", result: "allow", denyMessage: "" },
      { type: "user.interrupt" },
    ]);
  });

  it("refuses the whole list for one event it does not serve, naming the event", () => {
    const cases: Array<[unknown, string]> = [
      [{}, "the body must be an object with an events array"],
      [{ events: [] }, "events must hold at least one event"],
      [{ events: ["x"] }, "events[0]: each event must be an object with a type"],
      [
        { events: [{ type: "user.interrupt" }, { type: "user.tool_result", tool_use_id: "tu" }] },
        "events[1]: Stigmer does not serve 'user.tool_result' events; this API accepts user.message, user.tool_confirmation and user.interrupt",
      ],
      [{ events: [{ type: "system.message" }] }, "events[0]: Stigmer does not serve 'system.message' events"],
      [
        { events: [{ type: "user.message", content: [{ type: "image", source: {} }] }] },
        "events[0]: Stigmer accepts only text blocks in a user.message, not 'image'",
      ],
      [{ events: [{ type: "user.message", content: [] }] }, "needs at least one content block"],
      [{ events: [{ type: "user.message", content: [{ type: "text" }] }] }, "a text block needs its text"],
      [{ events: [{ type: "user.tool_confirmation", result: "allow" }] }, "needs its tool_use_id"],
      [{ events: [{ type: "user.tool_confirmation", tool_use_id: "t", result: "maybe" }] }, "must be allow or deny"],
      [
        { events: [{ type: "user.tool_confirmation", tool_use_id: "t", result: "deny", deny_message: 3 }] },
        "deny_message must be a string",
      ],
      [
        { events: [{ type: "user.tool_confirmation", tool_use_id: "t", result: "allow", deny_message: "x" }] },
        "deny_message is only allowed when result is deny",
      ],
      [{ events: [{ type: "user.interrupt", session_thread_id: "sthr_1" }] }, "session_thread_id must be absent"],
    ];
    for (const [body, message] of cases) {
      const refused = parseSendBody(body);
      expect(isLaneError(refused), message).toBe(true);
      expect(isLaneError(refused) ? refused.message : "").toContain(message);
    }
  });
});
