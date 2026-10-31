// Pins that a generated client method forwarding a request takes the
// request's plain-object form, as the reference pages and the README show
// it: `list({ org, pageSize })`, `rename({ resourceId, slug })`, a stream's
// filters. A built message still compiles, since a message satisfies its
// own init shape. The calls sit in a function the test never runs, so
// typecheck holds them and nothing is sent.
import { create } from "@bufbuild/protobuf";
import { ListAgentsRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/io_pb";
import { describe, expect, it } from "vitest";

import type { AgentClient } from "../../gen/agent";
import type { SessionClient } from "../../gen/session";

async function callers(agent: AgentClient, session: SessionClient): Promise<void> {
  await agent.list({ org: "acme", pageSize: 25 });
  await agent.rename({ resourceId: "agt_1", slug: "support-bot" });
  await agent.updateVisibility({ resourceId: "agt_1" });
  for await (const event of session.streamEvents({ sessionId: "ses_1" })) {
    void event;
  }
  await agent.list(create(ListAgentsRequestSchema, { org: "acme" }));
}

describe("generated request-taking methods", () => {
  it("take a plain object or a built message, checked by typecheck", () => {
    expect(typeof callers).toBe("function");
  });
});
