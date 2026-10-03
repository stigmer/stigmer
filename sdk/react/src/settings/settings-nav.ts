import type { ComponentType } from "react";
import {
  Activity,
  AppWindow,
  BarChart3,
  Box,
  Brain,
  Building2,
  CreditCard,
  FileBadge,
  Layers,
  KeyRound,
  KeySquare,
  Link,
  MessageSquare,
  MousePointerClick,
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
  /** Short, user-facing label shown in navigation. */
  readonly label: string;
  /** Lucide icon component rendered next to the label. */
  readonly icon: ComponentType<{
    /** Optional CSS class name applied to the icon. */
    className?: string;
  }>;
  /**
   * Platform-level permission (on `platform:stigmer`) required for this
   * entry to appear. Only meaningful inside
   * {@link PLATFORM_SETTINGS_NAV_GROUP} — items in the base groups are
   * visible to every signed-in user and leave this unset.
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
      "Manage members, teams, organization identity, and identity providers.",
    items: [
      { href: "/settings/org-profile", label: "Org Profile", icon: Building2 },
      {
        href: "/settings/org-preferences",
        label: "Preferences",
        icon: SlidersHorizontal,
      },
      { href: "/settings/members", label: "Members", icon: Users },
      { href: "/settings/teams", label: "Teams", icon: UsersRound },
      { href: "/settings/invitations", label: "Invitations", icon: Link },
      {
        href: "/settings/identity-providers",
        label: "Identity Providers",
        icon: ShieldCheck,
      },
    ],
  },
  {
    label: "Configuration",
    description:
      "API keys, environment variables, and OAuth app credentials for your integrations.",
    items: [
      { href: "/settings/api-keys", label: "API Keys", icon: KeyRound },
      {
        href: "/settings/platform-clients",
        label: "Platform Clients",
        icon: Plug,
      },
      { href: "/settings/environments", label: "Environments", icon: Box },
      { href: "/settings/oauth-apps", label: "OAuth Apps", icon: AppWindow },
      {
        href: "/settings/channel-apps",
        label: "Channel Apps",
        icon: MessageSquare,
      },
    ],
  },
  {
    label: "Billing & Usage",
    description: "Credit management and usage metrics.",
    items: [
      { href: "/settings/billing", label: "Billing", icon: CreditCard },
      { href: "/settings/usage", label: "Usage", icon: BarChart3 },
      { href: "/settings/provider-keys", label: "Provider keys", icon: KeySquare },
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
      },
      { href: "/settings/memory", label: "Memory", icon: Brain },
    ],
  },
];

/**
 * {@link SETTINGS_NAV_GROUPS} as a server that holds one organization shows
 * them (`ServerInfo.singleOrg`, the open-source edition), where nobody ever
 * names the organization: the first group is "General" rather than
 * "Organization", and the organization's profile page (its name, slug and
 * logo) is left out. Its preferences and members stay; Teams, Invitations
 * and Identity Providers keep the edition gates their own pages apply.
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
      href: "/settings/pricing-governance",
      label: "Pricing Governance",
      icon: Scale,
      requiredPermission: "can_manage_model_pricing",
    },
    {
      href: "/settings/cursor-accounts",
      label: "Cursor Accounts",
      icon: MousePointerClick,
      requiredPermission: "can_manage_cursor_accounts",
    },
    {
      href: "/settings/provider-standing",
      label: "Provider Standing",
      icon: Activity,
      requiredPermission: "can_view_provider_standing",
    },
    {
      href: "/settings/licenses",
      label: "Licenses",
      icon: FileBadge,
      requiredPermission: "can_issue_license",
    },
    {
      href: "/settings/plans",
      label: "Plans",
      icon: Layers,
      requiredPermission: "can_manage_plans",
    },
  ],
};
