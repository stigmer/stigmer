import type { ComponentType } from "react";
import {
  AppWindow,
  BarChart3,
  Bot,
  Box,
  Brain,
  Building2,
  CreditCard,
  FileBadge,
  History,
  Layers,
  KeyRound,
  Link,
  MessageSquare,
  Plug,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  Users,
  UsersRound,
} from "lucide-react";

/** Single navigable entry in the settings sidebar. */
export interface SettingsNavItem {
  /** Route for the settings page entry. */
  readonly href: string;
  /** Short, user-facing label shown in navigation: the page's own title, in sentence case. */
  readonly label: string;
  /**
   * One line on what the page is for, drawn under its name on the settings
   * landing. `{org}` stands for the active organization's slug, and reads
   * "this organization" where none is known.
   */
  readonly description?: string;
  /** Lucide icon component rendered next to the label. */
  readonly icon: ComponentType<{
    /** Optional CSS class name applied to the icon. */
    className?: string;
  }>;
  /**
   * Permission required for this entry to appear: on `platform:stigmer` for
   * the items of {@link PLATFORM_SETTINGS_NAV_GROUP}, on the active
   * organization for {@link ORG_ADMIN_SETTINGS_NAV_ITEMS}. Items in the base
   * groups are visible to every signed-in user and leave this unset.
   * {@link useSettingsNavGroups} checks it fail-closed.
   */
  readonly requiredPermission?: string;
}

/** Grouping model used to render settings navigation sections. */
export interface SettingsNavGroup {
  /** Group heading shown in the settings navigation. */
  readonly label: string;
  /** Helper text describing the group purpose. */
  readonly description: string;
  /** Entries that belong to this group. */
  readonly items: readonly SettingsNavItem[];
}

/** Canonical settings sidebar/grouped navigation model. */
export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    label: "Organization",
    description:
      "Manage members, teams, organization identity, and federation issuers.",
    items: [
      {
        href: "/settings/org-profile",
        label: "Organization profile",
        icon: Building2,
        description: "Its name, description and logo.",
      },
      {
        href: "/settings/org-preferences",
        label: "Preferences",
        icon: SlidersHorizontal,
        description:
          "What agents know about {org}, memory, the default environment, and who may create agents.",
      },
      {
        href: "/settings/org-embedding",
        label: "Embedding",
        icon: Plug,
        description: "How people sign in from your own product.",
      },
      {
        href: "/settings/members",
        label: "Members",
        icon: Users,
        description: "Who belongs to {org}, and each one's role.",
      },
      {
        href: "/settings/teams",
        label: "Teams",
        icon: UsersRound,
        description: "Groups you share agents and vaults with at once.",
      },
      {
        href: "/settings/invitations",
        label: "Invitations",
        icon: Link,
        description: "Links that let people join, with the role you choose.",
      },
      {
        href: "/settings/federation-issuers",
        label: "Federation issuers",
        icon: ShieldCheck,
        description: "Other platforms whose sign-in {org} accepts.",
      },
    ],
  },
  {
    label: "Configuration",
    description:
      "API keys, vaults of logins and secrets, and OAuth app credentials for your integrations.",
    items: [
      {
        href: "/settings/api-keys",
        label: "API keys",
        icon: KeyRound,
        description: "Sign the CLI and your own programs in as you.",
      },
      {
        href: "/settings/vaults",
        label: "Vaults",
        icon: Box,
        description: "The logins and secrets your agents use.",
      },
      {
        href: "/settings/oauth-apps",
        label: "OAuth apps",
        icon: AppWindow,
        description: "Your own login apps for the tools agents reach.",
      },
      {
        href: "/settings/channel-apps",
        label: "Channel apps",
        icon: MessageSquare,
        description: "Your own Slack and Meta apps for channels.",
      },
    ],
  },
  {
    label: "Billing and usage",
    description: "Plan, payment method and usage metrics.",
    items: [
      {
        href: "/settings/billing",
        label: "Billing",
        icon: CreditCard,
        description: "Your plan, this period's cost and the card.",
      },
      {
        href: "/settings/usage",
        label: "Usage",
        icon: BarChart3,
        description: "Tokens and runs, by model and by day.",
      },
    ],
  },
  {
    label: "Account",
    description: "Personal settings that apply to you across the platform.",
    items: [
      {
        href: "/settings/account-preferences",
        label: "Preferences",
        icon: UserCog,
        description:
          "What agents know about you, your default models, memory and notifications.",
      },
      {
        href: "/settings/memory",
        label: "Memory",
        icon: Brain,
        description: "What agents remember about you.",
      },
    ],
  },
];

