import type { ComponentType } from "react";
import {
  AppWindow,
  BarChart3,
  Box,
  Building2,
  CreditCard,
  KeyRound,
  Link,
  Plug,
  ShieldCheck,
  Users,
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
      "Manage your team, organization identity, and identity providers.",
    items: [
      { href: "/settings/org-profile", label: "Org Profile", icon: Building2 },
      { href: "/settings/members", label: "Members", icon: Users },
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
    ],
  },
  {
    label: "Billing & Usage",
    description: "Credit management and usage metrics.",
    items: [
      { href: "/settings/billing", label: "Billing", icon: CreditCard },
      { href: "/settings/usage", label: "Usage", icon: BarChart3 },
    ],
  },
];
