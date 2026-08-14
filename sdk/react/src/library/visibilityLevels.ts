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
  /**
   * When present, the level cannot be selected by the current caller and the
   * row renders locked (disabled, lock affordance) with this copy explaining
   * why and what to do instead. Computed by the level builders from caller
   * context — the component stays free of per-level branching, exactly like
   * the confirmation ladder.
   *
   * Today's only locked level is Public in the cloud edition for callers
   * without `can_set_public_visibility` (publishing is operator-granted);
   * the backend independently enforces the same gate.
   */
  readonly lockedReason?: string;
}

/**
 * The locked-row copy for a caller who may not set PUBLIC visibility. Names
 * the path forward (ask the platform team) rather than a bare "disabled" —
 * the option stays discoverable even though it is not self-service.
 */
export const PUBLIC_LOCKED_REASON =
  "Public listing is granted by the platform team — contact us to publish this resource.";

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
 * - `canSetPublicVisibility`: entering PUBLIC is operator-gated in the
 *   cloud edition; when the caller lacks the grant the Public option
 *   renders locked instead of disappearing (use
 *   `useCanSetPublicVisibility`, which is always `true` in local mode).
 */
export interface BlueprintVisibilityLevelsContext {
  readonly deploymentMode: "cloud" | "local";
  readonly hasIdentityProvider: boolean;
  readonly canSetPublicVisibility: boolean;
}

/**
 * The PUBLIC option, locked with {@link PUBLIC_LOCKED_REASON} when the
 * caller may not publish. Locked rather than hidden: the level (and the
 * path to it) stays discoverable, matching how the option keeps rendering
 * as the current state on already-public resources.
 */
function publicOption(canSetPublicVisibility: boolean): VisibilityLevelOption {
  return canSetPublicVisibility
    ? PUBLIC_OPTION
    : { ...PUBLIC_OPTION, lockedReason: PUBLIC_LOCKED_REASON };
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
  const publicLevel = publicOption(context.canSetPublicVisibility);
  if (context.deploymentMode === "local") {
    return [PRIVATE_OPTION, publicLevel];
  }
  return context.hasIdentityProvider
    ? [PRIVATE_OPTION, ORG_OPTION, PLATFORM_OPTION, publicLevel]
    : [PRIVATE_OPTION, ORG_OPTION, publicLevel];
}

/**
 * Inputs that gate the instance level set — only the publish gate; the set
 * itself is fixed (instances have no platform level and no deployment-mode
 * collapse).
 */
export interface InstanceVisibilityLevelsContext {
  readonly canSetPublicVisibility: boolean;
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
export function instanceVisibilityLevels(
  context: InstanceVisibilityLevelsContext,
): readonly VisibilityLevelOption[] {
  return [
    PRIVATE_OPTION,
    {
      ...ORG_OPTION,
      description: "All org members can view executions",
    },
    {
      ...publicOption(context.canSetPublicVisibility),
      description: "All authenticated users can view",
    },
  ];
}

/**
 * The levels an environment selector offers, in escalation order:
 * Private / Organization. Broader levels are structurally absent —
 * secret values never leave the org boundary (the backend rejects
 * public/platform via the kind's VisibilityConfig).
 *
 * Org sharing on an environment carries credential semantics, so the
 * copy names both effects: members get redacted view, and executions
 * in the org (teammate-run agents AND shared-agent visitors) can use
 * the values at runtime. Secret reveal stays creator-only at every
 * level.
 *
 * In `local` mode (OSS Go backend, single-user) sharing has no
 * enforcement meaning, so no interactive levels are offered —
 * {@link ResourceVisibilityControl} degrades to a read-only badge.
 */
export function environmentVisibilityLevels(
  deploymentMode: "cloud" | "local",
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
