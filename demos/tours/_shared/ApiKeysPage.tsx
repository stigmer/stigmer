import {
  ApiKeyCreatedAlert,
  ApiKeyListPanel,
  CreateApiKeyForm,
} from "@stigmer/react";
import { DEMO_NOW, DEMO_ORG } from "./fixtures";
import "./ApiKeysPage.css";

const noop = () => {};

/**
 * One settled state of the console's API Keys page, mirroring
 * `ApiKeysSection`'s own `FlowState` (sdk/react/src/settings/) so drift
 * between depiction and product is visible in a single diff. A closed
 * union rather than open props: a consumer picks a state the product
 * ships, it cannot compose a drifted variant.
 */
export type ApiKeysPageState =
  | { readonly phase: "idle" }
  | { readonly phase: "creating"; readonly initialName?: string }
  | {
      readonly phase: "reveal";
      readonly rawKey: string;
      readonly keyName: string;
    };

interface ApiKeysPageProps {
  /** Which settled state of the page to depict. */
  readonly state: ApiKeysPageState;
}

/**
 * The console's API Keys page, rendered inside `ManagementShell`'s content
 * area. Consumed by `quickstart-tour` (beat 0, reveal) and `api-key-setup`
 * (the whole creation flow).
 *
 * Depicts `ApiKeysSection` faithfully per phase:
 *
 * - **idle**: heading + "+ New API key" + description + key list. The
 *   create control is chrome, not the real button — the real one is a
 *   `useState` flip inside `ApiKeysSection`, unreachable without
 *   live-driving — but it copies the shipped rendering: plain
 *   text, `text-primary`, shown only in this phase.
 * - **creating**: the button hides (as shipped), the real
 *   `CreateApiKeyForm` renders in its bordered card above the list.
 *   `initialName` depicts the form mid-fill; the form is keyed on it so a
 *   step change remounts to the new settled state (the deterministic
 *   state-reset idiom — the input's text is internal `useState`).
 * - **reveal**: heading + description + the real `ApiKeyCreatedAlert`, and
 *   — one deliberate departure from the component's literal render — **no
 *   key list**. The shipped page would list the just-created key, but that
 *   row renders `formatShortDate(createdAt)` with no pinned locale (the
 *   rendered *format* varies per reader even though the frozen clock now
 *   pins the *instant* — the panel's `now` seam), so the depiction is
 *   alert-only, and both consumers depend on it staying so.
 *
 * Real components sit under `inert`: the form has a live submit path, the
 * alert a Copy button with a clipboard side effect, the list panel a fetch
 * — none reachable by a viewer mid-playback. Chrome is plain CSS
 * on `--stgm-*` tokens; the real components keep their own
 * compiled styles.
 */
export function ApiKeysPage({ state }: ApiKeysPageProps) {
  return (
    <div className="sx-apikeys">
      <section aria-labelledby="sx-apikeys-heading">
        <div className="sx-apikeys__header">
          <h2 id="sx-apikeys-heading" className="sx-apikeys__heading">
            API Keys
          </h2>
          {state.phase === "idle" && (
            <button
              type="button"
              inert
              className="sx-apikeys__create"
              data-cursor-target="create-api-key"
            >
              + New API key
            </button>
          )}
        </div>
        <p className="sx-apikeys__desc">
          API keys authenticate CLI sessions and programmatic access to the
          Stigmer API. Keys are scoped to your identity and work across all
          your organizations.
        </p>
        {state.phase === "reveal" ? (
          /* `key-reveal` is a camera target (viewport_transition), not a
             cursor stop: the revealed key is the beat's payoff and renders
             at `text-sm`, so api-key-setup zooms toward it for legibility
             in the docs column. Inert for quickstart-tour's step-0 reveal
             (step 0 may carry no interactions). */
          <div inert data-cursor-target="key-reveal">
            <ApiKeyCreatedAlert
              rawKey={state.rawKey}
              keyName={state.keyName}
              onDismiss={noop}
            />
          </div>
        ) : (
          <div inert>
            {state.phase === "creating" && (
              <div className="sx-apikeys__form-card">
                <CreateApiKeyForm
                  key={state.initialName ?? ""}
                  org={DEMO_ORG}
                  initialName={state.initialName}
                  onCancel={noop}
                />
              </div>
            )}
            {/* Frozen clock so a depicted key's "last used" stamp can never
                drift between replays (the panel's deterministic-clock seam). */}
            <ApiKeyListPanel now={DEMO_NOW} />
          </div>
        )}
      </section>
    </div>
  );
}
