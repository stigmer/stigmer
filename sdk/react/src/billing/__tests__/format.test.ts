// Money in two registers: a plan's price as a price list writes it, whole
// dollars without cents ("$99", "$0.40"), and an amount on an invoice or an
// estimate, always to the cent ("$99.00").

import { describe, expect, it } from "vitest";
import { formatPrice, formatUsd } from "../format";

const USD = 1_000_000n;

describe("formatPrice", () => {
  it("writes whole dollars without cents and anything else to the cent", () => {
    expect(formatPrice(99n * USD)).toBe("$99");
    expect(formatPrice(25n * USD)).toBe("$25");
    expect(formatPrice((USD * 4n) / 10n)).toBe("$0.40");
    expect(formatPrice((USD * 25n) / 2n)).toBe("$12.50");
    expect(formatPrice(1500n * USD)).toBe("$1,500");
    expect(formatPrice(0n)).toBe("$0");
    expect(formatPrice(undefined)).toBe("$0");
  });
});

describe("formatUsd", () => {
  it("writes every amount to the cent", () => {
    expect(formatUsd(99n * USD)).toBe("$99.00");
    expect(formatUsd((USD * 4n) / 10n)).toBe("$0.40");
    expect(formatUsd(undefined)).toBe("$0.00");
  });
});
