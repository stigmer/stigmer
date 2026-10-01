// Accessibility audit — the licenses console.
//
// Covers the populated renewal calendar (the ARIA table, the stretched row
// buttons, every standing badge), a license's detail with its ticket shown,
// the issue form (radio groups, the features fieldset, labelled inputs), the
// empty calendar and the access notice — each in light and dark against the
// shipped stylesheet, at the settings canvas's width.

import { describe, it, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerError } from "@stigmer/sdk";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { LicenseTerm } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import type { License } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import {
  COLOR_MODES,
  auditA11y,
  renderAudited,
  resetAudit,
} from "../../__tests__/helpers/a11y-audit.js";
import { LicensesConsole } from "../LicensesConsole.js";
import { license } from "./fixtures.js";

const NOW = new Date("2026-09-28T09:00:00Z");
const CANVAS = { width: 720, height: 900 } as const;

const entries: License[] = [
  license({
    id: "lic_trial",
    term: LicenseTerm.trial,
    issuedAt: "2026-09-01T00:00:00Z",
    expiresAt: "2026-10-01T00:00:00Z",
    maxUsers: 5,
    maxOrganizations: 1,
  }),
  license({
    id: "lic_paid",
    issuedAt: "2026-09-25T00:00:00Z",
    expiresAt: "2027-10-01T00:00:00Z",
    graceUntil: "2027-10-31T00:00:00Z",
    maxUsers: 50,
    features: [Feature.sso_enforcement, Feature.platform_client],
    notes: "PO 4411",
    ticket: "eyJhbGciOiJFZERTQSIsImtpZCI6ImxpY2Vuc2Utc2lnbmluZzp2MSJ9.payload.signature",
  }),
  license({
    id: "lic_globex",
    customerId: "cus_globex",
    customerName: "Globex",
    contactEmail: "it@globex.test",
    issuedAt: "2025-09-01T00:00:00Z",
    expiresAt: "2026-09-20T00:00:00Z",
    graceUntil: "2026-10-20T00:00:00Z",
  }),
];

function clientWith(list: () => Promise<{ entries: License[] }>): Stigmer {
  return {
    license: {
      list,
      get: async (id: string) => entries.find((e) => e.metadata?.id === id),
      create: async () => entries[1],
    },
  } as unknown as Stigmer;
}

const populated = () => clientWith(async () => ({ entries }));

afterEach(resetAudit);

describe("Licenses console a11y", () => {
  it.each(COLOR_MODES)("renewal calendar (%s)", async (mode) => {
    const container = renderAudited(<LicensesConsole now={NOW} />, mode, { ...CANVAS, client: populated() });
    await screen.findByRole("table", { name: "Licenses" });
    await auditA11y(container, `licenses calendar · ${mode}`);
  });

  it.each(COLOR_MODES)("license detail with the ticket shown (%s)", async (mode) => {
    const container = renderAudited(<LicensesConsole now={NOW} />, mode, { ...CANVAS, client: populated() });
    const rows = await screen.findAllByRole("button", { name: "Acme Corp" });
    rows[0]!.click();
    const show = await screen.findByRole("button", { name: /Show ticket/ });
    await screen.findByRole("button", { name: /Copy ticket/ });
    show.click();
    await screen.findByText(/payload\.signature/);
    await auditA11y(container, `license detail · ${mode}`);
  });

  it.each(COLOR_MODES)("issue form (%s)", async (mode) => {
    const container = renderAudited(<LicensesConsole now={NOW} />, mode, { ...CANVAS, client: populated() });
    (await screen.findByRole("button", { name: /Issue license/ })).click();
    await screen.findByRole("heading", { name: "Issue license" });
    await auditA11y(container, `issue form · ${mode}`);
  });

  it.each(COLOR_MODES)("empty calendar (%s)", async (mode) => {
    const container = renderAudited(<LicensesConsole now={NOW} />, mode, {
      ...CANVAS,
      client: clientWith(async () => ({ entries: [] })),
    });
    await screen.findByText("No licenses issued yet");
    await auditA11y(container, `licenses empty · ${mode}`);
  });

  it.each(COLOR_MODES)("access notice (%s)", async (mode) => {
    const container = renderAudited(<LicensesConsole now={NOW} />, mode, {
      ...CANVAS,
      client: clientWith(async () => {
        throw new StigmerError("permission-denied", "only platform operators can view licenses", 7);
      }),
    });
    await screen.findByText("Platform operator access required");
    await auditA11y(container, `licenses access notice · ${mode}`);
  });
});
