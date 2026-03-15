import {
  Play,
  History,
  Bot,
  FileCode2,
  Server,
  LayoutDashboard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export type NavEntry = NavItem | NavSection;

export function isNavSection(entry: NavEntry): entry is NavSection {
  return "items" in entry;
}

export const navigation: NavEntry[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  {
    label: "Operations",
    items: [
      { label: "Run Agent", href: "/run", icon: Play },
      { label: "Sessions", href: "/sessions", icon: History },
    ],
  },
  {
    label: "Resources",
    items: [
      { label: "Agents", href: "/agents", icon: Bot },
      { label: "Skills", href: "/skills", icon: FileCode2 },
      { label: "MCP Servers", href: "/mcp-servers", icon: Server },
    ],
  },
];
