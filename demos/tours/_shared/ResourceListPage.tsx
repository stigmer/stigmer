import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { ResourceCards, ResourceList } from "@stigmer/react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { PulseHighlight } from "@scenar/react";
import { DEMO_CONTENT_ZOOM } from "./fixtures";
import "./ResourceListPage.css";

interface ResourceListPageProps {
  /** Page heading (e.g. "Agents", "Skills", "MCP Servers"). */
  readonly title: string;
  /** Label for the create button (e.g. "Add Agent", "Add Skill"). */
  readonly createLabel: string;
  /** `data-cursor-target` value for the create button. */
  readonly cursorTarget: string;
  /** Resource items to display, fed by fixture data — no backend lookup. */
  readonly items: readonly SearchResult[];
  /** Layout mode for the resource list. @default "list" */
  readonly layout?: "list" | "grid";
  /** When true, the create button pulses to draw attention. */
  readonly highlightCreate?: boolean;
  /** When true, a brief flash highlights the last item (the one just added). */
  readonly showNewItem?: boolean;
}

/**
 * Generic Library resource page for tours: a page header with a create
 * button framing the real `ResourceCards`/`ResourceList` components.
 * Shared by the agent-, skill-, and MCP-server-creation tours — only the
 * title, labels, and fixture items differ per tour.
 *
 * Chrome is plain CSS colored with `--stgm-*` tokens (DD-003); the real
 * components inside keep their own compiled styles.
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
    <div className="resource-page">
      <div className="resource-page__header">
        <h3 className="resource-page__title">{title}</h3>
        <div className="resource-page__create-wrap" data-cursor-target={cursorTarget}>
          <div className="resource-page__create">
            <Plus size={12} className="resource-page__create-icon" />
            {createLabel}
          </div>

          {highlightCreate && <PulseHighlight />}
        </div>
      </div>

      <div className="resource-page__items" style={{ zoom: DEMO_CONTENT_ZOOM }}>
        {layout === "grid" ? (
          <ResourceCards
            items={items as SearchResult[]}
            renderCard={(item) => (
              <div className="resource-page__card">
                <span className="resource-page__card-name">
                  {item.name || item.slug}
                </span>
                {item.description && (
                  <p className="resource-page__card-desc">{item.description}</p>
                )}
              </div>
            )}
            getItemId={(item) => item.slug}
          />
        ) : (
          <ResourceList
            items={items as SearchResult[]}
            renderRow={(item) => (
              <div className="resource-page__row">
                <span className="resource-page__row-name">
                  {item.name || item.slug}
                </span>
                {item.description && (
                  <>
                    <span className="resource-page__row-sep" aria-hidden>
                      ·
                    </span>
                    <span className="resource-page__row-desc">
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
 * Brief highlight flash over the last item in the list to draw the viewer's
 * eye to the newly added resource.
 */
function NewItemHighlight() {
  return (
    <motion.div
      className="resource-page__new-flash"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration: 2, ease: "easeInOut" }}
      aria-hidden
    />
  );
}
