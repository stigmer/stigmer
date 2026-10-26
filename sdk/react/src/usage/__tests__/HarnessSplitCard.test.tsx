/**
 * HarnessSplitCard sizes each harness by tokens and labels it with its
 * tokens, calls and share; nothing renders for no rows or no tokens, and
 * nothing on it is money.
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
          create(HarnessUsageSchema, { harness: "native", totalTokens: 12_000n, callCount: 40, runCount: 5 }),
          create(HarnessUsageSchema, { harness: "cursor", totalTokens: 4_000n, callCount: 0, runCount: 2 }),
          create(HarnessUsageSchema, { harness: "claude", totalTokens: 4_000n, callCount: 9, runCount: 1 }),
          create(HarnessUsageSchema, { harness: "later-engine", totalTokens: 0n, callCount: 0, runCount: 0 }),
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "Token distribution by harness" })).toBeTruthy();
    expect(screen.getByText("Stigmer").parentElement?.textContent).toBe("Stigmer12.0k tokens40 calls (60%)");
    expect(screen.getByText("Cursor").parentElement?.textContent).toBe("Cursor4.0k tokens0 calls (20%)");
    expect(screen.getByText("Claude").parentElement?.textContent).toBe("Claude4.0k tokens9 calls (20%)");
    expect(screen.getByText("later-engine"), "a word this build does not name keeps its own").toBeTruthy();
    expect(container.textContent).not.toContain("$");
  });

  it("renders nothing without rows or tokens", () => {
    const { container } = render(<HarnessSplitCard breakdown={[]} />);
    expect(container.firstChild).toBeNull();
    cleanup();
    const zero = render(
      <HarnessSplitCard breakdown={[create(HarnessUsageSchema, { harness: "native", totalTokens: 0n })]} />,
    );
    expect(zero.container.firstChild).toBeNull();
  });
});
