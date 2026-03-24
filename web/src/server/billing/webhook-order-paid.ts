type ResolveOrderPaidGrantInput = {
  existingOrderStatus: "created" | "paid" | "failed" | "refunded" | null;
  insertedOrder: boolean;
};

export function resolveOrderPaidGrant(input: ResolveOrderPaidGrantInput): boolean {
  if (input.existingOrderStatus === "paid") {
    return false;
  }

  if (input.existingOrderStatus && input.existingOrderStatus !== "paid") {
    return true;
  }

  return input.insertedOrder;
}
