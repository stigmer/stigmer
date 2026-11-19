// The docs reader, over an injected fetch (no test reaches the network):
// llms.txt's page lines parsed and ranked; a page argument turned into its
// stigmer.ai/docs URL or refused; a page read whole through its .md export;
// the index cached per reader; and every bound: a redirect off the docs, a
// 404, a body past the cap, an unreachable site naming the proxy setting.

import { describe, expect, it, vi } from "vitest";

import {
  createDocsReader,
  docPageUrl,
  DOCS_ATTEMPTS,
  DOCS_INDEX_TTL_MS,
  DOCS_INDEX_URL,
  DOCS_MAX_BYTES,
  DocsError,
  formatHits,
  isDocsAddress,
  parseIndex,
  queryWords,
  rankDocs,
} from "../reader";

const INDEX = [
  "# Stigmer",
  "",
  "> The open-source backend for the agents in your product.",
  "",
  "- [Stigmer Docs](https://stigmer.ai/docs): Hand an Agent a ledger.",
  "",
  "## How it works",
  "",
  "- [Runners](https://stigmer.ai/docs/concepts/runners): Where a run executes, and the port a local runner listens on.",
  "- [Editions](https://stigmer.ai/docs/guides/self-hosting/cloud-vs-self-hosted): Open source, Enterprise and Cloud compared.",
  "- [Billing](https://stigmer.ai/docs/concepts/billing): Who pays the model bill, and what each edition costs.",
  "- [Vault](https://stigmer.ai/docs/sdk/resources/vault)",
  "",
  "## Optional",
  "",
  "- [stigmer up](https://stigmer.ai/docs/cli/commands/up): start the local server; --port moves it",
  "",
].join("\n");

const PAGE = "Source: https://stigmer.ai/docs/concepts/runners\n\n> Where a run executes.\n\nA runner listens on port 7234.\n";

function respond(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

/** A fetch answering from a table of address → response factory; anything else 404s. */
function fakeFetch(table: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    const make = table[url];
    return make === undefined ? respond("not found", { status: 404 }) : make();
  });
}

