// Pins the version surfaces in the resource layer: the history table
// (`get agent <ref> --version-history`) lists every version newest first with
// its short hash, tag, current marker and message; an empty history points at apply with an agent manifest; and
// `--version` reads the agent at a hash or a tag through the reference ladder.
// A hash-shaped argument the server finds no tag or hash for is read as a
// short hash and asked for again in full; a tag that looks like hex still
// wins, a short hash no version has answers the server's not-found, and one
// several versions share is a usage error.

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentVersionEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import type { Stigmer } from "@stigmer/client";
import { classify, ExitCode } from "../../errors/index.js";
import { getAgentAtVersion, renderAgentVersionHistory } from "../version.js";

const V2 = "b".repeat(64);
const V1 = "a".repeat(64);

describe("renderAgentVersionHistory", () => {
  it("lists the versions newest first, marking the current one", async () => {
    const listVersions = vi.fn(async () => ({
      entries: [
        create(AgentVersionEntrySchema, { versionHash: V2, isCurrent: true, tag: "stable", message: "tighter review" }),
        create(AgentVersionEntrySchema, { versionHash: V1, message: "" }),
      ],
      nextPageToken: "",
    }));
    const client = { agent: { listVersions } } as unknown as Stigmer;

    const rendered = await renderAgentVersionHistory(client, "", "reviewer");

    expect(listVersions).toHaveBeenCalledWith(expect.objectContaining({ org: "", slug: "reviewer", pageSize: 50 }));
    const lines = rendered.split("\n");
    expect(lines).toContain("Version History (2)");
    const rows = lines.filter((line) => line.includes("bbbbbbbbbbbb") || line.includes("aaaaaaaaaaaa"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^ {2}bbbbbbbbbbbb +stable +- +\* +tighter review$/);
    expect(rows[1]).toMatch(/^ {2}aaaaaaaaaaaa +- +- +-$/);
  });

  it("counts the page and marks older versions following it with +", async () => {
    const client = {
      agent: {
        listVersions: async () => ({
          entries: [create(AgentVersionEntrySchema, { versionHash: V2, isCurrent: true })],
          nextPageToken: "older",
        }),
      },
    } as unknown as Stigmer;

    const rendered = await renderAgentVersionHistory(client, "", "reviewer");

    expect(rendered.split("\n")).toContain("Version History (1+)");
  });

  it("points an empty history at applying an agent", async () => {
    const client = {
      agent: { listVersions: async () => ({ entries: [], nextPageToken: "" }) },
    } as unknown as Stigmer;

    const rendered = await renderAgentVersionHistory(client, "", "reviewer");

    expect(rendered).toContain("No version history found for reviewer\n");
    expect(rendered).toContain("Tip: Apply an agent to create the first version:");
    expect(rendered).toContain("stigmer apply -f agent.yaml");
  });
});

describe("getAgentAtVersion", () => {
  const NOT_FOUND = new ConnectError("agent version not found", Code.NotFound);

  // A server holding versions V1, V2 and V3 (V3 shares V1's first 32
  // characters), with the hex-looking tag "cafe1234" on V1, and the history
  // on one page.
  const V3 = `${"a".repeat(32)}${"c".repeat(32)}`;
  function serverWith() {
    const agentAt = (versionHash: string) => create(AgentSchema, { metadata: { id: "agt_1" }, status: { versionHash } });
    const getByReference = vi.fn(async ({ version }: { version: string }) => {
      if (version === V1 || version === "cafe1234") return agentAt(V1);
      if (version === V2) return agentAt(V2);
      throw NOT_FOUND;
    });
    const listVersions = vi.fn(async () => ({
      entries: [
        create(AgentVersionEntrySchema, { versionHash: V2 }),
        create(AgentVersionEntrySchema, { versionHash: V1, tag: "cafe1234" }),
        create(AgentVersionEntrySchema, { versionHash: V3 }),
      ],
      nextPageToken: "",
    }));
    return { client: { agent: { getByReference, listVersions } } as unknown as Stigmer, getByReference, listVersions };
  }

  it("reads the agent at a hash or a tag through the reference ladder, a hex-looking tag first", async () => {
    const { client, getByReference, listVersions } = serverWith();

    const agent = await getAgentAtVersion(client, "acme", "reviewer", "cafe1234");

    expect(agent.status?.versionHash).toBe(V1);
    expect(getByReference).toHaveBeenCalledWith({ org: "acme", slug: "reviewer", version: "cafe1234" });
    expect(listVersions).not.toHaveBeenCalled();
  });

  it("reads a short hash the server finds no tag for as the version it prefixes", async () => {
    const { client, getByReference } = serverWith();

    const agent = await getAgentAtVersion(client, "acme", "reviewer", "BBBBBBBBBBBB");

    expect(agent.status?.versionHash).toBe(V2);
    expect(getByReference.mock.calls.map(([req]) => req.version)).toEqual(["BBBBBBBBBBBB", V2]);
  });

  it("answers the server's not-found for a short hash no version has, and for a name that is not hex", async () => {
    const { client, listVersions } = serverWith();

    await expect(getAgentAtVersion(client, "acme", "reviewer", "dddd")).rejects.toBe(NOT_FOUND);
    await expect(getAgentAtVersion(client, "acme", "reviewer", "nightly")).rejects.toBe(NOT_FOUND);
    expect(listVersions).toHaveBeenCalledTimes(1);
  });

  it("answers the server's not-found for a full hash it does not hold, without reading the history", async () => {
    const { client, listVersions } = serverWith();

    await expect(getAgentAtVersion(client, "acme", "reviewer", "e".repeat(64))).rejects.toBe(NOT_FOUND);
    expect(listVersions).not.toHaveBeenCalled();
    expect((await getAgentAtVersion(client, "acme", "reviewer", V2.toUpperCase())).status?.versionHash).toBe(V2);
  });

  it("is a usage error for a short hash several versions share", async () => {
    const { client } = serverWith();

    const err = await getAgentAtVersion(client, "acme", "reviewer", "aaaa").catch((e: unknown) => e);

    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    expect((err as Error).message).toContain("aaaa matches 2 versions of acme/reviewer:");
  });
});
