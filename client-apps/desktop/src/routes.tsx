import { lazy, Suspense } from "react";
import {
  createHashRouter,
  Navigate,
  type RouteObject,
} from "react-router-dom";
import {
  ApiKeysSection,
  ChannelAppsSection,
  EnvironmentsSection,
  IdentityProvidersSection,
  InvitationsSection,
  MembersSection,
  OAuthAppsSection,
  OrgProfileSection,
  PlatformClientsSection,
  UsageSection,
} from "@stigmer/react";
import { AppShell } from "./shell/AppShell";
import { SessionLauncher } from "./pages/SessionLauncher";

const SessionPage = lazy(() => import("./pages/SessionPage"));
const LibraryLayout = lazy(() => import("./pages/library/LibraryLayout"));
const LibraryLanding = lazy(() => import("./pages/library/LibraryLanding"));
const AgentListPage = lazy(() => import("./pages/library/AgentListPage"));
const AgentDetailPage = lazy(() => import("./pages/library/AgentDetailPage"));
const SkillListPage = lazy(() => import("./pages/library/SkillListPage"));
const SkillDetailPage = lazy(() => import("./pages/library/SkillDetailPage"));
const McpServerListPage = lazy(() => import("./pages/library/McpServerListPage"));
const McpServerDetailPage = lazy(() => import("./pages/library/McpServerDetailPage"));
const AgentNewPage = lazy(() => import("./pages/library/AgentNewPage"));
const SkillNewPage = lazy(() => import("./pages/library/SkillNewPage"));
const McpServerNewPage = lazy(() => import("./pages/library/McpServerNewPage"));
const DashboardPage = lazy(() => import("./pages/dashboard/DashboardPage"));
const WorkflowListPage = lazy(() => import("./pages/workflow/WorkflowListPage"));
const WorkflowNewPage = lazy(() => import("./pages/workflow/WorkflowNewPage"));
const WorkflowDetailPage = lazy(() => import("./pages/workflow/WorkflowDetailPage"));
const WorkflowExecutionListPage = lazy(() => import("./pages/workflow/WorkflowExecutionListPage"));
const WorkflowExecutionDetailPage = lazy(() => import("./pages/workflow/WorkflowExecutionDetailPage"));
const SettingsLayout = lazy(() => import("./pages/settings/SettingsLayout"));
const SettingsLanding = lazy(() => import("./pages/settings/SettingsLanding"));
const BillingPage = lazy(() => import("./pages/settings/BillingPage"));
const PricingGovernancePage = lazy(() => import("./pages/settings/PricingGovernancePage"));
const CursorAccountsPage = lazy(() => import("./pages/settings/CursorAccountsPage"));

function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <SessionLauncher />,
      },
      {
        path: "sessions/:id",
        element: (
          <LazyPage>
            <SessionPage />
          </LazyPage>
        ),
      },
      {
        path: "dashboard",
        element: (
          <LazyPage>
            <DashboardPage />
          </LazyPage>
        ),
      },
      {
        path: "library",
        element: (
          <LazyPage>
            <LibraryLayout />
          </LazyPage>
        ),
        children: [
          {
            index: true,
            element: (
              <LazyPage>
                <LibraryLanding />
              </LazyPage>
            ),
          },
          {
            path: "agents",
            element: (
              <LazyPage>
                <AgentListPage />
              </LazyPage>
            ),
          },
          {
            path: "agents/new",
            element: (
              <LazyPage>
                <AgentNewPage />
              </LazyPage>
            ),
          },
          {
            path: "agents/:org/:slug",
            element: (
              <LazyPage>
                <AgentDetailPage />
              </LazyPage>
            ),
          },
          {
            path: "skills",
            element: (
              <LazyPage>
                <SkillListPage />
              </LazyPage>
            ),
          },
          {
            path: "skills/new",
            element: (
              <LazyPage>
                <SkillNewPage />
              </LazyPage>
            ),
          },
          {
            path: "skills/:org/:slug",
            element: (
              <LazyPage>
                <SkillDetailPage />
              </LazyPage>
            ),
          },
          {
            path: "mcp-servers",
            element: (
              <LazyPage>
                <McpServerListPage />
              </LazyPage>
            ),
          },
          {
            path: "mcp-servers/new",
            element: (
              <LazyPage>
                <McpServerNewPage />
              </LazyPage>
            ),
          },
          {
            path: "mcp-servers/:org/:slug",
            element: (
              <LazyPage>
                <McpServerDetailPage />
              </LazyPage>
            ),
          },
          {
            path: "workflows",
            element: (
              <LazyPage>
                <WorkflowListPage />
              </LazyPage>
            ),
          },
          {
            path: "workflows/new",
            element: (
              <LazyPage>
                <WorkflowNewPage />
              </LazyPage>
            ),
          },
          {
            path: "workflows/:org/:slug",
            element: (
              <LazyPage>
                <WorkflowDetailPage />
              </LazyPage>
            ),
          },
          {
            path: "workflows/executions",
            element: (
              <LazyPage>
                <WorkflowExecutionListPage />
              </LazyPage>
            ),
          },
        ],
      },
      {
        path: "executions/:id",
        element: (
          <LazyPage>
            <WorkflowExecutionDetailPage />
          </LazyPage>
        ),
      },
      {
        path: "workflows",
        element: <Navigate to="/library/workflows" replace />,
      },
      {
        path: "settings",
        children: [
          {
            element: (
              <LazyPage>
                <SettingsLayout />
              </LazyPage>
            ),
            children: [
              {
                index: true,
                element: (
                  <LazyPage>
                    <SettingsLanding />
                  </LazyPage>
                ),
              },
              { path: "api-keys", element: <ApiKeysSection /> },
              { path: "environments", element: <EnvironmentsSection /> },
              { path: "members", element: <MembersSection /> },
              { path: "org-profile", element: <OrgProfileSection /> },
              { path: "invitations", element: <InvitationsSection /> },
              { path: "identity-providers", element: <IdentityProvidersSection /> },
              { path: "platform-clients", element: <PlatformClientsSection /> },
              { path: "oauth-apps", element: <OAuthAppsSection /> },
              { path: "channel-apps", element: <ChannelAppsSection /> },
              { path: "usage", element: <UsageSection /> },
              {
                path: "billing",
                element: (
                  <LazyPage>
                    <BillingPage />
                  </LazyPage>
                ),
              },
              {
                path: "pricing-governance",
                element: (
                  <LazyPage>
                    <PricingGovernancePage />
                  </LazyPage>
                ),
              },
              {
                path: "cursor-accounts",
                element: (
                  <LazyPage>
                    <CursorAccountsPage />
                  </LazyPage>
                ),
              },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createHashRouter(routes);

const ROUTE_STORAGE_KEY = "stigmer:lastRoute";

router.subscribe((state) => {
  const path = state.location.pathname;
  if (path && path !== "/") {
    localStorage.setItem(ROUTE_STORAGE_KEY, path);
  }
});

const savedRoute = localStorage.getItem(ROUTE_STORAGE_KEY);
if (savedRoute && savedRoute !== "/") {
  router.navigate(savedRoute, { replace: true });
}
