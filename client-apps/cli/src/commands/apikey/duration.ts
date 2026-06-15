// Parse human expiration durations like "30d", "6h", "1y" into milliseconds.
// Ported from the Go CLI's ParseExpirationDuration; invalid input is a usage
// error (exit 2). Units: m (minutes), h (hours), d (days), y (years).

import { UsageError } from "../../errors/index.js";

const UNIT_MS: Record<string, number> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

export function parseExpiration(input: string): number {
  if (input.length < 2) {
    throw new UsageError(`invalid duration format: "${input}" (expected e.g. 30d, 6h, 1y)`);
  }

  const unit = input[input.length - 1];
  const valueText = input.slice(0, -1);
  const multiplier = UNIT_MS[unit];
  if (multiplier === undefined) {
    throw new UsageError(`invalid duration unit '${unit}' (valid: m, h, d, y)`);
  }

  if (!/^\d+$/.test(valueText)) {
    throw new UsageError(`invalid duration value in "${input}"`);
  }
  const value = Number.parseInt(valueText, 10);
  if (value <= 0) {
    throw new UsageError(`duration must be positive, got ${value}`);
  }

  return value * multiplier;
}
