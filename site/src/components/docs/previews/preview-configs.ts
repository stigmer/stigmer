import type { ComponentType } from "react";
import {
  AgentDetailView,
  ApiKeyListPanel,
  ErrorMessage,
  ModelSelector,
  SessionComposer,
} from "@stigmer/react";
import { create } from "@bufbuild/protobuf";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { fixtures, samples, type FixtureSpec } from "@stigmer/react/demo";

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

export interface PreviewConfig {
  /** The SDK component to render. */
  readonly component: ComponentType<any>;
  /** Fixture specs passed to `buildScenario()` for the demo client. */
  readonly fixtures: FixtureSpec[];
  /** Props spread onto the component. */
  readonly props: Record<string, unknown>;
  /** Extra Tailwind classes applied to the preview container (e.g. max-width). */
  readonly previewClassName?: string;
}

// ---------------------------------------------------------------------------
// Preview definitions
// ---------------------------------------------------------------------------

const noop = () => {};

/**
 * Data-driven registry of component previews for SDK reference pages.
 *
 * Each entry declares what to render and with what data. The generic
 * {@link ComponentPreview} component reads this config, creates a
 * demo client from the fixtures, and renders the component inside a
 * {@link PreviewShell}.
 *
 * Adding a new preview: add one entry here and add the component name
 * to `PREVIEW_COMPONENTS` in `site/scripts/generate-react-sdk-docs/renderer.ts`.
 */
export const PREVIEW_CONFIGS: Record<string, PreviewConfig> = {
  SessionComposer: {
    component: SessionComposer,
    fixtures: [
      fixtures.environment.list(() =>
        create(EnvironmentListSchema, { items: [], totalCount: 0 }),
      ),
    ],
    props: {
      onSubmit: noop,
      placeholder: "Describe what you need help with...",
      org: "acme",
      onAgentRefChange: noop,
      onMcpServerUsagesChange: noop,
      onSkillRefsChange: noop,
    },
    previewClassName: "max-w-2xl",
  },
  ModelSelector: {
    component: ModelSelector,
    fixtures: [],
    props: { onValueChange: noop },
  },
  AgentDetailView: {
    component: AgentDetailView,
    fixtures: [
      fixtures.agent.getByReference(() =>
        samples.agent({
          name: "support-agent",
          org: "acme",
          description:
            "Handles customer support requests — answers questions, looks up orders, and processes returns with human approval.",
        }),
      ),
    ],
    props: { org: "acme", slug: "support-agent" },
  },
  ErrorMessage: {
    component: ErrorMessage,
    fixtures: [],
    props: {
      error: new Error(
        "Failed to fetch agent — the server returned an unexpected response. " +
          "Check that the API URL is correct and the service is running.",
      ),
    },
  },
  ApiKeyListPanel: {
    component: ApiKeyListPanel,
    fixtures: [fixtures.apiKey.findAll(() => samples.apiKeyList())],
    props: {},
  },
};
