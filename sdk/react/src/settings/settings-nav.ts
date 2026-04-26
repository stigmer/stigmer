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
  Server,
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
    label: "Infrastructure",
    description:
      "Compute resources that execute your agents and workflows.",
    items: [
      { href: "/settings/runners", label: "Runners", icon: Server },
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
