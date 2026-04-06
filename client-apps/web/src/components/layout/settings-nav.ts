import type { ComponentType } from "react";
import {
  BarChart3,
  Box,
  Building2,
  CreditCard,
  KeyRound,
  ShieldCheck,
  Users,
} from "lucide-react";

export interface SettingsNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
}

export interface SettingsNavGroup {
  readonly label: string;
  readonly description: string;
  readonly items: readonly SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    label: "Organization",
    description:
      "Manage your team, organization identity, and identity providers.",
    items: [
      { href: "/settings/org-profile", label: "Org Profile", icon: Building2 },
      { href: "/settings/members", label: "Members", icon: Users },
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
      "API keys and environment variables for your agents and workflows.",
    items: [
      { href: "/settings/api-keys", label: "API Keys", icon: KeyRound },
      { href: "/settings/environments", label: "Environments", icon: Box },
    ],
  },
  {
    label: "Billing & Usage",
    description: "Subscription management and usage metrics.",
    items: [
      { href: "/settings/billing", label: "Billing", icon: CreditCard },
      { href: "/settings/usage", label: "Usage", icon: BarChart3 },
    ],
  },
];
