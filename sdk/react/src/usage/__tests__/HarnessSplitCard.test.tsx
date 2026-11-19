/**
 * HarnessSplitCard draws "By harness": each harness sized by tokens and
 * named in one line with its tokens, calls and share; nothing renders for
 * no rows or no tokens, and nothing on it is money.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { HarnessUsageSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { HarnessSplitCard } from "../HarnessSplitCard";

afterEach(cleanup);

describe("HarnessSplitCard", () => {
  it("labels each harness with its tokens, calls and share", () => {
    const { container } = render(
      <HarnessSplitCard
        breakdown={[
          create(HarnessUsageSchema, { harness: "stigmer", totalTokens: 12_000n, callCount: 40, runCount: 5 }),
          create(HarnessUsageSchema, { harness: "claude", totalTokens: 8_000n, callCount: 0, runCount: 1 }),
          create(HarnessUsageSchema, { harness: "later-engine", totalTokens: 0n, callCount: 0, runCount: 0 }),
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "By harness" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Token distribution by harness" })).toBeTruthy();
    // Each harness reads as one line: name · tokens · calls · share.
    expect(screen.getByText("Stigmer · 12.0k tokens · 40 calls · 60%")).toBeTruthy();
    expect(screen.getByText("Claude Agent · 8.0k tokens · 0 calls · 40%")).toBeTruthy();
    expect(
      screen.getByText("later-engine · 0 tokens · 0 calls · 0%"),
      "a word this build does not name keeps its own",
    ).toBeTruthy();
    expect(container.textContent).not.toContain("$");
  });

  it("renders nothing without rows or tokens", () => {
    const { container } = render(<HarnessSplitCard breakdown={[]} />);
    expect(container.firstChild).toBeNull();
    cleanup();
    const zero = render(
      <HarnessSplitCard breakdown={[create(HarnessUsageSchema, { harness: "stigmer", totalTokens: 0n })]} />,
    );
    expect(zero.container.firstChild).toBeNull();
  });
});
