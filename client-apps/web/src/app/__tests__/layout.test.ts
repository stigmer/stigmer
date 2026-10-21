/**
 * The console's root metadata: what a browser tab and a shared link show for
 * every console page that sets no title of its own.
 *
 * Pins that the tab names the app and that the description is the one
 * sentence from brand/positioning.ts, which the website reads too, so the
 * console never carries a hand-kept copy of the site's words.
 */
import { describe, expect, it, vi } from "vitest";
import { POSITIONING } from "../../../../../brand/positioning";

vi.mock("@/providers/Providers", () => ({ Providers: () => null }));
vi.mock("@/domain/_shared/layout/AppShell", () => ({ AppShell: () => null }));
vi.mock("@/domain/_shared/navigation/app-navigation", () => ({ AppNavigationProvider: () => null }));
vi.mock("@/domain/session/session-navigation", () => ({ SessionNavigationProvider: () => null }));
vi.mock("../fonts/fonts", () => ({ consoleFonts: [] }));

describe("the console's root metadata", () => {
  it("names the app in the tab and describes it in the one sentence", async () => {
    const { metadata } = await import("../layout");

    expect(metadata.title).toBe("Stigmer");
    expect(metadata.description).toBe(POSITIONING.oneSentence);
  });
});
