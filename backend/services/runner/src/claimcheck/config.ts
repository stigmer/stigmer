export interface ClaimcheckConfig {
  readonly enabled: boolean;
  readonly thresholdBytes: number;
  readonly compressionEnabled: boolean;
  readonly keyPrefix: string;
}

const DEFAULT_THRESHOLD_BYTES = 128 * 1024; // 128KB

export function loadClaimcheckConfig(): ClaimcheckConfig {
  return {
    enabled: process.env.CLAIMCHECK_ENABLED === "true",
    thresholdBytes: parseInt(
      process.env.CLAIMCHECK_THRESHOLD_BYTES ?? String(DEFAULT_THRESHOLD_BYTES),
      10,
    ),
    compressionEnabled: process.env.CLAIMCHECK_COMPRESSION_ENABLED !== "false",
    keyPrefix: process.env.CLAIMCHECK_KEY_PREFIX ?? "claimcheck/",
  };
}
