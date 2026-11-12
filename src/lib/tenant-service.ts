import type { Json } from "@/types/database.generated";

export type TenantServiceSettings = {
  serviceModel: "full-service" | "counter";
};

export type TenantFeature =
  | "reservations"
  | "guestCrm"
  | "customerCommunications"
  | "providerIntegrations"
  | "externalAssistant"
  | "tips";

type TenantServiceScope = { serviceSettings?: TenantServiceSettings };

export function parseTenantServiceSettings(flags: Json | undefined): TenantServiceSettings {
  const serviceModel = flags && typeof flags === "object" && !Array.isArray(flags)
    ? flags.service_model
    : undefined;
  if (serviceModel === undefined || serviceModel === "full-service") {
    return { serviceModel: "full-service" };
  }
  if (serviceModel === "counter") return { serviceModel };
  throw new Error("Unsupported tenant service model.");
}

const counterDisabledFeatures = new Set<TenantFeature>([
  "reservations",
  "guestCrm",
  "customerCommunications",
  "providerIntegrations",
  "externalAssistant",
  "tips",
]);

export function isTenantFeatureEnabled(scope: TenantServiceScope, feature: TenantFeature): boolean {
  return scope.serviceSettings?.serviceModel !== "counter" || !counterDisabledFeatures.has(feature);
}

const routeFeatures: Readonly<Record<string, TenantFeature>> = {
  "/reservations": "reservations",
  "/guests": "guestCrm",
  "/phone": "customerCommunications",
  "/integrations": "providerIntegrations",
};

export function isTenantRouteEnabled(scope: TenantServiceScope, destination: string): boolean {
  const root = `/${destination.split(/[/?#]/)[1] ?? ""}`;
  const feature = routeFeatures[root];
  return feature === undefined || isTenantFeatureEnabled(scope, feature);
}
