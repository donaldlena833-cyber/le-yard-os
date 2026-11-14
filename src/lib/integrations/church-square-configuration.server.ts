import "server-only";

import { z } from "zod";
import { appSurface } from "@/lib/app-surface";
import type { SquareCountConfiguration } from "./square-counts.server";

const environmentSchema = z.object({
  accessToken: z.string().trim().regex(/^[!-~]{1,4096}$/),
  merchantId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,100}$/),
  locationId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,100}$/),
});

export function churchSquareCountConfiguration(): SquareCountConfiguration | undefined {
  if (appSurface !== "operations" || process.env.VERCEL_ENV !== "production"
    || process.env.LE_YARD_CHURCH_SQUARE_COUNTS_ENABLED?.trim() !== "true") return undefined;
  const parsed = environmentSchema.safeParse({
    accessToken: process.env.SQUARE_CHURCH_ACCESS_TOKEN,
    merchantId: process.env.SQUARE_CHURCH_MERCHANT_ID,
    locationId: process.env.SQUARE_CHURCH_LOCATION_ID,
  });
  if (!parsed.success) return undefined;
  return {
    ...parsed.data, environment: "production", currency: "USD", timeZone: "America/New_York",
    address: { street: "140 Church Street", postalCode: "10007", country: "US" },
  };
}
