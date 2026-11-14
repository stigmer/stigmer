// Command-level contract for `stigmer usage onboarding`, a platform
// operator's count of how far new organizations got on the journey from a
// first agent to their users: the window as typed, else the last week to
// today; each step's count and share of the organizations counted, with the
// team's own left out and said so; json as protojson; and two refusals in
// plain words: a caller who is no platform operator, and a server older
// than the count (never an Unimplemented error), each keeping the server's
// refusal as its cause so the help line still follows it.
//
// The backend client is replaced at its module (the command imports it
// lazily), so the test is offline and deterministic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { StigmerError } from "@stigmer/client";
import {
  GetOnboardingFunnelOutputSchema,
  type GetOnboardingFunnelOutput,
} from "@stigmer/apis/ai/stigmer/platform/v1/onboarding_funnel_pb";
import { OnboardingStepId } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";
import type { Config } from "../../config/index.js";
import type { BackendClient } from "../../client/index.js";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { buildProgram } from "../../program.js";
import { ONBOARDING_NOT_PERMITTED, ONBOARDING_NOT_SERVED, onboardingRange } from "../usage.js";

const CONFIG: Config = {
  backend: {},
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const server = {
  asked: [] as { from: string; to: string }[],
  answer: (): Promise<GetOnboardingFunnelOutput> =>
    Promise.resolve(
      create(GetOnboardingFunnelOutputSchema, {
        organizations: 40,
        excluded: 2,
        steps: [
          { id: OnboardingStepId.describe, reached: 31 },
          { id: OnboardingStepId.key, reached: 12 },
          { id: OnboardingStepId.watch, reached: 9 },
          { id: OnboardingStepId.make_yours, reached: 5 },
          { id: OnboardingStepId.in_app, reached: 3 },
          { id: OnboardingStepId.others, reached: 1 },
        ],
      }),
    ),
};

vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  return { ...actual, load: () => CONFIG };
});

vi.mock("../../backend.js", () => ({
  connectBackend: (): BackendClient =>
    ({
      stigmer: {
        platform: {
          getOnboardingFunnel: (window: { from: string; to: string }) => {
            server.asked.push(window);
            return server.answer();
          },
        },
      },
      config: CONFIG,
    }) as unknown as BackendClient,
}));

async function onboarding(...flags: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "usage", "onboarding", ...flags]);
}

describe("CLI-20 stigmer usage onboarding", () => {
  let written: string[];
  const answer = server.answer;

  beforeEach(() => {
    server.asked.length = 0;
    server.answer = answer;
    written = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts the window as typed, each step with its share of the organizations counted", async () => {
    await onboarding("--from", "2026-11-01", "--to", "2026-11-07");
    expect(server.asked).toEqual([{ from: "2026-11-01", to: "2026-11-07" }]);
    const text = written.join("");
    expect(text).toContain("New organizations: 40 (2 made by your own team left out)");
    expect(text).toMatch(/1 Said what it should do\s+31\s+78%/);
    expect(text).toMatch(/2 Added a model key\s+12\s+30%/);
    expect(text).toMatch(/6 Brought others in\s+1\s+3%/);
  });

  it("prints protojson for -o json, and as yaml for -o yaml", async () => {
    await onboarding("--from", "2026-11-01", "--to", "2026-11-07", "-o", "json");
    expect(JSON.parse(written.join(""))).toMatchObject({ organizations: 40, excluded: 2 });
    written.length = 0;
    await onboarding("--from", "2026-11-01", "--to", "2026-11-07", "-o", "yaml");
    expect(written.join("")).toContain("organizations: 40");
  });

  it("counts the last week to today when no window is given", () => {
    const now = new Date(Date.UTC(2026, 10, 14, 9, 30));
    expect(onboardingRange({}, now)).toEqual({ from: "2026-11-08", to: "2026-11-14" });
    expect(onboardingRange({ to: "2026-11-07" }, now)).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(onboardingRange({ from: "2026-10-01" }, now)).toEqual({ from: "2026-10-01", to: "2026-11-14" });
    // An end that is no day or instant is sent as typed with no start, for the server to refuse in its words.
    expect(onboardingRange({ to: "next week" }, now)).toEqual({ from: "", to: "next week" });
    expect(onboardingRange({ to: "2026-11-07T12:00:00Z" }, now)).toEqual({ from: "2026-11-01", to: "2026-11-07T12:00:00Z" });
  });

  it("says plainly that only a platform operator may read the count, keeping the refusal as its cause", async () => {
    const refusal = new StigmerError("permission-denied", "only platform operators can read onboarding counts", 7);
    server.answer = () => Promise.reject(refusal);
    const error = await onboarding().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).message).toBe(ONBOARDING_NOT_PERMITTED);
    expect((error as CliExitError).cause).toBe(refusal);
  });

  it("passes any other failure on as it came, for the CLI's own error handling", async () => {
    const outage = new StigmerError("unavailable", "server unreachable", 14);
    server.answer = () => Promise.reject(outage);
    await expect(onboarding()).rejects.toBe(outage);
  });

  it("says plainly that an older server does not count onboarding, never an Unimplemented error", async () => {
    server.answer = () => Promise.reject(new StigmerError("unknown", "not implemented", 12));
    await expect(onboarding()).rejects.toThrow(ONBOARDING_NOT_SERVED);
  });
});
