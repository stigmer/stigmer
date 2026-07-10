// Unit tests for the framework-free agent-sharing helpers: origin
// validation (mirror of the proto CEL rule) and the hosted-link / embed
// snippet builders shared by the web console, desktop app, and CLI.

import { describe, expect, it } from "vitest";
import {
  MAX_ALLOWED_ORIGINS,
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
});
