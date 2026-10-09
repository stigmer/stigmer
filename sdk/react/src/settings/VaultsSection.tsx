"use client";

/**
 * The Vaults settings page: the caller's own My vault, and the
 * organization's shared vaults.
 *
 * My vault holds a person's own logins and secrets; a chat that includes
 * it uses it for that person's own messages, a chat with an agent of
 * another organization never does, and nobody else's run ever does, an
 * admin's included. It is
 * created by the server on the first save, so the page never creates it.
 * A login a sign-in saved can be renewed from here ("Sign in again", a new
 * sign-in at the same address); a new sign-in starts from the tool's own
 * page, and lands here.
 *
 * Shared vaults belong to the organization: its admins create them and say
 * who may use them (every member through organization visibility, or chosen
 * people and Teams where the edition grants roles on one resource).
 */
import { useCallback, useId, useRef, useState } from "react";
import { getUserMessage } from "@stigmer/sdk";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { useVaultSignIn } from "../vault/useVaultSignIn.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { CreateVaultForm } from "../vault/CreateVaultForm.js";
import { QUIET_BUTTON_CLASS } from "../vault/styles.js";
import { useMyVault } from "../vault/useMyVault.js";
import { VaultEntriesEditor } from "../vault/VaultEntriesEditor.js";
import { VaultListPanel } from "../vault/VaultListPanel.js";

/** Settings section for My vault and the organization's shared vaults. */
export function VaultsSection() {
  const org = useActiveOrgId();

  return (
    <div className="stg:space-y-10">
      <MyVaultCard org={org} />
      <SharedVaultsCard org={org} />
    </div>
  );
}

function MyVaultCard({ org }: { org: string }) {
  const myVault = useMyVault(org || null);
  const oauth = useVaultSignIn();
  const headingId = useId();
  const { signIn } = oauth;

  const signInAgain = useCallback(
    // Offered only on a login My vault holds, so an organization is known.
    (address: string) => {
      signIn(address, { org }).then(myVault.refetch, () => {});
    },
    [signIn, org, myVault.refetch],
  );

  return (
    <section aria-labelledby={headingId}>
      <div className="stg:mb-3 stg:flex stg:items-baseline stg:gap-2">
        <h2 id={headingId} className="stg:text-foreground stg:text-sm stg:font-semibold">
          My vault
        </h2>
        <span className="stg:bg-primary-subtle stg:text-primary stg:rounded-full stg:px-2 stg:py-0.5 stg:text-[0.6rem] stg:font-medium stg:uppercase stg:tracking-wider">
          You
        </span>
      </div>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Your own logins and secrets. A chat that includes My vault uses them
        for the messages you send, never a teammate&apos;s, and a chat with
        an agent of another organization never does. Saved values can be
        replaced but are never shown again.
      </p>

      {myVault.isLoading ? (
        <LoadingRegion className="stg:space-y-2" label="Loading">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="stg:bg-muted-subtle stg:h-8 stg:animate-pulse stg:rounded" style={{ width: `${85 - i * 10}%` }} />
          ))}
        </LoadingRegion>
      ) : myVault.error && !myVault.vault ? (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(myVault.error)}
        </p>
      ) : (
        <VaultEntriesEditor
          vault={myVault.vault}
          onSetSecrets={myVault.setSecrets}
          onRemoveSecrets={myVault.removeSecrets}
          onSetConnection={myVault.setConnection}
          onRemoveConnections={myVault.removeConnections}
          isMutating={myVault.isMutating || oauth.isInProgress}
          connectionAction={(address, connection) =>
            connection.source === VaultConnectionSource.sign_in ? (
              <button
                type="button"
                disabled={oauth.isInProgress}
                onClick={() => signInAgain(address)}
                className={QUIET_BUTTON_CLASS}
              >
                Sign in again
              </button>
            ) : null
          }
        />
      )}
      {oauth.error && (
        <p className="stg:text-destructive stg:mt-2 stg:text-xs" role="alert">
          {getUserMessage(oauth.error)}
        </p>
      )}
    </section>
  );
}

function SharedVaultsCard({ org }: { org: string }) {
  const [showCreate, setShowCreate] = useState(false);
  const listRefetchRef = useRef<(() => void) | null>(null);
  const headingId = useId();

  const handleRefetchRef = useCallback((refetch: () => void) => {
    listRefetchRef.current = refetch;
  }, []);

  const handleCreated = useCallback(() => {
    setShowCreate(false);
    listRefetchRef.current?.();
  }, []);

  return (
    <section aria-labelledby={headingId}>
      <div className="stg:mb-3 stg:flex stg:items-center stg:justify-between">
        <h2 id={headingId} className="stg:text-foreground stg:text-sm stg:font-semibold">
          Shared vaults
        </h2>
        {!showCreate && org && (
          <PermissionGate resource={{ kind: "organization", id: org }} relation="can_create_shared_vault">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="stg:text-primary stg:hover:text-foreground stg:text-xs stg:font-medium stg:transition-colors"
            >
              + New shared vault
            </button>
          </PermissionGate>
        )}
      </div>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Your organization&apos;s team keys. Admins create them and choose who
        may use them; an agent, a schedule, a share link or a channel can name
        one so its runs use it.
      </p>

      {showCreate && (
        <div className="stg:border-border stg:bg-card stg:mb-4 stg:rounded-lg stg:border stg:p-4">
          <CreateVaultForm org={org} onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
        </div>
      )}

      {org ? (
        <VaultListPanel org={org} onRefetchRef={handleRefetchRef} />
      ) : (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to view vaults.
        </p>
      )}
    </section>
  );
}
