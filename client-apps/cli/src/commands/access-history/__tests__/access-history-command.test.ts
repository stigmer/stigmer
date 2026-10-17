// Unit tests for `stigmer access-history list|export` end to end through the
// commands (commands/access-history/index.ts and
// resources/access-history.ts):
//
//   - list reads newest first in the organization the CLI resolves (`--org`
//     first, then the context), following pages until `--limit` entries are
//     in hand, and prints a table naming who did what for whom, or the
//     entries as JSON; a bad --limit is refused before anything is sent;
//   - export writes every entry after `--after`, oldest first, one JSON line
//     each, following every page; a bad --after is refused before anything
//     is sent;
//   - an open-source server's refusal reaches the user as the server wrote
//     it;
//   - retention: the table is followed by how long the server keeps the
//     history (JSON and YAML stay pure), and an export whose start the
//     server removed says which entries on stderr, stdout still pure JSON
//     Lines.
//
// The backend client is stubbed at its module seam; the config file is real
// (HOME redirected).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  AccessChange,
  AccessChangeCause,
  AccessHistoryEntrySchema,
  AccessHistoryPageSchema,
  type ListAccessHistoryInput,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CliExitError } from "../../../errors/cli-exit-error.js";
import { ExitCode } from "../../../errors/exit-codes.js";
import { registerAccessHistory } from "../index.js";

const backend = vi.hoisted(() => ({
  reads: [] as ListAccessHistoryInput[],
  refuse: false,
  empty: false,
  /** The oldest entry the server keeps; the ones before it were removed. */
  oldest: 1n,
  retentionDays: 0,
}));

function entry(sequence: number, change = AccessChange.granted) {
  return create(AccessHistoryEntrySchema, {
    sequence: BigInt(sequence),
    occurredAt: timestampFromDate(new Date(Date.UTC(2026, 9, sequence))),
    change,
    cause: change === AccessChange.revoked ? AccessChangeCause.organization_access_revoked : AccessChangeCause.grant,
    actorClass: sequence === 2 ? "internal" : "user",
    actor: { kind: "identity_account", id: "ida_ana", name: "Ana Silva", email: "ana@acme.example" },
    principal: { kind: "identity_account", id: "ida_raj", name: "Raj Patel", email: "raj@acme.example" },
    role: { id: "member", code: "member", name: "Member" },
    resource:
      sequence === 3
        ? { org: "org_acme", kind: ApiResourceKind.agent, id: "agt_billing", slug: "" }
        : { org: "org_acme", kind: ApiResourceKind.organization, id: "org_acme", slug: "acme" },
  });
}

/** The history oldest first: four entries. */
const ALL = [entry(1), entry(2), entry(3), entry(4, AccessChange.revoked)];

vi.mock("../../../backend.js", async () => {
  const { load: loadConfig } = await import("../../../config/index.js");
  return {
    connectBackend: () => ({
      config: loadConfig(),
      stigmer: {
        grant: {
          listAccessHistory: async (input: ListAccessHistoryInput) => {
            backend.reads.push(input);
            if (backend.refuse) {
              throw new ConnectError(
                "the access history is served by the Enterprise and Cloud editions",
                Code.Unimplemented,
              );
            }
            // Two entries a page, so every walk follows a token.
            const kept = backend.empty ? [] : ALL.filter((e) => e.sequence >= backend.oldest);
            const ordered =
              input.afterSequence === undefined
                ? [...kept].reverse()
                : kept.filter((e) => e.sequence > (input.afterSequence ?? 0n));
            const start = input.pageToken === "" ? 0 : Number(input.pageToken);
            const size = Math.min(input.pageSize, 2);
            const end = start + size;
            return create(AccessHistoryPageSchema, {
              entries: ordered.slice(start, end),
              nextPageToken: end < ordered.length ? String(end) : "",
              oldestSequence: kept.length === 0 ? 0n : backend.oldest,
              retentionDays: backend.retentionDays,
            });
          },
        },
      },
    }),
  };
});

async function run(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  });
  try {
    const program = new Command().exitOverride().option("--org <org>");
    registerAccessHistory(program);
    await program.parseAsync(["node", "stigmer", ...args]);
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return { stdout: out.join(""), stderr: err.join("") };
}

async function exitOf(args: string[]): Promise<number | undefined> {
  try {
    await run(args);
    return undefined;
  } catch (error) {
    return error instanceof CliExitError ? error.exitCode : -1;
  }
}

