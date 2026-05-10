"use client";

import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { ResourceCards, ResourceList } from "@stigmer/react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { PulseHighlight } from "@scenar/react";
import { DEMO_CONTENT_ZOOM } from "../shared/tokens";

interface ResourceListPageProps {
  /** Page heading (e.g. "Skills", "MCP Servers"). */
  readonly title: string;
  /** Label for the create button (e.g. "Add Skill", "Add MCP Server"). */
  readonly createLabel: string;
  /** `data-cursor-target` value for the create button. */
  readonly cursorTarget: string;
  /** Resource items to display in the list. */
  readonly items: readonly SearchResult[];
  /** Layout mode for the resource list. @default "list" */
  readonly layout?: "list" | "grid";
  /** When true, the create button pulses to draw attention. */
  readonly highlightCreate?: boolean;
  /** When true, a flash highlight appears on the last item in the list. */
  readonly showNewItem?: boolean;
}

/**
 * Generic resource list page for demo scenarios.
 *
 * Wraps the `ResourceCards`/`ResourceList` from `@stigmer/react` with a page
 * header and create button. The list is fed by fixture data passed as
 * `items` — no live backend required.
 *
 * Used by the skill-creation and MCP-server-creation guided tours.
 */
export function ResourceListPage({
  title,
  createLabel,
  cursorTarget,
  items,
  layout,
  highlightCreate,
  showNewItem,
}: ResourceListPageProps) {
  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <div className="relative" data-cursor-target={cursorTarget}>
          <div className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
            <Plus className="h-3 w-3" />
            {createLabel}
          </div>

          {highlightCreate && <PulseHighlight />}
        </div>
      </div>

      <div className="relative" style={{ zoom: DEMO_CONTENT_ZOOM }}>
        {layout === "grid" ? (
          <ResourceCards
            items={items as SearchResult[]}
            renderCard={(item) => (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="truncate text-sm font-semibold text-foreground">
                  {item.name || item.slug}
                </span>
                {item.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                )}
              </div>
            )}
            getItemId={(item) => item.slug}
          />
        ) : (
          <ResourceList
            items={items as SearchResult[]}
            renderRow={(item) => (
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {item.name || item.slug}
                </span>
                {item.description && (
                  <>
                    <span className="shrink-0 text-muted-foreground" aria-hidden>·</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </>
                )}
              </div>
            )}
            getItemId={(item) => item.slug}
          />
        )}
        {showNewItem && <NewItemHighlight />}
      </div>
    </div>
  );
}

/**
 * Brief highlight flash on the last item in the list to draw the
 * reader's eye to the newly added resource.
 */
function NewItemHighlight() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[52px] rounded-md bg-primary/5"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration: 2, ease: "easeInOut" }}
      aria-hidden
    />
  );
}