describe("parseIndex", () => {
  it("keeps every page line, with or without a description, and nothing else", () => {
    const hits = parseIndex(INDEX);
    expect(hits.map((h) => h.url)).toEqual([
      "https://stigmer.ai/docs",
      "https://stigmer.ai/docs/concepts/runners",
      "https://stigmer.ai/docs/guides/self-hosting/cloud-vs-self-hosted",
      "https://stigmer.ai/docs/concepts/billing",
      "https://stigmer.ai/docs/sdk/resources/vault",
      "https://stigmer.ai/docs/cli/commands/up",
    ]);
    expect(hits[4]).toEqual({ title: "Vault", url: "https://stigmer.ai/docs/sdk/resources/vault", description: "" });
  });

  it("skips a link followed by anything but a description", () => {
    expect(parseIndex("- [A](https://stigmer.ai/docs/a)x\n- [B](https://stigmer.ai/docs/b):  b  ")).toEqual([
      { title: "B", url: "https://stigmer.ai/docs/b", description: "b" },
    ]);
  });

  it("reads a hostile line in linear time", () => {
    const started = performance.now();
    expect(parseIndex(`- [\\](!):${" ".repeat(50_000)}\u2028x`)).toEqual([{ title: "\\", url: "!", description: "x" }]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("rankDocs", () => {
  const hits = parseIndex(INDEX);

  it("ranks a page matching more of the words first, the optional section included", () => {
    expect(rankDocs(hits, "how do I move the port stigmer up listens on").map((h) => h.title)).toEqual([
      "stigmer up",
      "Runners",
    ]);
  });

  it("weighs the title over the description", () => {
    expect(rankDocs(hits, "billing")[0]?.title).toBe("Billing");
    expect(rankDocs(hits, "edition").map((h) => h.title)).toEqual(["Editions", "Billing"]);
  });

  it("returns nothing for words that match no page, or only stop words", () => {
    expect(rankDocs(hits, "kubernetes")).toEqual([]);
    expect(rankDocs(hits, "what is the")).toEqual([]);
    expect(queryWords("What IS Stigmer's port?")).toEqual(["port"]);
  });

  it("matches whole words, singular or plural, and the start of a longer word", () => {
    const pages = parseIndex(
      [
        "- [Reports](https://stigmer.ai/docs/a): the variance report and its support",
        "- [Upload](https://stigmer.ai/docs/b): hooks for uploads",
        "- [Harnesses](https://stigmer.ai/docs/concepts/harnesses): the loop",
        "- [Authentication](https://stigmer.ai/docs/guides/authentication/overview): sign-in",
        "- [stigmer up](https://stigmer.ai/docs/cli/commands/up): start the local stack",
      ].join("\n"),
    );
    expect(rankDocs(pages, "port")).toEqual([]);
    expect(rankDocs(pages, "up").map((h) => h.title)).toEqual(["stigmer up"]);
    expect(rankDocs(pages, "harness").map((h) => h.title)).toEqual(["Harnesses"]);
    expect(rankDocs(pages, "report").map((h) => h.title)).toEqual(["Reports"]);
    expect(rankDocs(pages, "auth").map((h) => h.title)).toEqual(["Authentication"]);
    expect(rankDocs(pages, "self-hosting stack").map((h) => h.title)).toEqual(["stigmer up"]);
  });

  it("ranks a page first among equals when the query names its whole title", () => {
    const pages = parseIndex(
      [
        "- [Set up an Environment](https://stigmer.ai/docs/guides/set-up-an-environment): a sandbox",
        "- [stigmer up](https://stigmer.ai/docs/cli/commands/up): start the local stack",
      ].join("\n"),
    );
    expect(rankDocs(pages, "port stigmer up").map((h) => h.title)).toEqual(["stigmer up", "Set up an Environment"]);
  });

  it("returns at most the limit", () => {
    expect(rankDocs(hits, "docs", 2)).toHaveLength(2);
  });
});

describe("docPageUrl", () => {
  it.each([
    ["concepts/tools", "https://stigmer.ai/docs/concepts/tools"],
    ["/docs/concepts/tools", "https://stigmer.ai/docs/concepts/tools"],
    ["docs/concepts/tools.md", "https://stigmer.ai/docs/concepts/tools"],
    ["/concepts/tools/", "https://stigmer.ai/docs/concepts/tools"],
    ["https://stigmer.ai/docs/concepts/tools.md", "https://stigmer.ai/docs/concepts/tools"],
    ["https://stigmer.ai/docs/concepts/tools#how-it-works", "https://stigmer.ai/docs/concepts/tools"],
    ["concepts/tools?x=1#y", "https://stigmer.ai/docs/concepts/tools"],
  ])("reads %s as %s", (page, url) => {
    expect(docPageUrl(page)).toBe(url);
  });

  it("reads hostile arguments in linear time", () => {
    const started = performance.now();
    expect(docPageUrl(`concepts/tools${"/".repeat(50_000)}`)).toBe("https://stigmer.ai/docs/concepts/tools");
    expect(docPageUrl(`concepts/tools${"#".repeat(50_000)}\n`)).toBe("https://stigmer.ai/docs/concepts/tools");
    expect(() => docPageUrl(`concepts/tools${"/".repeat(50_000)}x`)).toThrow(DocsError);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it.each([
    "https://evil.example/x",
    "http://stigmer.ai/docs/concepts/tools",
    "https://stigmer.ai.evil.example/docs/x",
    "https://stigmer.ai/pricing",
    "//evil.example/docs/x",
    "../../x",
    "concepts/../../../etc/passwd",
    "file:///etc/passwd",
    "concepts/to ols",
    "",
  ])("refuses %s", (page) => {
    expect(() => docPageUrl(page)).toThrow(DocsError);
    try {
      docPageUrl(page);
    } catch (error) {
      expect((error as DocsError).kind).toBe("refused");
    }
  });

  it("knows a docs address", () => {
    expect(isDocsAddress(DOCS_INDEX_URL)).toBe(true);
    expect(isDocsAddress("https://stigmer.ai/docs/a.md")).toBe(true);
    expect(isDocsAddress("https://stigmer.ai/docsx")).toBe(false);
    expect(isDocsAddress("https://example.com/docs/a")).toBe(false);
  });
});

describe("formatHits", () => {
  it("numbers each page with its URL and description, and says what to do when none match", () => {
    const hits = parseIndex(INDEX).slice(1, 2);
    expect(formatHits("port", hits)).toBe(
      "1. Runners: https://stigmer.ai/docs/concepts/runners\n   Where a run executes, and the port a local runner listens on.",
    );
    expect(formatHits("x", [{ title: "Vault", url: "u", description: "" }])).toBe("1. Vault: u");
    expect(formatHits("kubernetes", [])).toContain('No docs page matches "kubernetes"');
  });
});

describe("createDocsReader", () => {
  it("searches the index, fetching it once per cache window", async () => {
    let now = 1_000;
    const doFetch = fakeFetch({ [DOCS_INDEX_URL]: () => respond(INDEX) });
    const reader = createDocsReader({ fetch: doFetch, now: () => now });
    expect((await reader.searchDocs("billing"))[0]?.title).toBe("Billing");
    await reader.searchDocs("runner");
    expect(doFetch).toHaveBeenCalledTimes(1);
    now += DOCS_INDEX_TTL_MS;
    await reader.searchDocs("runner");
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("reads a page's .md export whole, Source line and all", async () => {
    const doFetch = fakeFetch({ "https://stigmer.ai/docs/concepts/runners.md": () => respond(PAGE) });
    const page = await createDocsReader({ fetch: doFetch }).readDocPage("concepts/runners");
    expect(page).toEqual({ url: "https://stigmer.ai/docs/concepts/runners", markdown: PAGE });
    expect(doFetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it.each(["docs", "/docs", "https://stigmer.ai/docs", "https://stigmer.ai/docs/"])("reads the docs' front page %s from its index.md export", async (root) => {
    const doFetch = fakeFetch({ "https://stigmer.ai/docs/index.md": () => respond(PAGE) });
    expect(await createDocsReader({ fetch: doFetch }).readDocPage(root)).toEqual({ url: "https://stigmer.ai/docs", markdown: PAGE });
  });

  it("follows a redirect that stays in the docs", async () => {
    const doFetch = fakeFetch({
      "https://stigmer.ai/docs/old.md": () => respond("", { status: 308, headers: { location: "/docs/concepts/runners.md" } }),
      "https://stigmer.ai/docs/concepts/runners.md": () => respond(PAGE),
    });
    expect((await createDocsReader({ fetch: doFetch }).readDocPage("old")).markdown).toBe(PAGE);
  });

  it("refuses a redirect that leaves the docs, without fetching it", async () => {
    const doFetch = fakeFetch({
      "https://stigmer.ai/docs/away.md": () => respond("", { status: 302, headers: { location: "https://evil.example/x" } }),
    });
    await expect(createDocsReader({ fetch: doFetch }).readDocPage("away")).rejects.toMatchObject({ kind: "refused" });
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("stops a redirect loop, and a redirect with no location", async () => {
    const loop = fakeFetch({
      "https://stigmer.ai/docs/a.md": () => respond("", { status: 307, headers: { location: "/docs/a.md" } }),
    });
    await expect(createDocsReader({ fetch: loop }).readDocPage("a")).rejects.toMatchObject({ kind: "bad-answer" });
    const bare = fakeFetch({ "https://stigmer.ai/docs/a.md": () => respond("", { status: 301 }) });
    await expect(createDocsReader({ fetch: bare }).readDocPage("a")).rejects.toMatchObject({ kind: "bad-answer" });
  });

  it("says a missing page is missing, and to search first", async () => {
    const reader = createDocsReader({ fetch: fakeFetch({}) });
    await expect(reader.readDocPage("concepts/nosuch")).rejects.toThrow(
      /No docs page at https:\/\/stigmer\.ai\/docs\/concepts\/nosuch\. Search the docs/,
    );
  });

  it("names any other failing status", async () => {
    const doFetch = fakeFetch({ [DOCS_INDEX_URL]: () => respond("down", { status: 503 }) });
    await expect(createDocsReader({ fetch: doFetch }).searchDocs("x")).rejects.toThrow(/answered 503/);
  });

  it("refuses a body past the cap, declared or streamed", async () => {
    const declared = fakeFetch({
      "https://stigmer.ai/docs/big.md": () => respond("x", { headers: { "content-length": String(DOCS_MAX_BYTES + 1) } }),
    });
    await expect(createDocsReader({ fetch: declared }).readDocPage("big")).rejects.toMatchObject({ kind: "too-large" });
    const streamed = fakeFetch({ "https://stigmer.ai/docs/big.md": () => respond("x".repeat(DOCS_MAX_BYTES + 1)) });
    await expect(createDocsReader({ fetch: streamed }).readDocPage("big")).rejects.toMatchObject({ kind: "too-large" });
  });

  it("reads an empty body as empty text", async () => {
    const doFetch = fakeFetch({ "https://stigmer.ai/docs/empty.md": () => new Response(null, { status: 200 }) });
    expect((await createDocsReader({ fetch: doFetch }).readDocPage("empty")).markdown).toBe("");
  });

  it("reports a failed read of the body", async () => {
    const broken = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("socket hang up"));
        },
      });
    const doFetch = fakeFetch({ "https://stigmer.ai/docs/a.md": () => new Response(broken()) });
    await expect(createDocsReader({ fetch: doFetch }).readDocPage("a")).rejects.toThrow(/Reading .* failed: socket hang up/);
  });

  it("says the site is unreachable, naming the proxy setting Node ignores", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const behindProxy = createDocsReader({ fetch: down, env: { HTTPS_PROXY: "http://proxy:3128" } });
    await expect(behindProxy.searchDocs("x")).rejects.toThrow(
      /Could not reach https:\/\/stigmer\.ai to read the docs \(fetch failed\)\. HTTPS_PROXY is set, and Node's fetch uses it only with NODE_USE_ENV_PROXY=1\./,
    );
    const direct = createDocsReader({ fetch: down, env: {} });
    await expect(direct.searchDocs("x")).rejects.toThrow(/\(fetch failed\)\.$/);
    const proxied = createDocsReader({ fetch: down, env: { https_proxy: "http://p", NODE_USE_ENV_PROXY: "1" } });
    await expect(proxied.searchDocs("x")).rejects.toThrow(/\(fetch failed\)\.$/);
  });

  it("tries a read the site doesn't answer once more, and says when both tries timed out", async () => {
    const slow = vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    await expect(createDocsReader({ fetch: slow, env: {} }).searchDocs("x")).rejects.toThrow(/no answer within 15 s, tried 2 times/);
    expect(slow).toHaveBeenCalledTimes(DOCS_ATTEMPTS);
    let calls = 0;
    const stallsOnce = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      return respond(INDEX);
    });
    expect((await createDocsReader({ fetch: stallsOnce }).searchDocs("billing"))[0]?.title).toBe("Billing");
    expect(stallsOnce).toHaveBeenCalledTimes(2);
    const missing = fakeFetch({});
    await expect(createDocsReader({ fetch: missing }).readDocPage("nosuch")).rejects.toMatchObject({ kind: "not-found" });
    expect(missing).toHaveBeenCalledTimes(1);
    const odd = vi.fn(async () => {
      throw "boom";
    });
    await expect(createDocsReader({ fetch: odd, env: {} }).searchDocs("x")).rejects.toThrow(/\(boom\)/);
  });
});
