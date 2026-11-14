import type { ChurchSandwichRecipeKey } from "@/lib/kitchen/church-sandwich-bench";

export type ChurchSquareMenuDiagnosticVariation = {
  id: string;
  name: string;
  sku: string | null;
  tracking: "tracked" | "untracked" | "default_off";
  mapping: "mapped" | "unmapped" | "unknown";
  openingCount: "confirmed" | "unrecorded" | "unknown";
};

export type ChurchSquareMenuDiagnosticItem = {
  key: ChurchSandwichRecipeKey;
  name: string;
} & (
  | { status: "matched"; itemId: string; variations: ChurchSquareMenuDiagnosticVariation[] }
  | { status: "missing" | "ambiguous"; itemId: null; variations: [] }
);

export type ChurchSquareMenuDiagnostic = {
  checkedAt: string;
  items: ChurchSquareMenuDiagnosticItem[];
};
