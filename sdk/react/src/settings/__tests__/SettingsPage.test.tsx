/**
 * SettingsPage, the frame every settings page opens with: a landmark named
 * by its heading (an h2, under the settings layout's h1), the one-line
 * description and the page's main act; and the two answers a page knows
 * before it reads anything. Where the edition does not offer the page
 * (`unavailable`) or the person may not see it (`denied`), the body is never
 * mounted, so none of its reads start, and the main act is not offered.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { SettingsPage } from "../SettingsPage";

afterEach(cleanup);

/** A body that records that it mounted, as a panel's read would start. */
function Body({ mounted }: { readonly mounted: string[] }) {
  useEffect(() => {
    mounted.push("body");
  }, [mounted]);
  return <p>The page's rows</p>;
}

describe("SettingsPage", () => {
  it("is a region named by its h2 heading, with its description, act and body", () => {
    const mounted: string[] = [];
    render(
      <SettingsPage title="Teams" description="Groups of people." actions={<button type="button">New team</button>}>
        <Body mounted={mounted} />
      </SettingsPage>,
    );
    const region = screen.getByRole("region", { name: "Teams" });
    expect(within(region).getByRole("heading", { level: 2, name: "Teams" })).toBeTruthy();
    expect(within(region).getByText("Groups of people.")).toBeTruthy();
    expect(within(region).getByRole("button", { name: "New team" })).toBeTruthy();
    expect(within(region).getByText("The page's rows")).toBeTruthy();
    expect(mounted).toEqual(["body"]);
  });

  it("says what this edition does instead, and never mounts the body or offers the act, where it is unavailable", () => {
    const mounted: string[] = [];
    render(
      <SettingsPage
        title="Teams"
        actions={<button type="button">New team</button>}
        unavailable="Teams come with Stigmer Enterprise and Cloud. On this edition roles are granted on the organization only."
      >
        <Body mounted={mounted} />
      </SettingsPage>,
    );
    expect(screen.getByRole("status").textContent).toContain("Teams come with Stigmer Enterprise and Cloud.");
    expect(screen.queryByText("The page's rows")).toBeNull();
    expect(screen.queryByRole("button", { name: "New team" })).toBeNull();
    expect(mounted).toEqual([]);
  });

  it("says an admin can open it, and never mounts the body or offers the act, where the person is denied", () => {
    const mounted: string[] = [];
    render(
      <SettingsPage title="Invitations" actions={<button type="button">New link</button>} denied>
        <Body mounted={mounted} />
      </SettingsPage>,
    );
    expect(screen.getByText("Only an admin can open Invitations")).toBeTruthy();
    expect(screen.getByText("Ask an owner or an admin of this organization.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New link" })).toBeNull();
    expect(mounted).toEqual([]);
  });

  it("says who else can, in the page's own words", () => {
    const mounted: string[] = [];
    render(
      <SettingsPage
        title="Plans"
        denied={{ title: "Platform operator access required", description: "Ask a platform operator." }}
      >
        <Body mounted={mounted} />
      </SettingsPage>,
    );
    expect(screen.getByText("Platform operator access required")).toBeTruthy();
    expect(screen.getByText("Ask a platform operator.")).toBeTruthy();
    expect(mounted).toEqual([]);
  });

  it("treats a false or empty answer as no answer", () => {
    const mounted: string[] = [];
    render(
      <SettingsPage title="Members" unavailable={false} denied={false}>
        <Body mounted={mounted} />
      </SettingsPage>,
    );
    expect(screen.getByText("The page's rows")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(mounted).toEqual(["body"]);
  });
});
