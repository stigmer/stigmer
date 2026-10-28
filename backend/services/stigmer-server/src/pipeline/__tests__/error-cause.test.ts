/**
 * Pins the cause-chain renderer the failure log lines carry
 * (error-cause.ts, stigmer/stigmer#1383): no field without a cause; the
 * chain nearest first; only name, string code and message per link, so a
 * `pg` error's `detail` never reaches a log line; an AggregateError's
 * inner messages when its own is empty; the depth bound; a cycle; a
 * non-Error cause; and the deepest Error's stack for the debug line.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { MAX_CAUSE_LINKS, causeFields, causeStack } from "../error-cause.js";
import { internalError } from "../errors.js";

/** The shape of a `pg` DatabaseError: SQLSTATE in `code`, row values in `detail`. */
function uniqueViolation(): Error {
  const error = new Error(
    'duplicate key value violates unique constraint "agents_slug_key"',
  );
  error.name = "DatabaseError";
  return Object.assign(error, {
    code: "23505",
    detail: "Key (slug)=(secret-customer-slug) already exists.",
  });
}

describe("causeFields", () => {
  it("adds nothing when the error has no cause", () => {
    expect(causeFields(new Error("plain"))).toEqual({});
    expect(causeFields("a string was thrown")).toEqual({});
    expect(causeFields(new ConnectError("nope", Code.NotFound))).toEqual({});
    expect(causeFields(internalError(undefined, "failed to load"))).toEqual({});
  });

  it("renders one level under an internalError", () => {
    const error = internalError(
      new Error("database is locked"),
      "failed to load plugin",
    );
    expect(causeFields(error)).toEqual({
      cause: "Error: database is locked",
    });
  });

  it("renders a nested chain nearest first, with a string code and without a driver's detail", () => {
    const wrapper = new Error("rename failed for agent 'a'", {
      cause: uniqueViolation(),
    });
    const error = internalError(wrapper, "internal server error");

    const { cause } = causeFields(error) as { cause: string };
    expect(cause).toBe(
      "Error: rename failed for agent 'a' <- " +
        'DatabaseError[23505]: duplicate key value violates unique constraint "agents_slug_key"',
    );
    expect(cause).not.toContain("secret-customer-slug");
  });

  it("renders an AggregateError's inner messages when its own is empty, at most three", () => {
    const refused = Object.assign(
      new AggregateError(
        [
          new Error("connect ECONNREFUSED ::1:5432"),
          new Error("connect ECONNREFUSED 127.0.0.1:5432"),
          new Error("connect ECONNREFUSED 10.0.0.1:5432"),
          new Error("connect ECONNREFUSED 10.0.0.2:5432"),
        ],
        "",
      ),
      { code: "ECONNREFUSED" },
    );
    const error = internalError(refused, "failed to connect");

    expect(causeFields(error)).toEqual({
      cause:
        "AggregateError[ECONNREFUSED]: connect ECONNREFUSED ::1:5432; " +
        "connect ECONNREFUSED 127.0.0.1:5432; connect ECONNREFUSED 10.0.0.1:5432; +1 more",
    });
  });

  it("stops after the depth bound and marks the rest", () => {
    let deepest: Error = new Error("link 7");
    for (let n = 6; n >= 1; n -= 1) {
      deepest = new Error(`link ${n}`, { cause: deepest });
    }
    const { cause } = causeFields(new Error("top", { cause: deepest })) as {
      cause: string;
    };
    const links = cause.split(" <- ");
    expect(links).toHaveLength(MAX_CAUSE_LINKS + 1);
    expect(links[0]).toBe("Error: link 1");
    expect(links[MAX_CAUSE_LINKS - 1]).toBe(`Error: link ${MAX_CAUSE_LINKS}`);
    expect(links[MAX_CAUSE_LINKS]).toBe("…");
  });

  it("stops on a cycle", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(causeFields(new Error("top", { cause: a }))).toEqual({
      cause: "Error: a <- Error: b",
    });
  });

  it("renders a non-Error cause with String()", () => {
    expect(causeFields(new Error("top", { cause: 42 }))).toEqual({
      cause: "42",
    });
    const unrenderable = {
      toString(): string {
        throw new Error("no");
      },
    };
    expect(causeFields(new Error("top", { cause: unrenderable }))).toEqual({
      cause: "[unrenderable cause]",
    });
  });
});

describe("causeStack", () => {
  it("is undefined without an Error under the thrown one", () => {
    expect(causeStack(new Error("plain"))).toBeUndefined();
    expect(causeStack(new Error("top", { cause: "text" }))).toBeUndefined();
  });

  it("returns the deepest Error's stack", () => {
    const driver = new Error("database is locked");
    const error = internalError(
      new Error("load failed", { cause: driver }),
      "failed to load plugin",
    );
    expect(causeStack(error)).toBe(driver.stack);
  });
});
