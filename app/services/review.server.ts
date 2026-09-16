import db from "app/db.server";

export async function ensureShopExists(shopifyDomain: string) {
  return await db.shop.upsert({
    where: { shopifyDomain },
    update: {},
    create: { shopifyDomain },
  });
}

export async function createProductReview({
  shopifyDomain,
  productId,
  customerName,
  rating,
  comment,
}: {
  shopifyDomain: string;
  productId: string;
  customerName: string;
  rating: number;
  comment: string;
}) {
  const shop = await ensureShopExists(shopifyDomain);

  return await db.review.create({
    data: {
      shopId: shop.id,
      shopifyProductId: productId,
      customerName,
      rating,
      comment,
    },
  });
}

export async function getApprovedReviews(shopifyDomain: string, productId?: string) {
  return await db.review.findMany({
    where: {
      shop: { shopifyDomain },
      status: "APPROVED",
      ...(productId ? { shopifyProductId: productId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}