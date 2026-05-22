import { describe, it, expect, beforeEach } from "vitest";
import type { Transport } from "@connectrpc/connect";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionClient, type SessionInput } from "../../gen/session";

interface CapturedRequest {
  methodName: string;
  message: unknown;
}

function createCapturingTransport(): {
  transport: Transport;
  captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];

  const transport = {
    unary: async (
      method: { name: string },
      _signal: unknown,
      _timeout: unknown,
      _header: unknown,
      message: unknown,
    ) => ({
      header: new Headers(),
      trailer: new Headers(),
      message,
    }),
    stream: async () => {
      throw new Error("streaming not implemented in test transport");
    },
  } as unknown as Transport;

  const originalUnary = (transport as unknown as Record<string, unknown>).unary as (
    ...args: unknown[]
  ) => Promise<unknown>;

  (transport as unknown as Record<string, unknown>).unary = async (
    method: { name: string },
    signal: unknown,
    timeout: unknown,
    header: unknown,
    message: unknown,
    ...rest: unknown[]
  ) => {
    captured.push({ methodName: method.name, message });
    return originalUnary(method, signal, timeout, header, message, ...rest);
  };

  return { transport, captured };
}

describe("SessionClient proto serialization", () => {
  let client: SessionClient;
  let captured: CapturedRequest[];

  beforeEach(() => {
    const ctx = createCapturingTransport();
    client = new SessionClient(ctx.transport);
    captured = ctx.captured;
  });

  it("sets apiVersion and kind on the proto", async () => {
    await client.create({ name: "test-session", org: "my-org" });

    const proto = captured[0].message as Session;
    expect(proto.apiVersion).toBe("agentic.stigmer.ai/v1");
    expect(proto.kind).toBe("Session");
  });

  it("sets required fields on metadata", async () => {
    await client.create({ name: "my-session", org: "acme" });

    const proto = captured[0].message as Session;
    expect(proto.metadata?.name).toBe("my-session");
    expect(proto.metadata?.org).toBe("acme");
  });

  it("sets optional spec fields when provided", async () => {
    const input: SessionInput = {
      name: "s1",
      org: "o1",
      agentInstanceId: "ai-123",
      subject: "Help with deployment",
      threadId: "thread-abc",
      sandboxId: "sandbox-xyz",
    };

    await client.create(input);

    const proto = captured[0].message as Session;
    expect(proto.spec?.agentInstanceId).toBe("ai-123");
    expect(proto.spec?.subject).toBe("Help with deployment");
    expect(proto.spec?.threadId).toBe("thread-abc");
    expect(proto.spec?.sandboxId).toBe("sandbox-xyz");
  });

  it("does not overwrite protobuf defaults when optional fields are omitted", async () => {
    await client.create({ name: "minimal", org: "org" });

    const proto = captured[0].message as Session;
    expect(proto.spec?.agentInstanceId).toBe("");
    expect(proto.spec?.subject).toBe("");
    expect(proto.spec?.threadId).toBe("");
    expect(proto.spec?.sandboxId).toBe("");
  });

  it("serializes executionTarget when provided", async () => {
    await client.create({
      name: "s1",
      org: "o1",
      executionTarget: ExecutionTarget.LOCAL,
    });

    const proto = captured[0].message as Session;
    expect(proto.spec?.executionTarget).toBe(ExecutionTarget.LOCAL);
  });

  it("serializes metadata map when provided", async () => {
    await client.create({
      name: "s1",
      org: "o1",
      metadata: { env: "production", region: "us-east-1" },
    });

    const proto = captured[0].message as Session;
    expect(proto.spec?.metadata).toEqual({
      env: "production",
      region: "us-east-1",
    });
  });

  it("serializes workspace entries with git repo source", async () => {
    await client.create({
      name: "s1",
      org: "o1",
      workspaceEntries: [
        {
          name: "my-repo",
          source: {
            gitRepo: {
              url: "https://github.com/example/repo.git",
              branch: "main",
            },
          },
        },
      ],
    });

    const proto = captured[0].message as Session;
    const entries = proto.spec?.workspaceEntries;
    expect(entries).toHaveLength(1);
    expect(entries![0].name).toBe("my-repo");

    const source = entries![0].source;
    expect(source?.source?.case).toBe("gitRepo");
    if (source?.source?.case === "gitRepo") {
      expect(source.source.value.url).toBe(
        "https://github.com/example/repo.git",
      );
      expect(source.source.value.branch).toBe("main");
    }
  });

  it("serializes workspace entries with local path source", async () => {
    await client.create({
      name: "s1",
      org: "o1",
      workspaceEntries: [
        {
          name: "local",
          source: {
            localPath: { path: "/home/user/project" },
          },
        },
      ],
    });

    const proto = captured[0].message as Session;
    const entries = proto.spec?.workspaceEntries;
    expect(entries).toHaveLength(1);

    const source = entries![0].source;
    expect(source?.source?.case).toBe("localPath");
    if (source?.source?.case === "localPath") {
      expect(source.source.value.path).toBe("/home/user/project");
    }
  });

  it("routes create through the command controller", async () => {
    await client.create({ name: "s1", org: "o1" });
    expect(captured[0].methodName).toBe("create");
  });

  it("routes apply through the command controller", async () => {
    await client.apply({ name: "s1", org: "o1" });
    expect(captured[0].methodName).toBe("apply");
  });

  it("routes get through the query controller with SessionId", async () => {
    await client.get("session-id-123");
    const message = captured[0].message as { value: string };
    expect(captured[0].methodName).toBe("get");
    expect(message.value).toBe("session-id-123");
  });

  it("routes delete through the command controller with SessionId", async () => {
    await client.delete("session-id-456");
    const message = captured[0].message as { value: string };
    expect(captured[0].methodName).toBe("delete");
    expect(message.value).toBe("session-id-456");
  });
});
