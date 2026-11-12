// Contract for the CLI's Anthropic key check: Stigmer Cloud's rule, outcome
// for outcome (401 or 403 rejected, a 2xx accepted, anything else, a timeout
// or a fault unchecked), dialled at the base the runner sends the key to, with
// the key in `x-api-key` and the API version Anthropic requires. The fetch is
// replaced; nothing leaves the machine.

import { describe, expect, it } from "vitest";
import { ANTHROPIC_API_URL, checkAnthropicKey, type KeyCheckFetch } from "../key-check.js";

interface Dialled {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function answering(status: number, dialled: Dialled[] = []): KeyCheckFetch {
  return async (url, init) => {
    dialled.push({ url, headers: init.headers });
    return { status };
  };
}

describe("checkAnthropicKey", () => {
  it("sends the key to Anthropic's own listing when no base URL is set", async () => {
    const dialled: Dialled[] = [];
    expect(await checkAnthropicKey("sk-ant-good", "", answering(200, dialled))).toBe("accepted");
    expect(dialled).toEqual([
      { url: `${ANTHROPIC_API_URL}/v1/models`, headers: { "x-api-key": "sk-ant-good", "anthropic-version": "2023-06-01" } },
    ]);
  });

  it("sends the key to the gateway the runner sends it to, trailing slash or not", async () => {
    const dialled: Dialled[] = [];
    await checkAnthropicKey("sk-ant-good", " http://127.0.0.1:9999/ ", answering(204, dialled));
    expect(dialled[0]?.url).toBe("http://127.0.0.1:9999/v1/models");
  });

  it.each([
    [401, "rejected"],
    [403, "rejected"],
    [200, "accepted"],
    [404, "unchecked"],
    [429, "unchecked"],
    [500, "unchecked"],
    [503, "unchecked"],
  ] as const)("reads %i as %s", async (status, outcome) => {
    expect(await checkAnthropicKey("sk-ant-key", "", answering(status))).toBe(outcome);
  });

  it("calls a network fault unchecked, never throwing", async () => {
    const failing: KeyCheckFetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await checkAnthropicKey("sk-ant-key", "", failing)).toBe("unchecked");
  });

  it("gives up after the timeout and calls the key unchecked", async () => {
    const hanging: KeyCheckFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      });
    const started = Date.now();
    expect(await checkAnthropicKey("sk-ant-key", "", hanging, 50)).toBe("unchecked");
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
