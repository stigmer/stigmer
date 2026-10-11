/**
 * The share picker tells the organization's people from the accounts an
 * integrator's product created for its own users:
 *
 *   - a product's users are listed in their own group, "Users from your
 *     product" (the Members page's name for them), after People;
 *   - people who sign in through their organization's own identity
 *     provider (federated) stay people;
 *   - `includeAppUsers={false}` (a team's picker) leaves a product's users
 *     out, and a list of people alone stays flat, with no group headings;
 *   - a search matches people and a product's users by name or email, each
 *     in its own group;
 *   - the organization's service accounts are listed in a "Service
 *     accounts" group after a product's users, a chosen one still says it is
 *     a service account, and `includeServiceAccounts={false}` (a team's
 *     picker) leaves them out.
 *
 * The organization's access list and team list are stubbed.
 */
import { create } from "@bufbuild/protobuf";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  ApiResourceRefViewSchema,
  IdentityOriginSchema,
  PrincipalAccessSchema,
  type PrincipalAccess,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { afterEach, describe, expect, it, vi } from "vitest";

const members = vi.hoisted(() => ({ current: [] as PrincipalAccess[] }));

vi.mock("../useResourceAccess.js", () => ({
  useResourceAccess: () => ({
    members: members.current,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock("../../team/useTeamList.js", () => ({
  useTeamList: () => ({ teams: [], isLoading: false, error: null }),
}));

import { PrincipalPicker, type SelectedGrantee } from "../PrincipalPicker";

function person(id: string, name: string, mode: IdentityAccountProvisioningMode): PrincipalAccess {
  return create(PrincipalAccessSchema, {
    principal: create(ApiResourceRefViewSchema, {
      kind: "identity_account",
      id,
      name,
      email: `${id}@example.com`,
      identityOrigin: create(IdentityOriginSchema, { provisioningMode: mode }),
    }),
  });
}

const ORG_PEOPLE = [
  person("ida_ana", "Ana Direct", IdentityAccountProvisioningMode.direct),
  person("ida_fay", "Fay Federated", IdentityAccountProvisioningMode.federated),
];
const PRODUCT_USER = person("ida_pat", "Pat Product", IdentityAccountProvisioningMode.platform_client);
const SERVICE_ACCOUNT = person("ida_sa_ci", "ci-deploy", IdentityAccountProvisioningMode.service_account);

function openPicker(
  includeAppUsers?: boolean,
  includeServiceAccounts?: boolean,
  onChange: (value: SelectedGrantee | null) => void = () => {},
) {
  render(
    <PrincipalPicker
      org="acme"
      value={null}
      onChange={onChange}
      {...(includeAppUsers === undefined ? {} : { includeAppUsers })}
      {...(includeServiceAccounts === undefined ? {} : { includeServiceAccounts })}
    />,
  );
  fireEvent.focus(screen.getByRole("combobox"));
  return screen.getByRole("listbox");
}

afterEach(() => {
  cleanup();
  members.current = [];
});

describe("PrincipalPicker — a product's users", () => {
  it("lists a product's users in their own group after People, and keeps federated people as people", () => {
    members.current = [...ORG_PEOPLE, PRODUCT_USER];
    const listbox = openPicker();

    const people = within(listbox).getByRole("group", { name: "People" });
    expect(within(people).getByText("Ana Direct")).toBeTruthy();
    expect(within(people).getByText("Fay Federated")).toBeTruthy();
    expect(within(people).queryByText("Pat Product")).toBeNull();

    const product = within(listbox).getByRole("group", { name: "Users from your product" });
    expect(within(product).getByText("Pat Product")).toBeTruthy();

    const options = within(listbox).getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.findIndex((t) => t.includes("Pat Product"))).toBe(options.length - 1);
  });

  it("leaves a product's users out when asked, and keeps a people-only list flat", () => {
    members.current = [...ORG_PEOPLE, PRODUCT_USER];
    const listbox = openPicker(false);

    expect(within(listbox).queryByText("Pat Product")).toBeNull();
    expect(within(listbox).getByText("Fay Federated")).toBeTruthy();
    expect(within(listbox).queryByRole("group")).toBeNull();
  });

  it("searches people and a product's users by name or email, each in its own group", () => {
    members.current = [...ORG_PEOPLE, PRODUCT_USER];
    const listbox = openPicker();
    const search = screen.getByRole("combobox");

    fireEvent.change(search, { target: { value: "ida_pat@" } });
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent ?? "")).toEqual([
      expect.stringContaining("Pat Product"),
    ]);

    fireEvent.change(search, { target: { value: "fay" } });
    const options = within(listbox).getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options).toEqual([expect.stringContaining("Fay Federated")]);
  });
});

describe("PrincipalPicker — service accounts", () => {
  it("lists service accounts in their own group, last, never among People", () => {
    members.current = [...ORG_PEOPLE, PRODUCT_USER, SERVICE_ACCOUNT];
    const listbox = openPicker();

    const people = within(listbox).getByRole("group", { name: "People" });
    expect(within(people).queryByText("ci-deploy")).toBeNull();
    const group = within(listbox).getByRole("group", { name: "Service accounts" });
    expect(within(group).getByText("ci-deploy")).toBeTruthy();

    const options = within(listbox).getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.findIndex((t) => t.includes("Pat Product"))).toBe(options.length - 2);
    expect(options.findIndex((t) => t.includes("ci-deploy"))).toBe(options.length - 1);
  });

  it("groups even when service accounts are the only candidates beside people", () => {
    members.current = [...ORG_PEOPLE, SERVICE_ACCOUNT];
    const listbox = openPicker();
    expect(within(listbox).getByRole("group", { name: "People" })).toBeTruthy();
    expect(within(listbox).getByRole("group", { name: "Service accounts" })).toBeTruthy();
  });

  it("leaves service accounts out when asked, as a team's picker does", () => {
    members.current = [...ORG_PEOPLE, SERVICE_ACCOUNT];
    const listbox = openPicker(false, false);
    expect(within(listbox).queryByText("ci-deploy")).toBeNull();
    expect(within(listbox).queryByRole("group")).toBeNull();
  });

  it("grants a chosen service account as its identity account, and still labels it once chosen", () => {
    members.current = [...ORG_PEOPLE, SERVICE_ACCOUNT];
    const chosen: (SelectedGrantee | null)[] = [];
    const listbox = openPicker(undefined, undefined, (value) => chosen.push(value));
    const option = within(within(listbox).getByRole("group", { name: "Service accounts" })).getByRole("option");
    fireEvent.mouseDown(option);
    expect(chosen.map((value) => value?.grantee)).toEqual([{ kind: "identity_account", id: "ida_sa_ci" }]);

    cleanup();
    const value = chosen[0] ?? null;
    render(<PrincipalPicker org="acme" value={value} onChange={() => {}} />);
    expect(screen.getByText("Service account")).toBeTruthy();
  });
});
