// ---------------------------------------------------------------------------
// connect — what the server's answer, or its silence, means for the app
//
// Pure functions over getServerInfo's answer and its failure. Pinned: the
// four outcomes (open, sign-in through the announced provider, not set up
// for the app, including a server from before the field), the name the
// screens give a server (the cloud edition's, else its host), and the line
// between a server nothing answered for and an answer that is not a Stigmer
// server's.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { connectFailureOf, connectOutcome, hostOf, serverLabel } from "../connect";

const ACME = { issuer: "https://id.acme.internal/", audience: "https://stigmer.acme.internal", clientId: "acme-desktop" };

describe("DSK-07 connectOutcome", () => {
  it("opens the app on a server that trusts every request", () => {
    expect(connectOutcome({ authenticationRequired: false, nativeSignIn: undefined })).toEqual({ kind: "open" });
  });

  it("signs in through the provider a server that signs people in announced", () => {
    expect(connectOutcome({ authenticationRequired: true, nativeSignIn: ACME })).toEqual({
      kind: "sign-in",
      nativeSignIn: ACME,
    });
  });

  it("says a server that signs people in without a client for the app is not set up for it", () => {
    expect(connectOutcome({ authenticationRequired: true, nativeSignIn: undefined })).toEqual({ kind: "not-set-up" });
  });

  it("reads a server from before the field as not set up, never as open", () => {
    expect(connectOutcome({ authenticationRequired: undefined, nativeSignIn: undefined })).toEqual({
      kind: "not-set-up",
    });
    expect(connectOutcome({ authenticationRequired: undefined, nativeSignIn: ACME })).toEqual({ kind: "not-set-up" });
  });
});

describe("serverLabel", () => {
  it("names the cloud edition Stigmer Cloud, whatever its address", () => {
    expect(serverLabel({ deploymentMode: "cloud" }, "https://api.stigmer.ai")).toBe("Stigmer Cloud");
    expect(serverLabel({ deploymentMode: "cloud" }, "http://localhost:7234")).toBe("Stigmer Cloud");
  });

  it("names any other server by its host, port included", () => {
    expect(serverLabel({ deploymentMode: "local" }, "https://stigmer.acme.internal")).toBe("stigmer.acme.internal");
    expect(serverLabel({ deploymentMode: "enterprise" }, "http://127.0.0.1:7234")).toBe("127.0.0.1:7234");
    expect(serverLabel(undefined, "https://stigmer.acme.internal:8443")).toBe("stigmer.acme.internal:8443");
  });

  it("falls back to the text it was given when it is not an address", () => {
    expect(hostOf("not an address")).toBe("not an address");
  });
});

describe("DSK-07 connectFailureOf", () => {
  /**
   * Connect's error, as `@connectrpc/connect` builds it: `ConnectError.from`
   * keeps the transport's own failure as `cause` when a request never got an
   * answer; an error built from a response (`HTTP 404`, a missing trailer)
   * has none.
   */
  function connectError(message: string, cause?: unknown): Error {
    return Object.assign(new Error(message), { name: "ConnectError", cause });
  }

  /** The client's error for a call: `wrapError` keeps Connect's as `cause`. */
  function clientError(code: string, connect: Error): Error {
    return Object.assign(new Error(connect.message), { name: "StigmerError", code, cause: connect });
  }

  it("reads a request that never got an answer as a server it cannot reach", () => {
    const refused = "error sending request: Connection refused (os error 61)";
    expect(connectFailureOf(clientError("unknown", connectError(refused, refused)))).toBe("unreachable");
    const dns = new TypeError("failed to lookup address information");
    expect(connectFailureOf(clientError("unknown", connectError(dns.message, dns)))).toBe("unreachable");
  });

  it("reads a proxy that cannot reach its upstream as a server it cannot reach", () => {
    expect(connectFailureOf(clientError("unavailable", connectError("HTTP 503")))).toBe("unreachable");
  });

  it("reads an answer that is not a Stigmer server's as such", () => {
    expect(connectFailureOf(clientError("unimplemented", connectError("HTTP 404")))).toBe("not-stigmer");
    expect(connectFailureOf(clientError("unknown", connectError("missing trailer")))).toBe("not-stigmer");
  });

  it("does not read a Connect error nested in a Connect error as a transport failure", () => {
    const inner = connectError("HTTP 404");
    expect(connectFailureOf(clientError("unknown", connectError("wrapped", inner)))).toBe("not-stigmer");
  });
});
