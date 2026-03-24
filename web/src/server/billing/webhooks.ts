import { eq } from "drizzle-orm";
import type { WebhookCheckoutCreatedPayload } from "@polar-sh/sdk/models/components/webhookcheckoutcreatedpayload";
import type { WebhookCheckoutUpdatedPayload } from "@polar-sh/sdk/models/components/webhookcheckoutupdatedpayload";
import type { WebhookOrderPaidPayload } from "@polar-sh/sdk/models/components/webhookorderpaidpayload";

import { generateBillingOrderId } from "@/lib/ids";
import { resolveOrderPaidGrant } from "@/server/billing/webhook-order-paid";
import { db } from "@/server/db/client";
import { billingOrders, userBillingProfiles } from "@/server/db/schema";
import { grantPurchasedSessions, getOrCreateBillingProfile } from "@/server/billing/entitlements";
import { getPolarEnv } from "@/server/billing/polar";
import { createLogger } from "@/server/logger";

const log = createLogger("webhooks");

// ---------------------------------------------------------------------------
// order.paid – grant one purchased session credit
// ---------------------------------------------------------------------------

export async function handleOrderPaid(
  payload: WebhookOrderPaidPayload,
): Promise<void> {
  const env = getPolarEnv();
  const order = payload.data;

  const orderId = order.id;
  const productId = order.productId;
  const checkoutId = order.checkoutId;
  const customerId = order.customerId;
  const totalAmount = order.totalAmount ?? 0;
  const currency = order.currency ?? "usd";
  const metadata = (order.metadata ?? {}) as Record<string, unknown>;

  // Resolve user ID from customer externalId (set by plugin) or metadata
  const externalCustomerId =
    order.customer?.externalId ??
    (metadata.userId as string | undefined);

  if (!externalCustomerId) {
    log.warn({ orderId }, "order.paid missing externalId / userId in metadata, skipping");
    return;
  }

  // Only handle orders for our session product
  if (productId && productId !== env.POLAR_SESSION_PRODUCT_ID) {
    log.debug(
      { orderId, productId, expected: env.POLAR_SESSION_PRODUCT_ID },
      "order.paid for different product, ignoring",
    );
    return;
  }

  // Upsert the billing_orders row (idempotent)
  const existingOrder = checkoutId
    ? await db.query.billingOrders.findFirst({
        where: eq(billingOrders.polarCheckoutId, checkoutId),
      })
    : null;
  let localOrderId: string;
  let insertedOrder = false;

  if (existingOrder) {
    // Update the existing row to paid
    const [updated] = await db
      .update(billingOrders)
      .set({
        polarOrderId: orderId,
        status: "paid",
        amount: totalAmount,
        currency,
        metadata,
        updatedAt: new Date(),
      })
      .where(eq(billingOrders.id, existingOrder.id))
      .returning();
    localOrderId = updated?.id ?? existingOrder.id;
  } else {
    localOrderId = generateBillingOrderId();
    const [inserted] = await db
      .insert(billingOrders)
      .values({
        id: localOrderId,
        userId: externalCustomerId,
        polarCheckoutId: checkoutId ?? orderId,
        polarOrderId: orderId,
        polarProductId: productId ?? env.POLAR_SESSION_PRODUCT_ID,
        status: "paid",
        amount: totalAmount,
        currency,
        metadata,
      })
      .onConflictDoNothing()
      .returning({ id: billingOrders.id });

    insertedOrder = Boolean(inserted);

    if (!inserted && checkoutId) {
      const currentOrder = await db.query.billingOrders.findFirst({
        where: eq(billingOrders.polarCheckoutId, checkoutId),
      });

      if (currentOrder) {
        localOrderId = currentOrder.id;
      }
    }
  }

  const shouldGrantCredit = resolveOrderPaidGrant({
    existingOrderStatus: existingOrder?.status ?? null,
    insertedOrder,
  });

  // Update billing profile with Polar customer ID
  if (customerId) {
    const profile = await getOrCreateBillingProfile(externalCustomerId);
    if (profile && !profile.polarCustomerId) {
      await db
        .update(userBillingProfiles)
        .set({ polarCustomerId: customerId, updatedAt: new Date() })
        .where(eq(userBillingProfiles.userId, externalCustomerId));
    }
  }

  if (shouldGrantCredit) {
    await grantPurchasedSessions(externalCustomerId, 1);
  }

  log.info(
    { orderId, localOrderId, userId: externalCustomerId, grantedCredit: shouldGrantCredit },
    "order.paid processed",
  );
}

// ---------------------------------------------------------------------------
// checkout.created / checkout.updated – record the billing order
// ---------------------------------------------------------------------------

export async function handleCheckoutEvent(
  payload: WebhookCheckoutCreatedPayload | WebhookCheckoutUpdatedPayload,
): Promise<void> {
  const env = getPolarEnv();
  const data = payload.data;

  const checkoutId = data.id;
  const status = data.status;
  const productId = data.productId;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const totalAmount = data.totalAmount ?? 0;
  const currency = data.currency ?? "usd";

  const externalCustomerId =
    data.externalCustomerId ??
    (metadata.userId as string | undefined);

  if (!externalCustomerId) {
    log.debug({ checkoutId }, "Checkout event without userId, skipping");
    return;
  }

  // Check product match
  if (productId && productId !== env.POLAR_SESSION_PRODUCT_ID) {
    return;
  }

  const localStatus =
    status === "succeeded" || status === "confirmed" ? "paid" as const
    : status === "failed" || status === "expired" ? "failed" as const
    : "created" as const;

  const existing = await db.query.billingOrders.findFirst({
    where: eq(billingOrders.polarCheckoutId, checkoutId),
  });

  if (existing) {
    // Only update if not already paid (don't regress)
    if (existing.status !== "paid") {
      await db
        .update(billingOrders)
        .set({
          status: localStatus,
          amount: totalAmount,
          currency,
          metadata,
          updatedAt: new Date(),
        })
        .where(eq(billingOrders.id, existing.id));
    }
    return;
  }

  const orderId = generateBillingOrderId();
  await db
    .insert(billingOrders)
    .values({
      id: orderId,
      userId: externalCustomerId,
      polarCheckoutId: checkoutId,
      polarProductId: productId ?? env.POLAR_SESSION_PRODUCT_ID,
      status: localStatus,
      amount: totalAmount,
      currency,
      metadata,
    })
    .onConflictDoNothing();
}
