/**
 * Pins the console resolver's two contracts against a realistic export
 * shape (the file inventory mirrors client-apps/web/out):
 *
 *   - the PAGE contract: nginx.conf's try_files chain — literal, .html
 *     sibling, directory index, placeholder candidates most-literal-first,
 *     trailing-slash canonicalization, 404 posture (the full route-tree
 *     equivalence against the parsed nginx model lives in
 *     nginx-equivalence.test.ts; these arms pin the semantics readably);
 *   - the RSC FLIGHT contract: the retired Go handler's `.txt` rewrites
 *     (page-level twins and nested `__next.*.txt` payloads), including the
 *     two-dynamic-segment routes the Go handler's single-substitution
 *     loop could not resolve.
 */
import { describe, expect, it } from "vitest";

import {
  buildConsoleFileIndex,
  resolveConsoleRequest,
  type ConsoleResolution,
} from "../resolver.js";

// The realistic export inventory: static pages, one- and two-dynamic-
// segment routes, a literal-beats-dynamic sibling pair under /workflows,
// root-level RSC payloads, and build assets.
const index = buildConsoleFileIndex([
  "/index.html",
  "/index.txt",
  "/404.html",
  "/embed.js",
  "/Icon-bw.svg",
  "/__next._tree.txt",
  "/conversations.html",
  "/conversations.txt",
  "/auth/github/callback.html",
  "/sessions/__placeholder__.html",
  "/sessions/__placeholder__.txt",
  "/sessions/__placeholder__/__next.sessions.txt",
  "/workflows/executions/__placeholder__.html",
  "/workflows/executions/__placeholder__.txt",
  "/workflows/__placeholder__/__placeholder__.html",
  "/workflows/__placeholder__/__placeholder__.txt",
  "/workflows/__placeholder__/__placeholder__/__next.workflows.txt",
  "/_next/static/chunks/app-1a2b3c.js",
]);

function resolve(pathname: string): ConsoleResolution {
  return resolveConsoleRequest(pathname, index);
}

function servedFile(pathname: string): string | null {
  const resolution = resolve(pathname);
  return resolution.kind === "file" ? resolution.file : null;
}

describe("page contract (the nginx chain)", () => {
  it("serves the root route through the directory index", () => {
    expect(servedFile("/")).toBe("/index.html");
  });

  it("serves literal files directly", () => {
    expect(servedFile("/embed.js")).toBe("/embed.js");
    expect(servedFile("/Icon-bw.svg")).toBe("/Icon-bw.svg");
    expect(servedFile("/404.html")).toBe("/404.html");
  });

  it("serves static routes via the .html sibling", () => {
    expect(servedFile("/conversations")).toBe("/conversations.html");
    expect(servedFile("/auth/github/callback")).toBe(
      "/auth/github/callback.html",
    );
  });

  it("resolves one trailing dynamic segment to its placeholder document", () => {
    expect(servedFile("/sessions/ses_abc123")).toBe(
      "/sessions/__placeholder__.html",
    );
  });

  it("prefers the more-literal candidate: a literal segment beats a dynamic one", () => {
    // /workflows/executions/[id] and /workflows/[org]/[slug] are both
    // three segments — the filesystem, not the segment count, decides
    // (the F-12 lesson nginx.conf documents).
    expect(servedFile("/workflows/executions/wfe_123")).toBe(
      "/workflows/executions/__placeholder__.html",
    );
    expect(servedFile("/workflows/acme/my-flow")).toBe(
      "/workflows/__placeholder__/__placeholder__.html",
    );
  });

  it("serves a literal placeholder request through the .html sibling", () => {
    expect(servedFile("/sessions/__placeholder__")).toBe(
      "/sessions/__placeholder__.html",
    );
  });

  it("301s trailing slashes to the canonical URL, one strip per hop", () => {
    expect(resolve("/conversations/")).toEqual({
      kind: "redirect",
      location: "/conversations",
    });
    // nginx's ^(.+)/$ strips exactly one slash; the client walks the rest.
    expect(resolve("/conversations//")).toEqual({
      kind: "redirect",
      location: "/conversations/",
    });
    // "/" has no slashless twin and never redirects.
    expect(resolve("/").kind).toBe("file");
  });

  it("answers notFound for unknown URLs at every depth", () => {
    expect(resolve("/zz-no-such-route").kind).toBe("notFound");
    expect(resolve("/zz-no/zz-such/zz-route/zz-deep").kind).toBe("notFound");
    // Two placeholder candidates are exhaustive: three trailing dynamic
    // segments cannot resolve (MAX_DYNAMIC_SEGMENTS in the routing gate).
    expect(resolve("/workflows/a/b/c").kind).toBe("notFound");
  });

  it("never resolves top-level paths through placeholders", () => {
    // The nginx regexes require a non-empty static prefix.
    expect(resolve("/ses_abc123").kind).toBe("notFound");
  });

  it("serves /_next/ assets literally and nothing else", () => {
    expect(servedFile("/_next/static/chunks/app-1a2b3c.js")).toBe(
      "/_next/static/chunks/app-1a2b3c.js",
    );
    expect(resolve("/_next/static/chunks/missing.js").kind).toBe("notFound");
  });

  it("cannot be traversed out of the index", () => {
    expect(resolve("/../etc/passwd").kind).toBe("notFound");
    expect(resolve("/sessions/../../secret").kind).toBe("notFound");
  });
});

describe("RSC flight contract (the Go handler's rewrites)", () => {
  it("serves static-route flight payloads directly", () => {
    expect(servedFile("/conversations.txt")).toBe("/conversations.txt");
    expect(servedFile("/__next._tree.txt")).toBe("/__next._tree.txt");
  });

  it("rewrites a dynamic route's flight payload to the placeholder twin", () => {
    expect(servedFile("/sessions/ses_abc123.txt")).toBe(
      "/sessions/__placeholder__.txt",
    );
  });

  it("rewrites two-dynamic-segment flight payloads (beyond the Go handler)", () => {
    expect(servedFile("/workflows/acme/my-flow.txt")).toBe(
      "/workflows/__placeholder__/__placeholder__.txt",
    );
    expect(servedFile("/workflows/executions/wfe_123.txt")).toBe(
      "/workflows/executions/__placeholder__.txt",
    );
  });

  it("rewrites nested __next.*.txt payloads into the placeholder directory", () => {
    expect(servedFile("/sessions/ses_abc123/__next.sessions.txt")).toBe(
      "/sessions/__placeholder__/__next.sessions.txt",
    );
    expect(servedFile("/workflows/acme/my-flow/__next.workflows.txt")).toBe(
      "/workflows/__placeholder__/__placeholder__/__next.workflows.txt",
    );
  });

  it("answers notFound for flight requests on unknown routes", () => {
    expect(resolve("/zz-nope/zz-nope.txt").kind).toBe("notFound");
    expect(resolve("/zz-nope/zz-nope/__next.x.txt").kind).toBe("notFound");
    // A known parent whose payload file is absent must not fall back to
    // some other document.
    expect(resolve("/sessions/ses_abc/__next.missing.txt").kind).toBe(
      "notFound",
    );
  });

  it("keeps /_next/ .txt requests literal-only", () => {
    expect(resolve("/_next/static/zz.txt").kind).toBe("notFound");
  });
});
