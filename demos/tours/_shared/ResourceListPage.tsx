import { useMemo } from "react";
import { motion } from "framer-motion";
import { Plus, Upload } from "lucide-react";
import { ResourceWorkbench } from "@stigmer/react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type { ListResult } from "@stigmer/sdk";
import { PulseHighlight } from "@scenar/react";
import { DEMO_ORG } from "./fixtures";
import "./ResourceListPage.css";

const noop = () => {};

interface ResourceListPageProps {
  /** Page heading (e.g. "Agents", "Skills", "MCP Servers"). */
  readonly title: string;
  /**
   * The resource noun as the console's copy inflects it (`"agents"`,
   * `"skills"`, `"MCP servers"`). Derives the subtitle ("Browse and manage
   * {noun} in your organization.") and the search placeholder ("Search
   * {noun}…") — both follow this exact pattern on every real list page.
   */
  readonly nounPlural: string;
  /** The console's exact create-button label (e.g. "Create agent"). */
  readonly createLabel: string;
  /** `data-cursor-target` value for the create button. */
  readonly cursorTarget: string;
  /** Resource items to display, fed by fixture data — no backend lookup. */
  readonly items: readonly SearchResult[];
  /**
   * Render the Apply-YAML icon button beside the create button, as the
   * console's agents and MCP-servers pages do (the skills page doesn't).
   */
  readonly showApplyYaml?: boolean;
  /** When true, the create button pulses to draw attention. */
  readonly highlightCreate?: boolean;
  /** When true, a brief flash highlights the last item (the one just added). */
  readonly showNewItem?: boolean;
}

/**
 * Generic Library resource page for tours, at the console's own
 * composition: the real `ResourceWorkbench` (toolbar with search, view
 * switcher, and header action; card grid; the console's default card
 * layout) fed by a fixture `listFn` — the SessionView mechanism applied to
 * the Library zone (stigmer/stigmer#317). Shared by the agent-, skill-,
 * and MCP-server-creation tours.
 *
 * What stays demo-owned: the page framing the console's `LibraryLayout`
 * and per-resource list pages hand out (breadcrumb, `h1` + subtitle —
 * ~15 lines of client-app markup transcribed in plain CSS), the create
 * button (the real one is the host's routing `Link`; the demo's is an
 * inert twin carrying the cursor target and pulse), and the new-item
 * flash. Two deliberate determinism departures from the console's wiring,
 * both seams the workbench exposes for exactly this host class: no
 * `viewModeStorageKey` (persisted view mode would make replays
 * reader-dependent) and a resolved-fixture `listFn` (no backend).
 */
export function ResourceListPage({
  title,
  nounPlural,
  createLabel,
  cursorTarget,
  items,
  showApplyYaml,
  highlightCreate,
  showNewItem,
}: ResourceListPageProps) {
  const listFn = useMemo(
    () =>
      async (): Promise<ListResult> => ({
        entries: [...items],
        totalCount: items.length,
        totalPages: 1,
      }),
    [items],
  );

  return (
    <div className="resource-page">
      {/* The library zone's breadcrumb (`LibraryBreadcrumb`): Library / {page}. */}
      <nav className="resource-page__breadcrumb" aria-label="Breadcrumb">
        <span>Library</span>
        <span className="resource-page__breadcrumb-sep" aria-hidden>
          /
        </span>
        <span className="resource-page__breadcrumb-current">{title}</span>
      </nav>

      {/* The list page's header ramp: `text-xl font-semibold` + `mt-1 text-sm`. */}
      <div className="resource-page__header">
        <h1 className="resource-page__title">{title}</h1>
        <p className="resource-page__subtitle">
          Browse and manage {nounPlural} in your organization.
        </p>
      </div>

      <div className="resource-page__items">
        <ResourceWorkbench
          listFn={listFn}
          org={DEMO_ORG}
          scope="org"
          onScopeChange={noop}
          defaultViewMode="cards"
          viewModes={["table", "cards"]}
          searchPlaceholder={`Search ${nounPlural}\u2026`}
          headerAction={
            <div className="resource-page__actions">
              {showApplyYaml && (
                <span className="resource-page__apply-yaml" aria-label="Apply YAML">
                  <Upload size={14} />
                </span>
              )}
              <span
                className="resource-page__create-wrap"
                data-cursor-target={cursorTarget}
              >
                <span className="resource-page__create">
                  <Plus size={14} className="resource-page__create-icon" />
                  {createLabel}
                </span>
                {highlightCreate && <PulseHighlight />}
              </span>
            </div>
          }
        />
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
