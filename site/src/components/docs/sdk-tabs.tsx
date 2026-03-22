import type { ReactNode } from "react";
import { Tabs } from "fumadocs-ui/components/tabs";

const SDK_LANGUAGES = ["Go", "TypeScript", "Python", "Java"];

interface SDKTabsProps {
  children: ReactNode;
}

/**
 * Pre-configured language tabs for SDK code examples.
 *
 * Wraps Fumadocs Tabs with the four supported SDK languages and
 * cross-page persistence — when a reader picks "Python" on one page,
 * every other SDKTabs on the site remembers that choice.
 *
 * @example
 * ```mdx
 * <SDKTabs>
 *   <Tab value="Go">
 *     ```go
 *     agent, err := client.CreateAgent(ctx, spec)
 *     ```
 *   </Tab>
 *   <Tab value="TypeScript">
 *     ```typescript
 *     const agent = await client.createAgent(spec);
 *     ```
 *   </Tab>
 * </SDKTabs>
 * ```
 */
export function SDKTabs({ children }: SDKTabsProps) {
  return (
    <Tabs groupId="sdk-language" persist items={SDK_LANGUAGES}>
      {children}
    </Tabs>
  );
}
