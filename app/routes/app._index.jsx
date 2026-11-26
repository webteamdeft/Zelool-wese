import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

// The app's landing page is the product list. Keep the embedded query string (host, shop).
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const { search } = new URL(request.url);
  return redirect(`/app/products${search}`);
};
