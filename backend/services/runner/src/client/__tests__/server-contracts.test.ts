import { describe, it, expect } from "vitest";
import {
  assertCreateRequirements,
  assertReferenceRequirements,
  ServerContractError,
} from "../server-contracts.js";

describe("assertCreateRequirements", () => {
  const validResource = {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "AgentExecution",
    metadata: { name: "aex-test-123", org: "test-org" },
  };

  it("passes when name and org are provided", () => {
    expect(() => assertCreateRequirements(validResource, "AgentExecution", "test")).not.toThrow();
  });

  it("passes when slug is provided instead of name", () => {
    const resource = {
      ...validResource,
      metadata: { slug: "my-execution", org: "test-org" },
    };
    expect(() => assertCreateRequirements(resource, "AgentExecution", "test")).not.toThrow();
  });

  it("passes when id is provided (update-by-id path)", () => {
    const resource = {
      ...validResource,
      metadata: { id: "aex_abc123", org: "test-org" },
    };
    expect(() => assertCreateRequirements(resource, "AgentExecution", "test")).not.toThrow();
  });

  it("rejects when metadata has neither name, slug, nor id", () => {
    const resource = {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      metadata: { org: "test-org" },
    };
    expect(() => assertCreateRequirements(resource, "AgentExecution", "test"))
      .toThrow(/metadata.name or metadata.slug/);
  });

  it("rejects when org is missing", () => {
    const resource = {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      metadata: { name: "aex-test" },
    };
    expect(() => assertCreateRequirements(resource, "AgentExecution", "test"))
      .toThrow(/metadata.org for authorization/);
  });

  it("rejects wrong apiVersion", () => {
    const resource = {
      apiVersion: "wrong/v1",
      kind: "AgentExecution",
      metadata: { name: "aex-test", org: "org" },
    };
    expect(() => assertCreateRequirements(resource, "AgentExecution", "test"))
      .toThrow(/apiVersion must be/);
  });

  it("rejects wrong kind", () => {
    const resource = {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: { name: "aex-test", org: "org" },
    };
    expect(() => assertCreateRequirements(resource, "AgentExecution", "test"))
      .toThrow(/kind must be "AgentExecution"/);
  });

  it("rejects missing metadata entirely", () => {
    const resource = {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
    };
    expect(() => assertCreateRequirements(resource, "AgentExecution", "test"))
      .toThrow(/requires metadata/);
  });

  it("throws ServerContractError with caller context", () => {
    const resource = {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      metadata: { org: "test-org" },
    };
    try {
      assertCreateRequirements(resource, "AgentExecution", "createAgentExecution");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ServerContractError);
      expect((e as Error).message).toContain("createAgentExecution");
    }
  });
});

describe("assertReferenceRequirements", () => {
  it("passes when slug and org are provided", () => {
    expect(() => assertReferenceRequirements(
      { slug: "my-agent", org: "test-org", kind: 1 },
      "Agent",
      "test",
    )).not.toThrow();
  });

  it("rejects empty slug", () => {
    expect(() => assertReferenceRequirements(
      { slug: "", org: "test-org", kind: 1 },
      "Agent",
      "getAgentByReference",
    )).toThrow(/requires a non-empty slug/);
  });

  it("rejects missing slug", () => {
    expect(() => assertReferenceRequirements(
      { org: "test-org", kind: 1 },
      "Agent",
      "test",
    )).toThrow(/requires a non-empty slug/);
  });

  it("rejects empty org", () => {
    expect(() => assertReferenceRequirements(
      { slug: "my-agent", org: "", kind: 1 },
      "Agent",
      "test",
    )).toThrow(/requires org for scoped lookup/);
  });

  it("rejects missing org", () => {
    expect(() => assertReferenceRequirements(
      { slug: "my-agent", kind: 1 },
      "Agent",
      "test",
    )).toThrow(/requires org for scoped lookup/);
  });

  it("error message hints at placeholder resolution", () => {
    try {
      assertReferenceRequirements({ slug: "", org: "org" }, "Agent", "test");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("placeholder resolution");
    }
  });
});
