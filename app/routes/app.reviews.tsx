import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useActionData } from "react-router";
import { authenticate } from "app/shopify.server";
import db from "app/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const reviews = await db.review.findMany({
    where: { shop: { shopifyDomain: session.shop } },
    orderBy: { createdAt: "desc" },
  });

  return { reviews };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const reviewId = formData.get("reviewId") as string;
  const intent = formData.get("intent") as string;

  if (intent === "APPROVE") {
    await db.review.update({
      where: { id: reviewId },
      data: { status: "APPROVED" },
    });
    return { success: true, message: "Review approved successfully!" };
  } else if (intent === "DELETE") {
    await db.review.delete({
      where: { id: reviewId },
    });
    return { success: true, message: "Review deleted successfully!" };
  }

  return { success: false, message: "Invalid action" };
};

export default function ReviewsAdminPage() {
  const { reviews } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  useEffect(() => {
    if (actionData?.success && typeof shopify !== "undefined" && shopify.toast) {
      shopify.toast.show(actionData.message || "Action updated successfully");
    }
  }, [actionData]);

  const handleStatusChange = (reviewId: string, intent: "APPROVE" | "DELETE") => {
    const formData = new FormData();
    formData.append("reviewId", reviewId);
    formData.append("intent", intent);
    submit(formData, { method: "post" });
  };

  return (
    <s-page heading="Manage Product Reviews">
      <s-section>
        <s-box padding="large" border-radius="200">
          {reviews.length === 0 ? (
            <s-text>No reviews found yet.</s-text>
          ) : (
            reviews.map((review) => (
              <s-box key={review.id} padding="base" border-width="100" margin-block-end="base">
                <s-stack direction="block" gap="small">
                  <s-text font-weight="bold">{review.customerName} - {review.rating} ⭐</s-text>
                  <s-text>{review.comment}</s-text>
                  <s-text color="subdued">Status: {review.status}</s-text>
                  
                  <s-stack direction="inline" gap="small">
                    {review.status !== "APPROVED" && (
                      <s-button onClick={() => handleStatusChange(review.id, "APPROVE")}>
                        Approve
                      </s-button>
                    )}
                    <s-button variant="primary" onClick={() => handleStatusChange(review.id, "DELETE")}>
                      Delete
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))
          )}
        </s-box>
      </s-section>
    </s-page>
  );
}