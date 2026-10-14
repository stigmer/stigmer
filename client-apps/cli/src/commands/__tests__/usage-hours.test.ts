// Command-level contract for `stigmer usage hours`: it asks the server
// whether it serves the subscription kind before calling it, so a server
// that counts no agent hours (open source) gets a plain sentence and a
// usage exit, never the RPC; a server that does is asked for the global
// --org's hours, and the line is printed.
//
// The backend client is replaced at its module (the command imports it
// lazily), so the test is offline and deterministic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  AgentHoursSchema,
  AgentHoursWindow,
  type AgentHours,
} from "@stigmer/protos/ai/stigmer/billing/subscription/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Config } from "../../config/index.js";
import type { BackendClient } from "../../client/index.js";
import { UsageError } from "../../errors/index.js";
import { buildProgram } from "../../program.js";
import { AGENT_HOURS_NOT_SERVED } from "../usage.js";

const CONFIG: Config = {
  backend: { type: "cloud" },
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const server = {
  serves: new Set<ApiResourceKind>(),
  asked: [] as string[],
};

vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  return { ...actual, load: () => CONFIG };
});

vi.mock("../../backend.js", () => ({
  connectBackend: (): BackendClient =>
    ({
      stigmer: {
        subscription: {
          getAgentHours: (input: { readonly org: string }): Promise<AgentHours> => {
            server.asked.push(input.org);
            return Promise.resolve(
              create(AgentHoursSchema, {
                workingSeconds: 11_520n,
                includedHours: 10,
                windowEnd: timestampFromMs(Date.UTC(2026, 10, 1)),
                window: AgentHoursWindow.calendar_month,
              }),
            );
          },
        },
      },
      config: CONFIG,
      isResourceAvailable: (kind: ApiResourceKind) => Promise.resolve(server.serves.has(kind)),
    }) as unknown as BackendClient,
}));

async function usageHours(): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--org", "acme", "usage", "hours"]);
}

describe("stigmer usage hours", () => {
  let written: string[];

  beforeEach(() => {
    server.serves.clear();
    server.asked.length = 0;
    written = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("on a server that serves no subscriptions, says so and never calls it", async () => {
    await expect(usageHours()).rejects.toThrow(new UsageError(AGENT_HOURS_NOT_SERVED));
    expect(server.asked).toEqual([]);
  });

  it("on a server that does, prints the organization's hours", async () => {
    server.serves.add(ApiResourceKind.subscription);
    await usageHours();
    expect(server.asked).toEqual(["acme"]);
    expect(written.join("")).toBe(
      "Agent hours: 3.2 h of 10 h used this month (resets 2026-11-01 UTC). New work pauses at the allowance.\n",
    );
  });
});
