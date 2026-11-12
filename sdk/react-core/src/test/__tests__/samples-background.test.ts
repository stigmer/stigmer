// Proves the sample builders a running command's story needs (../samples.ts):
// a background command's status event, started (its time limit) or ended
// (how, with what code and output, stopped by whom), with its id derived
// from the tool use and its phase unless one is given; and a running tool's
// output as a stream frame.
import { describe, it, expect } from "vitest";
import { samples, SAMPLE_INSTANT, sampleInstant } from "../samples";

describe("samples.backgroundCommandStatusEvent", () => {
  it("says a command started, with a ten-minute limit and nothing of an end", () => {
    expect(samples.backgroundCommandStatusEvent("tu-1").event).toEqual({
      case: "stigmerBackgroundCommandStatus",
      value: expect.objectContaining({
        id: "tu-1.bg.running",
        processedAt: SAMPLE_INSTANT,
        toolUseId: "tu-1",
        sessionThreadId: "",
        phase: "running",
        timeoutSeconds: 600,
        ending: "",
        stoppedBy: "",
        output: "",
        endedAt: "",
      }),
    });
    expect(samples.backgroundCommandStatusEvent("tu-1").event.value).not.toHaveProperty("exitCode", expect.anything());
  });

  it("says how an ended command ended: exited by default, else as given, at the moment it is stamped", () => {
    const at = sampleInstant(5_000);
    expect(samples.backgroundCommandStatusEvent("tu-1", { phase: "ended", processedAt: at }).event.value).toMatchObject({
      id: "tu-1.bg.ended",
      ending: "exited",
      stoppedBy: "",
      endedAt: at,
    });
    expect(
      samples.backgroundCommandStatusEvent("tu-1", {
        id: "ev-9",
        threadId: "th-1",
        phase: "ended",
        ending: "stopped",
        stoppedBy: "person",
        exitCode: 143,
        output: "killed",
        timeoutSeconds: 30,
      }).event.value,
    ).toMatchObject({ id: "ev-9", sessionThreadId: "th-1", ending: "stopped", stoppedBy: "person", exitCode: 143, output: "killed", timeoutSeconds: 30 });
  });
});

describe("samples.toolOutputDeltaFrame", () => {
  it("carries a running tool's output fragment as a streamed frame", () => {
    expect(samples.toolOutputDeltaFrame("tu-1", "PASS\n").frame).toEqual({
      case: "stigmerToolOutputDelta",
      value: expect.objectContaining({ toolUseId: "tu-1", delta: "PASS\n" }),
    });
  });
});
