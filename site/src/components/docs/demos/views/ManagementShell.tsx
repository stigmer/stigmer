"use client";

import { type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BarChart3,
  Box,
  Building2,
  CreditCard,
  KeyRound,
  Link as LinkIcon,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import {
  DEMO_SHELL_HEIGHT,
  DEMO_SHELL_HEIGHT_MIN,
} from "../shared/tokens";

export type ManagementNavId =
  | "org-profile"
  | "members"
  | "invitations"
  | "identity-providers"
  | "api-keys"
  | "environments"
  | "billing"
  | "usage";

interface NavItem {
  readonly id: ManagementNavId;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
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
      {
        id: "identity-providers",
        label: "Identity Providers",
        icon: ShieldCheck,
      },
    ],
  },
  {
    heading: "Configuration",
    items: [
      { id: "api-keys", label: "API Keys", icon: KeyRound },
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

/**
 * Sidebar zoom factor. The sidebar is authored at real-app dimensions
 * (text-sm, size-4 icons, standard spacing) then uniformly scaled
 * down to fit the demo shell height. This keeps proportions identical
 * to the real Console and future nav items will fit without tweaks.
 */
const SIDEBAR_ZOOM = 0.55;

interface ManagementShellProps {
  activeNav?: ManagementNavId;
  contentKey: string;
  slideDirection?: "forward" | "backward";
  children: ReactNode;
}

/**
 * Schematic management zone layout for demo scenarios.
 *
 * Mirrors the real Console ManagementSidebar with all three
 * navigation groups (Organization, Configuration, Billing & Usage),
 * a "Back to Sessions" link, and a user profile footer. The sidebar
 * is rendered at real-app proportions and uniformly zoomed to fit
 * the demo container.
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
    <div
      className="flex overflow-hidden rounded-lg border border-border bg-card"
      style={{
        height: `var(--scenar-shell-height, clamp(${DEMO_SHELL_HEIGHT_MIN}px, 55vh, ${DEMO_SHELL_HEIGHT}px))`,
      }}
    >
      {/* Management sidebar — real-app layout scaled via zoom */}
      <nav
        className="flex shrink-0 flex-col border-r border-border bg-muted"
        aria-label="Demo management navigation"
        style={{ zoom: SIDEBAR_ZOOM, width: `${170 / SIDEBAR_ZOOM}px` }}
      >
        {/* Org switcher */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <span className="text-[10px] font-bold text-primary">A</span>
          </div>
          <span className="truncate text-sm font-semibold text-foreground">
            Acme Corp
          </span>
        </div>

        {/* Back to Sessions */}
        <div className="px-3 pb-1">
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground">
            <ArrowLeft className="size-4 shrink-0" />
            <span>Back to Sessions</span>
          </div>
        </div>

        <div className="mx-3 my-0.5 border-t border-border" />

        {/* Grouped navigation */}
        <div className="flex flex-col gap-3 px-3 pt-1">
          {NAV_GROUPS.map((group) => (
            <div key={group.heading} className="flex flex-col gap-0.5">
              <span className="px-2 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {group.heading}
              </span>
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                    activeNav === item.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  <item.icon className="size-4 shrink-0" />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User profile */}
        <div className="flex items-center gap-2 border-t border-border px-4 py-2">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted-foreground/20">
            <User className="size-3 text-muted-foreground" />
          </div>
          <span className="truncate text-xs text-muted-foreground">
            you@acme.com
          </span>
        </div>
      </nav>

      {/* Content area */}
      <motion.div
        key={contentKey}
        className="min-w-0 flex-1 overflow-hidden bg-background"
        initial={{ opacity: 0, x: slideX }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </div>
  );
}
