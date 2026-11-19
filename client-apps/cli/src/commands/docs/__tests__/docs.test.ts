// `stigmer docs search|read` (commands/docs/index.ts) over a stubbed reader
// (the real one is the tool server's, tested there): search prints the
// numbered pages or `{results}`, read prints the page whole or `{url,
// markdown}`, and a reader's failure becomes the CLI's error with its exit
// code: a page outside the docs a usage error, a missing page not-found with
// the search to run, an unreachable site a connection failure.

import { Command } from "commander";
import { ExitCode } from "@stigmer/client/exit-codes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliExitError } from "../../../errors/cli-exit-error.js";
import { UsageError } from "../../../errors/usage-error.js";
import { asCliError, registerDocs } from "../index.js";

const PAGE = "Source: https://stigmer.ai/docs/concepts/runners\n\nWhole page.\n";

vi.mock("@stigmer/mcp-server/docs", () => ({
  formatHits: (query: string, hits: Array<{ title: string; url: string }>) =>
    hits.length === 0 ? `No docs page matches "${query}".` : hits.map((h, i) => `${i + 1}. ${h.title}: ${h.url}`).join("\n"),
  sharedDocsReader: () => ({
    searchDocs: async (query: string) =>
      query === "port stigmer up" ? [{ title: "stigmer up", url: "https://stigmer.ai/docs/cli/commands/up", description: "" }] : [],
    readDocPage: async (page: string) => ({ url: `https://stigmer.ai/docs/${page}`, markdown: PAGE }),
  }),
}));

async function run(...args: string[]): Promise<string> {
  const out: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  try {
    const program = new Command().exitOverride();
    registerDocs(program);
    await program.parseAsync(["node", "stigmer", ...args]);
  } finally {
    spy.mockRestore();
  }
  return out.join("");
}

afterEach(() => vi.restoreAllMocks());

describe("stigmer docs", () => {
  it("search prints the matching pages, numbered, or them as JSON", async () => {
    expect(await run("docs", "search", "port", "stigmer", "up")).toBe("1. stigmer up: https://stigmer.ai/docs/cli/commands/up\n");
    expect(JSON.parse(await run("docs", "search", "port", "stigmer", "up", "-o", "json"))).toEqual({
      results: [{ title: "stigmer up", url: "https://stigmer.ai/docs/cli/commands/up", description: "" }],
    });
    expect(await run("docs", "search", "kubernetes")).toBe('No docs page matches "kubernetes".\n');
  });

  it("read prints the page whole, or its address and text as JSON", async () => {
    expect(await run("docs", "read", "concepts/runners")).toBe(PAGE);
    expect(JSON.parse(await run("docs", "read", "concepts/runners", "--json"))).toEqual({
      url: "https://stigmer.ai/docs/concepts/runners",
      markdown: PAGE,
    });
  });
});

describe("asCliError", () => {
  const failing = (kind: string) => () => Promise.reject(Object.assign(new Error(`${kind} words`), { kind }));

  it("passes a read's answer through", async () => {
    expect(await asCliError(async () => 42)).toBe(42);
  });

  it("makes a page outside the docs a usage error", async () => {
    await expect(asCliError(failing("refused"))).rejects.toBeInstanceOf(UsageError);
  });

  it("makes a missing page not-found, naming the search to run", async () => {
    const error = await asCliError(failing("not-found")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(ExitCode.NotFound);
    expect((error as CliExitError).hints).toEqual(["Find the page's path:", "  stigmer docs search <words>"]);
  });

  it("makes an unreachable site a connection failure, and leaves any other failure as it is", async () => {
    const error = await asCliError(failing("unreachable")).catch((e: unknown) => e);
    expect((error as CliExitError).exitCode).toBe(ExitCode.Connection);
    await expect(asCliError(failing("too-large"))).rejects.toThrow("too-large words");
  });
});
