// Unit tests for the proto-to-differ mappings in stream/convert.ts that the
// stream renderers print verbatim: the summarization source names (and their
// fallback), and the sanitizing of raw provider errors in system messages,
// which keeps an explanatory prefix when the message has one, replaces a bare
// raw error with the run-logs pointer, and leaves ordinary text untouched.

import { SummarizationSource } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { isApprovalNoiseMessage, mapSummarizationSource, sanitizeSystemContent } from "../convert.js";

describe("mapSummarizationSource", () => {
  it.each([
    [SummarizationSource.graph_start, "graph_start"],
    [SummarizationSource.mid_run, "mid_run"],
    [SummarizationSource.SUMMARIZATION_SOURCE_UNSPECIFIED, "unknown"],
  ])("%s -> %s", (source, expected) => {
    expect(mapSummarizationSource(source)).toBe(expected);
  });
});

describe("sanitizeSystemContent", () => {
  it("leaves ordinary system text as it is", () => {
    expect(sanitizeSystemContent("Context summarized to fit the window.")).toBe(
      "Context summarized to fit the window.",
    );
  });

  it("keeps the explanatory prefix of a raw API error", () => {
    expect(
      sanitizeSystemContent("Model call failed: Error code: 400 - {'type': 'error', 'message': 'bad'}"),
    ).toBe("Model call failed (internal error — check run logs for details)");
  });

  it("replaces a bare raw error with the run-logs pointer", () => {
    expect(sanitizeSystemContent("Error code: 500 - {\"type\": \"error\"}")).toBe(
      "Agent run encountered an internal error. Check run logs for details.",
    );
    expect(sanitizeSystemContent("invalid_request_error: request_id=req_1")).toBe(
      "Agent run encountered an internal error. Check run logs for details.",
    );
  });
});

describe("isApprovalNoiseMessage", () => {
  it("recognizes the approval acknowledgement and nothing else", () => {
    expect(isApprovalNoiseMessage("Approval received for Shell")).toBe(true);
    expect(isApprovalNoiseMessage("Awaiting approval")).toBe(false);
  });
});
