"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  usePersonalEnvironment,
  EnvironmentVariableEditor,
  EnvironmentListPanel,
  CreateEnvironmentForm,
} from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";

const PERSONAL_EXCLUDE_LABELS = { "stigmer.ai/personal": "true" } as const;

export function EnvironmentsSection() {
  const org = useActiveOrgSlug();

  return (
    <div className="space-y-10">
      <PersonalEnvironmentCard org={org} />
      <OrgEnvironmentsCard org={org} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Personal Environment
// ---------------------------------------------------------------------------

function PersonalEnvironmentCard({ org }: { org: string }) {
  const {
    environment,
    isLoading,
    error,
    getOrCreate,
    isMutating,
  } = usePersonalEnvironment(org || null);

  const bootstrapAttempted = useRef(false);

  useEffect(() => {
    if (!org || isLoading || environment || bootstrapAttempted.current) return;
    bootstrapAttempted.current = true;
    getOrCreate().catch(() => {
      // error state is surfaced via the hook's `error` field
    });
  }, [org, isLoading, environment, getOrCreate]);

  const environmentId = environment?.metadata?.id;

  return (
    <section aria-labelledby="personal-env-heading">
      <div className="mb-3 flex items-baseline gap-2">
        <h2
          id="personal-env-heading"
          className="text-foreground text-sm font-semibold"
        >
          Personal Environment
        </h2>
        <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wider">
          You
        </span>
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
        Your private secrets and configuration. These are only visible to you
        and are used when running agents that require credentials.
      </p>

      {isLoading || isMutating ? (
        <SkeletonRows count={3} />
      ) : error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : environmentId ? (
        <EnvironmentVariableEditor environmentId={environmentId} />
      ) : (
        <p className="text-muted-foreground text-xs">
          Your personal environment will be created automatically when needed.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Organization Environments
// ---------------------------------------------------------------------------

function OrgEnvironmentsCard({ org }: { org: string }) {
  const [showCreate, setShowCreate] = useState(false);
  const listRefetchRef = useRef<(() => void) | null>(null);

  const handleRefetchRef = useCallback((refetch: () => void) => {
    listRefetchRef.current = refetch;
  }, []);

  const handleCreated = useCallback(() => {
    setShowCreate(false);
    listRefetchRef.current?.();
  }, []);

  return (
    <section aria-labelledby="org-env-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="org-env-heading"
          className="text-foreground text-sm font-semibold"
        >
          Shared Environments
        </h2>

        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="text-primary hover:text-primary/80 text-xs font-medium transition-colors"
          >
            + New environment
          </button>
        )}
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
        Environments shared across your organization. Members with access can
        view and manage variables.
      </p>

      {showCreate && (
        <div className="border-border bg-card mb-4 rounded-lg border p-4">
          <CreateEnvironmentForm
            org={org}
            onCreated={handleCreated}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {org ? (
        <EnvironmentListPanel
          org={org}
          excludeLabels={PERSONAL_EXCLUDE_LABELS}
          onRefetchRef={handleRefetchRef}
        />
      ) : (
        <p className="text-muted-foreground py-4 text-center text-xs">
          Select an organization to view environments.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="bg-muted/40 h-8 animate-pulse rounded"
          style={{ width: `${85 - i * 10}%` }}
        />
      ))}
    </div>
  );
}
