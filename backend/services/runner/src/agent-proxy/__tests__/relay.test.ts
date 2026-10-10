/**
 * The local proxy's relay (`agent-proxy/relay.ts`) when the host or the
 * provider breaks off.
 *
 * Pinned:
 *  - a request body over the limit is refused, not buffered;
 *  - a host that hangs up mid-call ends the provider call too, so a dropped
 *    turn stops spending the operator's tokens;
 *  - a provider that breaks off mid-stream breaks the host's stream too, so
 *    a cut-off answer never reads as a complete one;
 *  - an error reply on a response already started destroys it rather than
 *    write a second head.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { FakeUpstream } from "../../__test-utils__/fake-upstream.js";
import { RequestTooLargeError, readBody, replyError } from "../relay.js";
import { AgentProxy } from "../server.js";

const HOST_TOKEN = "host-token-relay";
const EXECUTION = "aex-relay";
const upstream = new FakeUpstream();

beforeAll(() => upstream.start());
afterAll(() => upstream.stop());

async function proxied(): Promise<{ readonly proxy: AgentProxy; readonly close: () => Promise<void> }> {
  process.env.ANTHROPIC_BASE_URL = upstream.url;
  const proxy = await AgentProxy.start(testConfig({ proxyEndpoint: null }));
  proxy.authorizeHost(HOST_TOKEN);
  const closeTurn = proxy.openTurn({ executionId: EXECUTION, threadId: "thread-ses-relay" });
  return {
    proxy,
    close: async () => {
      closeTurn();
      await proxy.close();
      delete process.env.ANTHROPIC_BASE_URL;
      upstream.handler = undefined;
    },
  };
}

const asHost = { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION, "content-type": "application/json" };

describe("the relay when a side breaks off", () => {
  it("refuses a request body over the limit", async () => {
    const body = new PassThrough();
    const read = readBody(body, 4);
    body.write(Buffer.from("12345"));
    await expect(read).rejects.toBeInstanceOf(RequestTooLargeError);
  });

  it("ends the provider call when the host hangs up mid-call", async () => {
    let providerSawTheHangUp: () => void = () => {};
    const hungUp = new Promise<void>((resolve) => {
      providerSawTheHangUp = resolve;
    });
    upstream.handler = (req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: ping\n\n");
      res.on("close", () => providerSawTheHangUp());
      void req;
    };
    const { proxy, close } = await proxied();
    try {
      const controller = new AbortController();
      const res = await fetch(`${proxy.endpoint}/v1/proxy/llm/anthropic/v1/messages`, { method: "POST", headers: asHost, body: "{}", signal: controller.signal });
      expect(res.status).toBe(200);
      controller.abort();
      await hungUp;
    } finally {
      await close();
    }
  });

  it("breaks the host's stream when the provider breaks off mid-stream", async () => {
    upstream.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: message_start\n\n", () => res.socket?.destroy());
    };
    const { proxy, close } = await proxied();
    try {
      const res = await fetch(`${proxy.endpoint}/v1/proxy/llm/anthropic/v1/messages`, { method: "POST", headers: asHost, body: "{}" });
      expect(res.status).toBe(200);
      await expect(res.text()).rejects.toThrow();
    } finally {
      await close();
    }
  });
});

describe("an error reply", () => {
  it("destroys a response already started rather than write a second head", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("partial");
      replyError(res, 502, "too late for a status");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      // The head may never leave before the socket is destroyed; either way the host reads no complete answer.
      const read = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`).then((res) => res.text());
      await expect(read).rejects.toThrow();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
