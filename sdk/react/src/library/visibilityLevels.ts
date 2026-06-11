import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

/**
 * A selectable visibility level: label, explanation, and escalation copy.
 *
 * Options are always declared in escalation order (least to most exposed:
 * private < org < platform < public); {@link VisibilitySelector} derives
 * "is this an escalation?" from array position, and shows
 * {@link confirmPrompt} before applying one.
 */
export interface VisibilityLevelOption {
  readonly value: ApiResourceVisibility;
  readonly label: string;
  /** One-line explanation shown under the selector for the current level. */
  readonly description: string;
  /**
   * Light inline confirmation question shown inside the selector when the
   * user escalates TO this level (e.g. private → org). Omitted for the
   * least-exposed level (de-escalation never confirms — revoking access is
   * always safe).
   *
   * Levels that expand access far beyond the owning org carry a
   * {@link confirmDialog} instead; see the severity ladder on
   * {@link VisibilityLevelOption}.
   */
  readonly confirmPrompt?: string;
  /**
   * Heavy confirmation shown as a modal {@link ConfirmDialog} when the user
   * escalates TO this level. Reserved for levels that expose the resource
   * beyond the owning organization (platform, public), where a blocking,
   * audience-naming confirmation is warranted.
   *
   * The selector derives escalation severity purely from this data:
   * `confirmDialog` present → modal; else `confirmPrompt` present → inline;
   * else apply immediately. There is no per-level branching in the
   * component.
   */
  readonly confirmDialog?: {
    /** Modal title, phrased as a question (e.g. "Make this public?"). */
    readonly title: string;
    /** Body copy that names the exact audience and the consequence. */
    readonly description: string;
  };
  /** Color treatment for the selected segment and the confirmation prompt. */
  readonly tone: "private" | "org" | "platform" | "public";
}

const PRIVATE_OPTION: VisibilityLevelOption = {
  value: ApiResourceVisibility.visibility_private,
  label: "Private",
  description: "Only you can access",
  tone: "private",
};

const ORG_OPTION: VisibilityLevelOption = {
  value: ApiResourceVisibility.visibility_org,
  label: "Organization",
  description: "All members of your organization",
  confirmPrompt: "Make visible to all org members?",
  tone: "org",
};

const PLATFORM_OPTION: VisibilityLevelOption = {
  value: ApiResourceVisibility.visibility_platform,
  label: "Platform",
  description: "All organizations managed by your platform",
  confirmDialog: {
    title: "Share with your whole platform?",
    description:
      "Every organization managed by your platform will be able to view and use this resource. You can return it to a narrower visibility at any time.",
  },
  tone: "platform",
};

const PUBLIC_OPTION: VisibilityLevelOption = {
  value: ApiResourceVisibility.visibility_public,
  label: "Public",
  description: "Anyone on Stigmer",
  confirmDialog: {
    title: "Make this public?",
    description:
      "Anyone signed in to Stigmer will be able to view and use this resource. You can return it to a narrower visibility at any time.",
  },
  tone: "public",
};

/**
 * Inputs that gate which levels a blueprint selector offers.
 *
 * Mirrors the backend's per-kind `VisibilityConfig` plus runtime context the
 * proto cannot know:
 *
 * - `deploymentMode`: the OSS Go backend (`local`) is single-user and
 *   performs no org/platform visibility gating, so only Private/Public are
 *   meaningful there.
 * - `hasIdentityProvider`: `visibility_platform` requires the owning org to
 *   operate an IdentityProvider — the backend rejects it otherwise
 *   (`ValidateVisibilityStep`), so the option only renders when the signal
 *   is present (use `useSsoProvider`, the permission-free lookup).
 */
export interface BlueprintVisibilityLevelsContext {
  readonly deploymentMode: "cloud" | "local";
  readonly hasIdentityProvider: boolean;
}

/**
 * The levels a blueprint (agent, skill, workflow, mcp_server) selector
 * offers, in escalation order.
 *
 * Cloud: Private / Organization [/ Platform] / Public — Organization is the
 * creation default (blueprints are shared org assets; Private is an explicit
 * opt-in). Local: Private / Public.
 */
export function blueprintVisibilityLevels(
  context: BlueprintVisibilityLevelsContext,
): readonly VisibilityLevelOption[] {
  if (context.deploymentMode === "local") {
    return [PRIVATE_OPTION, PUBLIC_OPTION];
  }
  return context.hasIdentityProvider
    ? [PRIVATE_OPTION, ORG_OPTION, PLATFORM_OPTION, PUBLIC_OPTION]
    : [PRIVATE_OPTION, ORG_OPTION, PUBLIC_OPTION];
}

/**
 * The levels an instance (agent_instance, workflow_instance) selector
 * offers, in escalation order: Private / Organization / Public.
 *
 * Platform is deliberately absent — instances are tenant-isolated by
 * design (each managed org instantiates shared blueprints inside its own
 * boundary). Descriptions are execution-oriented because org visibility on
 * an instance is about who can run it and see its executions.
 */
export const INSTANCE_VISIBILITY_LEVELS: readonly VisibilityLevelOption[] = [
  PRIVATE_OPTION,
  {
    ...ORG_OPTION,
    description: "All org members can view executions",
  },
  {
    ...PUBLIC_OPTION,
    description: "All authenticated users can view",
  },
];

/**
 * Canonical option for a visibility value, independent of any kind's offered
 * list. Used to render the current level even when it is not offerable in
 * the current context (e.g. a platform-shared blueprint whose org no longer
 * operates an IdentityProvider) — the state must stay legible.
 */
export function visibilityOption(
  visibility: ApiResourceVisibility,
): VisibilityLevelOption {
  switch (visibility) {
    case ApiResourceVisibility.visibility_org:
      return ORG_OPTION;
    case ApiResourceVisibility.visibility_platform:
      return PLATFORM_OPTION;
    case ApiResourceVisibility.visibility_public:
      return PUBLIC_OPTION;
    default:
      return PRIVATE_OPTION;
  }
}

/**
 * Human label for a visibility value — the one place list rows, badges, and
 * detail panels resolve enum-to-text, so no surface ever falls through to
 * "Private" (or "unknown") for org/platform.
 */
export function visibilityLabel(visibility: ApiResourceVisibility): string {
  return visibilityOption(visibility).label;
}
