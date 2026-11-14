// ---------------------------------------------------------------------------
// The journey's Bring others in route — renders the React SDK's page
//
// The route's whole job is to hand the journey's last step to BringOthersIn
// with the console's Members address and its link renderer, so invite links
// take this console's own `/invite/<token>`; a route that drifted to another
// part, or lost the Members address, would show here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react-sdk", () => ({
  BringOthersIn: (props: { membersHref: string; buildInviteUrl?: unknown }) => (
    <p>
      bring others in, members at {props.membersHref}, {props.buildInviteUrl === undefined ? "own invite address" : "another"}
    </p>
  ),
}));

import BringOthersInPage from "../page";
import { MEMBERS_HREF } from "@/domain/journey/journey-links";

describe("Bring others in route", () => {
  it("renders the journey's last page with the Members address and this console's invite address", () => {
    render(<BringOthersInPage />);
    expect(screen.getByText(`bring others in, members at ${MEMBERS_HREF}, own invite address`)).toBeTruthy();
  });
});
