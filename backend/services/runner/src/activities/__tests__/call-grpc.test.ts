import { describe, it, expect } from "vitest";
import { createCallGrpcActivities } from "../call-grpc.js";

describe("createCallGrpcActivities", () => {
  it("creates activities object with CallGrpc method", () => {
    const activities = createCallGrpcActivities();
    expect(typeof activities.CallGrpc).toBe("function");
  });

  it("rejects with non-retryable error for missing proto file", async () => {
    const activities = createCallGrpcActivities();

    await expect(
      activities.CallGrpc(
        {
          proto: "/nonexistent/path/to/service.proto",
          service: { name: "test.Service", host: "localhost", port: 50051 },
          method: "Call",
        },
        {},
      ),
    ).rejects.toThrow("proto");
  });

  it("resolves runtime placeholders in service host", async () => {
    const activities = createCallGrpcActivities();

    await expect(
      activities.CallGrpc(
        {
          proto: "/nonexistent/service.proto",
          service: { name: "test.Service", host: "${.secrets.HOST}" },
          method: "Call",
        },
        { HOST: "resolved-host" },
      ),
    ).rejects.toThrow("proto");
  });
});
