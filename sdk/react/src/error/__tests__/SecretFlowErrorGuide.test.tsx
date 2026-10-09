/**
 * Pins the error guide against the run resolver's refusal wording
 * (backend/services/stigmer-server/src/domain/vault/resolve.ts
 * `missingMessage`): each "<declarer> needs <KEY>: <who acts>" item is
 * shown with its declarer, key and instruction, a recover's wrapping prefix
 * does not leak into the declarer, a long message is read in linear time,
 * and any other failure renders nothing.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StigmerError } from "@stigmer/sdk";

import { SecretFlowErrorGuide, isSecretFlowError } from "../SecretFlowErrorGuide.js";

function preconditionError(message: string): StigmerError {
  return new StigmerError("failed-precondition", message, 9);
}

describe("SecretFlowErrorGuide", () => {
  it("shows each missing key with its declarer and the server's instruction", () => {
    render(
      <SecretFlowErrorGuide
        error={preconditionError(
          "Linear needs LINEAR_API_KEY: sign in to Linear, or add LINEAR_API_KEY to My vault; the agent Support needs ZENDESK_TOKEN: add ZENDESK_TOKEN to My vault",
        )}
      />,
    );
    expect(screen.getByText("Linear")).toBeTruthy();
    expect(screen.getByText("LINEAR_API_KEY")).toBeTruthy();
    expect(screen.getByText(/sign in to Linear/)).toBeTruthy();
    expect(screen.getByText("the agent Support")).toBeTruthy();
    expect(screen.getByText("ZENDESK_TOKEN")).toBeTruthy();
  });

  it("keeps a recover's wrapping prefix out of the declarer", () => {
    const error = preconditionError(
      "recreate execution context for recovered execution run_1: GitHub needs GITHUB_TOKEN: add GITHUB_TOKEN to My vault",
    );
    render(<SecretFlowErrorGuide error={error} />);
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(isSecretFlowError(error)).toBe(true);
  });

  it("reads a long message without the pattern-matching slowdown, finding nothing in it", () => {
    const hostile = preconditionError("9".repeat(200_000) + " needs " + "9".repeat(200_000));
    const started = performance.now();
    expect(isSecretFlowError(hostile)).toBe(false);
    expect(performance.now() - started, "linear in the message's length").toBeLessThan(1_000);
  });

  it("renders nothing for any other failure", () => {
    const { container } = render(
      <SecretFlowErrorGuide error={preconditionError("the session is busy")} />,
    );
    expect(container.innerHTML).toBe("");
    expect(isSecretFlowError(new Error("Linear needs X: y"))).toBe(false);
    expect(
      isSecretFlowError(preconditionError("Linear needs LINEAR_API_KEY:   ; the agent needs 9KEY: act")),
      "an instruction that is only spaces, or a key that is not a variable name, is not the refusal",
    ).toBe(false);
  });
});
