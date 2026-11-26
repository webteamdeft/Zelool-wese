import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings, saveSettings } from "../lib/settings.server";
import { calculatePrice } from "../lib/pricing.js";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const settings = await getSettings();

  let locations = [];
  let locationError = null;
  try {
    const response = await admin.graphql(`#graphql
      query inventoryLocations {
        locations(first: 50) {
          nodes { id name isActive }
        }
      }`);
    const json = await response.json();
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
    locations = (json.data?.locations?.nodes ?? []).filter((loc) => loc.isActive);
  } catch (error) {
    locationError = `Could not load locations: ${error.message}`;
  }

  return { settings, locations, locationError };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const form = await request.formData();

  const markupPercent = Number(form.get("markupPercent"));
  const feedUrl = String(form.get("feedUrl") ?? "").trim();
  const locationId = String(form.get("locationId") ?? "").trim();
  const outOfStockAction = form.get("outOfStockAction") === "keep" ? "keep" : "draft";

  const errors = {};
  if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 1000) {
    errors.markupPercent = "Enter a markup between 0 and 1000.";
  }
  if (feedUrl && !/^https?:\/\//i.test(feedUrl)) {
    errors.feedUrl = "The feed URL must start with http:// or https://.";
  }
  if (Object.keys(errors).length) return { errors };

  await saveSettings({ markupPercent, feedUrl, locationId, outOfStockAction });
  return { saved: true };
};

export default function Settings() {
  const { settings, locations, locationError } = useLoaderData();
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";

  const [markup, setMarkup] = useState(String(settings.markupPercent));
  const [feedUrl, setFeedUrl] = useState(settings.feedUrl);
  const [locationId, setLocationId] = useState(settings.locationId);
  const [outOfStockAction, setOutOfStockAction] = useState(settings.outOfStockAction);

  const errors = fetcher.data?.errors ?? {};
  const markupValue = Number(markup);
  const example = Number.isFinite(markupValue) ? calculatePrice(10, markupValue) : null;

  return (
    <s-page heading="Pricing & settings">
      <s-button
        slot="primary-action"
        variant="primary"
        {...(saving ? { loading: true } : {})}
        onClick={() =>
          fetcher.submit(
            { markupPercent: markup, feedUrl, locationId, outOfStockAction },
            { method: "POST" },
          )
        }
      >
        Save
      </s-button>

      {fetcher.data?.saved && (
        <s-banner tone="success">Settings saved.</s-banner>
      )}

      <s-section heading="Pricing">
        <s-stack direction="block" gap="base">
          <label>
            Markup on source price (%)
            <input
              type="number"
              min="0"
              step="0.01"
              value={markup}
              onChange={(e) => setMarkup(e.currentTarget.value)}
              style={{ display: "block", marginTop: 4, padding: 6, width: 160 }}
            />
          </label>
          {errors.markupPercent && <s-text tone="critical">{errors.markupPercent}</s-text>}
          <s-paragraph>
            Shopify price = source price × (1 + markup), rounded up to the next whole dollar.
            {example !== null && (
              <>
                {" "}Example: a $10.00 source price becomes <strong>${example}.00</strong>.
              </>
            )}
          </s-paragraph>
          <s-paragraph>
            Individual product prices can be locked on the Products page. Locked prices are
            never changed by sync.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Feed source">
        <s-stack direction="block" gap="base">
          <label>
            Supplier feed URL (JSON array or CSV)
            <input
              type="url"
              value={feedUrl}
              placeholder="https://example.com/wesee-feed.csv"
              onChange={(e) => setFeedUrl(e.currentTarget.value)}
              style={{ display: "block", marginTop: 4, padding: 6, width: "100%", maxWidth: 560 }}
            />
          </label>
          {errors.feedUrl && <s-text tone="critical">{errors.feedUrl}</s-text>}
          <s-paragraph>
            Required fields per product: SKU, name, price. Optional: stock, images (URLs), description, specs.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Inventory">
        <s-stack direction="block" gap="base">
          {locationError && <s-banner tone="critical">{locationError}</s-banner>}
          <label>
            Inventory location
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.currentTarget.value)}
              style={{ display: "block", marginTop: 4, padding: 6, minWidth: 320 }}
            >
              <option value="">Select a location…</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            When an active product reaches zero stock
            <select
              value={outOfStockAction}
              onChange={(e) => setOutOfStockAction(e.currentTarget.value)}
              style={{ display: "block", marginTop: 4, padding: 6, minWidth: 320 }}
            >
              <option value="draft">Move it back to draft</option>
              <option value="keep">Keep it published</option>
            </select>
          </label>
          <s-paragraph>
            Negative source stock is always synced as 0. New products are always created as drafts.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}
