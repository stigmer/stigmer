/**
 * ProviderBadge names the identity source an account signs in through (the
 * federation issuer's display name, or "Stigmer" for a direct sign-up), so
 * two accounts that share an email can be told apart; an account with no
 * known source shows no badge at all.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  ApiResourceRefViewSchema,
  IdentityOriginSchema,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { ProviderBadge } from "../ProviderBadge";

afterEach(cleanup);

describe("ProviderBadge", () => {
  it("names the account's identity provider", () => {
    const principal = create(ApiResourceRefViewSchema, {
      kind: "identity_account",
      id: "ida_fay",
      name: "Fay Federated",
      identityOrigin: create(IdentityOriginSchema, { providerDisplayName: "Acme Okta" }),
    });
    render(<ProviderBadge principal={principal} />);

    expect(screen.getByText("Acme Okta")).toBeTruthy();
  });

  it("shows nothing for an account with no known identity source", () => {
    const principal = create(ApiResourceRefViewSchema, { kind: "identity_account", id: "ida_old", name: "Old" });
    const { container } = render(<ProviderBadge principal={principal} />);

    expect(container.textContent).toBe("");
  });
});
