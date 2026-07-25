import type { ReactNode } from "react";
import {
  AdminListPage,
  BrowserView,
  CodeEditorView,
  type FileTreeEntry,
  LoginCardPage,
  StatusBadge,
  TerminalView,
} from "@scenar/react";
import type { MultiTenantSetupStep } from "./steps";
import {
  CREATE_ORG_CODE,
  LOOKUP_ORG_CODE,
  PROVISION_GRANT_CODE,
  ORG_CREATED_OUTPUT,
  USER_ONBOARDED_OUTPUT,
} from "./steps";

// BrowserView shells render slightly below 1.0 so the mockup sits comfortably
// in the docs column (ported from the in-repo demo's DEMO_BROWSER_ZOOM).
const BROWSER_ZOOM = 0.9;

// ---------------------------------------------------------------------------
// File tree (CodeEditorView sidebar)
// ---------------------------------------------------------------------------

const FILE_TREE: FileTreeEntry[] = [
  { name: "src", type: "folder", depth: 0 },
  { name: "tenants", type: "folder", depth: 1 },
  { name: "onboard-tenant.ts", type: "file", depth: 2 },
  { name: "onboard-tenant-user.ts", type: "file", depth: 2 },
  { name: "federation", type: "folder", depth: 1 },
  { name: "register-idp.ts", type: "file", depth: 2 },
  { name: "package.json", type: "file", depth: 0 },
];

// ---------------------------------------------------------------------------
// Step renderer — pure (data) -> ReactNode. The player, cursor, narration, and
// viewport are provided by the packed embed entry.
// ---------------------------------------------------------------------------

export function renderStep(data: MultiTenantSetupStep): ReactNode {
  switch (data.view) {
    case "tenant-signup":
      return (
        <BrowserView url="acme.cloud/admin/tenants" contentKey="admin" zoom={BROWSER_ZOOM}>
          <AdminListPage
            appName="Acme Cloud"
            breadcrumbs={["Tenants"]}
            title="Tenant Organizations"
            ctaLabel="Create tenant"
            ctaTargetId="create-tenant-btn"
            columns={[
              { key: "name", label: "Name" },
              { key: "id", label: "External ID" },
              { key: "status", label: "Status", align: "right" },
            ]}
            rows={[
              {
                id: "alpha",
                cells: {
                  name: "Tenant Alpha",
                  id: "acme-tenant-alpha-id",
                  status: <StatusBadge label="Provisioning..." variant="warning" />,
                },
              },
              {
                id: "globex",
                cells: {
                  name: "Globex Corp",
                  id: "acme-globex-corp-id",
                  status: <StatusBadge label="Active" variant="success" />,
                },
              },
              {
                id: "initech",
                cells: {
                  name: "Initech",
                  id: "acme-initech-id",
                  status: <StatusBadge label="Active" variant="success" />,
                },
              },
            ]}
          />
        </BrowserView>
      );

    case "code-create-org":
      return (
        <CodeEditorView
          filename="onboard-tenant.ts"
          lines={CREATE_ORG_CODE}
          highlightLines={[5, 6, 7, 8, 9, 10, 11]}
          fileTree={FILE_TREE}
          contentKey="create-org"
        />
      );

    case "terminal-org-created":
      return (
        <TerminalView
          title="Terminal — zsh"
          lines={ORG_CREATED_OUTPUT}
          contentKey="org-created"
        />
      );

    case "user-signup":
      return (
        <BrowserView url="tenant-alpha.acme.cloud/signup" contentKey="signup" zoom={BROWSER_ZOOM}>
          <LoginCardPage
            appName="Tenant Alpha"
            subtitle="Create your account"
            fields={[
              { label: "Name", value: "Jane Doe" },
              { label: "Email", value: "jane@acme.com" },
            ]}
            submitLabel="Create account"
            submitTargetId="signup-btn"
          />
        </BrowserView>
      );

    case "code-lookup-org":
      return (
        <CodeEditorView
          filename="onboard-tenant-user.ts"
          lines={LOOKUP_ORG_CODE}
          highlightLines={[1, 2, 3, 4, 5, 6, 7]}
          fileTree={FILE_TREE}
          contentKey="lookup"
        />
      );

    case "code-provision-grant":
      return (
        <CodeEditorView
          filename="onboard-tenant-user.ts"
          lines={PROVISION_GRANT_CODE}
          highlightLines={[1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14]}
          fileTree={FILE_TREE}
          contentKey="provision-grant"
          slideDirection="forward"
        />
      );

    case "terminal-user-onboarded":
      return (
        <TerminalView
          title="Terminal — zsh"
          lines={USER_ONBOARDED_OUTPUT}
          contentKey="user-onboarded"
        />
      );
  }
}