/**
 * {@link SETTINGS_NAV_GROUPS} as a server that holds one organization shows
 * them (`ServerInfo.singleOrg`, the open-source edition), where nobody ever
 * names the organization: the first group is "General" rather than
 * "Organization", and the organization's profile page (its name, slug and
 * logo) is left out. Its preferences and members stay; Teams, Invitations
 * and Federation issuers keep the edition gates their own pages apply.
 * {@link useSettingsNavGroups} picks between the two.
 */
export const SINGLE_ORG_SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] =
  SETTINGS_NAV_GROUPS.map((group, index) =>
    index === 0
      ? {
          label: "General",
          description: "Preferences and members of this server.",
          items: group.items.filter(
            (item) => item.href !== "/settings/org-profile",
          ),
        }
      : group,
  );

/**
 * Organization entries shown only to a caller who holds their permission on
 * the active organization, each placed in the first group (Organization, or
 * General on a server that holds one) after Teams.
 *
 * Kept out of {@link SETTINGS_NAV_GROUPS} for the reason the platform group
 * is: that constant is what every signed-in user sees. Service accounts are
 * managed by the organization's admins (`can_create_identity_account`), the
 * access history is read by its owners and admins
 * (`can_view_access_history`), and a
 * page a member could only be told about is discoverability, not capability,
 * so it stays hidden until the server says yes. Use
 * {@link useSettingsNavGroups} for the permission-aware list.
 */
export const ORG_ADMIN_SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    href: "/settings/service-accounts",
    label: "Service accounts",
    icon: Bot,
    description: "Accounts that CI jobs and scripts act as.",
    requiredPermission: "can_create_identity_account",
  },
  {
    href: "/settings/access-history",
    label: "Access history",
    icon: History,
    description: "Who was given or lost access, and when.",
    requiredPermission: "can_view_access_history",
  },
];

/**
 * Stigmer-internal platform-operator navigation group.
 *
 * Deliberately NOT part of {@link SETTINGS_NAV_GROUPS}: that constant
 * means "groups every signed-in user sees", and its members must never
 * change based on who is looking. This group is appended for platform
 * operators only — use {@link useSettingsNavGroups} to get the
 * permission-aware list instead of composing the two by hand.
 *
 * Every item here declares its `requiredPermission`; the hook filters
 * per item (fail-closed), so an operator holding one platform permission
 * but not another sees exactly their slice of this group.
 */
export const PLATFORM_SETTINGS_NAV_GROUP: SettingsNavGroup = {
  label: "Platform",
  description:
    "Stigmer-internal operations. Visible to platform operators only.",
  items: [
    {
      href: "/settings/model-catalog",
      label: "Model catalog",
      icon: Scale,
      description: "Every model the registry serves, at list prices.",
      requiredPermission: "can_manage_model_pricing",
    },
    {
      href: "/settings/licenses",
      label: "Licenses",
      icon: FileBadge,
      description: "Licenses issued to self-hosted customers.",
      requiredPermission: "can_issue_license",
    },
    {
      href: "/settings/plans",
      label: "Plans",
      icon: Layers,
      description: "The plans organizations subscribe to.",
      requiredPermission: "can_manage_plans",
    },
  ],
};
