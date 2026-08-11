"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getUserMessage } from "@stigmer/sdk";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment.js";
import { EnvironmentVariableEditor } from "../environment/EnvironmentVariableEditor.js";
import { EnvironmentListPanel } from "../environment/EnvironmentListPanel.js";
import { CreateEnvironmentForm } from "../environment/CreateEnvironmentForm.js";
import { useActiveOrgSlug } from "../organization/OrgProvider.js";

const ENV_EXCLUDE_LABELS: Record<string, string>[] = [
  { "stigmer.ai/personal": "true" },
  { "stigmer.ai/managed": "true" },
];

/** Settings section for personal and organization environment variables. */
export function EnvironmentsSection() {
  const org = useActiveOrgSlug();

  return (
    <div className="stg:space-y-10">
      <PersonalEnvironmentCard org={org} />
      <EnvironmentsCard org={org} />
    </div>
  );
}

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
    bootstrapAttempted.current = false;
  }, [org]);

  useEffect(() => {
    if (!org || isLoading || environment || bootstrapAttempted.current) return;
    bootstrapAttempted.current = true;
    getOrCreate().catch(() => {});
  }, [org, isLoading, environment, getOrCreate]);

  const environmentId = environment?.metadata?.id;

  return (
    <section aria-labelledby="personal-env-heading">
      <div className="stg:mb-3 stg:flex stg:items-baseline stg:gap-2">
        <h2
          id="personal-env-heading"
          className="stg:text-foreground stg:text-sm stg:font-semibold"
        >
          Personal Environment
        </h2>
        <span className="stg:bg-primary-subtle stg:text-primary stg:rounded-full stg:px-2 stg:py-0.5 stg:text-[0.6rem] stg:font-medium stg:uppercase stg:tracking-wider">
          You
        </span>
      </div>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Your private secrets and configuration, automatically managed for you.
        Only visible to you — used when running agents that require your
        personal credentials.
      </p>

      {isLoading || isMutating ? (
        <SkeletonRows count={3} />
      ) : error ? (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(error)}
        </p>
      ) : environmentId ? (
        <EnvironmentVariableEditor environmentId={environmentId} />
      ) : (
        <p className="stg:text-muted-foreground stg:text-xs">
          Your personal environment will be created automatically when needed.
        </p>
      )}
    </section>
  );
}

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
      <div className="stg:mb-3 stg:flex stg:items-center stg:justify-between">
        <h2
          id="org-env-heading"
          className="stg:text-foreground stg:text-sm stg:font-semibold"
        >
          Environments
        </h2>

        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="stg:text-primary stg:hover:text-foreground stg:text-xs stg:font-medium stg:transition-colors"
          >
            + New environment
          </button>
        )}
      </div>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Named environments for your organization. Store credentials, API tokens,
        and configuration that agents need at runtime.
      </p>

      {showCreate && (
        <div className="stg:border-border stg:bg-card stg:mb-4 stg:rounded-lg stg:border stg:p-4">
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
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to view environments.
        </p>
      )}
    </section>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="stg:space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="stg:bg-muted-subtle stg:h-8 stg:animate-pulse stg:rounded"
          style={{ width: `${85 - i * 10}%` }}
        />
      ))}
    </div>
  );
}
