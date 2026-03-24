import { describe, expect, it } from "bun:test";

import { resolveOrderPaidGrant } from "@/server/billing/webhook-order-paid";

describe("resolveOrderPaidGrant", () => {
  it("grants a credit when an existing order transitions from created to paid", () => {
    expect(
      resolveOrderPaidGrant({
        existingOrderStatus: "created",
        insertedOrder: false,
      }),
    ).toBe(true);
  });

  it("does not grant a second credit for an already paid order retry", () => {
    expect(
      resolveOrderPaidGrant({
        existingOrderStatus: "paid",
        insertedOrder: false,
      }),
    ).toBe(false);
  });

  it("grants a credit for the first successful insert of a paid order", () => {
    expect(
      resolveOrderPaidGrant({
        existingOrderStatus: null,
        insertedOrder: true,
      }),
    ).toBe(true);
  });

  it("does not grant a credit when a concurrent insert loses the race", () => {
    expect(
      resolveOrderPaidGrant({
        existingOrderStatus: null,
        insertedOrder: false,
      }),
    ).toBe(false);
  });
});
