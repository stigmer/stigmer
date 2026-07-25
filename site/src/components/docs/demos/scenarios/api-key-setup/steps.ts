/**
 * API key setup scenario for the Quickstart "Sign up and get your API key" step.
 *
 * Defines an 8-step playback that walks the reader through the Stigmer
 * web app: new-session page -> click user profile -> open menu ->
 * click Settings -> view API keys -> create a new key -> copy the key.
 *
 * Each step is a discriminated union (`ApiKeySetupStep`) so the render
 * prop in the scenario component can switch on `step.view` and render
 * the appropriate sub-component.
 */

import { create } from "@bufbuild/protobuf";
import {
  EnvironmentSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import {
  EnvironmentSpecSchema,
  EnvironmentValueSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiKeysSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type ApiKeySetupStep =
  | { view: "new-session" }
  | { view: "user-profile-click" }
  | { view: "user-menu-open" }
  | { view: "settings-click" }
  | { view: "settings-api-keys" }
  | { view: "create-key-click" }
  | { view: "create-form" }
  | { view: "key-created" };

// ---------------------------------------------------------------------------
// Fixture data — API keys matching the console screenshots
// ---------------------------------------------------------------------------

let _apiKeyList: ReturnType<typeof create<typeof ApiKeysSchema>> | undefined;

export function getApiKeyList() {
  if (!_apiKeyList) {
    _apiKeyList = create(ApiKeysSchema, {
      entries: [
        samples.apiKey({
          id: "apk-00000000-0000-0000-0000-000000000001",
          name: "ci-pipeline",
          fingerprint: "Kd9m2R",
        }),
        samples.apiKey({
          id: "apk-00000000-0000-0000-0000-000000000002",
          name: "local-dev",
          fingerprint: "Yw3pLx",
        }),
      ],
    });
  }
  return _apiKeyList;
}

export const CREATED_KEY_NAME = "quickstart-key";
export const CREATED_RAW_KEY = "sk_live_dEm0k3y_a1b2c3d4e5f6g7h8";

// ---------------------------------------------------------------------------
// Fixture data — personal environment
// ---------------------------------------------------------------------------

export const PERSONAL_ENV_ID = "env-00000000-0000-0000-0000-000000000099";

export const PERSONAL_ENVIRONMENT = create(EnvironmentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Environment",
  metadata: create(ApiResourceMetadataSchema, {
    id: PERSONAL_ENV_ID,
    name: "Personal Environment",
    slug: "env-personal",
    org: "demo-org",
    labels: { "stigmer.ai/personal": "true" },
  }),
  spec: create(EnvironmentSpecSchema, {
    description: "Your private secrets and configuration.",
    data: {
      GITHUB_TOKEN: create(EnvironmentValueSchema, {
        value: "",
        isSecret: true,
      }),
      OPENAI_API_KEY: create(EnvironmentValueSchema, {
        value: "",
        isSecret: true,
      }),
      SLACK_WEBHOOK_URL: create(EnvironmentValueSchema, {
        value: "",
        isSecret: true,
      }),
    },
  }),
});

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const apiKeySetupSteps: ScenarioStep<ApiKeySetupStep>[] = [
  {
    delayMs: 0,
    data: { view: "new-session" },
    narration: "Before you can call your agent from code, you need an API key. Let's grab one from the console.",
  },
  { delayMs: 2000, data: { view: "user-profile-click" } },
  { delayMs: 1500, data: { view: "user-menu-open" } },
  { delayMs: 1500, data: { view: "settings-click" } },
  {
    delayMs: 1500,
    data: { view: "settings-api-keys" },
    narration: "These are your API keys. You'll create one for the quickstart.",
    interactions: [
      { atPercent: 0.3, type: "hover", target: "create-api-key" },
    ],
  },
  { delayMs: 2500, data: { view: "create-key-click" } },
  {
    delayMs: 2500,
    data: { view: "create-form" },
    interactions: [
      { atPercent: 0.15, type: "type", target: "apikey-name-input", text: CREATED_KEY_NAME },
    ],
  },
  {
    delayMs: 2500,
    data: { view: "key-created" },
    narration: "Your key is ready. Copy it now — you won't see the full key again after this.",
  },
];

