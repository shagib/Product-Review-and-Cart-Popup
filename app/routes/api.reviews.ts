import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "app/db.server";
import { createProductReview, getApprovedReviews } from "app/services/review.server";

// CORS Headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopifyDomain = url.searchParams.get("shop");
  const productId = url.searchParams.get("productId");

  if (!shopifyDomain) {
    return Response.json(
      { error: "Missing shop parameter" }, 
      { status: 400, headers: corsHeaders }
    );
  }

  // 🟢 Shop Domain Normalization (Trailing Slash বা Space হ্যান্ডেল করার জন্য)
  const cleanShopDomain = shopifyDomain.trim().toLowerCase();

  const settings = await db.notificationSetting.findFirst({
    where: { 
      shop: { 
        shopifyDomain: cleanShopDomain 
      } 
    },
  });

  // 🟢 Boolean নিশ্চিত করা
  const isReviewActive = Boolean(settings?.isReviewActive);

  if (!isReviewActive) {
    return Response.json(
      { isReviewActive: false, reviews: [] }, 
      { headers: corsHeaders }
    );
  }

  const reviews = productId ? await getApprovedReviews(cleanShopDomain, productId) : [];

  return Response.json(
    { isReviewActive: true, reviews }, 
    { headers: corsHeaders }
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const queryShop = url.searchParams.get("shop");

  let body: any = {};
  try {
    body = await request.json();
  } catch (e) {
    return Response.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400, headers: corsHeaders }
    );
  }

  // URL Query parameter অথবা Body — যেকোনো স্থান থেকে Domain নিয়ে নেওয়া
  const shopifyDomain = (body.shopifyDomain || queryShop || "").trim().toLowerCase();
  const { productId, customerName, rating, comment } = body;

  if (!shopifyDomain || !productId || !customerName || !rating || !comment) {
    return Response.json(
      { success: false, message: "All fields are required" }, 
      { status: 400, headers: corsHeaders }
    );
  }

  // রিভিউ পোস্ট করার আগে সেটিংসে রিভিউ অপশন অন আছে কিনা ডাবল চেক
  const settings = await db.notificationSetting.findFirst({
    where: { shop: { shopifyDomain } },
  });

  if (!settings?.isReviewActive) {
    return Response.json(
      { success: false, message: "Review submission is currently disabled by admin." },
      { status: 403, headers: corsHeaders }
    );
  }

  await createProductReview({
    shopifyDomain,
    productId,
    customerName,
    rating: Number(rating),
    comment,
  });

  return Response.json(
    { success: true, message: "Review submitted for approval!" }, 
    { headers: corsHeaders }
  );
};