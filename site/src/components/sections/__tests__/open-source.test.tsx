/**
 * The landing page's open-source section and the license it claims.
 *
 * Pins that the section says the core is Apache 2.0, not that all of Stigmer
 * is: the repository's ee/ directory is under the Stigmer Enterprise License,
 * so "Stigmer is Apache 2.0" would be a false statement about the license on
 * the page visitors read first.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OpenSource } from "../OpenSource";

afterEach(cleanup);

describe("OpenSource", () => {
  it("says the core is Apache 2.0, not the whole of Stigmer", () => {
    render(<OpenSource />);

    const claim = screen.getByText(/Apache 2\.0\. Public protobuf contracts\./);
    expect(claim.textContent).toContain("Stigmer's core is Apache 2.0.");
    expect(claim.textContent).not.toContain("Stigmer is Apache 2.0");
  });
});
