import { z } from "zod";
import type { ChurchSandwichRecipeKey } from "@/lib/kitchen/church-sandwich-bench";

export const squareStandardIngredient = z.string().max(80).regex(/^[A-Z][A-Z0-9_]*$/);
export const squareCustomIngredient = z.string().trim().min(1).max(120).regex(/^[^\p{Cc}\p{Cf}]+$/u);
export const churchSquareCatalogAllergens = z.object({
  status: z.enum(["configured", "empty", "unsupported", "unavailable"]),
  standard: z.array(squareStandardIngredient).max(50),
  custom: z.array(squareCustomIngredient).max(50),
}).refine(({ status, standard, custom }) =>
  (status === "configured") === (standard.length + custom.length > 0));

export type ChurchSquareCatalogAllergens = z.infer<typeof churchSquareCatalogAllergens>;

export type ChurchSquareAllergenDiagnosticItem = {
  key: ChurchSandwichRecipeKey;
  name: string;
} & (
  | { status: "matched"; itemId: string; catalogVersion: string | null; variationIds: string[]; allergens: ChurchSquareCatalogAllergens }
  | { status: "missing" | "ambiguous"; itemId: null; variationIds: []; allergens: null }
);

export type ChurchSquareAllergenDiagnostic = {
  checkedAt: string;
  items: ChurchSquareAllergenDiagnosticItem[];
};
