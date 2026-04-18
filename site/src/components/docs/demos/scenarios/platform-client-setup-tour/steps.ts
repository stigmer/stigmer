/**
 * Platform client setup tour — 8-step walkthrough of creating a
 * PlatformClient in the Stigmer Console and obtaining credentials.
 *
 * Mirrors the api-key-setup pattern: navigates from the session view
 * through the user menu into Settings > Platform Clients, creates a
 * new client, and reveals the one-time secret.
 */

import { create } from "@bufbuild/protobuf";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSpecSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/spec_pb";
import { PlatformClientsSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type PlatformClientSetupStep =
  | { view: "new-session" }
  | { view: "user-profile-click" }
  | { view: "user-menu-open" }
  | { view: "settings-click" }
  | { view: "settings-platform-clients" }
  | { view: "create-client-click" }
  | { view: "create-form" }
  | { view: "secret-revealed" };

// ---------------------------------------------------------------------------
// Fixture data — existing platform clients
// ---------------------------------------------------------------------------

let _platformClientList:
  | ReturnType<typeof create<typeof PlatformClientsSchema>>
  | undefined;

export function getPlatformClientList() {
  if (!_platformClientList) {
    _platformClientList = create(PlatformClientsSchema, {
      entries: [
        create(PlatformClientSchema, {
          apiVersion: "iam.stigmer.ai/v1",
          kind: "PlatformClient",
          metadata: create(ApiResourceMetadataSchema, {
            id: "pcl-00000000-0000-0000-0000-000000000001",
            name: "Mobile App",
            slug: "mobile-app",
            org: "demo-org",
          }),
          spec: create(PlatformClientSpecSchema, {
            clientId: "stgm_cid_mbl4pp7x9k2r",
            secretFingerprint: "x9k2r5",
            neverExpires: true,
            autoProvisionAccounts: true,
            autoGrantOnOrg: true,
          }),
        }),
      ],
    });
  }
  return _platformClientList;
}

export const CREATED_CLIENT_NAME = "acme-dashboard";
export const CREATED_CLIENT_ID = "stgm_cid_d3m0kEy_a1b2c3d4";
export const CREATED_CLIENT_SECRET =
  "stgm_cs_dEm0sEcR3t_e5f6g7h8i9j0k1l2";

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const platformClientSetupSteps: ScenarioStep<PlatformClientSetupStep>[] =
  [
    {
      delayMs: 0,
      data: { view: "new-session" },
      caption: "Start here",
      narration:
        "To embed Stigmer in your product, you need a PlatformClient. Let's create one in the Console.",
    },
    {
      delayMs: 2000,
      data: { view: "user-profile-click" },
      caption: "Click your profile",
    },
    {
      delayMs: 1500,
      data: { view: "user-menu-open" },
      caption: "Open the menu",
    },
    {
      delayMs: 1500,
      data: { view: "settings-click" },
      caption: "Go to Settings",
    },
    {
      delayMs: 1500,
      data: { view: "settings-platform-clients" },
      caption: "Your platform clients",
      narration:
        "Platform clients let your backend mint user tokens. You'll create one for your dashboard.",
      interactions: [
        { atPercent: 0.3, type: "hover", target: "create-platform-client" },
      ],
    },
    {
      delayMs: 2500,
      data: { view: "create-client-click" },
      caption: "Create a new client",
    },
    {
      delayMs: 2500,
      data: { view: "create-form" },
      caption: "Name your client",
      interactions: [
        {
          atPercent: 0.15,
          type: "type",
          target: "pc-name-input",
          text: CREATED_CLIENT_NAME,
        },
      ],
    },
    {
      delayMs: 2500,
      data: { view: "secret-revealed" },
      caption: "Copy your credentials",
      narration:
        "Your client ID and secret are ready. Store the secret securely — you won't see it again.",
    },
  ];