describe("stigmer access-history", () => {
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    backend.reads.length = 0;
    backend.refuse = false;
    backend.empty = false;
    backend.oldest = 1n;
    backend.retentionDays = 0;
    originalHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "stigmer-access-history-"));
    process.env.HOME = home;
    mkdirSync(join(home, ".stigmer"), { recursive: true });
    writeFileSync(
      join(home, ".stigmer", "config.yaml"),
      [
        "backends:",
        "  team:",
        "    type: selfhost",
        "    endpoint: 127.0.0.1:1",
        "current_backend: team",
        "context:",
        "  org: org_ctx",
        "",
      ].join("\n"),
    );
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("lists newest first in the context organization, up to --limit, as a table", async () => {
    const { stdout } = await run(["access-history", "list", "--limit", "3"]);
    expect(backend.reads.map((r) => [r.org, r.pageToken, r.afterSequence])).toEqual([
      ["org_ctx", "", undefined],
      ["org_ctx", "2", undefined],
    ]);
    const [header, ...rest] = stdout.trim().split("\n");
    expect(header).toMatch(/^#\s+WHEN\s+CHANGE\s+WHO\s+ROLE\s+ON\s+BY\s+WHY$/);
    const lines = ["", ...rest.filter((line) => /^\d/.test(line))];
    expect(lines.slice(1).map((line) => line.split(/\s+/)[0])).toEqual(["4", "3", "2"]);
    expect(lines[1]).toMatch(/removed\s+raj@acme\.example\s+member\s+organization acme\s+ana@acme\.example\s+organization_access_revoked/);
    expect(lines[2]).toContain("agent agt_billing (deleted)");
    expect(lines[3]).toContain("server, for ana@acme.example");
  });

  it("lists the newest 50 by default, as YAML, and says so when there is nothing", async () => {
    const { stdout } = await run(["access-history", "list", "-o", "yaml"]);
    expect(backend.reads[0]?.pageSize).toBe(50);
    expect(stdout).toContain("sequence: \"4\"");
    backend.reads.length = 0;
    backend.empty = true;
    const none = await run(["access-history", "list"]);
    expect(none.stdout).toContain("No access changes found");
  });

  it("lists in the organization --org names, as JSON", async () => {
    const { stdout } = await run(["--org", "acme", "access-history", "list", "-o", "json"]);
    expect(backend.reads[0]?.org).toBe("acme");
    const listed = JSON.parse(stdout) as Array<{ sequence: string; change: string }>;
    expect(listed.map((e) => e.sequence)).toEqual(["4", "3", "2", "1"]);
    expect(listed[0]?.change).toBe("revoked");
  });

  it("exports every entry after --after, oldest first, one JSON line each", async () => {
    const { stdout } = await run(["access-history", "export", "--after", "1"]);
    const lines = stdout.trimEnd().split("\n").map((line) => JSON.parse(line) as { sequence: string });
    expect(lines.map((line) => line.sequence)).toEqual(["2", "3", "4"]);
    expect(backend.reads.every((r) => r.afterSequence === 1n && r.pageSize === 100)).toBe(true);

    backend.reads.length = 0;
    const all = await run(["access-history", "export"]);
    expect(all.stdout.trimEnd().split("\n")).toHaveLength(4);
    expect(backend.reads[0]?.afterSequence).toBe(0n);
  });

  it("refuses a bad --limit or --after before anything is sent", async () => {
    expect(await exitOf(["access-history", "list", "--limit", "0"])).toBe(ExitCode.Usage);
    expect(await exitOf(["access-history", "list", "--limit", "many"])).toBe(ExitCode.Usage);
    expect(await exitOf(["access-history", "export", "--after", "-1"])).toBe(ExitCode.Usage);
    expect(await exitOf(["access-history", "export", "--after", "4.5"])).toBe(ExitCode.Usage);
    expect(await exitOf(["access-history", "export", "--after", "9999999999999999999"])).toBe(ExitCode.Usage);
    expect(backend.reads).toEqual([]);
  });

  it("follows the table with how long the server keeps the history, and leaves JSON pure", async () => {
    const forGood = await run(["access-history", "list"]);
    expect(forGood.stdout.trimEnd().split("\n").at(-1)).toBe("Kept for good.");

    backend.retentionDays = 365;
    const windowed = await run(["access-history", "list"]);
    expect(windowed.stdout.trimEnd().split("\n").at(-1)).toBe("Entries older than 365 days are removed.");
    const json = await run(["access-history", "list", "-o", "json"]);
    expect(() => JSON.parse(json.stdout) as unknown).not.toThrow();
    expect(json.stdout).not.toContain("removed.");
  });

  it("says on stderr which entries after --after the server removed, and writes only entries to stdout", async () => {
    backend.oldest = 3n;
    backend.retentionDays = 365;
    const { stdout, stderr } = await run(["access-history", "export"]);
    expect(stderr).toBe("entries 1 to 2 are no longer kept: this server removes entries older than 365 days\n");
    const lines = stdout.trimEnd().split("\n").map((line) => JSON.parse(line) as { sequence: string });
    expect(lines.map((line) => line.sequence)).toEqual(["3", "4"]);

    const caughtUp = await run(["access-history", "export", "--after", "2"]);
    expect(caughtUp.stderr).toBe("");
    const single = await run(["access-history", "export", "--after", "1"]);
    expect(single.stderr).toBe("entry 2 is no longer kept: this server removes entries older than 365 days\n");
  });

  it("passes an open-source server's refusal through as the server wrote it", async () => {
    backend.refuse = true;
    const failure = await run(["access-history", "list"]).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(String(failure)).toContain("the access history is served by the Enterprise and Cloud editions");
  });
});
