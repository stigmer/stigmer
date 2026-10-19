/**
 * How a checked send applies, over fake native clients: a user.message is
 * a turn created in the session under the console's name and answered with
 * the user.message the server wrote with it (read back by the run's id);
 * a confirmation and an interrupt each go through their own method; the
 * events apply in order and the first failure stops the list with the
 * ones before it applied. A message's Files ride the turn by id; the
 * file check asks the File query only for an image block's type, refuses
 * one that is not an image, and lets the query's own refusal through.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { FileId } from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
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
import { checkSendFiles, serveSend, type SendEvent } from "../send.js";

/** The Files the harness's File query knows, by id, with their types. */
const FILE_TYPES: Readonly<Record<string, string>> = {
  file_shot: "image/png",
  file_brief: "application/pdf",
};

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
    fileQuery: {
      get: (input: FileId) => {
        seen.calls.push(`File.get ${input.value}`);
        const mimeType = FILE_TYPES[input.value];
        if (mimeType === undefined) {
          return Promise.reject(new ConnectError("file not found", Code.NotFound));
        }
        return Promise.resolve(create(FileSchema, { metadata: { id: input.value }, spec: { mimeType } }));
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
    await serveSend(call, [{ type: "user.message", text: "hello", files: [] }], response, () => 1234);
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
      { type: "user.message", text: "never sent", files: [] },
    ];
    await expect(serveSend(call, events, response, () => 0)).rejects.toThrow("the call no longer waits");
    expect(seen.calls).toEqual(["interrupt", "confirmToolUse"]);
  });

  it("is an internal fault when the turn's user.message cannot be read back", async () => {
    const { call, response } = harness({ noReadBack: true });
    await expect(serveSend(call, [{ type: "user.message", text: "x", files: [] }], response, () => 0)).rejects.toThrow(
      "the user.message was applied but its recorded event could not be read",
    );
  });

  it("names a message's Files by id on the turn it starts", async () => {
    const { seen, call, response } = harness();
    const files = [
      { fileId: "file_shot", block: "image" as const },
      { fileId: "file_brief", block: "document" as const },
    ];
    await serveSend(call, [{ type: "user.message", text: "see these", files }], response, () => 0);
    expect(seen.run?.spec?.fileIds).toEqual(["file_shot", "file_brief"]);
  });
});

describe("checkSendFiles", () => {
  it("passes an image block naming an image File and a document block naming any File, asking only for the image", async () => {
    const { seen, call } = harness();
    const events: SendEvent[] = [
      { type: "user.interrupt" },
      {
        type: "user.message",
        text: "",
        files: [
          { fileId: "file_shot", block: "image" },
          { fileId: "file_brief", block: "document" },
        ],
      },
    ];
    expect(await checkSendFiles(call, events)).toBeUndefined();
    expect(seen.calls).toEqual(["File.get file_shot"]);
  });

  it("refuses an image block naming a File that is not an image, naming the event and the type", async () => {
    const { call } = harness();
    const refused = await checkSendFiles(call, [
      { type: "user.message", text: "", files: [{ fileId: "file_brief", block: "image" }] },
    ]);
    expect(refused?.message).toBe("events[0]: file file_brief is application/pdf, not an image: send it in a document block");
  });

  it("lets the File query's own refusal through for a File the caller cannot read", async () => {
    const { call } = harness();
    await expect(
      checkSendFiles(call, [{ type: "user.message", text: "", files: [{ fileId: "file_none", block: "image" }] }]),
    ).rejects.toThrow("file not found");
  });
});
