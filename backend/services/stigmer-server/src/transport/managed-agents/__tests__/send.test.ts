/**
 * How a checked send applies, over fake native clients: a user.message is
 * a turn created in the session under the console's name and answered with
 * the user.message the server wrote with it (read back by the run's id);
 * a confirmation and an interrupt each go through their own method; the
 * events apply in order and the first failure stops the list with the
 * ones before it applied.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  InterruptSessionResponseSchema,
  SessionEventListSchema,
  type ConfirmToolUseInput,
  type InterruptSessionInput,
  type ListSessionEventsRequest,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";

import type { LaneResponse } from "../../lanes.js";
import type { LaneCall, LaneClients } from "../call.js";
import { serveSend, type SendEvent } from "../send.js";

interface Seen {
  readonly calls: string[];
  run?: Run;
  readBack?: ListSessionEventsRequest;
  confirmation?: ConfirmToolUseInput;
  interrupt?: InterruptSessionInput;
}

function harness(options: { readonly failConfirmation?: boolean; readonly noReadBack?: boolean } = {}) {
  const seen: Seen = { calls: [] };
  const clients = {
    runCommand: {
      create: (run: Run) => {
        seen.calls.push("Run.create");
        seen.run = run;
        return Promise.resolve(create(RunSchema, { metadata: { id: "run_1" } }));
      },
    },
    sessionQuery: {
      listEvents: (request: ListSessionEventsRequest) => {
        seen.calls.push("listEvents");
        seen.readBack = request;
        return Promise.resolve(
          create(SessionEventListSchema, {
            events: options.noReadBack
              ? []
              : [
                  create(SessionEventSchema, {
                    seq: 4n,
                    runId: "run_1",
                    event: {
                      case: "userMessage",
                      value: { id: "sevt_msg", content: [{ type: "text", text: "hello" }], processedAt: "t" },
                    },
                  }),
                ],
          }),
        );
      },
    },
    sessionCommand: {
      confirmToolUse: (input: ConfirmToolUseInput) => {
        seen.calls.push("confirmToolUse");
        seen.confirmation = input;
        if (options.failConfirmation === true) {
          return Promise.reject(new ConnectError("the call no longer waits", Code.FailedPrecondition));
        }
        return Promise.resolve(
          create(SessionEventSchema, {
            event: {
              case: "userToolConfirmation",
              value: { id: "sevt_conf", toolUseId: input.toolUseId, result: input.result, denyMessage: input.denyMessage },
            },
          }),
        );
      },
      interrupt: (input: InterruptSessionInput) => {
        seen.calls.push("interrupt");
        seen.interrupt = input;
        return Promise.resolve(
          create(InterruptSessionResponseSchema, {
            event: create(SessionEventSchema, { event: { case: "userInterrupt", value: { id: "sevt_int" } } }),
          }),
        );
      },
    },
  };
  const call: LaneCall = {
    sessionId: "ses_1",
    clients: clients as unknown as LaneClients,
    options: { headers: new Headers(), signal: new AbortController().signal },
    requestId: "req_test",
  };
  let body = "";
  let status = 0;
  const response = {
    set statusCode(value: number) {
      status = value;
    },
    setHeader: () => undefined,
    end: (chunk: string) => {
      body = chunk;
    },
  } as unknown as LaneResponse;
  return { seen, call, response, answer: () => ({ status, body: JSON.parse(body) as unknown }) };
}

describe("serveSend", () => {
  it("starts a turn for a user.message and answers with the event written with it", async () => {
    const { seen, call, response, answer } = harness();
    await serveSend(call, [{ type: "user.message", text: "hello" }], response, () => 1234);
    expect(seen.run).toMatchObject({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Run",
      metadata: { name: "run-1234", org: "" },
      spec: { target: { case: "sessionId", value: "ses_1" }, message: "hello" },
    });
    expect(seen.readBack).toMatchObject({ sessionId: "ses_1", runId: "run_1", types: ["user.message"], pageSize: 1 });
    expect(answer()).toEqual({
      status: 200,
      body: { data: [{ type: "user.message", id: "sevt_msg", content: [{ type: "text", text: "hello" }], processed_at: "t" }] },
    });
  });

  it("answers a confirmation and an interrupt through their own methods, in order", async () => {
    const { seen, call, response, answer } = harness();
    const events: SendEvent[] = [
      { type: "user.tool_confirmation", toolUseId: "tu_1", result: "deny", denyMessage: "not that" },
      { type: "user.interrupt" },
    ];
    await serveSend(call, events, response, () => 0);
    expect(seen.calls).toEqual(["confirmToolUse", "interrupt"]);
    expect(seen.confirmation).toMatchObject({ sessionId: "ses_1", toolUseId: "tu_1", result: "deny", denyMessage: "not that" });
    expect(seen.interrupt).toMatchObject({ sessionId: "ses_1", sessionThreadId: "" });
    const { body } = answer() as { body: { data: Array<{ type: string; id: string }> } };
    expect(body.data.map((event) => [event.type, event.id])).toEqual([
      ["user.tool_confirmation", "sevt_conf"],
      ["user.interrupt", "sevt_int"],
    ]);
  });

  it("stops at the first failure, the events before it applied and none after", async () => {
    const { seen, call, response } = harness({ failConfirmation: true });
    const events: SendEvent[] = [
      { type: "user.interrupt" },
      { type: "user.tool_confirmation", toolUseId: "tu_1", result: "allow", denyMessage: "" },
      { type: "user.message", text: "never sent" },
    ];
    await expect(serveSend(call, events, response, () => 0)).rejects.toThrow("the call no longer waits");
    expect(seen.calls).toEqual(["interrupt", "confirmToolUse"]);
  });

  it("is an internal fault when the turn's user.message cannot be read back", async () => {
    const { call, response } = harness({ noReadBack: true });
    await expect(serveSend(call, [{ type: "user.message", text: "x" }], response, () => 0)).rejects.toThrow(
      "the user.message was applied but its recorded event could not be read",
    );
  });
});
