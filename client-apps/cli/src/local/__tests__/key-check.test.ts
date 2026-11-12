// Contract for the CLI's Anthropic key check: Stigmer Cloud's rule, outcome
// for outcome (401 or 403 rejected, a 2xx accepted, anything else, a timeout
// or a fault unchecked), dialled at the base the runner sends the key to, with
// the key in `x-api-key` and the API version Anthropic requires, never
// following a redirect (a 3xx is unchecked: the key goes to no other host).
// The fetch is replaced, or dials two loopback servers; nothing leaves the
// machine.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ANTHROPIC_API_URL, checkAnthropicKey, type KeyCheckFetch } from "../key-check.js";

interface Dialled {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly redirect?: string;
}

function answering(status: number, dialled: Dialled[] = []): KeyCheckFetch {
  return async (url, init) => {
    dialled.push({ url, headers: init.headers, redirect: init.redirect });
    return { status };
  };
}

describe("checkAnthropicKey", () => {
  it("sends the key to Anthropic's own listing when no base URL is set", async () => {
    const dialled: Dialled[] = [];
    expect(await checkAnthropicKey("sk-ant-good", "", answering(200, dialled))).toBe("accepted");
    expect(dialled).toEqual([
      {
        url: `${ANTHROPIC_API_URL}/v1/models`,
        headers: { "x-api-key": "sk-ant-good", "anthropic-version": "2023-06-01" },
        redirect: "manual",
      },
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
    [302, "unchecked"],
    [307, "unchecked"],
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

  describe("a gateway that redirects", () => {
    const servers: Server[] = [];
    afterEach(async () => {
      await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    });
    async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
      const server = createServer(handler);
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    it("never carries the key to the host it redirects to, and calls the key unchecked", async () => {
      const keysSeenElsewhere: string[] = [];
      const elsewhere = await listen((req, res) => {
        keysSeenElsewhere.push(String(req.headers["x-api-key"] ?? ""));
        res.writeHead(200).end("{}");
      });
      const gateway = await listen((_req, res) => {
        res.writeHead(307, { location: `${elsewhere}/v1/models` }).end();
      });

      expect(await checkAnthropicKey("sk-ant-secret", gateway)).toBe("unchecked");
      expect(keysSeenElsewhere).toEqual([]);
    });
  });
});

