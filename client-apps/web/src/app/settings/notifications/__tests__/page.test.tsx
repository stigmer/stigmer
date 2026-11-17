// ---------------------------------------------------------------------------
// The old Settings → Notifications address: Notifications are a section of
// Account preferences now, so a bookmark or a shared link to this
// address replaces itself with that page's.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({ replaced: [] as string[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (to: string) => nav.replaced.push(to) }),
}));

import NotificationsPage from "../page";

describe("the old Settings → Notifications address", () => {
  it("replaces itself with /settings/account-preferences", async () => {
    const { container } = render(<NotificationsPage />);
    await waitFor(() =>
      expect(nav.replaced).toEqual(["/settings/account-preferences"]),
    );
    expect(container.textContent).toBe("");
  });
});
