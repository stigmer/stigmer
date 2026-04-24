import { lazy, Suspense } from "react";
import {
  createHashRouter,
  type RouteObject,
} from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { SessionLauncher } from "./pages/SessionLauncher";

const SessionPage = lazy(() => import("./pages/SessionPage"));
const LibraryLanding = lazy(() => import("./pages/library/LibraryLanding"));
const AgentListPage = lazy(() => import("./pages/library/AgentListPage"));
const AgentDetailPage = lazy(() => import("./pages/library/AgentDetailPage"));
const SkillListPage = lazy(() => import("./pages/library/SkillListPage"));
const SkillDetailPage = lazy(() => import("./pages/library/SkillDetailPage"));
const McpServerListPage = lazy(() => import("./pages/library/McpServerListPage"));
const McpServerDetailPage = lazy(() => import("./pages/library/McpServerDetailPage"));
const SettingsRunners = lazy(() => import("./pages/settings/SettingsRunners"));
const SettingsApiKeys = lazy(() => import("./pages/settings/SettingsApiKeys"));
const SettingsEnvironments = lazy(() => import("./pages/settings/SettingsEnvironments"));
const SettingsMembers = lazy(() => import("./pages/settings/SettingsMembers"));
const SettingsOrgProfile = lazy(() => import("./pages/settings/SettingsOrgProfile"));

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
            path: "runners",
            element: (
              <LazyPage>
                <SettingsRunners />
              </LazyPage>
            ),
          },
          {
            path: "api-keys",
            element: (
              <LazyPage>
                <SettingsApiKeys />
              </LazyPage>
            ),
          },
          {
            path: "environments",
            element: (
              <LazyPage>
                <SettingsEnvironments />
              </LazyPage>
            ),
          },
          {
            path: "members",
            element: (
              <LazyPage>
                <SettingsMembers />
              </LazyPage>
            ),
          },
          {
            path: "org-profile",
            element: (
              <LazyPage>
                <SettingsOrgProfile />
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
