/**
 * External URLs the Console links to.
 *
 * These are static across all deployments (OSS and cloud) and do not belong
 * in RuntimeConfig, which is reserved for deployment-specific values.
 */
export const EXTERNAL_LINKS = {
  website: "https://stigmer.ai",
  download: "https://stigmer.ai/download",
  github: "https://github.com/stigmer/stigmer",
  docs: "https://stigmer.ai/docs",
} as const;
