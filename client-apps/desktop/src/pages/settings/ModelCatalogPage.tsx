import { ModelCatalogConsole } from "@stigmer/react-sdk/console";

/**
 * Platform-operator console for the model catalog: the models the
 * registry serves at the prices the catalog holds, with search,
 * per-model detail records, and the edit, add and retire steps.
 *
 * Reached via the operator-gated "Platform" nav group (see
 * `useSettingsNavGroups` — fail-closed on `can_manage_model_pricing` on
 * `platform:stigmer`). The nav gate is discoverability only; the server
 * permission is the real boundary, and non-operators who navigate here
 * by URL see the authorization notice the console renders.
 */
export default function ModelCatalogPage() {
  return <ModelCatalogConsole />;
}
