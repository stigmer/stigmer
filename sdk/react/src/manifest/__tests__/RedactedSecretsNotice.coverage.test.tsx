/**
 * RedactedSecretsNotice states the redaction contract in words: the
 * `***REDACTED***` marker names a stored secret, applying it keeps that
 * secret, and replacing it sets a new value.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RedactedSecretsNotice } from "../RedactedSecretsNotice";

afterEach(cleanup);

describe("RedactedSecretsNotice", () => {
  it("names the marker and says applying keeps the stored secrets", () => {
    render(<RedactedSecretsNotice className="custom" />);

    const marker = screen.getByText("***REDACTED***");
    expect(marker.tagName).toBe("CODE");
    expect(marker.parentElement?.textContent).toBe("Secret values are shown as ***REDACTED***.");
    expect(
      screen.getByText("Applying keeps the stored secrets; replace a marker to set a new value."),
    ).toBeTruthy();
  });
});
