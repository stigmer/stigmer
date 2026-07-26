import { ApiKeyCreatedAlert } from "@stigmer/react";
import { DEMO_CONTENT_ZOOM } from "../_shared/fixtures";
import "./ApiKeysPage.css";

const noop = () => {};

interface ApiKeysPageProps {
  /** Name of the just-created key, shown in the reveal alert. */
  readonly keyName: string;
  /** The one-time raw key value the reveal alert displays. */
  readonly rawKey: string;
}

/**
 * The console's API Keys page in the *reveal* state — the moment right
 * after a key is created, rendered inside `ManagementShell`'s content area.
 *
 * Depicts `ApiKeysSection` (sdk/react/src/settings/) faithfully for that
 * state: the heading, the identity-scope description, and the real
 * `ApiKeyCreatedAlert`. Deliberately **no** "+ New API key" button — the
 * shipped component hides it while the alert is showing (`flow.phase !==
 * "idle"`), so a button here would depict a screen the product never
 * renders (DD-004). The button belongs to the idle-state beats of the
 * future `api-key-setup` tour.
 *
 * The alert sits inside `inert`: it has a real Copy button (with a
 * clipboard side effect) and a dismiss control a viewer must not be able
 * to click mid-playback (DD-006). Chrome is plain CSS on `--stgm-*` tokens
 * (DD-003); the alert keeps its own compiled styles.
 */
export function ApiKeysPage({ keyName, rawKey }: ApiKeysPageProps) {
  return (
    <div className="sx-apikeys" style={{ zoom: DEMO_CONTENT_ZOOM }}>
      <section aria-labelledby="sx-apikeys-heading">
        <h2 id="sx-apikeys-heading" className="sx-apikeys__heading">
          API Keys
        </h2>
        <p className="sx-apikeys__desc">
          API keys authenticate CLI sessions and programmatic access to the
          Stigmer API. Keys are scoped to your identity and work across all
          your organizations.
        </p>
        <div inert>
          <ApiKeyCreatedAlert
            rawKey={rawKey}
            keyName={keyName}
            onDismiss={noop}
          />
        </div>
      </section>
    </div>
  );
}
