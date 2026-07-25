"use client";

import type * as PageTree from "fumadocs-core/page-tree";
import { SidebarSeparator } from "fumadocs-ui/components/layout/sidebar";

/**
 * Sidebar group-label renderer (Cursor-style, per DD-01 §2.2: muted uppercase
 * group labels).
 *
 * Fumadocs' default renders separators at the same size and color as page
 * items, so the capability groups barely read as groups. This override keeps
 * the default `SidebarSeparator` primitive (item offset, icon slot) and
 * restyles the label: smaller, uppercase-tracked, muted — matching the Hero
 * eyebrow treatment on the welcome page.
 *
 * Spacing note: custom separator components receive only `item`, not their
 * position, so the default renderer's "skip top margin on the first entry"
 * behavior is reproduced with a `:not(:first-child)` variant. Separators do
 * appear first both at the top level ("Get Started") and inside generated
 * folders (React SDK's "Foundation", CLI's "Core Commands").
 */
export function DocsSidebarSeparator({ item }: { item: PageTree.Separator }) {
  return (
    <SidebarSeparator className="text-xs font-medium uppercase tracking-wider text-fd-muted-foreground [&:not(:first-child)]:mt-7">
      {item.icon}
      {item.name}
    </SidebarSeparator>
  );
}
