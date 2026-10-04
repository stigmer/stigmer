/**
 * Pins the scope the API Keys section shows for each key: a key that names
 * no organization works in all of its owner's organizations; a key limited
 * to one is named by that organization's slug when the user's organization
 * list holds it, and by a plain label when it does not, so a stored id is
 * never shown. The organization context is stubbed; the list runs through
 * the real hook over a stubbed `apiKey.findAll`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ApiKeySchema, type ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "../../context";

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ID = "org_01jbbbbbbbbbbbbbbbbbbbbbbb";

const ACME = create(OrganizationSchema, {
  metadata: { id: ACME_ID, slug: "acme", name: "Acme" },
});

vi.mock("../../organization/OrgProvider.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../organization/OrgProvider.js")>();
  return {
    ...actual,
    useActiveOrgId: () => ACME_ID,
    useOptionalOrg: () => ({ orgs: [ACME] }),
  };
});

import { ApiKeysSection } from "../ApiKeysSection";

function key(id: string, name: string, org: string): ApiKey {
  return create(ApiKeySchema, {
    metadata: { id, name },
    spec: { fingerprint: id.slice(-6), boundOrg: org },
  });
}

function renderSection(keys: ApiKey[]) {
  const client = {
    apiKey: { findAll: vi.fn(async () => ({ entries: keys })) },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <ApiKeysSection />
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("ApiKeysSection key scope", () => {
  it("shows every key's scope by slug, never by organization id", async () => {
    renderSection([
      key("key-all-111111", "everywhere", ""),
      key("key-acme-222222", "acme-only", ACME_ID),
      key("key-other-333333", "elsewhere", OTHER_ID),
    ]);

    expect(await screen.findByText("All your organizations")).toBeTruthy();
    expect(screen.getByText("Only in acme")).toBeTruthy();
    expect(screen.getByText("Limited to one organization")).toBeTruthy();
    expect(screen.queryByText(new RegExp(ACME_ID))).toBeNull();
    expect(screen.queryByText(new RegExp(OTHER_ID))).toBeNull();
  });
});
