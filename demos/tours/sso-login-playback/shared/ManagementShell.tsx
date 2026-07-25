import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BarChart3,
  Box,
  Building2,
  CreditCard,
  KeyRound,
  Link as LinkIcon,
  Plug,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import "./ManagementShell.css";

export type ManagementNavId =
  | "org-profile"
  | "members"
  | "invitations"
  | "identity-providers"
  | "api-keys"
  | "platform-clients"
  | "environments"
  | "billing"
  | "usage";

interface NavItem {
  readonly id: ManagementNavId;
  readonly label: string;
  readonly icon: React.ComponentType<{ size?: number | string }>;
}

interface NavGroup {
  readonly heading: string;
  readonly items: readonly NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    heading: "Organization",
    items: [
      { id: "org-profile", label: "Org Profile", icon: Building2 },
      { id: "members", label: "Members", icon: Users },
      { id: "invitations", label: "Invitations", icon: LinkIcon },
      { id: "identity-providers", label: "Identity Providers", icon: ShieldCheck },
    ],
  },
  {
    heading: "Configuration",
    items: [
      { id: "api-keys", label: "API Keys", icon: KeyRound },
      { id: "platform-clients", label: "Platform Clients", icon: Plug },
      { id: "environments", label: "Environments", icon: Box },
    ],
  },
  {
    heading: "Billing & Usage",
    items: [
      { id: "billing", label: "Billing", icon: CreditCard },
      { id: "usage", label: "Usage", icon: BarChart3 },
    ],
  },
];

interface ManagementShellProps {
  activeNav?: ManagementNavId;
  contentKey: string;
  slideDirection?: "forward" | "backward";
  children: ReactNode;
}

/**
 * Schematic management zone layout for the SSO login tour.
 *
 * Mirrors the real Console ManagementSidebar with all three navigation groups,
 * a "Back to Sessions" link, and a user profile footer. Rebuilt token-driven
 * (see coding-guidelines/tailwind-to-scenar-tokens.md) so it themes with the
 * embed. The sidebar is rendered at real-app proportions and uniformly scaled
 * via CSS `zoom` to fit the demo container.
 *
 * Single-consumer: stays tour-local under `tours/sso-login-playback/shared/`.
 */
export function ManagementShell({
  activeNav,
  contentKey,
  slideDirection,
  children,
}: ManagementShellProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;

  return (
    <div className="sx-mgmt">
      {/* Management sidebar — real-app layout scaled via zoom */}
      <nav className="sx-mgmt__nav" aria-label="Demo management navigation">
        {/* Org switcher */}
        <div className="sx-mgmt__org">
          <div className="sx-mgmt__org-logo">
            <span>A</span>
          </div>
          <span className="sx-mgmt__org-name">Acme Corp</span>
        </div>

        {/* Back to Sessions */}
        <div className="sx-mgmt__back">
          <div className="sx-mgmt__back-inner">
            <ArrowLeft size={16} aria-hidden />
            <span>Back to Sessions</span>
          </div>
        </div>

        <div className="sx-mgmt__divider" />

        {/* Grouped navigation */}
        <div className="sx-mgmt__groups">
          {NAV_GROUPS.map((group) => (
            <div key={group.heading} className="sx-mgmt__group">
              <span className="sx-mgmt__group-heading">{group.heading}</span>
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className={
                    activeNav === item.id
                      ? "sx-mgmt__item sx-mgmt__item--active"
                      : "sx-mgmt__item"
                  }
                >
                  <item.icon size={16} aria-hidden />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Spacer */}
        <div className="sx-mgmt__spacer" />

        {/* User profile */}
        <div className="sx-mgmt__user">
          <div className="sx-mgmt__user-avatar">
            <User size={12} aria-hidden />
          </div>
          <span className="sx-mgmt__user-email">you@acme.com</span>
        </div>
      </nav>

      {/* Content area */}
      <motion.div
        key={contentKey}
        className="sx-mgmt__content"
        initial={{ opacity: 0, x: slideX }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </div>
  );
}
