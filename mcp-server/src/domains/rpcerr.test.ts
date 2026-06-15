import { Code, ConnectError } from "@connectrpc/connect";
import { beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../logger";
import { rpcError } from "./rpcerr";

beforeAll(() => configureLogger({ level: "error", format: "text" }));

const resource = 'agent "code-reviewer" in org "stigmer"';

describe("rpcError", () => {
  it("maps NotFound to a slug-guidance message", () => {
    expect(rpcError(new ConnectError("missing", Code.NotFound), resource).message).toBe(
      'agent "code-reviewer" in org "stigmer" not found. Verify the org and slug are correct.',
    );
  });

  it("maps PermissionDenied to an API-key-permissions message", () => {
    expect(rpcError(new ConnectError("nope", Code.PermissionDenied), resource).message).toBe(
      'Permission denied for agent "code-reviewer" in org "stigmer". Check your API key permissions.',
    );
  });

  it("maps Unauthenticated", () => {
    expect(rpcError(new ConnectError("bad token", Code.Unauthenticated), resource).message).toBe(
      "Authentication failed. Check your API key.",
    );
  });

  it("maps Unavailable", () => {
    expect(rpcError(new ConnectError("down", Code.Unavailable), resource).message).toBe(
      "Stigmer server is unavailable. Ensure it is running and reachable.",
    );
  });

  it("maps DeadlineExceeded", () => {
    expect(rpcError(new ConnectError("slow", Code.DeadlineExceeded), resource).message).toBe(
      "Request timed out contacting stigmer-server.",
    );
  });

  it("passes through the raw message for InvalidArgument", () => {
    expect(rpcError(new ConnectError("field x is required", Code.InvalidArgument), resource).message).toBe(
      "field x is required",
    );
  });

  it("wraps non-gRPC/unknown errors", () => {
    expect(rpcError(new Error("boom"), resource).message).toBe("unexpected error: boom");
  });

  it("maps every gRPC code to a non-empty message without throwing", () => {
    // Completeness guard: the default branch must catch any code the explicit
    // switch does not handle, so no gRPC status can ever surface a blank or
    // thrown error to the client.
    const codes = Object.values(Code).filter((c): c is Code => typeof c === "number");
    for (const code of codes) {
      const msg = rpcError(new ConnectError("detail", code), resource).message;
      expect(msg, `code ${Code[code]}`).toBeTruthy();
    }
  });
});
