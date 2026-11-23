import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  AgentVersionEntrySchema,
  type AgentVersionEntry,
} from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { agentVersionLabel, useAgentVersions } from "../useAgentVersions";
import type { VersionEntry } from "../../version-history/version-entry";

// ---------------------------------------------------------------------------
// An agent's version history and how a version reads, as a host drawing its
// own chat reads them from @stigmer/react-core alone.
//
// Pinned: the history pages newest first through `listVersions` and maps
// each entry to the shared timeline shape (id is the hash, the label its
// short form, the tag kept); `getSpec` answers a loaded version's spec by
// hash; a null org or slug reads nothing; and `agentVersionLabel` words a
// version by its tag, else its short hash, including a hash the history does
// not hold (still loading, or a history the reader cannot see).
// ---------------------------------------------------------------------------

const HASH_V2 = "3f2a9c1e0b7d44aa";
const HASH_V1 = "aa11bb22cc33dd44";
const HASH_V0 = "0f0f0f0f0f0f0f0f";

function entry(hash: string, tag: string, instructions: string, isCurrent = false): AgentVersionEntry {
  return create(AgentVersionEntrySchema, {
    versionHash: hash,
    tag,
    isCurrent,
    message: tag ? `release ${tag}` : "",
    appliedAt: timestampFromDate(new Date("2026-11-20T10:00:00Z")),
    appliedBy: { id: "usr_1", avatar: "" },
    specSnapshot: { instructions },
  });
}

function clientWith(listVersions: ReturnType<typeof vi.fn>): Stigmer {
  return { agent: { listVersions } } as unknown as Stigmer;
}

function render(listVersions: ReturnType<typeof vi.fn>, org: string | null, slug: string | null) {
  const client = clientWith(listVersions);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return renderHook(() => useAgentVersions(org, slug), { wrapper });
}

describe("useAgentVersions", () => {
  it("pages the history newest first, mapped to the timeline shape", async () => {
    const listVersions = vi
      .fn()
      .mockResolvedValueOnce({
        entries: [entry(HASH_V2, "v2", "second", true), entry(HASH_V1, "v1", "first")],
        nextPageToken: "page-2",
      })
      .mockResolvedValueOnce({ entries: [entry(HASH_V0, "", "zeroth")], nextPageToken: "" });

    const hook = render(listVersions, "acme", "reviewer");
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    expect(listVersions).toHaveBeenCalledWith(
      expect.objectContaining({ org: "acme", slug: "reviewer", pageToken: "" }),
    );
    expect(hook.result.current.versions.map((v) => v.id)).toEqual([HASH_V2, HASH_V1]);
    const newest = hook.result.current.versions[0];
    expect(newest).toMatchObject({
      id: HASH_V2,
      label: HASH_V2.slice(0, 12),
      tag: "v2",
      sublabel: "release v2",
      isCurrent: true,
      actor: { id: "usr_1", avatar: undefined },
    });
    expect(newest?.timestamp.toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(hook.result.current.hasMore).toBe(true);
    expect(hook.result.current.isEmpty).toBe(false);

    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.versions).toHaveLength(3));
    expect(listVersions).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageToken: "page-2" }),
    );
    expect(hook.result.current.versions[2]).toMatchObject({ id: HASH_V0, tag: undefined });
    expect(hook.result.current.hasMore).toBe(false);
  });

  it("answers a loaded version's spec by its hash, and null for one not loaded", async () => {
    const listVersions = vi.fn().mockResolvedValue({
      entries: [entry(HASH_V2, "v2", "second", true)],
      nextPageToken: "",
    });
    const hook = render(listVersions, "acme", "reviewer");
    await waitFor(() => expect(hook.result.current.versions).toHaveLength(1));

    expect(hook.result.current.getSpec(HASH_V2)?.instructions).toBe("second");
    expect(hook.result.current.getSpec(HASH_V1)).toBeNull();
  });

  it("reads nothing while the org or the slug is null", async () => {
    const listVersions = vi.fn();
    const noOrg = render(listVersions, null, "reviewer");
    const noSlug = render(listVersions, "acme", null);
    await waitFor(() => expect(noOrg.result.current.isLoading).toBe(false));
    await waitFor(() => expect(noSlug.result.current.isLoading).toBe(false));

    expect(listVersions).not.toHaveBeenCalled();
    expect(noOrg.result.current.versions).toEqual([]);
    expect(noOrg.result.current.isEmpty).toBe(true);
  });
});

describe("agentVersionLabel", () => {
  const history: readonly VersionEntry[] = [
    { id: HASH_V2, timestamp: new Date(0), label: HASH_V2.slice(0, 12), tag: "v2" },
    { id: HASH_V1, timestamp: new Date(0), label: HASH_V1.slice(0, 12) },
  ];

  it("words a tagged version by its tag", () => {
    expect(agentVersionLabel(history, HASH_V2)).toBe("v2");
  });

  it("words an untagged version by its short hash", () => {
    expect(agentVersionLabel(history, HASH_V1)).toBe("aa11bb22cc33");
  });

  it("words a hash the history does not hold by its short hash", () => {
    expect(agentVersionLabel(history, HASH_V0)).toBe("0f0f0f0f0f0f");
    expect(agentVersionLabel([], HASH_V2)).toBe("3f2a9c1e0b7d");
  });
});
