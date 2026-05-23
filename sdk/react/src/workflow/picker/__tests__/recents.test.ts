import { describe, it, expect, beforeEach } from "vitest";
import { getRecentKinds, recordRecentKind, clearRecentKinds } from "../recents";

const TEST_KEY = "stigmer:test:recent-kinds";

describe("TaskKindRecentsStore", () => {
  beforeEach(() => {
    clearRecentKinds(TEST_KEY);
  });

  it("returns empty array when no recents exist", () => {
    const recents = getRecentKinds(TEST_KEY);
    expect(recents).toEqual([]);
  });

  it("records a kind and retrieves it", () => {
    recordRecentKind("http_call", TEST_KEY);
    const recents = getRecentKinds(TEST_KEY);
    expect(recents).toHaveLength(1);
    expect(recents[0].kind).toBe("http_call");
  });

  it("records multiple kinds in most-recent-first order", () => {
    recordRecentKind("http_call", TEST_KEY);
    recordRecentKind("agent_call", TEST_KEY);
    recordRecentKind("transform", TEST_KEY);

    const recents = getRecentKinds(TEST_KEY);
    expect(recents[0].kind).toBe("transform");
    expect(recents[1].kind).toBe("agent_call");
    expect(recents[2].kind).toBe("http_call");
  });

  it("deduplicates: recording an existing kind moves it to front", () => {
    recordRecentKind("http_call", TEST_KEY);
    recordRecentKind("agent_call", TEST_KEY);
    recordRecentKind("http_call", TEST_KEY);

    const recents = getRecentKinds(TEST_KEY);
    expect(recents).toHaveLength(2);
    expect(recents[0].kind).toBe("http_call");
    expect(recents[1].kind).toBe("agent_call");
  });

  it("caps at 5 entries", () => {
    recordRecentKind("kind_1", TEST_KEY);
    recordRecentKind("kind_2", TEST_KEY);
    recordRecentKind("kind_3", TEST_KEY);
    recordRecentKind("kind_4", TEST_KEY);
    recordRecentKind("kind_5", TEST_KEY);
    recordRecentKind("kind_6", TEST_KEY);

    const recents = getRecentKinds(TEST_KEY);
    expect(recents).toHaveLength(5);
    expect(recents[0].kind).toBe("kind_6");
    // kind_1 should have been evicted
    const kinds = recents.map((r) => r.kind);
    expect(kinds).not.toContain("kind_1");
  });

  it("clearRecentKinds removes all entries", () => {
    recordRecentKind("http_call", TEST_KEY);
    recordRecentKind("agent_call", TEST_KEY);

    clearRecentKinds(TEST_KEY);
    const recents = getRecentKinds(TEST_KEY);
    expect(recents).toEqual([]);
  });

  it("handles corrupted localStorage data gracefully", () => {
    globalThis.localStorage.setItem(TEST_KEY, "not valid json [[[");
    const recents = getRecentKinds(TEST_KEY);
    expect(recents).toEqual([]);
  });

  it("handles non-array localStorage data gracefully", () => {
    globalThis.localStorage.setItem(TEST_KEY, JSON.stringify({ foo: "bar" }));
    const recents = getRecentKinds(TEST_KEY);
    expect(recents).toEqual([]);
  });

  it("filters out invalid entries from localStorage", () => {
    const data = [
      { kind: "valid_kind", timestamp: Date.now() },
      { kind: 123, timestamp: Date.now() }, // invalid: kind is not string
      { timestamp: Date.now() }, // invalid: missing kind
      { kind: "another_valid", timestamp: Date.now() },
    ];
    globalThis.localStorage.setItem(TEST_KEY, JSON.stringify(data));

    const recents = getRecentKinds(TEST_KEY);
    expect(recents).toHaveLength(2);
    expect(recents[0].kind).toBe("valid_kind");
    expect(recents[1].kind).toBe("another_valid");
  });
});
