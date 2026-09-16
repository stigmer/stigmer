/**
 * Unit tests for the streaming persist decision (issue #179), the shared
 * cadence rule both adapters' stream loops read.
 *
 * Validates the converged cadence: a discrete transcript change persists
 * immediately, while high-frequency token deltas ride the shared
 * StreamingUpdateScheduler's time cadence (rather than the old, time-blind
 * `eventCount % 20` gate that starved short turns). The signal is the one
 * transcript builder's `dirty` flag (since #1097); until then three
 * Cursor-named flags, two of them constant `false` on both loops.
 */

import { describe, it, expect } from "vitest";
import {
  StreamingUpdateScheduler,
  type StreamingConfig,
} from "../streaming-scheduler.js";
import { shouldPersistStreamingStatus } from "../persist-decision.js";

const CONFIG: StreamingConfig = {
  minIntervalMs: 500,
  maxIntervalMs: 5000,
  burstThreshold: 50,
};

describe("shouldPersistStreamingStatus", () => {
  it("persists on the first event via the scheduler (kills the opaque-wait at turn start)", () => {
    const scheduler = new StreamingUpdateScheduler(CONFIG, 0);
    expect(shouldPersistStreamingStatus(false, scheduler, 1, 0)).toBe(true);
  });

  it("does not persist a sub-500ms token delta while the transcript is clean", () => {
    const scheduler = new StreamingUpdateScheduler(CONFIG, 0);
    scheduler.markUpdateSent(1, 0); // first flush already sent

    // 100ms later, one more delta event — too soon for the time cadence.
    expect(shouldPersistStreamingStatus(false, scheduler, 2, 100)).toBe(false);
  });

  it("persists a token delta once the 500ms cadence elapses", () => {
    const scheduler = new StreamingUpdateScheduler(CONFIG, 0);
    scheduler.markUpdateSent(1, 0);

    expect(shouldPersistStreamingStatus(false, scheduler, 2, 500)).toBe(true);
  });

  it("flushes immediately when the transcript is dirty, bypassing the time cadence", () => {
    const scheduler = new StreamingUpdateScheduler(CONFIG, 0);
    scheduler.markUpdateSent(1, 0);

    // Only 1ms after the last flush: the scheduler alone would say no...
    expect(shouldPersistStreamingStatus(false, scheduler, 2, 1)).toBe(false);
    // ...but a discrete transcript change flushes now.
    expect(shouldPersistStreamingStatus(true, scheduler, 2, 1)).toBe(true);
  });

  // The #179 starvation scenario: a short turn of < 20 events. Under the old
  // `eventCount % 20` gate, a tool call appearing at event 3 (and completing at
  // event 4) would never be persisted until the unconditional final flush. With
  // the converged decision, the tool lifecycle flushes the instant it happens,
  // regardless of how few events the turn has.
  it("surfaces a tool call on a short (<20 event) turn", () => {
    const scheduler = new StreamingUpdateScheduler(CONFIG, 0);
    const flushes: number[] = [];
    let clock = 0;

    // Helper mirroring the loop: decide, then mark both clocks on a flush.
    const tick = (eventCount: number, transcriptDirty: boolean) => {
      const persist = shouldPersistStreamingStatus(transcriptDirty, scheduler, eventCount, clock);
      if (persist) {
        flushes.push(eventCount);
        scheduler.markUpdateSent(eventCount, clock);
      }
      clock += 50; // 50ms between events — well under the 500ms floor
    };

    tick(1, false); // assistant delta — first-event flush
    tick(2, false); // thinking delta — within 500ms, no flush
    tick(3, true);  // tool call starts — the transcript is dirty, flush
    tick(4, true);  // tool call completes — dirty again, flush
    tick(5, false); // closing assistant delta — within 500ms, no flush

    // The tool lifecycle (events 3 and 4) is observed live; event 1 is the
    // first-event flush. Events 2 and 5 correctly ride the cadence.
    expect(flushes).toEqual([1, 3, 4]);
  });
});
