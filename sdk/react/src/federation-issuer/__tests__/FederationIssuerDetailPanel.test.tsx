import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clone, create } from "@bufbuild/protobuf";
import {
  FederationIssuerSchema,
  type FederationIssuer,
} from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import type { CheckMyPermissionInput } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { StigmerContext } from "../../context";
import { FederationIssuerDetailPanel } from "../FederationIssuerDetailPanel";

/**
 * Pins three things about the detail panel:
 *
 *   - the save names the fields the form edits, each by its path, on the
 *     issuer's id: a spec field the form does not list is not named, so
 *     it keeps its stored value;
 *   - the Edit button is offered only to a caller the server says holds
 *     `can_edit` on the issuer, so a member who may view an issuer is
 *     never handed a form the server would refuse;
 *   - an issuer's sign-in settings are edited as the admin sets them: an
 *     issuer with none reads "None", and the save carries the account
 *     creation and role the admin turns on.
 */

const IDP: FederationIssuer = create(FederationIssuerSchema, {
  metadata: {
    id: "issuer-1",
    name: "Acme Okta",
    slug: "acme-okta",
    org: "acme",
  },
  spec: {
    displayName: "Acme Okta",
    jwksUri: "https://acme.okta.example/jwks",
    allowedIssuers: ["https://acme.okta.example"],
    expectedAudience: "stigmer",
    createAccountsOnSignIn: true,
    signInRole: IamRole.admin,
    externalIdClaim: "org_slug",
  },
});

function renderPanel(
  update: ReturnType<typeof vi.fn>,
  checkMyPermission: ReturnType<typeof vi.fn> = vi.fn(async () => ({
    isAuthorized: true,
  })),
) {
  const client = {
    federationIssuer: { update },
    iamPolicy: { checkMyPermission },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <FederationIssuerDetailPanel federationIssuer={IDP} />
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("FederationIssuerDetailPanel save payload", () => {
  it("names the fields the form edits on a display-name edit, on the issuer's id", async () => {
    const update = vi.fn(async (_resource: FederationIssuer, _paths: string[]) => IDP);
    renderPanel(update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const displayName = await screen.findByLabelText("Display name");
    fireEvent.change(displayName, { target: { value: "Acme Okta (renamed)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<FederationIssuer>(update);
    const spec = sent.resource.spec;

    // The edited field.
    expect(spec?.displayName).toBe("Acme Okta (renamed)");
    // The form's other fields travel with it from the edit state.
    expect(spec?.jwksUri).toBe("https://acme.okta.example/jwks");
    expect(spec?.allowedIssuers).toEqual(["https://acme.okta.example"]);
    expect(spec?.expectedAudience).toBe("stigmer");
    expect(spec?.createAccountsOnSignIn).toBe(true);
    expect(spec?.signInRole).toBe(IamRole.admin);
    expect(spec?.externalIdClaim).toBe("org_slug");
    // Each by its path; a spec field the form does not list is not named,
    // so it keeps its stored value.
    expect(sent.paths).toEqual([
      "spec.display_name",
      "spec.jwks_uri",
      "spec.allowed_issuers",
      "spec.expected_audience",
      "spec.userinfo_endpoint",
      "spec.create_accounts_on_sign_in",
      "spec.sign_in_role",
      "spec.external_id_claim",
    ]);
    // An update names its issuer by id.
    expect(sent.id).toBe(IDP.metadata?.id);
  });
});

describe("FederationIssuerDetailPanel edit gate", () => {
  it("offers Edit only with can_edit on the issuer", async () => {
    const checkMyPermission = vi.fn(async (_input: CheckMyPermissionInput) => ({
      isAuthorized: false,
    }));
    renderPanel(vi.fn(), checkMyPermission);

    // can_edit gates Edit; can_delete gates the slug field (rename).
    await waitFor(() =>
      expect(new Set(checkMyPermission.mock.calls.map(([input]) => input.relation))).toEqual(
        new Set(["can_edit", "can_delete"]),
      ),
    );
    for (const [asked] of checkMyPermission.mock.calls) {
      expect(asked.resource?.kind).toBe("federation_issuer");
      expect(asked.resource?.id).toBe("issuer-1");
    }
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    // The configuration stays readable; only the edit affordance is withheld.
    expect(screen.getByRole("heading", { name: "Acme Okta" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("FederationIssuerDetailPanel sign-in settings", () => {
  const PLAIN: FederationIssuer = create(FederationIssuerSchema, {
    metadata: { id: "issuer-2", name: "Acme Auth", slug: "acme-auth", org: "acme" },
    spec: {
      displayName: "Acme Auth",
      jwksUri: "https://auth.acme.example/jwks",
      allowedIssuers: ["https://auth.acme.example"],
      expectedAudience: "stigmer",
    },
  });

  function renderPlain(update: ReturnType<typeof vi.fn>) {
    const client = {
      federationIssuer: { update },
      iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
    } as never;
    return render(
      <StigmerContext.Provider value={client}>
        <FederationIssuerDetailPanel federationIssuer={PLAIN} />
      </StigmerContext.Provider>,
    );
  }

  it("saves the account creation and role the admin turns on", async () => {
    const update = vi.fn(async (_resource: FederationIssuer, _paths: string[]) => PLAIN);
    renderPlain(update);

    expect(screen.getByText("None")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const createAccounts = screen.getByRole("switch", {
      name: "Create accounts on sign-in",
    });
    const role = screen.getByLabelText("Sign-in role") as HTMLSelectElement;
    expect(createAccounts.getAttribute("aria-checked")).toBe("false");
    expect(role.value).toBe(String(IamRole.iam_role_unspecified));

    fireEvent.click(createAccounts);
    fireEvent.change(role, { target: { value: String(IamRole.viewer) } });
    expect(createAccounts.getAttribute("aria-checked")).toBe("true");

    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const spec = sentUpdate<FederationIssuer>(update).resource.spec;
    expect(spec?.createAccountsOnSignIn).toBe(true);
    expect(spec?.signInRole).toBe(IamRole.viewer);
    expect(spec?.externalIdClaim).toBe("");
  });
});

describe("FederationIssuerDetailPanel rename", () => {
  it("renames through the kind's rename for whoever may delete it, and hands the renamed resource to onUpdated", async () => {
    const renamed = clone(FederationIssuerSchema, IDP);
    if (renamed.metadata !== undefined) {
      renamed.metadata.slug = "renamed-slug";
    }
    const rename = vi.fn(async () => renamed);
    const onUpdated = vi.fn();
    const client = {
      federationIssuer: { rename },
      iamPolicy: { checkMyPermission: async () => ({ isAuthorized: true }) },
    } as never;
    render(
      <StigmerContext.Provider value={client}>
        <FederationIssuerDetailPanel federationIssuer={IDP} onUpdated={onUpdated} />
      </StigmerContext.Provider>,
    );

    fireEvent.change(await screen.findByLabelText("Slug", undefined, { timeout: 5000 }), {
      target: { value: "renamed-slug" },
    });
    const button = screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement;
    // The field settles before it takes the rename, however slow the runner.
    await waitFor(() => expect(button.disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(button);

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(renamed), { timeout: 5000 });
    expect(rename.mock.calls[0]).toEqual([expect.objectContaining({ resourceId: IDP.metadata?.id, slug: "renamed-slug" })]);
  });
});
