// A short-lived loopback HTTP server that receives Auth0's redirect carrying
// the authorization code. Lifecycle: new -> start -> waitForCallback -> shutdown.

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

  constructor(
    private readonly port: number,
    private readonly path: string,
  ) {}

  /** Bind and listen on 127.0.0.1, reporting a clear error if the port is taken. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.once("error", (err) => {
        reject(
          new CliExitError(
            `failed to start the login callback server on port ${this.port} (is it already in use?): ${err.message}`,
            ExitCode.General,
          ),
        );
      });
      server.listen(this.port, "127.0.0.1", () => {
        this.server = server;
        resolve();
      });
    });
  }

  /** Resolve when the OAuth callback arrives; reject on error or timeout. */
  waitForCallback(timeoutMs: number): Promise<CallbackResult> {
    return new Promise<CallbackResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new CliExitError("timed out waiting for authentication — please try again", ExitCode.General));
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);
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
