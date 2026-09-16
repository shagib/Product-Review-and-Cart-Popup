import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState, useEffect } from "react";
import { useActionData, useLoaderData, useSubmit } from "react-router";
import { authenticate } from "app/shopify.server";
import db from "app/db.server";
import { SHOPIFY_DEFAULT_MESSAGES } from "../constants/notification";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const savedSettings = await db.notificationSetting.findFirst({
    where: {
      shop: {
        shopifyDomain: session.shop,
      },
    },
  });

  return {
    savedSettings: {
      isReviewActive: savedSettings?.isReviewActive ?? false,
      createMsg: savedSettings?.createMsg || "",
      updateMsg: savedSettings?.updateMsg || "",
      deleteMsg: savedSettings?.deleteMsg || "",
      statusMsg: savedSettings?.statusMsg || "",
    },
    defaultPlaceholders: SHOPIFY_DEFAULT_MESSAGES,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const isReviewActive = formData.get("isReviewActive") === "true";
  const createMsg = (formData.get("createMsg") as string).trim();
  const updateMsg = (formData.get("updateMsg") as string).trim();
  const deleteMsg = (formData.get("deleteMsg") as string).trim();
  const statusMsg = (formData.get("statusMsg") as string).trim();

  const shop = await db.shop.upsert({
    where: { shopifyDomain: session.shop },
    update: {},
    create: { shopifyDomain: session.shop },
  });

  await db.notificationSetting.upsert({
    where: { shopId: shop.id },
    update: { isReviewActive, createMsg, updateMsg, deleteMsg, statusMsg },
    create: {
      shopId: shop.id,
      isReviewActive,
      createMsg,
      updateMsg,
      deleteMsg,
      statusMsg,
    },
  });

  await admin.graphql(
    `#graphql
    mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            namespace: "app_settings",
            key: "is_review_active",
            type: "boolean",
            value: isReviewActive ? "true" : "false",
            ownerId: (await admin.graphql(`{ shop { id } }`).then(res => res.json())).data.shop.id,
          },
        ],
      },
    }
  );

  return { success: true, message: "Settings saved successfully" };
};

export default function SettingsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { savedSettings, defaultPlaceholders } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const [formState, setFormState] = useState(savedSettings);
  const [initialState, setInitialState] = useState(savedSettings);

  const isDirty = JSON.stringify(formState) !== JSON.stringify(initialState);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (actionData?.success) {
      setInitialState(formState);
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(actionData.message, { duration: 3000 });
      }
    }
  }, [actionData, formState]);

  const handleSave = () => {
    const formData = new FormData();
    Object.entries(formState).forEach(([key, value]) => {
      formData.append(key, String(value));
    });
    submit(formData, { method: "post" });
  };

  const handleDiscard = () => {
    setFormState(initialState);
  };

  const handleTabChange = (status: boolean) => {
    setFormState((prev) => ({
      ...prev,
      isReviewActive: status,
    }));
  };

  if (!isMounted) return null;
  
  return (
    <s-page heading="Notification Settings">
      {isDirty && (
        <s-save-bar>
          <s-button variant="primary" onClick={handleSave}>
            Save
          </s-button>
          <s-button onClick={handleDiscard}>Discard</s-button>
        </s-save-bar>
      )}

      <s-section heading="Customer Review Settings">
        <s-box padding="large" border-radius="200" margin-block-end="base">
          <s-stack direction="inline">
            <s-text font-weight="bold">Enable Review Box</s-text>
            <div style={{ display: "inline-flex", background: "#f1f2f3", padding: "4px", borderRadius: "8px" }}>
              <button
                type="button"
                onClick={() => handleTabChange(true)}
                style={{
                  padding: "6px 16px",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: formState.isReviewActive ? "bold" : "normal",
                  background: formState.isReviewActive ? "#ffffff" : "transparent",
                  boxShadow: formState.isReviewActive ? "0px 1px 3px rgba(0,0,0,0.12)" : "none",
                  color: formState.isReviewActive ? "#008060" : "#6d7175",
                  transition: "all 0.2s ease"
                }}
              >
                Enable
              </button>

              <button
                type="button"
                onClick={() => handleTabChange(false)}
                style={{
                  padding: "6px 16px",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: !formState.isReviewActive ? "bold" : "normal",
                  background: !formState.isReviewActive ? "#ffffff" : "transparent",
                  boxShadow: !formState.isReviewActive ? "0px 1px 3px rgba(0,0,0,0.12)" : "none",
                  color: !formState.isReviewActive ? "#d32f2f" : "#6d7175",
                  transition: "all 0.2s ease"
                }}
              >
                Disable
              </button>
            </div>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Product Actions Toast Messages">
        <s-box padding="large" border-radius="200">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Product Create Message"
              value={formState.createMsg}
              placeholder={defaultPlaceholders.createMsg}
              onInput={(e) => {
                const target = e.target as HTMLInputElement;
                setFormState({ ...formState, createMsg: target.value });
              }}
            />

            <s-text-field
              label="Product Update Message"
              value={formState.updateMsg}
              placeholder={defaultPlaceholders.updateMsg}
              onInput={(e) => {
                const target = e.target as HTMLInputElement;
                setFormState({ ...formState, updateMsg: target.value });
              }}
            />

            <s-text-field
              label="Product Delete Message"
              value={formState.deleteMsg}
              placeholder={defaultPlaceholders.deleteMsg}
              onInput={(e) => {
                const target = e.target as HTMLInputElement;
                setFormState({ ...formState, deleteMsg: target.value });
              }}
            />

            <s-text-field
              label="Product Status Message"
              value={formState.statusMsg}
              placeholder={defaultPlaceholders.statusMsg}
              onInput={(e) => {
                const target = e.target as HTMLInputElement;
                setFormState({ ...formState, statusMsg: target.value });
              }}
            />
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}