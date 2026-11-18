// ---------------------------------------------------------------------------
// The old Settings → Policies address: Policies are a section of
// Organization preferences now, so a bookmark or a shared link to this
// address replaces itself with that page's.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({ replaced: [] as string[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (to: string) => nav.replaced.push(to) }),
}));

import OrgPoliciesPage from "../page";

describe("the old Settings → Policies address", () => {
  it("replaces itself with /settings/org-preferences", async () => {
    const { container } = render(<OrgPoliciesPage />);
    await waitFor(() =>
      expect(nav.replaced).toEqual(["/settings/org-preferences"]),
    );
    expect(container.textContent).toBe("");
  });
});
