import "server-only";

import { appSurface } from "@/lib/app-surface";

export function squareProductionAccessToken(): string | undefined {
  if (appSurface !== "operations" || process.env.VERCEL_ENV !== "production") return undefined;
  return process.env.SQUARE_PRODUCTION_ACCESS_TOKEN?.trim() || undefined;
}

export function squareProductionSyncConfiguration() {
  const accessToken = squareProductionAccessToken();
  if (!accessToken || process.env.LE_YARD_SQUARE_SOURCE_SYNC_ENABLED?.trim() !== "true"
    || process.env.SQUARE_SOURCE_ENVIRONMENT?.trim() !== "production") return undefined;
  return { accessToken, environment: "production" as const };
}
