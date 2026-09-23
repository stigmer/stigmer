// Public surface of the CLI config module.

export {
  type BackendConfig,
  type BackendType,
  type CloudBackendConfig,
  type Config,
  type ContextConfig,
  type MarketplaceEntryConfig,
  type NamedBackendConfig,
  type NamedBackendType,
  CLOUD_BACKEND_NAME,
  LOCAL_BACKEND_NAME,
  activeBackend,
  activeBackendName,
  getDefault,
  isCloudMode,
  load,
  save,
} from "./config.js";
export {
  DEFAULT_CLOUD_CONSOLE_URL,
  DEFAULT_LOCAL_ORG,
  ensureAuthenticated,
  resolveConsoleURL,
  resolveContextOrganization,
  resolveEndpoint,
  resolveOrganization,
  resolveToken,
} from "./resolve.js";
export { configDir, configPath, dataDir } from "./paths.js";
export { configKeyNames, getConfigValue, setConfigValue } from "./keys.js";
