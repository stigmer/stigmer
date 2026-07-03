/**
 * Deny-gate secret leak-scan (DD-26 follow-up #2) — the load-bearing guarantee.
 *
 * The runner-level analog of the offline Go `TestOffline_FileReview_
 * SecretUnderGlobalBypass_NeverPersisted`: assemble a realistic deny-gate status
 * whose transcript carries a secret-like write with its content, run the
 * Invariant-A backstop that BOTH harnesses call before persisting, then serialize
 * the whole status and assert none of the secret bytes survive.
 *
 * An offline end-to-end test is structurally infeasible for this path (DD-23 /
 * DD-26 F3: the offline harness always runs a git workspace with LocalArtifactDir,
 * so deriveCaptureMode is always true and the no-storage deny-gate is unreachable).
 * This test exercises the exact function both `execute-deep-agent/index.ts` and the
 * Cursor `persist` wrapper invoke, over a full AgentExecutionStatus.
 */

import { describe, it, expect } from "vitest";
import { create, toJsonString } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ToolCallStatus, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { withholdSecretContentFromMessages } from "../tool-row.js";

const SECRET = "API_KEY=SUPER_SECRET_LEAK_TOKEN_9f3a";

function secretWriteRow(id: string, path: string) {
  return create(ToolCallSchema, {
    id,
    name: "write",
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    result: "wrote file",
    argsPreview: JSON.stringify({ path, content: SECRET }),
    args: { path, content: SECRET },
  });
}

describe("deny-gate secret leak-scan", () => {
  it("no secret bytes survive in the serialized status (top-level + sub-agent), non-secret content preserved", () => {
    const status = create(AgentExecutionStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          toolCalls: [
            secretWriteRow("tc-secret", ".env"),
            // A non-secret write in the same turn must keep its content (the
            // backstop is scoped to secret-like paths only).
            create(ToolCallSchema, {
              id: "tc-ok",
              name: "write",
              status: ToolCallStatus.TOOL_CALL_COMPLETED,
              argsPreview: JSON.stringify({ path: "notes.md" }),
              args: { path: "notes.md", content: "PUBLIC_NOTES_BODY" },
            }),
          ],
        }),
      ],
      subAgentExecutions: [
        create(SubAgentExecutionSchema, {
          id: "sa-1",
          messages: [
            create(AgentMessageSchema, {
              type: MessageType.MESSAGE_AI,
              toolCalls: [secretWriteRow("tc-sa-secret", "config/credentials.json")],
            }),
          ],
        }),
      ],
    });

    // The mechanism both harnesses call before every persist.
    withholdSecretContentFromMessages(status.messages, status.subAgentExecutions);

    const serialized = toJsonString(AgentExecutionStatusSchema, status);
    expect(serialized).not.toContain(SECRET);
    // The paths remain (a filename is not the secret); non-secret content survives.
    expect(serialized).toContain(".env");
    expect(serialized).toContain("config/credentials.json");
    expect(serialized).toContain("PUBLIC_NOTES_BODY");
  });

  it("global bypass: the backstop is the sole guarantee when no gate scrubbed the row", () => {
    // Under auto_approve_all neither harness installs a gate, so a secret write
    // flows and its content lands on the streamed row unscrubbed. The backstop —
    // called unconditionally before persist — is the only thing standing between
    // that row and durable storage.
    const status = create(AgentExecutionStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          toolCalls: [secretWriteRow("tc-flowed", ".aws/credentials")],
        }),
      ],
    });

    withholdSecretContentFromMessages(status.messages, status.subAgentExecutions);

    const serialized = toJsonString(AgentExecutionStatusSchema, status);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).toContain(".aws/credentials"); // path kept, honest record
  });
});
