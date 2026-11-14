import type { ChurchSandwichRecipeKey } from "@/lib/kitchen/church-sandwich-bench";

export type ChurchSquareItemPresentation = {
  itemPhotoCount: number | null;
  description: "present" | "missing" | "unverified";
};

export type ChurchSquareVariationPresentation = {
  photoCount: number | null;
  sellability: "sellable" | "not_sellable" | "unspecified";
};

export type ChurchSquareMenuDiagnosticVariation = {
  id: string;
  name: string;
  sku: string | null;
  tracking: "tracked" | "untracked" | "default_off";
  mapping: "mapped" | "unmapped" | "unknown";
  openingCount: "confirmed" | "unrecorded" | "unknown";
  presentation: ChurchSquareVariationPresentation;
};

export type ChurchSquareMenuDiagnosticItem = {
  key: ChurchSandwichRecipeKey;
  name: string;
} & (
  | { status: "matched"; itemId: string; presentation: ChurchSquareItemPresentation; variations: ChurchSquareMenuDiagnosticVariation[] }
  | { status: "missing" | "ambiguous"; itemId: null; variations: [] }
);

export type ChurchSquareMenuDiagnostic = {
  checkedAt: string;
  items: ChurchSquareMenuDiagnosticItem[];
};
