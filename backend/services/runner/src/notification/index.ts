export {
  type NotificationProvider,
  type NotificationRequest,
  type NotificationResult,
  registerProvider,
  getProvider,
  resetProviders,
} from "./provider.js";

export { WebhookProvider } from "./webhook.js";

import { registerProvider } from "./provider.js";
import { WebhookProvider } from "./webhook.js";

registerProvider(new WebhookProvider());
