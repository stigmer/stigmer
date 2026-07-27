import type { CSSProperties, ReactNode } from "react";
import { DatastoreDetailView } from "@stigmer/react";
import { BrowserView } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";
import { DEMO_SLUG, type DatastoreRecordsTourStep } from "./steps";

/** The console's address as the depicted browser shows it. */
const CONSOLE_URL = "app.stigmer.ai";

/**
 * The library zone's page scroll pane and content column, at the console's
 * own geometry (`LibraryLayout`: `mx-auto max-w-4xl px-6 py-8`). No zoom —
 * the shell lays out at real size (one scale factor per frame).
 */
const DETAIL_PAGE: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  background: "var(--stgm-background)",
};
const DETAIL_CONTENT: CSSProperties = {
  margin: "0 auto",
  maxWidth: 896,
  padding: "32px 24px",
};

const noop = () => {};

/**
 * Pure `renderStep`: the real `DatastoreDetailView` in a browser window at
 * the datastore's console route, tab pinned from step data via the view's
 * controlled `activeTab` prop. Wrapped `inert` (the connect-tools
 * precedent): the browser renders real tab, filter, and write affordances a
 * viewer must not drive mid-playback.
 */
export function renderStep(data: DatastoreRecordsTourStep): ReactNode {
  switch (data.view) {
    case "datastore":
      return (
        <BrowserView
          url={`${CONSOLE_URL}/library/datastores/${DEMO_SLUG}`}
          contentKey={data.tab}
        >
          <div style={DETAIL_PAGE} inert>
            <div style={DETAIL_CONTENT}>
              <DatastoreDetailView
                org={DEMO_ORG}
                slug={DEMO_SLUG}
                activeTab={data.tab}
                onTabChange={noop}
              />
              {/* Tour-owned scroll anchor: the constraints beat's `scroll_to`
                  brings the Overview schema's tail — where the unique
                  constraint and its message render — into frame. Anchoring
                  after the view keeps the SDK's internals untagged. */}
              {data.tab === "overview" && <div data-scroll-target="schema-foot" />}
            </div>
          </div>
        </BrowserView>
      );
  }
}
