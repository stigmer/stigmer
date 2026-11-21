/**
 * Pins listByAgent's own refusal of an empty agent_id: protovalidate's
 * `required` refuses it first on the wire (run.test.ts), so this step is
 * the guard for a caller that reaches the pipeline without the interceptor
 * chain, and its copy names the wire field.
 */
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ListRunsByAgentRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";

import { errorOf, testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newValidateListByAgentRequestStep } from "../steps.js";

function contextFor(agentId: string): RequestContext<typeof RunQueryController.method.listByAgent.input> {
  return new RequestContext(
    RunQueryController.method.listByAgent.input,
    create(ListRunsByAgentRequestSchema, { agentId }),
    testCallerIdentity(),
  );
}

describe("ValidateListByAgentRequest", () => {
  it("refuses an empty agent_id with InvalidArgument naming the field", async () => {
    const error = await errorOf(async () => newValidateListByAgentRequestStep().execute(contextFor("")));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("agent_id is required");
  });

  it("passes a request that names an agent", async () => {
    await expect(Promise.resolve(newValidateListByAgentRequestStep().execute(contextFor("agt_1")))).resolves.toBeUndefined();
  });
});
