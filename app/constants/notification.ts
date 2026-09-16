export const SHOPIFY_DEFAULT_MESSAGES = {
  createMsg: "Product created successfully",
  updateMsg: "Product updated successfully",
  deleteMsg: "Product deleted successfully",
  statusMsg: "Product status updated successfully",
} as const;

export type NotificationType = keyof typeof SHOPIFY_DEFAULT_MESSAGES;