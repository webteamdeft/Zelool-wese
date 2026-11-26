import prisma from "../db.server";

export const DEFAULT_SETTINGS = {
  markupPercent: 85,
  feedUrl: "",
  locationId: "",
  outOfStockAction: "draft",
};

export async function getSettings() {
  const row = await prisma.settings.findUnique({ where: { id: "default" } });
  return row ?? { id: "default", ...DEFAULT_SETTINGS };
}

export async function saveSettings(input) {
  const data = {
    markupPercent: input.markupPercent,
    feedUrl: input.feedUrl,
    locationId: input.locationId,
    outOfStockAction: input.outOfStockAction,
  };
  return prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
  });
}
