// Accessibility audit — Models & providers.
//
// Covers the hub in each face a person meets: an admin with nothing
// connected (the key forms), an admin with keys (own and the parent's, the
// replace and remove controls), a member (the lines naming who connects),
// and a laptop (the setup commands with their Copy buttons) — each in light
// and dark against the shipped stylesheet, at the page's width.

import { afterEach, describe, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderAvailability } from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import { ProviderKeyCheck } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import type { Stigmer } from "@stigmer/client";
import { COLOR_MODES, auditA11y, renderAudited, resetAudit } from "../../__tests__/helpers/a11y-audit.js";
import { ModelsHub } from "../hub/ModelsHub.js";
import {
  LAPTOP_WITHOUT_KEYS,
  ORG_ID,
  PARENT_ID,
  fakeClient,
  readiness,
  readinessWrapper,
  server,
  storedKey,
  type FakeServer,
} from "./readiness-fixture.js";

const CANVAS = { width: 896, height: 1200 } as const;

function audited(fake: FakeServer, mode: (typeof COLOR_MODES)[number], deployment: "cloud" | "local" = "cloud") {
  const { client } = fakeClient(fake);
  const Wrapper = readinessWrapper(client, deployment);
  return renderAudited(
    <Wrapper>
      <ModelsHub org={ORG_ID} />
    </Wrapper>,
    mode,
    { ...CANVAS, client: client as unknown as Stigmer },
  );
}

afterEach(resetAudit);

describe("Models & providers a11y", () => {
  it.each(COLOR_MODES)("an admin with nothing connected, a key form open (%s)", async (mode) => {
    const container = audited(server(), mode);
    const [connect] = await screen.findAllByRole("button", { name: "Connect Anthropic" });
    await userEvent.click(connect!);
    await screen.findByLabelText("Anthropic API key");
    await auditA11y(container, `models hub none · ${mode}`);
  });

  it.each(COLOR_MODES)("an admin with an own key and the parent's (%s)", async (mode) => {
    const container = audited(
      server({
        readiness: readiness({
          anthropic: ProviderAvailability.served_by_organization,
          openai: { availability: ProviderAvailability.served_by_parent_organization, parentOrg: PARENT_ID },
        }),
        keys: [
          storedKey("anthropic", { check: ProviderKeyCheck.checked, lastUsedDaysAgo: 0 }),
          storedKey("openai", { keyHint: "m2Lk", inheritedFromOrg: PARENT_ID, check: ProviderKeyCheck.unchecked }),
        ],
      }),
      mode,
    );
    await screen.findByRole("button", { name: "Replace key" });
    await auditA11y(container, `models hub connected · ${mode}`);
  });

  it.each(COLOR_MODES)("a member (%s)", async (mode) => {
    const container = audited(server({ canManage: false }), mode);
    await screen.findByText(/An admin of Acme Research connects Anthropic/);
    await auditA11y(container, `models hub member · ${mode}`);
  });

  it.each(COLOR_MODES)("a laptop without keys (%s)", async (mode) => {
    const container = audited(server({ readiness: LAPTOP_WITHOUT_KEYS }), mode, "local");
    await screen.findAllByRole("button", { name: "Copy" });
    await auditA11y(container, `models hub local · ${mode}`);
  });
});
