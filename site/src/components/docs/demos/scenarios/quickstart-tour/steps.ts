/**
 * Quickstart overview tour — multi-surface preview of the entire
 * quickstart journey placed at the top of the page inside
 * "What you'll build."
 *
 * Five steps: API key → code → generic response → change message →
 * unsatisfying domain response. Shows the reader what they are about
 * to build before they start coding.
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
import type { ScenarioStep, TerminalLine } from "@scenar/react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type QuickstartTourStep =
  | { view: "api-key-created" }
  | { view: "code-connect" }
  | { view: "terminal-generic" }
  | { view: "code-domain-question" }
  | { view: "terminal-domain-fail" };

// ---------------------------------------------------------------------------
// Fixture data — API keys (real SDK components need this)
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

export const PERSONAL_ENVIRONMENT = create(EnvironmentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Environment",
  metadata: create(ApiResourceMetadataSchema, {
    id: "env-00000000-0000-0000-0000-000000000099",
    name: "Personal Environment",
    slug: "env-personal",
    org: "demo-org",
    labels: { "stigmer.ai/personal": "true" },
  }),
  spec: create(EnvironmentSpecSchema, {
    description: "Your private secrets and configuration.",
    data: {
      STIGMER_API_KEY: create(EnvironmentValueSchema, {
        value: "",
        isSecret: true,
      }),
    },
  }),
});

// ---------------------------------------------------------------------------
// Fixture data — code snippets
// ---------------------------------------------------------------------------

export const CONNECT_CODE = [
  '// ask-agent.ts — Connect and send a message',
  'import { Stigmer } from "@stigmer/sdk";',
  "",
  "const stigmer = new Stigmer({",
  "  apiKey: process.env.STIGMER_API_KEY!,",
  "});",
  "",
  "const session = await stigmer.session.create({",
  '  name: `session-${Date.now()}`,',
  '  org: "my-org",',
  "});",
  "",
  "const execution = await stigmer.agentExecution.create({",
  '  org: "my-org",',
  "  sessionId: session.metadata!.id,",
  '  message: "Best practices for handling customer complaints?",',
  "});",
];

export const DOMAIN_CODE = [
  '// ask-agent.ts — Try a domain-specific question',
  'import { Stigmer } from "@stigmer/sdk";',
  "",
  "const stigmer = new Stigmer({",
  "  apiKey: process.env.STIGMER_API_KEY!,",
  "});",
  "",
  "const session = await stigmer.session.create({",
  '  name: `session-${Date.now()}`,',
  '  org: "my-org",',
  "});",
  "",
  "const execution = await stigmer.agentExecution.create({",
  '  org: "my-org",',
  "  sessionId: session.metadata!.id,",
  '  message: "What is your return policy for defective items?",',
  "});",
];

// ---------------------------------------------------------------------------
// Fixture data — terminal output
// ---------------------------------------------------------------------------

export const GENERIC_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "npx tsx ask-agent.ts" },
  { type: "blank", text: "" },
  { type: "output", text: "Here are some best practices for handling" },
  { type: "output", text: "customer complaints:" },
  { type: "blank", text: "" },
  { type: "output", text: "1. Listen actively — let the customer explain" },
  { type: "output", text: "   their issue fully before responding." },
  { type: "output", text: "2. Respond promptly — acknowledge complaints" },
  { type: "output", text: "   within hours, not days." },
  { type: "output", text: "3. Apologize sincerely — show empathy even if" },
  { type: "output", text: '   the issue wasn\'t your fault.' },
];

export const DOMAIN_FAIL_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "npx tsx ask-agent.ts" },
  { type: "blank", text: "" },
  { type: "output", text: "I don't have specific information about your" },
  { type: "output", text: "company's return policy for defective items." },
  { type: "output", text: "Generally, many companies accept returns for" },
  { type: "output", text: "defective products within a certain timeframe." },
  { type: "blank", text: "" },
  { type: "output", text: "I'd recommend checking your company's return" },
  { type: "output", text: "policy documentation for accurate details." },
];

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const quickstartTourSteps: ScenarioStep<QuickstartTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "api-key-created" },
    narration:
      "You start by creating an API key in the Stigmer console. Copy it — you'll use it in your code.",
    interactions: [
      { atPercent: 0.5, type: "set_cursor", target: "copy-key" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "code-connect" },
    narration:
      "A few lines of code is all you need. Import the SDK, connect with your key, and send a message.",
    interactions: [
      { atPercent: 0.0, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3500,
    data: { view: "terminal-generic" },
    narration:
      "The agent answers a general question well. Best practices for handling complaints — covered.",
  },
  {
    delayMs: 3500,
    data: { view: "code-domain-question" },
  },
  {
    delayMs: 3000,
    data: { view: "terminal-domain-fail" },
    narration:
      "But ask about your return policy, and it can only guess. It has no domain knowledge yet.",
  },
];
