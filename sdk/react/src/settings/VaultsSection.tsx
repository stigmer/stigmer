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
import { getUserMessage } from "@stigmer/client";
import { VaultConnectionSource } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import { PermissionGate } from "../grant/PermissionGate.js";
import { Button } from "../button/Button.js";
import { Card } from "../internal/surface/Card.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { useVaultSignIn } from "../vault/useVaultSignIn.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { CreateVaultForm } from "../vault/CreateVaultForm.js";
import { useMyVault } from "../vault/useMyVault.js";
import { VaultEntriesEditor } from "../vault/VaultEntriesEditor.js";
import { VaultListPanel } from "../vault/VaultListPanel.js";
import { NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";
import { SettingsSkeleton } from "./SettingsSkeleton.js";

/** Settings section for My vault and the organization's shared vaults. */
export function VaultsSection() {
  const org = useActiveOrgId();
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
    <SettingsPage
      title="Vaults"
      description="The logins and secrets your agents use: your own, in My vault, and your organization's, in shared vaults."
      actions={
        !showCreate &&
        org && (
          <PermissionGate resource={{ kind: "organization", id: org }} relation="can_create_shared_vault">
            <Button size="sm" onClick={() => setShowCreate(true)}>
              New shared vault
            </Button>
          </PermissionGate>
        )
      }
    >
      {!org ? (
        <NoOrganization what="its vaults" />
      ) : (
        <div className="stg:flex stg:flex-col stg:gap-8">
          <MyVaultCard org={org} />
          <SharedVaultsCard
            org={org}
            showCreate={showCreate}
            onCreated={handleCreated}
            onCancelCreate={() => setShowCreate(false)}
            onRefetchRef={handleRefetchRef}
          />
        </div>
      )}
    </SettingsPage>
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
    <section aria-labelledby={headingId} className="stg:flex stg:flex-col stg:gap-3">
      <div className="stg:flex stg:flex-col stg:gap-1">
        <div className="stg:flex stg:items-baseline stg:gap-2">
          <h3 id={headingId} className="stg:m-0 stg:text-foreground stg:text-sm stg:font-semibold">
            My vault
          </h3>
          <span className="stg:bg-primary-subtle stg:text-primary stg:rounded-full stg:px-2 stg:py-0.5 stg:text-2xs stg:font-medium stg:uppercase stg:tracking-wider">
            You
          </span>
        </div>
        <p className="stg:m-0 stg:text-muted-foreground stg:text-xs">
          Your own logins and secrets. A chat that includes My vault uses them for the messages you send, never a
          teammate&apos;s, and a chat with an agent of another organization never does. Saved values can be replaced but
          are never shown again.
        </p>
      </div>

      {myVault.isLoading ? (
        <SettingsSkeleton label="Loading My vault" rows={2} />
      ) : myVault.error && !myVault.vault ? (
        <ErrorMessage error={myVault.error} title="My vault could not be read" retry={myVault.refetch} />
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
              <Button variant="ghost" size="xs" disabled={oauth.isInProgress} onClick={() => signInAgain(address)}>
                Sign in again
              </Button>
            ) : null
          }
        />
      )}
      {oauth.error && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(oauth.error)}
        </p>
      )}
    </section>
  );
}

function SharedVaultsCard({
  org,
  showCreate,
  onCreated,
  onCancelCreate,
  onRefetchRef,
}: {
  readonly org: string;
  readonly showCreate: boolean;
  readonly onCreated: () => void;
  readonly onCancelCreate: () => void;
  readonly onRefetchRef: (refetch: () => void) => void;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="stg:flex stg:flex-col stg:gap-3">
      <div className="stg:flex stg:flex-col stg:gap-1">
        <h3 id={headingId} className="stg:m-0 stg:text-foreground stg:text-sm stg:font-semibold">
          Shared vaults
        </h3>
        <p className="stg:m-0 stg:text-muted-foreground stg:text-xs">
          Your organization&apos;s team keys. Admins create them and choose who may use them; a conversation, a routine
          or a channel can name one so its runs use it.
        </p>
      </div>

      {showCreate && (
        <Card>
          <CreateVaultForm org={org} onCreated={onCreated} onCancel={onCancelCreate} />
        </Card>
      )}

      <VaultListPanel org={org} onRefetchRef={onRefetchRef} />
    </section>
  );
}
