#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const UNIT_DEFINITIONS = Object.freeze({
  g: { dimension: "mass", factor: 1 },
  kg: { dimension: "mass", factor: 1_000 },
  oz: { dimension: "mass", factor: 28.349523125 },
  lb: { dimension: "mass", factor: 453.59237 },
  ml: { dimension: "volume", factor: 1 },
  l: { dimension: "volume", factor: 1_000 },
  "fl-oz": { dimension: "volume", factor: 29.5735295625 },
  gal: { dimension: "volume", factor: 3_785.411784 },
  each: { dimension: "count", factor: 1 },
  dozen: { dimension: "count", factor: 12 },
});

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireNumber(value, label, { minimum = -Infinity, exclusiveMinimum = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  if (exclusiveMinimum ? value <= minimum : value < minimum) {
    const comparison = exclusiveMinimum ? "greater than" : "at least";
    throw new RangeError(`${label} must be ${comparison} ${minimum}.`);
  }
  return value;
}

function optionalNumber(value, label, options) {
  return value === undefined || value === null
    ? null
    : requireNumber(value, label, options);
}

function percent(value, label) {
  if (value === undefined || value === null) return null;
  return requireNumber(value, label, { minimum: 0, exclusiveMinimum: true }) < 100
    ? value
    : (() => {
        throw new RangeError(`${label} must be less than 100.`);
      })();
}

function wastePercent(value, label) {
  if (value === undefined || value === null) return 0;
  const parsed = requireNumber(value, label, { minimum: 0 });
  if (parsed >= 100) throw new RangeError(`${label} must be less than 100.`);
  return parsed;
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function roundCents(value) {
  return Math.round(value + Number.EPSILON);
}

function roundUpCents(value, increment) {
  return Math.ceil((value - Number.EPSILON) / increment) * increment;
}

function normalizeSource(value, label) {
  if (value === undefined || value === null) return null;
  const source = requireObject(value, label);
  return {
    label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : null,
    observedAt:
      typeof source.observedAt === "string" && source.observedAt.trim()
        ? source.observedAt.trim()
        : null,
  };
}

function unitDefinition(unit) {
  return typeof unit === "string" ? UNIT_DEFINITIONS[unit] ?? null : null;
}

function calculateIngredient(ingredient, itemIndex, ingredientIndex) {
  const path = `menuItems[${itemIndex}].ingredients[${ingredientIndex}]`;
  requireObject(ingredient, path);
  const name = requireString(ingredient.name, `${path}.name`);
  const quantity = requireNumber(ingredient.quantity, `${path}.quantity`, {
    minimum: 0,
    exclusiveMinimum: true,
  });
  const unit = requireString(ingredient.unit, `${path}.unit`);
  const waste = wastePercent(ingredient.wastePercent, `${path}.wastePercent`);
  const source = normalizeSource(ingredient.source, `${path}.source`);
  const missing = [];
  const warnings = [];

  const recipeUnit = unitDefinition(unit);
  if (!recipeUnit) missing.push(`Unsupported recipe unit '${unit}'.`);

  const purchaseQuantity = optionalNumber(
    ingredient.purchaseQuantity,
    `${path}.purchaseQuantity`,
    { minimum: 0, exclusiveMinimum: true },
  );
  const purchaseUnit =
    ingredient.purchaseUnit === undefined || ingredient.purchaseUnit === null
      ? null
      : requireString(ingredient.purchaseUnit, `${path}.purchaseUnit`);
  const purchasePriceCents = optionalNumber(
    ingredient.purchasePriceCents,
    `${path}.purchasePriceCents`,
    { minimum: 0 },
  );

  if (purchaseQuantity === null) missing.push("Missing purchase quantity.");
  if (purchaseUnit === null) missing.push("Missing purchase unit.");
  if (purchasePriceCents === null) missing.push("Missing purchase price.");

  const pricedUnit = purchaseUnit ? unitDefinition(purchaseUnit) : null;
  if (purchaseUnit && !pricedUnit) missing.push(`Unsupported purchase unit '${purchaseUnit}'.`);
  if (recipeUnit && pricedUnit && recipeUnit.dimension !== pricedUnit.dimension) {
    missing.push(
      `Cannot convert ${recipeUnit.dimension} unit '${unit}' to ${pricedUnit.dimension} unit '${purchaseUnit}' without explicit conversion evidence.`,
    );
  }
  if (!source?.label || !source?.observedAt) {
    warnings.push("Price source label and observation date are incomplete.");
  }

  let exactCostCents = null;
  let asPurchasedQuantity = null;
  let costPerBaseUnitCents = null;
  if (
    missing.length === 0 &&
    recipeUnit &&
    pricedUnit &&
    purchaseQuantity !== null &&
    purchasePriceCents !== null
  ) {
    const recipeBaseQuantity = quantity * recipeUnit.factor;
    const purchaseBaseQuantity = purchaseQuantity * pricedUnit.factor;
    costPerBaseUnitCents = purchasePriceCents / purchaseBaseQuantity;
    asPurchasedQuantity = quantity / (1 - waste / 100);
    exactCostCents =
      (recipeBaseQuantity / (1 - waste / 100)) * costPerBaseUnitCents;
  }

  return {
    result: {
      name,
      recipeQuantity: quantity,
      recipeUnit: unit,
      wastePercent: waste,
      asPurchasedQuantity: asPurchasedQuantity === null ? null : round(asPurchasedQuantity),
      purchaseQuantity,
      purchaseUnit,
      purchasePriceCents,
      costPerBaseUnitCents:
        costPerBaseUnitCents === null ? null : round(costPerBaseUnitCents),
      costCents: exactCostCents === null ? null : roundCents(exactCostCents),
      source,
      missing,
      warnings,
    },
    exactCostCents,
  };
}

function calculateMenuItem(item, itemIndex, defaults) {
  const path = `menuItems[${itemIndex}]`;
  requireObject(item, path);
  const name = requireString(item.name, `${path}.name`);
  const batchYield = requireNumber(item.yield, `${path}.yield`, {
    minimum: 0,
    exclusiveMinimum: true,
  });
  const menuPriceCents = optionalNumber(item.menuPriceCents, `${path}.menuPriceCents`, {
    minimum: 0,
  });
  const targetFoodCostPercent =
    percent(item.targetFoodCostPercent, `${path}.targetFoodCostPercent`) ??
    defaults.targetFoodCostPercent;
  const priceRoundingCents =
    optionalNumber(item.priceRoundingCents, `${path}.priceRoundingCents`, {
      minimum: 0,
      exclusiveMinimum: true,
    }) ?? defaults.priceRoundingCents;

  if (!Number.isInteger(priceRoundingCents)) {
    throw new RangeError(`${path}.priceRoundingCents must be an integer.`);
  }
  if (!Array.isArray(item.ingredients) || item.ingredients.length === 0) {
    throw new TypeError(`${path}.ingredients must be a non-empty array.`);
  }

  const calculated = item.ingredients.map((ingredient, ingredientIndex) =>
    calculateIngredient(ingredient, itemIndex, ingredientIndex),
  );
  const ingredients = calculated.map(({ result }) => result);
  const missingInputs = ingredients.flatMap((ingredient) =>
    ingredient.missing.map((message) => `${ingredient.name}: ${message}`),
  );
  const warnings = ingredients.flatMap((ingredient) =>
    ingredient.warnings.map((message) => `${ingredient.name}: ${message}`),
  );
  const knownExactBatchCostCents = calculated.reduce(
    (sum, ingredient) => sum + (ingredient.exactCostCents ?? 0),
    0,
  );
  const complete = missingInputs.length === 0;
  const exactPortionCostCents = complete ? knownExactBatchCostCents / batchYield : null;
  const portionCostCents =
    exactPortionCostCents === null ? null : roundCents(exactPortionCostCents);
  const foodCostPercent =
    portionCostCents !== null && menuPriceCents !== null && menuPriceCents > 0
      ? round((portionCostCents / menuPriceCents) * 100, 2)
      : null;
  const grossMarginCents =
    portionCostCents !== null && menuPriceCents !== null
      ? menuPriceCents - portionCostCents
      : null;
  const suggestedMenuPriceCents =
    exactPortionCostCents !== null && targetFoodCostPercent !== null
      ? roundUpCents(
          exactPortionCostCents / (targetFoodCostPercent / 100),
          priceRoundingCents,
        )
      : null;
  const allPricesSupported = ingredients.every(
    (ingredient) => ingredient.source?.label && ingredient.source?.observedAt,
  );

  return {
    name,
    status: complete ? "calculated" : "incomplete",
    evidenceStatus: complete
      ? allPricesSupported
        ? "supported"
        : "unverified"
      : "incomplete",
    yield: batchYield,
    menuPriceCents,
    targetFoodCostPercent,
    priceRoundingCents,
    ingredients,
    knownBatchCostCents: roundCents(knownExactBatchCostCents),
    batchCostCents: complete ? roundCents(knownExactBatchCostCents) : null,
    portionCostCents,
    foodCostPercent,
    grossMarginCents,
    suggestedMenuPriceCents,
    missingInputs,
    warnings,
  };
}

export function calculateMenuCosts(input) {
  requireObject(input, "input");
  const currency = input.currency === undefined
    ? "USD"
    : requireString(input.currency, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new RangeError("currency must be a three-letter ISO currency code.");
  }
  const targetFoodCostPercent = percent(
    input.targetFoodCostPercent,
    "targetFoodCostPercent",
  );
  const priceRoundingCents =
    optionalNumber(input.priceRoundingCents, "priceRoundingCents", {
      minimum: 0,
      exclusiveMinimum: true,
    }) ?? 100;
  if (!Number.isInteger(priceRoundingCents)) {
    throw new RangeError("priceRoundingCents must be an integer.");
  }
  if (!Array.isArray(input.menuItems) || input.menuItems.length === 0) {
    throw new TypeError("menuItems must be a non-empty array.");
  }

  return {
    currency,
    assumptions: [
      "Money inputs and outputs use integer minor units.",
      "Waste increases the as-purchased quantity needed for the usable recipe quantity.",
      "Only mass-to-mass, volume-to-volume, and count-to-count conversions are permitted.",
      "Suggested prices round upward by the configured priceRoundingCents increment.",
    ],
    menuItems: input.menuItems.map((item, itemIndex) =>
      calculateMenuItem(item, itemIndex, {
        targetFoodCostPercent,
        priceRoundingCents,
      }),
    ),
  };
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: node calculate-menu-cost.mjs <input.json|->");
  }
  const raw = inputPath === "-" ? await readStandardInput() : await readFile(inputPath, "utf8");
  const result = calculateMenuCosts(JSON.parse(raw));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
