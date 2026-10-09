import { lazy, Suspense } from "react";
import {
  createHashRouter,
  matchRoutes,
  type RouteObject,
} from "react-router-dom";
import {
  AccountPreferencesSection,
  ApiKeysSection,
  ChannelAppsSection,
  VaultsSection,
  IdentityProvidersSection,
  InvitationsSection,
  MembersSection,
  MemorySection,
  OAuthAppsSection,
  OrgPreferencesSection,
  OrgProfileSection,
  PlatformClientsSection,
  TeamsSection,
  UsageSection,
  ProviderKeysSection,
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
const ScheduleListPage = lazy(() => import("./pages/library/ScheduleListPage"));
const ScheduleDetailPage = lazy(() => import("./pages/library/ScheduleDetailPage"));
const AgentNewPage = lazy(() => import("./pages/library/AgentNewPage"));
const SkillNewPage = lazy(() => import("./pages/library/SkillNewPage"));
const McpServerNewPage = lazy(() => import("./pages/library/McpServerNewPage"));
const ScheduleNewPage = lazy(() => import("./pages/library/ScheduleNewPage"));
const PluginListPage = lazy(() => import("./pages/library/PluginListPage"));
const PluginDetailPage = lazy(() => import("./pages/library/PluginDetailPage"));
const PluginUploadPage = lazy(() => import("./pages/library/PluginUploadPage"));
const MarketplacePage = lazy(() => import("./pages/marketplace/MarketplacePage"));
const DashboardPage = lazy(() => import("./pages/dashboard/DashboardPage"));
const ConversationsPage = lazy(() => import("./pages/conversations/ConversationsPage"));
const RunPage = lazy(() => import("./pages/runs/RunPage"));
const SettingsLayout = lazy(() => import("./pages/settings/SettingsLayout"));
const SettingsLanding = lazy(() => import("./pages/settings/SettingsLanding"));
const BillingPage = lazy(() => import("./pages/settings/BillingPage"));
const PricingGovernancePage = lazy(() => import("./pages/settings/PricingGovernancePage"));
const CursorAccountsPage = lazy(() => import("./pages/settings/CursorAccountsPage"));
const ProviderStandingPage = lazy(() => import("./pages/settings/ProviderStandingPage"));
const LicensesPage = lazy(() => import("./pages/settings/LicensesPage"));
const PlansPage = lazy(() => import("./pages/settings/PlansPage"));

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
        path: "conversations",
        element: (
          <LazyPage>
            <ConversationsPage />
          </LazyPage>
        ),
      },
      {
        path: "marketplace",
        element: (
          <LazyPage>
            <MarketplacePage />
          </LazyPage>
        ),
      },
      {
        path: "conversations/:channelId/:key",
        element: (
          <LazyPage>
            <ConversationsPage />
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
            path: "plugins",
            element: (
              <LazyPage>
                <PluginListPage />
              </LazyPage>
            ),
          },
          {
            path: "plugins/upload",
            element: (
              <LazyPage>
                <PluginUploadPage />
              </LazyPage>
            ),
          },
          {
            path: "plugins/:org/:slug",
            element: (
              <LazyPage>
                <PluginDetailPage />
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
            path: "schedules",
            element: (
              <LazyPage>
                <ScheduleListPage />
              </LazyPage>
            ),
          },
          {
            path: "schedules/new",
            element: (
              <LazyPage>
                <ScheduleNewPage />
              </LazyPage>
            ),
          },
          {
            path: "schedules/:org/:slug",
            element: (
              <LazyPage>
                <ScheduleDetailPage />
              </LazyPage>
            ),
          },
        ],
      },
      {
        path: "runs/:id",
        element: (
          <LazyPage>
            <RunPage />
          </LazyPage>
        ),
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
              { path: "vaults", element: <VaultsSection /> },
              { path: "members", element: <MembersSection /> },
              { path: "teams", element: <TeamsSection /> },
              { path: "org-profile", element: <OrgProfileSection /> },
              { path: "org-preferences", element: <OrgPreferencesSection /> },
              {
                path: "account-preferences",
                element: <AccountPreferencesSection />,
              },
              { path: "memory", element: <MemorySection /> },
              { path: "invitations", element: <InvitationsSection /> },
              { path: "identity-providers", element: <IdentityProvidersSection /> },
              { path: "platform-clients", element: <PlatformClientsSection /> },
              { path: "oauth-apps", element: <OAuthAppsSection /> },
              { path: "channel-apps", element: <ChannelAppsSection /> },
              { path: "usage", element: <UsageSection /> },
              { path: "provider-keys", element: <ProviderKeysSection /> },
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
              {
                path: "provider-standing",
                element: (
                  <LazyPage>
                    <ProviderStandingPage />
                  </LazyPage>
                ),
              },
              {
                path: "licenses",
                element: (
                  <LazyPage>
                    <LicensesPage />
                  </LazyPage>
                ),
              },
              {
                path: "plans",
                element: (
                  <LazyPage>
                    <PlansPage />
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

/**
 * The saved route to reopen at launch, when it still names a screen. A
 * path the app no longer routes (a screen removed or moved, such as a run's
 * page before runs lived at /runs) opens the home screen instead of a page
 * with no way out.
 */
export function restorableRoute(saved: string | null): string | undefined {
  if (!saved || saved === "/") return undefined;
  return matchRoutes(routes, saved) === null ? undefined : saved;
}

const savedRoute = restorableRoute(localStorage.getItem(ROUTE_STORAGE_KEY));
if (savedRoute !== undefined) {
  router.navigate(savedRoute, { replace: true });
}
