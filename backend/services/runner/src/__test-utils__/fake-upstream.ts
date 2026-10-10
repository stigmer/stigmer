/**
 * A provider, or the Stigmer platform's proxy, on loopback: records every
 * request it is sent and answers what the test tells it to. The agent
 * proxy's tests (`agent-proxy/__tests__/`) and the provider-lane tests
 * (`shared/__tests__/model-lanes.test.ts`) stand it where the network is.
 */

import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Received {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface UpstreamAnswer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export class FakeUpstream {
  /** A provider's streamed answer, with the headers an SDK reads. */
  static readonly DEFAULT_ANSWER: UpstreamAnswer = {
    status: 200,
    headers: { "content-type": "text/event-stream", "request-id": "req-upstream", "x-ratelimit-remaining": "41" },
    body: "event: message_start\ndata: {}\n\n",
  };

  readonly received: Received[] = [];
  answer: UpstreamAnswer = FakeUpstream.DEFAULT_ANSWER;
  /** When set, answers instead of {@link answer}: for a test that needs a slow or a broken upstream. */
  handler: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;
  url = "";
  private server: Server | undefined;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        this.received.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
        if (this.handler) {
          this.handler(req, res);
          return;
        }
        res.writeHead(this.answer.status, this.answer.headers);
        res.end(this.answer.body);
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  get last(): Received {
    const last = this.received.at(-1);
    if (!last) throw new Error("the upstream received nothing");
    return last;
  }
}
