// The agents page's Agent (docs/concepts/agents.mdx), as its owner sees its
// page in the console: the page says each section of the detail page is one
// of the YAML fields it prints, so the scene draws that very Agent
// (docs-fixtures.ts), framed and answered as the gallery's own agent page
// is (agent.tsx).
import { AgentDetailView } from "@stigmer/react-sdk";
import { VARIANCE_REPORTER, VARIANCE_REPORTER_VERSIONS } from "../docs-fixtures.ts";
import { ORGANIZATION } from "../fixtures.ts";
import { agentRoutes, MENU, START_SESSION } from "./agent.tsx";
import type { Drawing } from "./drawing.ts";

/** The variance reporter's page, as its owner sees it in the console. */
export function varianceReporterScene(): Drawing {
  return {
    inOrganization: true,
    routes: agentRoutes("owner", { agent: VARIANCE_REPORTER, versions: VARIANCE_REPORTER_VERSIONS }),
    render: () => (
      <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <AgentDetailView
          org={ORGANIZATION.metadata?.slug ?? ""}
          slug={VARIANCE_REPORTER.metadata?.slug ?? ""}
          editable
          primaryAction={START_SESSION}
          actions={MENU}
        />
      </div>
    ),
  };
}
