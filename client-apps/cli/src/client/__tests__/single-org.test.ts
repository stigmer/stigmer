// Pins the CLI's one question about its server (client/single-org.ts):
// whether it holds one organization, asked once per client, with a server that
// cannot answer treated as one that holds several; and the one guard, which
// refuses an empty organization only where the server needs one, naming the
// ways to set it.

import { describe, expect, it, vi } from "vitest";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../../errors/usage-error.js";
import { holdsOneOrganization, requireOrganization } from "../single-org.js";

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

  it("a server that cannot answer holds several", async () => {
    const { stigmer } = serverAnswering(async () => {
      throw new Error("unreachable");
    });
    expect(await holdsOneOrganization(stigmer)).toBe(false);
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
