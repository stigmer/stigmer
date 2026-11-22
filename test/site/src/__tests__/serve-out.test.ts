// The static server answers the export's URLs as the site's host does:
// the exact file, then `<path>.html`, then `<path>/index.html`, an unknown
// path as 404.html with status 404, and a path that leaves the folder refused.
// Domain: test machinery (the site suite's web server).
//
// The cases build a small export in a temporary folder, shaped as the real
// one is (`docs.html` beside a `docs/` folder, a page under a folder, a
// 404 page), and one case starts the server on a loopback port.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentTypeOf, resolvePath, serveOut } from "../serve-out.ts";

let root = "";

function write(path: string, body: string): void {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "serve-out-"));
  write("index.html", "home");
  write("404.html", "not found page");
  write("docs.html", "docs index");
  write("docs.md", "docs markdown");
  write("docs/sdk/ink.html", "ink");
  write("blog/index.html", "blog folder index");
  write("_next/static/app.js", "console.log(1)");
  write("fonts/geist.woff2", "font");
  mkdirSync(join(root, "empty"), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function served(pathname: string): { file: string; status: number } | { status: number } {
  const resolution = resolvePath(root, pathname);
  return resolution.kind === "file" ? { file: resolution.file.slice(root.length + 1), status: resolution.status } : { status: resolution.status };
}

describe("resolvePath", () => {
  it("serves the root's index page for /", () => {
    expect(served("/")).toEqual({ file: "index.html", status: 200 });
  });

  it("serves an exact file", () => {
    expect(served("/docs.md")).toEqual({ file: "docs.md", status: 200 });
    expect(served("/_next/static/app.js")).toEqual({ file: "_next/static/app.js", status: 200 });
  });

  it("serves <path>.html for a clean URL, ahead of a folder of the same name", () => {
    expect(served("/docs")).toEqual({ file: "docs.html", status: 200 });
    expect(served("/docs/sdk/ink")).toEqual({ file: "docs/sdk/ink.html", status: 200 });
  });

  it("serves <path>/index.html when there is no <path>.html", () => {
    expect(served("/blog")).toEqual({ file: "blog/index.html", status: 200 });
    expect(served("/blog/")).toEqual({ file: "blog/index.html", status: 200 });
  });

  it("serves <path>.html for a trailing slash when the folder has no index page", () => {
    expect(served("/docs/")).toEqual({ file: "docs.html", status: 200 });
  });

  it("serves 404.html with status 404 for an unknown path or a folder with nothing to serve", () => {
    expect(served("/nowhere")).toEqual({ file: "404.html", status: 404 });
    expect(served("/empty")).toEqual({ file: "404.html", status: 404 });
    expect(served("/docs/sdk")).toEqual({ file: "404.html", status: 404 });
  });

  it("decodes the path before looking it up", () => {
    write("docs/a b.html", "spaced");
    expect(served("/docs/a%20b")).toEqual({ file: "docs/a b.html", status: 200 });
  });

  it("refuses a path that leaves the folder, however it is spelled", () => {
    expect(served("/..%2f..%2fetc%2fpasswd")).toEqual({ status: 400 });
    expect(served("/%2e%2e/secret")).toEqual({ status: 400 });
    expect(served("/docs/../../secret")).toEqual({ status: 400 });
  });

  it("refuses a path that cannot be decoded or carries a null byte", () => {
    expect(served("/%E0%A4%A")).toEqual({ status: 400 });
    expect(served("/docs%00.html")).toEqual({ status: 400 });
  });

  it("answers 404 with no file when the export has no 404 page", () => {
    const bare = mkdtempSync(join(tmpdir(), "serve-out-bare-"));
    try {
      expect(resolvePath(bare, "/nowhere")).toEqual({ kind: "refused", status: 404 });
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("contentTypeOf", () => {
  it("types the files an export holds by extension, and anything else as bytes", () => {
    expect(contentTypeOf("a/page.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeOf("x.JS")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeOf("f.woff2")).toBe("font/woff2");
    expect(contentTypeOf("blob.bin")).toBe("application/octet-stream");
  });
});

describe("serveOut", () => {
  let server: Server | undefined;
  let origin = "";

  beforeAll(async () => {
    server = await serveOut(root, 0);
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("the server did not bind a port");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  });

  it("answers a clean URL with the page, its type and status", async () => {
    const response = await fetch(`${origin}/docs/sdk/ink`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("ink");
  });

  it("answers an unknown path with the 404 page and status 404", async () => {
    const response = await fetch(`${origin}/nowhere`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found page");
  });

  it("answers HEAD with no body and refuses other methods", async () => {
    const head = await fetch(`${origin}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await fetch(`${origin}/`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  it("refuses an encoded path that leaves the folder", async () => {
    const response = await fetch(`${origin}/..%2f..%2fsecret`);
    expect(response.status).toBe(400);
  });
});
