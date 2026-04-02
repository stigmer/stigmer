import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StigmerProvider } from "../../provider";
import { createDemoClient } from "../client";
import { DemoTransport } from "../transport";
import { rpcKey } from "../types";

describe("createDemoClient", () => {
  it("returns a client accepted by StigmerProvider", () => {
    const client = createDemoClient({ fixtures: new Map() });

    render(
      <StigmerProvider client={client}>
        <div data-testid="child">rendered</div>
      </StigmerProvider>,
    );

    expect(screen.getByTestId("child").textContent).toBe("rendered");
  });

  it("provides all expected resource clients", () => {
    const client = createDemoClient({ fixtures: new Map() });

    expect(client.agent).toBeDefined();
    expect(client.agentExecution).toBeDefined();
    expect(client.agentInstance).toBeDefined();
    expect(client.apiKey).toBeDefined();
    expect(client.environment).toBeDefined();
    expect(client.executionContext).toBeDefined();
    expect(client.iamPolicy).toBeDefined();
    expect(client.identityAccount).toBeDefined();
    expect(client.identityProvider).toBeDefined();
    expect(client.mcpServer).toBeDefined();
    expect(client.organization).toBeDefined();
    expect(client.project).toBeDefined();
    expect(client.session).toBeDefined();
    expect(client.skill).toBeDefined();
    expect(client.workflow).toBeDefined();
    expect(client.workflowExecution).toBeDefined();
    expect(client.workflowInstance).toBeDefined();
    expect(client.search).toBeDefined();
    expect(client.github).toBeDefined();
  });
});

describe("DemoTransport", () => {
  it("calls unary fixture handler and returns its result", async () => {
    const fixtureResponse = { id: "test-123", name: "mock-session" };
    const fixtures = new Map([
      [
        "test.Service/get",
        { unary: () => fixtureResponse },
      ],
    ]);

    const transport = new DemoTransport(fixtures);
    const result = await transport.unary(
      { parent: { typeName: "test.Service" }, name: "get" },
      undefined,
      undefined,
      undefined,
      { id: "test-123" },
    );

    expect(result.stream).toBe(false);
    expect(result.message).toBe(fixtureResponse);
    expect(result.header).toBeInstanceOf(Headers);
    expect(result.trailer).toBeInstanceOf(Headers);
  });

  it("passes request to unary fixture handler", async () => {
    const request = { value: "session-42" };
    let receivedRequest: unknown;

    const fixtures = new Map([
      [
        "test.Service/get",
        {
          unary: (req: unknown) => {
            receivedRequest = req;
            return {};
          },
        },
      ],
    ]);

    const transport = new DemoTransport(fixtures);
    await transport.unary(
      { parent: { typeName: "test.Service" }, name: "get" },
      undefined,
      undefined,
      undefined,
      request,
    );

    expect(receivedRequest).toBe(request);
  });

  it("calls stream fixture handler and yields results", async () => {
    const items = [
      { id: "1", status: "running" },
      { id: "1", status: "completed" },
    ];

    const fixtures = new Map([
      [
        "test.Service/subscribe",
        { stream: () => items },
      ],
    ]);

    const transport = new DemoTransport(fixtures);

    async function* singleMessage() {
      yield { value: "exec-1" };
    }

    const result = await transport.stream(
      { parent: { typeName: "test.Service" }, name: "subscribe" },
      undefined,
      undefined,
      undefined,
      singleMessage(),
    );

    expect(result.stream).toBe(true);

    const collected: unknown[] = [];
    for await (const msg of result.message) {
      collected.push(msg);
    }
    expect(collected).toEqual(items);
  });

  it("throws descriptive error for missing unary fixture", async () => {
    const transport = new DemoTransport(new Map());

    await expect(
      transport.unary(
        {
          parent: {
            typeName:
              "ai.stigmer.agentic.session.v1.SessionQueryController",
          },
          name: "get",
        },
        undefined,
        undefined,
        undefined,
        {},
      ),
    ).rejects.toThrow("No demo fixture for SessionQueryController/get");
  });

  it("throws descriptive error for missing stream fixture", async () => {
    const transport = new DemoTransport(new Map());

    async function* empty() {
      yield {};
    }

    await expect(
      transport.stream(
        {
          parent: {
            typeName:
              "ai.stigmer.agentic.agentexecution.v1.AgentExecutionQueryController",
          },
          name: "subscribe",
        },
        undefined,
        undefined,
        undefined,
        empty(),
      ),
    ).rejects.toThrow(
      "No demo fixture for AgentExecutionQueryController/subscribe",
    );
  });

  it("includes the full fixture key in the error message", async () => {
    const transport = new DemoTransport(new Map());

    await expect(
      transport.unary(
        {
          parent: {
            typeName:
              "ai.stigmer.agentic.session.v1.SessionQueryController",
          },
          name: "get",
        },
        undefined,
        undefined,
        undefined,
        {},
      ),
    ).rejects.toThrow(
      'key "ai.stigmer.agentic.session.v1.SessionQueryController/get"',
    );
  });
});

describe("rpcKey", () => {
  it("constructs a fixture key from service descriptor and method name", () => {
    const service = {
      typeName: "ai.stigmer.agentic.session.v1.SessionQueryController",
    };
    expect(rpcKey(service, "get")).toBe(
      "ai.stigmer.agentic.session.v1.SessionQueryController/get",
    );
  });
});
