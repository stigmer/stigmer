/**
 * Pins the scope the API Keys section shows for each key: a key that names
 * no organization works in all of its owner's organizations; a key limited
 * to one is named by that organization's slug when the user's organizations
 * (or the one they have open) hold it, and by a plain label when not, so a stored id is
 * never shown. The organization context is a real OrgProvider over a
 * stubbed `listMine` (and `get`, for an organization the person has open
 * outside their list, which names its keys by slug too); the list runs
 * through the real hook over a stubbed `apiKey.list`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import {
  ApiKeySchema,
  type ApiKey,
} from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "../../context";
import { OrgProvider } from "../../organization/OrgProvider";

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ID = "org_01jbbbbbbbbbbbbbbbbbbbbbbb";

const ACME = create(OrganizationSchema, {
  metadata: { id: ACME_ID, slug: "acme", name: "Acme" },
});

const CHILD_ID = "org_01jccccccccccccccccccccccc";

const CHILD = create(OrganizationSchema, {
  metadata: { id: CHILD_ID, slug: "acme-customer", name: "Customer" },
  spec: { parentOrg: ACME_ID },
});

import { ApiKeysSection } from "../ApiKeysSection";

function key(id: string, name: string, org: string): ApiKey {
  return create(ApiKeySchema, {
    metadata: { id, name },
    spec: { fingerprint: id.slice(-6), boundOrg: org },
  });
}

function renderSection(keys: ApiKey[], opened?: Organization) {
  const client = {
    apiKey: { list: vi.fn(async () => ({ entries: keys, nextPageToken: "" })) },
    organization: {
      listMine: vi.fn(async () => ({ entries: [ACME], nextPageToken: "" })),
      get: vi.fn(async () => opened ?? ACME),
    },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <OrgProvider>
        <ApiKeysSection />
      </OrgProvider>
    </StigmerContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

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

  it("names a key limited to the organization the person has open outside their list by its slug", async () => {
    localStorage.setItem("stigmer:activeOrg", CHILD_ID);
    renderSection([key("key-child-444444", "customer-only", CHILD_ID)], CHILD);

    expect(await screen.findByText("Only in acme-customer")).toBeTruthy();
    expect(screen.queryByText("Limited to one organization")).toBeNull();
  });
});
