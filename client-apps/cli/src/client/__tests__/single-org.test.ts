// Pins the CLI's one question about its server (client/single-org.ts):
// whether it holds one organization, asked once per client, with a server that
// predates the field treated as one that holds several and a failed ask
// reported as itself and asked again; and the one guard, which
// refuses an empty organization only where the server needs one, naming the
// ways to set it.

import { describe, expect, it, vi } from "vitest";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../../errors/usage-error.js";
import { holdsOneOrganization, omitsOrganization, requireOrganization } from "../single-org.js";

function serverAnswering(answer: () => Promise<{ singleOrg: boolean | undefined }>) {
  const getServerInfo = vi.fn(answer);
  const stigmer = { platform: { getServerInfo } } as unknown as Stigmer;
  return { stigmer, getServerInfo };
}

describe("holdsOneOrganization", () => {
  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ] as const)("a server answering single_org %s holds one: %s", async (sent, held) => {
    const { stigmer } = serverAnswering(async () => ({ singleOrg: sent }));
    expect(await holdsOneOrganization(stigmer)).toBe(held);
  });

  it("asks once per client, sharing the pending answer", async () => {
    const { stigmer, getServerInfo } = serverAnswering(async () => ({ singleOrg: true }));
    await Promise.all([holdsOneOrganization(stigmer), holdsOneOrganization(stigmer)]);
    await holdsOneOrganization(stigmer);
    expect(getServerInfo).toHaveBeenCalledTimes(1);
  });

  it("a failed ask rejects with its own error and is asked again", async () => {
    let calls = 0;
    const { stigmer, getServerInfo } = serverAnswering(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("connect ECONNREFUSED 127.0.0.1:7234");
      }
      return { singleOrg: true };
    });
    await expect(holdsOneOrganization(stigmer)).rejects.toThrow("ECONNREFUSED");
    expect(await holdsOneOrganization(stigmer)).toBe(true);
    expect(getServerInfo).toHaveBeenCalledTimes(2);
  });
});

describe("omitsOrganization", () => {
  it("leaves the organization out on a server that holds one", async () => {
    const { stigmer } = serverAnswering(async () => ({ singleOrg: true }));
    expect(await omitsOrganization(stigmer)).toBe(true);
  });

  it("keeps it when the ask fails, so output never fails the command", async () => {
    const { stigmer } = serverAnswering(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:7234");
    });
    expect(await omitsOrganization(stigmer)).toBe(false);
  });
});

describe("requireOrganization", () => {
  const SET_IT_WITH = ["stigmer config context set --org <org>", "stigmer run --org <org> ..."];

  it("passes a named organization without asking the server", async () => {
    const { stigmer, getServerInfo } = serverAnswering(async () => ({ singleOrg: false }));
    await requireOrganization(stigmer, "acme", SET_IT_WITH);
    expect(getServerInfo).not.toHaveBeenCalled();
  });

  it("passes no organization on a server that holds one", async () => {
    const { stigmer } = serverAnswering(async () => ({ singleOrg: true }));
    await expect(requireOrganization(stigmer, "", SET_IT_WITH)).resolves.toBeUndefined();
  });

  it("reports a server it cannot reach as that, not as a missing organization", async () => {
    const { stigmer } = serverAnswering(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:7234");
    });
    const refusal = requireOrganization(stigmer, "", SET_IT_WITH);
    await expect(refusal).rejects.toThrow("ECONNREFUSED");
    await expect(refusal).rejects.not.toBeInstanceOf(UsageError);
  });

  it("refuses no organization on a server that holds several, naming the ways to set it", async () => {
    const { stigmer } = serverAnswering(async () => ({ singleOrg: false }));
    const refusal = requireOrganization(stigmer, "", SET_IT_WITH);
    await expect(refusal).rejects.toBeInstanceOf(UsageError);
    await expect(refusal).rejects.toThrow(
      "organization not set\n\nSet it with:\n" +
        "  stigmer config context set --org <org>\n" +
        "  stigmer run --org <org> ...",
    );
  });
});
