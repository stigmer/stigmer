/**
 * The served-by rule (stigmer#1441): a split only when two or more known
 * credential sources served tokens, the unknown remainder as its own share;
 * one known source as a plain line ("All on your keys", or "Your keys
 * served ..." when some tokens have no recorded source); nothing when no
 * source is known, or an "estimated" note on request when nothing was
 * metered.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProviderKeySource } from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";
import { ServedByLine, summarizeServedBy, type ServedByRow } from "../ServedByLine";

afterEach(cleanup);

const org = (tokens: number, calls = 1): ServedByRow => ({
  providerKeySource: ProviderKeySource.ORGANIZATION,
  totalTokens: tokens,
  llmCallCount: calls,
});
const platform = (tokens: number, calls = 1): ServedByRow => ({
  providerKeySource: ProviderKeySource.PLATFORM,
  totalTokens: tokens,
  llmCallCount: calls,
});
const unknown = (tokens: number, calls = 0): ServedByRow => ({
  providerKeySource: ProviderKeySource.UNSPECIFIED,
  totalTokens: tokens,
  llmCallCount: calls,
});

describe("summarizeServedBy", () => {
  it("splits by tokens when two known sources served, most first, unknown last", () => {
    expect(summarizeServedBy([platform(2_000), org(6_000), unknown(2_000)])).toEqual({
      kind: "split",
      shares: [
        { label: "your keys", tokens: 6_000, percent: 60 },
        { label: "Stigmer's free model", tokens: 2_000, percent: 20 },
        { label: "source not recorded", tokens: 2_000, percent: 20 },
      ],
    });
  });

  it("reads one known source as a plain line", () => {
    expect(summarizeServedBy([org(6_000)])).toEqual({ kind: "single", text: "All on your keys" });
    expect(summarizeServedBy([org(6_000), unknown(1_000)])).toEqual({
      kind: "single",
      text: "Your keys served 6.0k tokens",
    });
  });

  it("ignores a known row with nothing in it", () => {
    expect(summarizeServedBy([org(6_000), platform(0, 0)])).toEqual({ kind: "single", text: "All on your keys" });
  });

  it("says estimated only when no source is known and nothing was metered", () => {
    expect(summarizeServedBy([unknown(1_000)])).toEqual({ kind: "estimated" });
    expect(summarizeServedBy([unknown(1_000, 3)])).toEqual({ kind: "none" });
    expect(summarizeServedBy([])).toEqual({ kind: "none" });
  });
});

describe("ServedByLine", () => {
  it("renders the split as one labelled line", () => {
    render(<ServedByLine rows={[org(6_000), platform(2_000)]} />);
    expect(screen.getByLabelText("Served by").textContent).toBe(
      "Served by your keys 6.0k tokens (75%) · Stigmer's free model 2.0k tokens (25%)",
    );
  });

  it("shows the estimated note only when asked", () => {
    const { container } = render(<ServedByLine rows={[unknown(1_000)]} />);
    expect(container.firstChild).toBeNull();
    cleanup();
    render(<ServedByLine rows={[unknown(1_000)]} showEstimated />);
    expect(screen.getByLabelText("Served by").textContent).toBe("Estimated from the runners' own reports");
  });
});
