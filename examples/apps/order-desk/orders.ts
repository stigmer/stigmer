/**
 * The shop's data, in memory. In your product these are your own database
 * and your own rules; the tools in server.ts read them the same way.
 */

export interface Order {
  readonly id: string;
  readonly status: "processing" | "shipped" | "delivered";
  readonly items: ReadonlyArray<{ readonly name: string; readonly quantity: number; readonly finalSale: boolean }>;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  readonly deliveredOn: string | null;
  /** The last day a return is accepted: 30 days after delivery, none for an order not yet delivered. */
  readonly returnBy: string | null;
}

export const ORDERS: Readonly<Record<string, Order>> = {
  "1042": {
    id: "1042",
    status: "delivered",
    items: [{ name: "Linen shirt, size M", quantity: 1, finalSale: false }],
    carrier: "UPS",
    trackingNumber: "1Z999AA10123456784",
    deliveredOn: "2026-11-12",
    returnBy: "2026-12-12",
  },
  "1043": {
    id: "1043",
    status: "shipped",
    items: [{ name: "Wool scarf", quantity: 2, finalSale: true }],
    carrier: "USPS",
    trackingNumber: "9400111202555842761234",
    deliveredOn: null,
    returnBy: null,
  },
  "1044": {
    id: "1044",
    status: "processing",
    items: [{ name: "Canvas tote", quantity: 1, finalSale: false }],
    carrier: null,
    trackingNumber: null,
    deliveredOn: null,
    returnBy: null,
  },
};

export const REFUND_POLICY = [
  "Items can be returned within 30 days of delivery, unworn and with their tags, for a full refund to the original payment.",
  "Final-sale items can't be returned.",
  "An order that hasn't been delivered yet can be cancelled instead, until it ships.",
  "Refunds reach the customer 5 to 10 business days after the return arrives.",
].join(" ");
