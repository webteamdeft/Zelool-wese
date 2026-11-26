import { useState } from "react";
import { Form, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { pushVariantPrice } from "../lib/sync.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  const frames = await prisma.frame.findMany({
    where: q
      ? { OR: [{ sku: { contains: q } }, { name: { contains: q } }] }
      : undefined,
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
  });

  return { frames, q };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");

  const frame = await prisma.frame.findUnique({ where: { id } });
  if (!frame) return { error: "Product not found." };

  const price = Math.round(Number(form.get("price")) * 100) / 100;
  if (!Number.isFinite(price) || price < 0) {
    return { error: "Price must be a number of 0 or more.", id };
  }
  const priceLocked = form.get("priceLocked") === "true";
  const priceChanged = Math.abs(price - frame.price) > 0.001;

  try {
    // Push to Shopify first, so local data never claims a price Shopify doesn't have.
    if (priceChanged && frame.shopifyProductId) {
      await pushVariantPrice(admin, frame, price);
    }
    await prisma.frame.update({ where: { id }, data: { price, priceLocked } });
    return { saved: true, id };
  } catch (error) {
    return { error: `Could not update Shopify: ${error.message}`, id };
  }
};

function statusTone(status) {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "warning";
  return "neutral";
}

function ProductRow({ frame }) {
  const fetcher = useFetcher();
  const [price, setPrice] = useState(String(frame.price));
  const [locked, setLocked] = useState(frame.priceLocked);
  const saving = fetcher.state !== "idle";
  const result = fetcher.data?.id === frame.id ? fetcher.data : null;

  return (
    <tr style={{ borderTop: "1px solid #e1e3e5", verticalAlign: "top" }}>
      <td style={{ padding: 8, fontFamily: "monospace" }}>{frame.sku}</td>
      <td style={{ padding: 8 }}>
        {frame.name}
        {frame.lastError && (
          <div style={{ color: "#8e1f0b", fontSize: 12, marginTop: 4 }}>{frame.lastError}</div>
        )}
        {!frame.inSource && (
          <div style={{ color: "#8a6116", fontSize: 12, marginTop: 4 }}>Not in latest feed</div>
        )}
      </td>
      <td style={{ padding: 8 }}>${frame.sourcePrice.toFixed(2)}</td>
      <td style={{ padding: 8 }}>
        <input
          type="number"
          min="0"
          step="1"
          value={price}
          onChange={(e) => setPrice(e.currentTarget.value)}
          style={{ width: 90, padding: 4 }}
        />
      </td>
      <td style={{ padding: 8, textAlign: "center" }}>
        <input
          type="checkbox"
          checked={locked}
          onChange={(e) => setLocked(e.currentTarget.checked)}
          aria-label={`Lock price for ${frame.sku}`}
        />
      </td>
      <td style={{ padding: 8 }}>{frame.stock}</td>
      <td style={{ padding: 8 }}>
        {frame.shopifyStatus ? (
          <s-badge tone={statusTone(frame.shopifyStatus)}>{frame.shopifyStatus.toLowerCase()}</s-badge>
        ) : (
          <s-badge>not in Shopify</s-badge>
        )}
      </td>
      <td style={{ padding: 8 }}>
        <s-button
          size="slim"
          {...(saving ? { loading: true } : {})}
          onClick={() =>
            fetcher.submit(
              { id: frame.id, price, priceLocked: String(locked) },
              { method: "POST" },
            )
          }
        >
          Save
        </s-button>
        {result?.saved && <div style={{ color: "#108043", fontSize: 12 }}>Saved</div>}
        {result?.error && <div style={{ color: "#8e1f0b", fontSize: 12 }}>{result.error}</div>}
      </td>
    </tr>
  );
}

export default function Products() {
  const { frames, q } = useLoaderData();

  return (
    <s-page heading="Products">
      <s-section heading={`Synced frames (${frames.length})`}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            New frames are created as drafts. Publish them manually in Shopify. Locked prices
            are not changed by sync. Edit a price here to push it to Shopify immediately.
          </s-paragraph>
          <Form method="get">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search by SKU or name"
              style={{ padding: 6, minWidth: 280 }}
            />{" "}
            <button type="submit">Search</button>
          </Form>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ padding: 8 }}>SKU</th>
                  <th style={{ padding: 8 }}>Name</th>
                  <th style={{ padding: 8 }}>Source</th>
                  <th style={{ padding: 8 }}>Price</th>
                  <th style={{ padding: 8, textAlign: "center" }}>Locked</th>
                  <th style={{ padding: 8 }}>Stock</th>
                  <th style={{ padding: 8 }}>Shopify</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {frames.map((frame) => (
                  <ProductRow key={`${frame.id}-${frame.updatedAt}`} frame={frame} />
                ))}
              </tbody>
            </table>
            {frames.length === 0 && (
              <s-paragraph>No products yet. Run a sync from Sync & logs.</s-paragraph>
            )}
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}
