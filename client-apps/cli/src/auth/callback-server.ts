// A short-lived loopback HTTP server that receives the identity provider's
// redirect carrying the authorization code. Lifecycle: new -> start ->
// waitForCallback -> shutdown.
//
// It binds 127.0.0.1 on the first free port of the list it is given: the
// loopback callbacks an operator registers for the native client
// (`http://127.0.0.1:17234-17236/auth/callback`, the same three the desktop
// app's debug build returns to), so a second sign-in running elsewhere on the
// machine takes the next port instead of failing.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { CliExitError, ExitCode } from "../errors/index.js";
import { HOLDING_PAGE, renderErrorPage, SUCCESS_PAGE } from "./pages.js";

export interface CallbackResult {
  readonly code: string;
  readonly state: string;
}

type Settler = {
  resolve(result: CallbackResult): void;
  reject(error: Error): void;
};

export class CallbackServer {
  private server?: Server;
  private settler?: Settler;
  private boundPort?: number;

  constructor(
    private readonly ports: readonly number[],
    private readonly path: string,
  ) {}

  /** The port bound by {@link start}. */
  get port(): number {
    if (this.boundPort === undefined) throw new Error("callback server not started");
    return this.boundPort;
  }

  /** The redirect address the provider calls back on. */
  get redirectUri(): string {
    return `http://127.0.0.1:${this.port}${this.path}`;
  }

  /** Bind 127.0.0.1 on the first free port, reporting a clear error when none is. */
  async start(): Promise<void> {
    const failures: string[] = [];
    for (const port of this.ports) {
      try {
        this.server = await listen(port, (req, res) => this.handle(req, res));
        this.boundPort = port;
        return;
      } catch (err) {
        failures.push(`${port}: ${(err as Error).message}`);
      }
    }
    throw new CliExitError(
      `failed to start the sign-in callback on 127.0.0.1 (ports ${this.ports.join(", ")} are in use)`,
      ExitCode.General,
      ["Finish or stop the other sign-in, then try again.", ...failures.map((f) => `  ${f}`)],
    );
  }

  /** Resolve when the OAuth callback arrives; reject on error or timeout. */
  waitForCallback(timeoutMs: number): Promise<CallbackResult> {
    return new Promise<CallbackResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new CliExitError("the sign-in wasn't finished in the browser in time, so nothing was saved", ExitCode.General, [
            "Run 'stigmer auth login' again and finish signing in on the page it opens.",
            "Where no browser can open here, run 'stigmer auth login --device' instead.",
          ]),
        );
      }, timeoutMs);
      this.settler = {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  async shutdown(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.boundPort ?? 0}`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    if (url.pathname !== this.path) {
      res.end(HOLDING_PAGE);
      return;
    }

    const errorCode = url.searchParams.get("error");
    if (errorCode !== null) {
      const description = url.searchParams.get("error_description") ?? "";
      const message =
        errorCode === "access_denied" ? "You cancelled the login process." : "Authentication was cancelled or denied.";
      res.end(renderErrorPage(message, errorCode, description));
      this.settler?.reject(
        new CliExitError(`authentication failed: ${errorCode}${description ? ` — ${description}` : ""}`, ExitCode.Auth),
      );
      return;
    }

    const code = url.searchParams.get("code");
    if (code === null || code === "") {
      res.end(
        renderErrorPage("No authorization code received.", "missing_code", "The callback did not contain a code."),
      );
      this.settler?.reject(new CliExitError("callback did not contain an authorization code", ExitCode.Auth));
      return;
    }

    res.end(SUCCESS_PAGE);
    this.settler?.resolve({ code, state: url.searchParams.get("state") ?? "" });
  }
}

function listen(port: number, handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}
