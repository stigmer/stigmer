// Unit tests for the framework-free agent-sharing helpers: origin
// validation (mirror of the proto CEL rule) and the hosted-link / embed
// snippet builders shared by the web console, desktop app, and CLI.

import { describe, expect, it } from "vitest";
import {
  LINK_TOKEN_PARAM,
  MAX_ALLOWED_ORIGINS,
  appendLinkToken,
  buildChatUrl,
  buildEmbedLoaderUrl,
  buildEmbedSnippet,
  chatPath,
  validateOrigin,
} from "../sharing";

describe("validateOrigin", () => {
  it("accepts exact web origins", () => {
    expect(validateOrigin("https://example.com")).toBeNull();
    expect(validateOrigin("http://example.com")).toBeNull();
    expect(validateOrigin("https://sub.example.com")).toBeNull();
    expect(validateOrigin("https://example.com:8443")).toBeNull();
    expect(validateOrigin("http://localhost:3000")).toBeNull();
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateOrigin("  https://example.com  ")).toBeNull();
  });

  it("rejects empty input with guidance", () => {
    expect(validateOrigin("")).toMatch(/Enter an origin/);
    expect(validateOrigin("   ")).toMatch(/Enter an origin/);
  });

  it("rejects trailing slashes, paths, queries, and fragments", () => {
    for (const bad of [
      "https://example.com/",
      "https://example.com/path",
      "https://example.com?q=1",
      "https://example.com#top",
    ]) {
      expect(validateOrigin(bad)).toMatch(/exact web origin/);
    }
  });

  it("rejects non-http(s) schemes and bare hosts", () => {
    expect(validateOrigin("ftp://example.com")).toMatch(/exact web origin/);
    expect(validateOrigin("example.com")).toMatch(/exact web origin/);
  });

  it("rejects hostname labels with leading/trailing hyphens", () => {
    expect(validateOrigin("https://-bad.example.com")).toMatch(/exact web origin/);
    expect(validateOrigin("https://bad-.example.com")).toMatch(/exact web origin/);
  });

  it("exposes the proto max_items bound", () => {
    expect(MAX_ALLOWED_ORIGINS).toBe(32);
  });
});

describe("chatPath / buildChatUrl", () => {
  const SHARE = "ash_01j9z3k8f2q4m6n7p8r9s0t1v2";

  it("builds the canonical /chat/<share id> path", () => {
    expect(chatPath(SHARE)).toBe(`/chat/${SHARE}`);
  });

  it("builds the absolute hosted chat URL", () => {
    expect(buildChatUrl("https://app.stigmer.ai", SHARE)).toBe(
      `https://app.stigmer.ai/chat/${SHARE}`,
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(buildChatUrl("https://app.stigmer.ai/", SHARE)).toBe(
      `https://app.stigmer.ai/chat/${SHARE}`,
    );
  });

  it("works with localhost origins (local backend)", () => {
    expect(buildChatUrl("http://localhost:8234", SHARE)).toBe(
      `http://localhost:8234/chat/${SHARE}`,
    );
  });

  it("appends ?k= when the share link is locked with a token", () => {
    expect(chatPath(SHARE, "tok123")).toBe(`/chat/${SHARE}?k=tok123`);
    expect(buildChatUrl("https://app.stigmer.ai", SHARE, "tok123")).toBe(
      `https://app.stigmer.ai/chat/${SHARE}?k=tok123`,
    );
  });

  it("url-encodes the token and the id (defense in depth; both are url-safe as generated)", () => {
    expect(chatPath(SHARE, "a+b/c")).toBe(`/chat/${SHARE}?k=a%2Bb%2Fc`);
    expect(chatPath("a/b")).toBe("/chat/a%2Fb");
  });

  it("omits ?k= for an empty/undefined token (plain link)", () => {
    expect(chatPath(SHARE, "")).toBe(`/chat/${SHARE}`);
    expect(chatPath(SHARE, undefined)).toBe(`/chat/${SHARE}`);
  });
});

describe("appendLinkToken", () => {
  it("appends the identical ?k= shape chatPath emits", () => {
    expect(appendLinkToken("https://app.stigmer.ai/chat/ash_1", "tok123")).toBe(
      buildChatUrl("https://app.stigmer.ai", "ash_1", "tok123"),
    );
  });

  it("uses & when the URL already carries a query", () => {
    expect(appendLinkToken("/chat/ash_1?theme=dark", "tok123")).toBe(
      `/chat/ash_1?theme=dark&${LINK_TOKEN_PARAM}=tok123`,
    );
  });

  it("returns the URL unchanged for a null/empty token", () => {
    expect(appendLinkToken("/chat/ash_1", null)).toBe("/chat/ash_1");
    expect(appendLinkToken("/chat/ash_1", undefined)).toBe("/chat/ash_1");
    expect(appendLinkToken("/chat/ash_1", "")).toBe("/chat/ash_1");
  });
});

describe("buildEmbedLoaderUrl", () => {
  it("points at embed.js on the app origin root", () => {
    expect(buildEmbedLoaderUrl("https://app.stigmer.ai")).toBe("https://app.stigmer.ai/embed.js");
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(buildEmbedLoaderUrl("https://app.stigmer.ai/")).toBe("https://app.stigmer.ai/embed.js");
  });
});

describe("buildEmbedSnippet", () => {
  it("emits exactly the two-line loader + element snippet, naming the share by id", () => {
    expect(buildEmbedSnippet("https://app.stigmer.ai", "ash_1")).toBe(
      [
        `<script src="https://app.stigmer.ai/embed.js" async></script>`,
        `<stigmer-agent share="ash_1"></stigmer-agent>`,
      ].join("\n"),
    );
  });

  it("adds the token attribute when the share link is locked", () => {
    expect(buildEmbedSnippet("https://app.stigmer.ai", "ash_1", "tok123")).toBe(
      [
        `<script src="https://app.stigmer.ai/embed.js" async></script>`,
        `<stigmer-agent share="ash_1" token="tok123"></stigmer-agent>`,
      ].join("\n"),
    );
  });

  it("omits the token attribute for an empty token (plain link)", () => {
    expect(buildEmbedSnippet("https://app.stigmer.ai", "ash_1", "")).toBe(
      buildEmbedSnippet("https://app.stigmer.ai", "ash_1"),
    );
  });
});
