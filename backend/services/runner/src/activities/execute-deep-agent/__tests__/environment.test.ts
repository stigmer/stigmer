import { describe, it, expect, vi } from "vitest";
import { resolveEnvironment } from "../environment.js";

function createMockClient(execContext: any) {
  return {
    getExecutionContextByExecutionId: vi.fn().mockResolvedValue(execContext),
  } as any;
}

function createNotFoundClient() {
  return {
    getExecutionContextByExecutionId: vi.fn().mockRejectedValue(
      Object.assign(new Error("not found"), { code: 5 }),
    ),
  } as any;
}

describe("resolveEnvironment", () => {
  it("extracts plaintext environment variables", async () => {
    const client = createMockClient({
      spec: {
        data: {
          API_URL: { value: "https://api.example.com", isSecret: false },
          REGION: { value: "us-east-1", isSecret: false },
        },
      },
    });

    const result = await resolveEnvironment(client, "exec-1");

    expect(result.mergedEnvVars).toEqual({
      API_URL: "https://api.example.com",
      REGION: "us-east-1",
    });
    expect(result.secretKeys.size).toBe(0);
  });

  it("tracks secret keys separately", async () => {
    const client = createMockClient({
      spec: {
        data: {
          PUBLIC_KEY: { value: "pk_123", isSecret: false },
          SECRET_KEY: { value: "sk_456", isSecret: true },
          API_TOKEN: { value: "tok_789", isSecret: true },
        },
      },
    });

    const result = await resolveEnvironment(client, "exec-2");

    expect(Object.keys(result.mergedEnvVars)).toHaveLength(3);
    expect(result.secretKeys).toEqual(new Set(["SECRET_KEY", "API_TOKEN"]));
  });

  it("returns empty result when execution context not found", async () => {
    const client = createNotFoundClient();

    const result = await resolveEnvironment(client, "exec-no-ctx");

    expect(result.mergedEnvVars).toEqual({});
    expect(result.secretKeys.size).toBe(0);
  });

  it("returns empty result when spec.data is empty", async () => {
    const client = createMockClient({ spec: { data: {} } });

    const result = await resolveEnvironment(client, "exec-empty");

    expect(result.mergedEnvVars).toEqual({});
    expect(result.secretKeys.size).toBe(0);
  });

  it("returns empty result when spec.data is undefined", async () => {
    const client = createMockClient({ spec: {} });

    const result = await resolveEnvironment(client, "exec-no-data");

    expect(result.mergedEnvVars).toEqual({});
    expect(result.secretKeys.size).toBe(0);
  });

  it("propagates non-NOT_FOUND errors", async () => {
    const client = {
      getExecutionContextByExecutionId: vi.fn().mockRejectedValue(
        new Error("connection refused"),
      ),
    } as any;

    await expect(resolveEnvironment(client, "exec-err"))
      .rejects.toThrow("connection refused");
  });

  it("handles NOT_FOUND with lowercase code", async () => {
    const client = {
      getExecutionContextByExecutionId: vi.fn().mockRejectedValue(
        Object.assign(new Error("not found"), { code: "not_found" }),
      ),
    } as any;

    const result = await resolveEnvironment(client, "exec-lc");
    expect(result.mergedEnvVars).toEqual({});
  });
});
