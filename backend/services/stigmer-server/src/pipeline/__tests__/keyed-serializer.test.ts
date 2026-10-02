/**
 * Pins KeyedSerializer, the per-key turn the recover RPCs run in
 * (stigmer#1672): work for one key never overlaps and starts in arrival
 * order; work for different keys never waits on each other; a rejected
 * work rejects only its own caller and neither blocks nor poisons the next;
 * and a key's entry is gone once its queue drains, so the map holds only
 * keys with work in flight. Every case is driven by deferreds the test
 * settles itself, never by a timer.
 */
import { describe, expect, it } from "vitest";

import { KeyedSerializer } from "../keyed-serializer.js";
import { deferred } from "./race-support.js";

describe("KeyedSerializer", () => {
  it("runs work for one key one at a time, in arrival order", async () => {
    const serializer = new KeyedSerializer();
    const events: string[] = [];
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const releaseSecond = deferred();

    const first = serializer.run("aex_1", async () => {
      events.push("first started");
      firstStarted.resolve();
      await releaseFirst.promise;
      events.push("first finished");
      return "first";
    });
    const second = serializer.run("aex_1", async () => {
      events.push("second started");
      await releaseSecond.promise;
      events.push("second finished");
      return "second";
    });
    const third = serializer.run("aex_1", async () => {
      events.push("third started");
      return "third";
    });

    await firstStarted.promise;
    expect(events).toEqual(["first started"]);
    releaseFirst.resolve();
    expect(await first).toBe("first");
    releaseSecond.resolve();
    expect(await second).toBe("second");
    expect(await third).toBe("third");
    expect(events).toEqual([
      "first started",
      "first finished",
      "second started",
      "second finished",
      "third started",
    ]);
  });

  it("never makes work for one key wait on another key", async () => {
    const serializer = new KeyedSerializer();
    const releaseHeld = deferred();
    const otherStarted = deferred();

    const held = serializer.run("aex_held", async () => {
      await releaseHeld.promise;
    });
    const other = serializer.run("aex_other", async () => {
      otherStarted.resolve();
    });

    // Reached only while the held key's work is still running; a shared
    // queue would time the case out instead.
    await otherStarted.promise;
    await other;
    releaseHeld.resolve();
    await held;
  });

  it("rejects only the failing caller, and the next work for the key still runs", async () => {
    const serializer = new KeyedSerializer();
    const failure = new Error("first exploded");

    const first = serializer.run("aex_1", async () => {
      throw failure;
    });
    const second = serializer.run("aex_1", async () => "second");

    await expect(first).rejects.toBe(failure);
    expect(await second).toBe("second");
  });

  it("runs work that throws before its first await as a rejection, not a throw from run", async () => {
    const serializer = new KeyedSerializer();
    const failure = new Error("synchronous");

    const first = serializer.run("aex_1", () => {
      throw failure;
    });
    await expect(first).rejects.toBe(failure);
    expect(await serializer.run("aex_1", async () => "after")).toBe("after");
  });

  it("forgets a key once its queue drains, whatever the last work's outcome", async () => {
    const serializer = new KeyedSerializer();
    const release = deferred();
    expect(serializer.activeKeyCount).toBe(0);

    const held = serializer.run("aex_1", async () => {
      await release.promise;
    });
    const failing = serializer.run("aex_1", async () => {
      throw new Error("last one fails");
    });
    const other = serializer.run("aex_2", async () => "other");
    expect(serializer.activeKeyCount).toBe(2);

    await other;
    expect(serializer.activeKeyCount).toBe(1);
    release.resolve();
    await held;
    await expect(failing).rejects.toThrow("last one fails");
    expect(serializer.activeKeyCount).toBe(0);
  });
});
