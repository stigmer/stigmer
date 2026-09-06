// A fake Discord channel webhook receiver.
// Domain: conformance harness (cloud-capability fixtures, E1).
//
// The marketing-site lead notifier posts an embed to a Discord channel
// webhook and treats delivery as part of the request: a non-2xx from Discord
// makes POST /api/v1/public/leads/contact-sales answer 502 (fail-loud, no
// queue, no retry — DD-012 pins the site contract). The server is booted with
// its leads webhook URL pointed here so the public suite can assert both the
// embed Java sends (title, fields, footer, truncation) and the 502 posture by
// scripting the next delivery to fail. The billing governance notifier posts
// through the same Discord client; C5 may reuse this fixture for it.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readBody } from "./fake-llm-upstream";

export interface CapturedDiscordPost {
  readonly path: string;
  readonly body: unknown;
}

export class FakeDiscordWebhook {
  private server: Server | undefined;
  private captured: CapturedDiscordPost[] = [];
  private failNextStatus: number | undefined;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
  }

  async close(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    this.server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  // The webhook URL the server is booted with. Discord's shape is
  // /api/webhooks/<id>/<token>; the fixture accepts any path under it.
  url(): string {
    if (this.server === undefined) throw new Error("FakeDiscordWebhook.start() must be called before url()");
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}/api/webhooks/conformance/token`;
  }

  posts(): readonly CapturedDiscordPost[] {
    return this.captured;
  }

  // The next delivery answers this status (e.g. 429, 500) — the notifier's
  // fail-loud arm.
  failNext(status: number): void {
    this.failNextStatus = status;
  }

  reset(): void {
    this.captured = [];
    this.failNextStatus = undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req);
    let body: unknown;
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = raw;
    }
    this.captured.push({ path: new URL(req.url ?? "/", "http://fake").pathname, body });
    const status = this.failNextStatus ?? 204;
    this.failNextStatus = undefined;
    res.writeHead(status);
    res.end();
  }
}
