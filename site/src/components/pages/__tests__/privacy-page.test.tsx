/**
 * The public privacy policy: static legal copy.
 *
 * Pins what the policy says the service does with the information it
 * collects: it runs the agents a customer configures, and it neither sells
 * personal information nor trains models on customer content.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PrivacyPage } from "../PrivacyPage";

afterEach(() => {
  cleanup();
});

describe("PrivacyPage", () => {
  it("says the information runs the agents a customer configures, and is never sold or trained on", () => {
    render(<PrivacyPage />);

    expect(screen.getByText("How we use information")).toBeTruthy();
    const use = screen.getByText(/execute the agents you configure/);
    expect(use.textContent?.replace(/\s+/g, " ")).toContain(
      "provide and operate the service, execute the agents you configure, bill for usage,",
    );
    const text = use.textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("We do not sell your personal information");
    expect(text).toContain("not use your content to train our own or third-party");
  });
});
