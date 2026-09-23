import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { DeploymentMode } from "@stigmer/sdk";

/**
 * A selectable visibility level: label, explanation, and escalation copy.
 *
 * Options are always declared in escalation order (least to most exposed:
 * private < org < platform); {@link VisibilitySelector} derives
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
   * Levels that expand access beyond the owning org carry a
   * {@link confirmDialog} instead; see the severity ladder on
   * {@link VisibilityLevelOption}.
   */
  readonly confirmPrompt?: string;
  /**
   * Heavy confirmation shown as a modal {@link ConfirmDialog} when the user
   * escalates TO this level. Reserved for levels that expose the resource
   * beyond the owning organization (platform), where a blocking,
   * audience-naming confirmation is warranted.
   *
   * The selector derives escalation severity purely from this data:
   * `confirmDialog` present → modal; else `confirmPrompt` present → inline;
   * else apply immediately. There is no per-level branching in the
   * component.
   */
  readonly confirmDialog?: {
    /** Modal title, phrased as a question (e.g. "Share with your whole platform?"). */
    readonly title: string;
    /** Body copy that names the exact audience and the consequence. */
    readonly description: string;
  };
  /**
   * Color treatment for the selected segment and the confirmation prompt.
   * `"public"` is the tone of the retired level: never offered, rendered
   * only for a stored value from before the retirement (see
   * {@link visibilityOption}).
   */
  readonly tone: "private" | "org" | "platform" | "public";
  /**
   * When present, the level cannot be selected by the current caller and the
   * row renders locked (disabled, lock affordance) with this copy explaining
   * why and what to do instead. The component stays free of per-level
   * branching, exactly like the confirmation ladder: a consumer that builds
   * its own option list decides which levels its caller may enter.
   */
  readonly lockedReason?: string;
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

/**
 * The retired public level, rendered for a stored value and never offered.
 *
 * The server refuses `visibility_public` at every door and moves every
 * stored row that held it to `visibility_org` on upgrade, so a live row
 * carries this value only on a server not yet upgraded. A badge that met
 * it and fell through to "Private" would lie, so the value keeps a
 * truthful rendering; no level list returns it.
 */
const RETIRED_PUBLIC_OPTION: VisibilityLevelOption = {
  value: ApiResourceVisibility.visibility_public,
  label: "Public",
  description:
    "Retired level — this resource becomes visible to your organization on upgrade",
  tone: "public",
};

/**
 * Inputs that gate which levels a blueprint selector offers.
 *
 * Mirrors the backend's per-kind `VisibilityConfig` plus the one runtime
 * fact the proto cannot know: `visibility_platform` requires the owning
 * org to operate an IdentityProvider — the backend rejects it otherwise
 * (`ValidateVisibilityStep`), so the option only renders when the signal
 * is present (use `useSsoProvider`, the permission-free lookup; the
 * open-source edition serves no IdentityProvider kind, so the signal is
 * never present there).
 */
export interface BlueprintVisibilityLevelsContext {
  readonly hasIdentityProvider: boolean;
}

/**
 * The levels a blueprint (agent, skill, workflow, mcp_server, plugin)
 * selector offers, in escalation order: Private / Organization
 * [/ Platform]. Organization is the creation default (blueprints are
 * shared org assets; Private is an explicit opt-in).
 */
export function blueprintVisibilityLevels(
  context: BlueprintVisibilityLevelsContext,
): readonly VisibilityLevelOption[] {
  return context.hasIdentityProvider
    ? [PRIVATE_OPTION, ORG_OPTION, PLATFORM_OPTION]
    : [PRIVATE_OPTION, ORG_OPTION];
}

/**
 * The levels an instance (agent_instance, workflow_instance) selector
 * offers, in escalation order: Private / Organization.
 *
 * Platform is deliberately absent — instances are tenant-isolated by
 * design (each managed org instantiates shared blueprints inside its own
 * boundary). Descriptions are execution-oriented because org visibility on
 * an instance is about who can run it and see its executions.
 */
export function instanceVisibilityLevels(): readonly VisibilityLevelOption[] {
  return [
    PRIVATE_OPTION,
    {
      ...ORG_OPTION,
      description: "All org members can view executions",
    },
  ];
}

/**
 * The levels an environment selector offers, in escalation order:
 * Private / Organization. The platform level is structurally absent —
 * secret values never leave the org boundary (the backend rejects it via
 * the kind's VisibilityConfig).
 *
 * Org sharing on an environment carries credential semantics, so the
 * copy names both effects: members get redacted view, and executions
 * in the org (teammate-run agents AND shared-agent visitors) can use
 * the values at runtime. Secret reveal stays creator-only at every
 * level.
 *
 * In `local` mode (the open-source edition, single-user) sharing has no
 * enforcement meaning, so no interactive levels are offered —
 * {@link ResourceVisibilityControl} degrades to a read-only badge.
 * Enterprise and Cloud enforce org sharing alike.
 */
export function environmentVisibilityLevels(
  deploymentMode: DeploymentMode,
): readonly VisibilityLevelOption[] {
  if (deploymentMode === "local") {
    return [PRIVATE_OPTION];
  }
  return [
    {
      ...PRIVATE_OPTION,
      description: "Only you can view and use these credentials",
    },
    {
      ...ORG_OPTION,
      description:
        "Agents run in your org — including shared-agent visitors — can use these credentials. Members see names only; secret values stay hidden.",
      confirmPrompt: "Let agents run in your org use these credentials?",
    },
  ];
}

/**
 * Canonical option for a visibility value, independent of any kind's offered
 * list. Used to render the current level even when it is not offerable in
 * the current context (e.g. a platform-shared blueprint whose org no longer
 * operates an IdentityProvider, or a row still carrying the retired public
 * level) — the state must stay legible.
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
      return RETIRED_PUBLIC_OPTION;
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
