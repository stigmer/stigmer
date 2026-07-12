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
  it("builds the canonical /chat/<org>/<slug> path", () => {
    expect(chatPath("acme", "support-agent")).toBe("/chat/acme/support-agent");
  });

  it("builds the absolute hosted chat URL", () => {
    expect(buildChatUrl("https://app.stigmer.ai", "acme", "support-agent")).toBe(
      "https://app.stigmer.ai/chat/acme/support-agent",
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(buildChatUrl("https://app.stigmer.ai/", "acme", "support-agent")).toBe(
      "https://app.stigmer.ai/chat/acme/support-agent",
    );
  });

  it("works with localhost origins (local backend)", () => {
    expect(buildChatUrl("http://localhost:8234", "stigmer", "helper")).toBe(
      "http://localhost:8234/chat/stigmer/helper",
    );
  });

  it("appends ?k= when the share link is locked with a token", () => {
    expect(chatPath("acme", "support-agent", "tok123")).toBe(
      "/chat/acme/support-agent?k=tok123",
    );
    expect(
      buildChatUrl("https://app.stigmer.ai", "acme", "support-agent", "tok123"),
    ).toBe("https://app.stigmer.ai/chat/acme/support-agent?k=tok123");
  });

  it("url-encodes the token (defense in depth; generated tokens are url-safe)", () => {
    expect(chatPath("acme", "bot", "a+b/c")).toBe("/chat/acme/bot?k=a%2Bb%2Fc");
  });

  it("omits ?k= for an empty/undefined token (plain link)", () => {
    expect(chatPath("acme", "bot", "")).toBe("/chat/acme/bot");
    expect(chatPath("acme", "bot", undefined)).toBe("/chat/acme/bot");
  });
});

describe("appendLinkToken", () => {
  it("appends the identical ?k= shape chatPath emits", () => {
    expect(appendLinkToken("https://app.stigmer.ai/chat/acme/bot", "tok123")).toBe(
      buildChatUrl("https://app.stigmer.ai", "acme", "bot", "tok123"),
    );
  });

  it("uses & when the URL already carries a query", () => {
    expect(appendLinkToken("/chat/acme/bot?theme=dark", "tok123")).toBe(
      `/chat/acme/bot?theme=dark&${LINK_TOKEN_PARAM}=tok123`,
    );
  });

  it("returns the URL unchanged for a null/empty token", () => {
    expect(appendLinkToken("/chat/acme/bot", null)).toBe("/chat/acme/bot");
    expect(appendLinkToken("/chat/acme/bot", undefined)).toBe("/chat/acme/bot");
    expect(appendLinkToken("/chat/acme/bot", "")).toBe("/chat/acme/bot");
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
  it("emits exactly the two-line loader + element snippet", () => {
    expect(buildEmbedSnippet("https://app.stigmer.ai", "acme", "support-agent")).toBe(
      [
        `<script src="https://app.stigmer.ai/embed.js" async></script>`,
        `<stigmer-agent org="acme" agent="support-agent"></stigmer-agent>`,
      ].join("\n"),
    );
  });

  it("adds the token attribute when the share link is locked", () => {
    expect(
      buildEmbedSnippet("https://app.stigmer.ai", "acme", "support-agent", "tok123"),
    ).toBe(
      [
        `<script src="https://app.stigmer.ai/embed.js" async></script>`,
        `<stigmer-agent org="acme" agent="support-agent" token="tok123"></stigmer-agent>`,
      ].join("\n"),
    );
  });

  it("omits the token attribute for an empty token (plain link)", () => {
    expect(buildEmbedSnippet("https://app.stigmer.ai", "acme", "bot", "")).toBe(
      buildEmbedSnippet("https://app.stigmer.ai", "acme", "bot"),
    );
  });
});
