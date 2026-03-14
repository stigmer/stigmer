import {
  Play,
  History,
  Bot,
  FileCode2,
  Server,
  PenLine,
  LayoutGrid,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

export const navigation: NavEntry[] = [
  { label: "Run Agent", href: "/run", icon: Play },
  { label: "Sessions", href: "/sessions", icon: History },
  { label: "Catalog", href: "/catalog", icon: LayoutGrid },
  {
    label: "Draft",
    icon: PenLine,
    items: [
      { label: "Skill", href: "/draft/skill", icon: FileCode2 },
      { label: "Agent", href: "/draft/agent", icon: Bot },
      { label: "MCP Server", href: "/draft/mcp-server", icon: Server },
    ],
  },
];
