import { timingSafeEqual } from "node:crypto";
import { unauthenticated } from "../shopify.server";
import { startSync } from "../lib/sync.server";

// Scheduled sync entry point. Call with:
//   POST /api/sync
//   Authorization: Bearer <SYNC_TOKEN>
// Returns 202 with the run id, or 409 if a run is already in progress.

function tokenMatches(header, expected) {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export const action = async ({ request }) => {
  if (!tokenMatches(request.headers.get("authorization"), process.env.SYNC_TOKEN)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = process.env.SYNC_SHOP;
  if (!shop) {
    return Response.json({ error: "SYNC_SHOP is not set on the server." }, { status: 500 });
  }

  const { admin } = await unauthenticated.admin(shop);
  const result = await startSync({ admin, trigger: "scheduled" });

  return Response.json(result, { status: result.alreadyRunning ? 409 : 202 });
};

export const loader = () => Response.json({ error: "Use POST" }, { status: 405 });
