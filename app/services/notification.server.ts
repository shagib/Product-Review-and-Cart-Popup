import db from "app/db.server";
import { SHOPIFY_DEFAULT_MESSAGES, NotificationType } from "../constants/notification";

export async function getNotificationMessage(shop: string, type: NotificationType): Promise<string> {
  const setting = await db.notificationSetting.findUnique({
    where: { shop },
  });

  return setting?.[type] || SHOPIFY_DEFAULT_MESSAGES[type];
}