// The settings scenes: an organization's provider keys, and the model
// picker the composer opens.
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { ProviderKeyQueryController } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/query_pb";
import type { ProviderKey } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { ModelSelector, ProviderKeysSection } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { ORGANIZATION } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";

function inert(): void {}

/**
 * The provider keys of the samples' organization, read by an admin: the
 * person's organizations, the billing permission and the key list answered.
 */
export function providerKeysScene(keys: readonly ProviderKey[]): Drawing {
  return {
    inOrganization: true,
    routes: (router) => {
      router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]) });
      router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: true }) });
      router.service(ProviderKeyQueryController, { list: () => ({ entries: [...keys], nextPageToken: "" }) });
    },
    render: () => <ProviderKeysSection />,
  };
}

/** Provider keys in local mode, where the section says the runner uses the person's own keys. */
export function providerKeysLocalScene(): Drawing {
  return {
    deploymentMode: "local",
    inOrganization: true,
    routes: (router) => {
      router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]) });
    },
    render: () => <ProviderKeysSection />,
  };
}

/** The model picker on the Claude harness with Claude Sonnet 4.6 chosen; the case opens it. */
export function modelSelectorScene(): Drawing {
  return {
    render: () => <ModelSelector value="claude-sonnet-4.6" onValueChange={inert} initialHarness="claude" />,
  };
}
