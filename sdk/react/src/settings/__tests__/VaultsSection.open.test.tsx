/**
 * The Vaults page opens a shared vault in place: pressing its row hands the
 * page the vault, the page names it with a way back to the vaults, and My
 * vault and the list give way to the open vault until the way back is
 * pressed. The list panel, My vault and the access button are stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { VaultSchema, type Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";

const PRODUCTION = create(VaultSchema, {
  metadata: { id: "vlt_prod", name: "Production", org: "org_acme" },
  spec: { description: "The keys the production agents run with" },
});

vi.mock("../../organization/OrgProvider.js", () => ({ useActiveOrgId: () => "org_acme" }));
vi.mock("../../organization/useOrgDisplayName.js", () => ({ useOrgDisplayName: () => "acme" }));
vi.mock("../../grant/useCheckPermission.js", () => ({
  useCheckPermission: () => ({ allowed: true, isLoading: false, error: null, refetch: () => {} }),
}));
vi.mock("../../vault/useMyVault.js", () => ({
  useMyVault: () => ({ vault: null, isLoading: true, error: null, refetch: () => {} }),
}));
vi.mock("../../vault/useVaultSignIn.js", () => ({
  useVaultSignIn: () => ({ signIn: async () => {}, isInProgress: false, error: null }),
}));
vi.mock("../../access/ManageAccessButton.js", () => ({
  ManageAccessButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock("../../vault/VaultListPanel.js", () => ({
  VaultListPanel: ({ onOpen, openId }: { onOpen?: (vault: Vault) => void; openId?: string | null }) =>
    openId ? (
      <p>Production's sections</p>
    ) : (
      <button type="button" onClick={() => onOpen?.(PRODUCTION)}>
        Production
      </button>
    ),
}));

import { VaultsSection } from "../VaultsSection";

afterEach(cleanup);

describe("VaultsSection, a vault opened in place", () => {
  it("names the open vault on the page, with Who can use and the way back to the vaults", () => {
    render(<VaultsSection />);
    expect(screen.getByRole("heading", { name: "Vaults" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Production" }));

    expect(screen.getByRole("heading", { name: "Production" })).toBeTruthy();
    expect(screen.getByText("The keys the production agents run with")).toBeTruthy();
    expect(screen.getByText("Production's sections")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Who can use" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "My vault" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Vaults" }));
    expect(screen.getByRole("heading", { name: "Vaults" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My vault" })).toBeTruthy();
  });
});
