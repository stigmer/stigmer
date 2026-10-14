// Pins the readiness gate every managed target boots through: it polls the
// organization list until the server answers, and returns on the first
// answer, so a server still opening its store is waited for rather than
// failed.
import { describe, expect, it } from "vitest";

import type { ConformanceClients } from "../clients";
import { awaitGrpcReady } from "../grpc-ready";

describe("awaitGrpcReady", () => {
  it("polls until the organization list answers, then returns", async () => {
    let calls = 0;
    const clients = {
      organizationQuery: {
        listMine: () => {
          calls += 1;
          return calls < 3 ? Promise.reject(new Error("store opening")) : Promise.resolve({ entries: [] });
        },
      },
    } as unknown as ConformanceClients;
    await awaitGrpcReady(clients, () => "");
    expect(calls).toBe(3);
  });
});
