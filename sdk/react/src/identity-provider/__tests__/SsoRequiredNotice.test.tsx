/**
 * Pins SsoRequiredNotice: it renders nothing for any refusal but
 * SSO_REQUIRED; for that one it shows the organization's sentence, signs
 * in through the organization's provider for that organization, and offers
 * the move where the host routes one.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { SsoProviderInfoSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";

const state = vi.hoisted(() => ({ looked: [] as Array<string | null> }));

vi.mock("../useSsoProvider.js", async () => {
  const { create: make } = await import("@bufbuild/protobuf");
  const { SsoProviderInfoSchema: schema } = await import("@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb");
  return {
    useSsoProvider: (org: string | null) => {
      state.looked.push(org);
      return { ssoProvider: org === null ? null : make(schema, { displayName: "Acme Okta" }), isLoading: false, error: null };
    },
  };
});

import { SsoRequiredNotice } from "../SsoRequiredNotice";

const refusal = new ConnectError("This organization requires you to sign in through Acme Okta.", Code.PermissionDenied, undefined, [
  {
    desc: ErrorInfoSchema,
    value: create(ErrorInfoSchema, { reason: "SSO_REQUIRED", domain: "stigmer.ai", metadata: { org: "org_acme", provider: "acme-okta" } }),
  },
]);

afterEach(() => {
  cleanup();
  state.looked = [];
});

describe("SsoRequiredNotice", () => {
  it("renders nothing for any other refusal", () => {
    const { container } = render(
      <SsoRequiredNotice error={new ConnectError("denied", Code.PermissionDenied)} onSignIn={() => {}} />,
    );
    expect(container.textContent).toBe("");
    expect(state.looked).toEqual([null]);
  });

  it("signs in through the organization's provider for that organization, and offers the move", () => {
    const onSignIn = vi.fn();
    render(<SsoRequiredNotice error={refusal} onSignIn={onSignIn} moveHref={(org) => `/sso/move?org=${org}`} />);
    expect(screen.getByText("This organization requires you to sign in through Acme Okta.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Acme Okta" }));
    expect(onSignIn).toHaveBeenCalledWith(create(SsoProviderInfoSchema, { displayName: "Acme Okta" }), "org_acme");
    expect(screen.getByRole("link", { name: "Bring my access with me" }).getAttribute("href")).toBe("/sso/move?org=org_acme");
    expect(state.looked).toContain("org_acme");
  });
});
