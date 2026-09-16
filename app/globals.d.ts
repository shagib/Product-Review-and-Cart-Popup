import type { DetailedHTMLProps, HTMLAttributes } from "react";
type CustomElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;

declare module "*.css";

declare global {
  interface Window {
    shopify?: CustomElement;
  }
  const shopify: {
    toast: {
      show: (message: string, options?: { duration?: number; isError?: boolean }) => void;
    };
  };

  // JSX Components Type Declaration
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: CustomElement;
    }
  }
}
export {};