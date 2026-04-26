import { lazy, Suspense } from "react";
import {
  createHashRouter,
  type RouteObject,
} from "react-router-dom";
import {
  ApiKeysSection,
  EnvironmentsSection,
  IdentityProvidersSection,
  InvitationsSection,
  MembersSection,
  OAuthAppsSection,
  OrgProfileSection,
  PlatformClientsSection,
  UsageSection,
} from "@stigmer/react";
import { CreditCard } from "lucide-react";
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
const SettingsLayout = lazy(() => import("./pages/settings/SettingsLayout"));
const SettingsLanding = lazy(() => import("./pages/settings/SettingsLanding"));
const SettingsRunners = lazy(() => import("./pages/settings/SettingsRunners"));

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
            path: "mcp-servers/:org/:slug",
            element: (
              <LazyPage>
                <McpServerDetailPage />
              </LazyPage>
            ),
          },
        ],
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
              { path: "usage", element: <UsageSection /> },
              {
                path: "billing",
                element: (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <CreditCard className="mb-4 size-10 text-muted-foreground" />
                    <h2 className="mb-2 text-lg font-semibold text-foreground">Billing</h2>
                    <p className="text-sm text-muted-foreground">This feature is coming soon.</p>
                  </div>
                ),
              },
            ],
          },
          {
            path: "runners",
            element: (
              <LazyPage>
                <SettingsRunners />
              </LazyPage>
            ),
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
