"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  usePersonalEnvironment,
  EnvironmentVariableEditor,
  EnvironmentListPanel,
  CreateEnvironmentForm,
} from "@stigmer/react";
import { getUserMessage } from "@stigmer/sdk";
import { useActiveOrgSlug } from "@/domain/_shared/org/org-context";

const ENV_EXCLUDE_LABELS: Record<string, string>[] = [
  { "stigmer.ai/personal": "true" },
  { "stigmer.ai/managed": "true" },
];

export function EnvironmentsSection() {
  const org = useActiveOrgSlug();

  return (
    <div className="space-y-10">
      <PersonalEnvironmentCard org={org} />
      <EnvironmentsCard org={org} />
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

  // Reset the bootstrap guard when the org changes so auto-create
  // can fire for the new organization. Declared before the bootstrap
  // effect so React executes the reset first (effects run in order).
  useEffect(() => {
    bootstrapAttempted.current = false;
  }, [org]);

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
        <span className="bg-primary-subtle text-primary rounded-full px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wider">
          You
        </span>
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
        Your private secrets and configuration, automatically managed for you.
        Only visible to you — used when running agents that require your
        personal credentials.
      </p>

      {isLoading || isMutating ? (
        <SkeletonRows count={3} />
      ) : error ? (
        <p className="text-destructive text-xs" role="alert">
          {getUserMessage(error)}
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
// Environments
// ---------------------------------------------------------------------------

function EnvironmentsCard({ org }: { org: string }) {
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
          Environments
        </h2>

        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="text-primary hover:text-foreground text-xs font-medium transition-colors"
          >
            + New environment
          </button>
        )}
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
        Named environments for your organization. Store credentials, API tokens,
        and configuration that agents need at runtime.
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
          excludeLabels={ENV_EXCLUDE_LABELS}
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
          className="bg-muted-subtle h-8 animate-pulse rounded"
          style={{ width: `${85 - i * 10}%` }}
        />
      ))}
    </div>
  );
}
