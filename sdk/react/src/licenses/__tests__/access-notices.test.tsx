/**
 * The operator consoles' access notices, exported for an embedder that
 * mounts an operator surface of its own: each says what its console's
 * settings frame says to a person who is not a platform operator, in the
 * same words, as a status (the shared permission empty state), so the
 * console and an embedder never tell a refused person two different things.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LICENSES_DENIAL, LicensesAccessNotice } from "../LicensesAccessNotice";
import { PLANS_DENIAL, PlansAccessNotice } from "../../plan-catalog/PlansAccessNotice";

afterEach(cleanup);

describe("the operator consoles' access notices", () => {
  it.each([
    ["LicensesAccessNotice", LicensesAccessNotice, LICENSES_DENIAL],
    ["PlansAccessNotice", PlansAccessNotice, PLANS_DENIAL],
  ] as const)("%s says what its console's frame says to a non-operator", (_name, Notice, denial) => {
    render(<Notice />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(denial.title);
    expect(notice.textContent).toContain(denial.description);
  });
});
