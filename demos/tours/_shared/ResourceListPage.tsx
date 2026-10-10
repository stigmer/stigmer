import { useMemo, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Plus, Upload } from "lucide-react";
import { ResourceWorkbench } from "@stigmer/react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type { ListResult } from "@stigmer/sdk";
import { PulseHighlight } from "@scenar/react";
import { DEMO_ORG } from "./fixtures";
import "./ResourceListPage.css";

interface ResourceListPageProps {
  /** Page heading (e.g. "Agents", "Skills", "Plugins"). */
  readonly title: string;
  /**
   * The resource noun as the console's copy inflects it (`"agents"`,
   * `"skills"`, `"plugins"`). Derives the subtitle ("Browse and manage
   * {noun} in your organization.") and the search placeholder ("Search
   * {noun}…") — the pattern most real list pages follow.
   */
  readonly nounPlural: string;
  /**
   * The page's own subtitle, for a list page whose copy departs from the
   * derived one (the Plugins page says what a plugin is instead).
   */
  readonly subtitle?: string;
  /** The console's exact create-button label (e.g. "Create agent"). */
  readonly createLabel: string;
  /** `data-cursor-target` value for the create button. */
  readonly cursorTarget: string;
  /**
   * Icon on the create button. Defaults to the console's `Plus`; a page
   * whose button names something else carries that page's icon.
   */
  readonly createIcon?: ReactNode;
  /**
   * Render the create button as the console's outlined secondary button
   * rather than its primary one, for a page where it is not the first way
   * in (the Plugins page leads with Browse Marketplace).
   */
  readonly createSecondary?: boolean;
  /**
   * Inert twins of the buttons the page shows before the create button, in
   * order: the Plugins page's Browse Marketplace (primary) and Upload
   * plugin. Display-only, like the create button.
   */
  readonly leadingActions?: readonly ListPageAction[];
  /** Resource items to display, fed by fixture data — no backend lookup. */
  readonly items: readonly SearchResult[];
  /**
   * Render the Apply-YAML icon button beside the create button, as the
   * console's agents page does (the skills page doesn't).
   */
  readonly showApplyYaml?: boolean;
  /** When true, the create button pulses to draw attention. */
  readonly highlightCreate?: boolean;
  /** When true, a brief flash highlights the last item (the one just added). */
  readonly showNewItem?: boolean;
}

/** One inert header button: its label, its icon, and whether it is the primary one. */
export interface ListPageAction {
  readonly label: string;
  readonly icon: ReactNode;
  readonly primary?: boolean;
}

/**
 * Generic Library resource page for tours, at the console's own
 * composition: the real `ResourceWorkbench` (toolbar with search, view
 * switcher, and header action; card grid; the console's default card
 * layout) fed by a fixture `listFn` — the SessionView mechanism applied to
 * the Library zone (stigmer/stigmer#317). Shared by the skill-creation
 * and MCP-server-creation tours.
 *
 * What stays demo-owned: the page framing the console's `LibraryLayout`
 * and per-resource list pages hand out (breadcrumb, `h1` + subtitle —
 * ~15 lines of client-app markup transcribed in plain CSS), the create
 * button (the real one is the host's routing `Link` or button; the demo's
 * is an inert twin carrying the cursor target and pulse), inert twins of
 * any buttons beside it, and the new-item flash. Two deliberate
 * determinism departures from the console's wiring,
 * both seams the workbench exposes for exactly this host class: no
 * `viewModeStorageKey` (persisted view mode would make replays
 * reader-dependent) and a resolved-fixture `listFn` (no backend).
 */
export function ResourceListPage({
  title,
  nounPlural,
  createLabel,
  cursorTarget,
  subtitle,
  createIcon,
  createSecondary,
  leadingActions,
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
          {subtitle ?? `Browse and manage ${nounPlural} in your organization.`}
        </p>
      </div>

      <div className="resource-page__items">
        <ResourceWorkbench
          listFn={listFn}
          org={DEMO_ORG}
          defaultViewMode="cards"
          viewModes={["table", "cards"]}
          searchPlaceholder={`Search ${nounPlural}\u2026`}
          headerAction={
            <div className="resource-page__actions">
              {leadingActions?.map((action) => (
                <span
                  key={action.label}
                  className={
                    action.primary
                      ? "resource-page__create"
                      : "resource-page__create resource-page__create--secondary"
                  }
                >
                  {action.icon}
                  {action.label}
                </span>
              ))}
              {showApplyYaml && (
                <span className="resource-page__apply-yaml" aria-label="Apply YAML">
                  <Upload size={14} />
                </span>
              )}
              <span
                className="resource-page__create-wrap"
                data-cursor-target={cursorTarget}
              >
                <span
                  className={
                    createSecondary
                      ? "resource-page__create resource-page__create--secondary"
                      : "resource-page__create"
                  }
                >
                  {createIcon ?? (
                    <Plus size={14} className="resource-page__create-icon" />
                  )}
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
