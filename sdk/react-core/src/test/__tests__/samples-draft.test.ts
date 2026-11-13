// Proves the sample builder a live thought or message needs (../samples.ts):
// the stream frame that opens it (`event_start`) under the id its stored
// event will carry, typed as a thought or a message, which the session log
// folds into a live item a replay draws until the stored event arrives.
import { describe, it, expect } from "vitest";
import { SessionLog } from "@stigmer/client";
import { samples } from "../samples";

const RUN = samples.run().metadata!.id;

describe("samples.draftFrame", () => {
  it("opens a thought under the id its stored event will carry", () => {
    const frame = samples.draftFrame(`${RUN}.root.t1`, "thinking");
    expect(frame.frame.case).toBe("eventStart");
    expect(frame.frame.case === "eventStart" && frame.frame.value.event).toMatchObject({ id: `${RUN}.root.t1`, type: "agent.thinking" });
  });

  it("opens a message as an agent message", () => {
    const frame = samples.draftFrame(`${RUN}.root.m1`, "message");
    expect(frame.frame.case === "eventStart" && frame.frame.value.event).toMatchObject({ id: `${RUN}.root.m1`, type: "agent.message" });
  });

  it("folds, after the turn's events, into a live thought with no words yet", () => {
    const log = new SessionLog();
    log.apply(samples.turnEvents({ message: "Why are invoices off?", phase: "running", reply: "" }).map((event, i) => ({ ...event, seq: BigInt(i + 1) })));
    log.applyFrame(samples.draftFrame(`${RUN}.root.t1`, "thinking"));
    const last = log.snapshot().turns[0]!.items.at(-1);
    expect(last).toMatchObject({ kind: "thinking", id: `${RUN}.root.t1`, live: true, text: "" });
  });
});
