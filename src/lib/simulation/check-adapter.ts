import { fullServiceDayScenario } from "./full-service-day-v1.ts";
import type {
  ServiceScenarioMenuLine,
  ServiceScenarioServicePeriod,
  ServiceScenarioV1,
} from "./types.ts";

export interface SyntheticPosCheckLine {
  id: string;
  menuLineId: string;
  name: string;
  unitPriceCents: number;
  disposition: ServiceScenarioMenuLine["disposition"];
  recipeId: string | null;
}

export interface SyntheticPosCheck {
  id: string;
  servicePeriodId: "lunch" | "dinner";
  tableLabel: string;
  openedAt: string;
  covers: number;
  lines: SyntheticPosCheckLine[];
  grossSalesCents: number;
  compsCents: number;
  voidsCents: number;
  netSalesCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  cashTipsCents: number;
  cardTipsCents: number;
  ticketSeconds: number;
  source: "synthetic_pos_check_adapter";
}

export interface RecipeConsumptionMovement {
  id: string;
  servicePeriodId: "lunch" | "dinner";
  recipeId: string;
  menuLineId: string;
  quantity: number;
  movementKind: "recipe_consumption";
  source: "synthetic_pos_check_adapter";
}

export interface PrepUsageExpectation {
  recipeId: string;
  plannedQuantity: number;
  usedQuantity: number;
  remainingQuantity: number;
  source: "synthetic_pos_check_adapter";
}

export interface InventoryCountExpectation {
  itemId: string;
  startingQuantity: number;
  recipeConsumptionQuantity: number;
  wasteQuantity: number;
  expectedCountQuantity: number;
  firstBlindCountQuantity: number;
  finalCountQuantity: number;
  varianceResolved: boolean;
  unit: "portion";
}

export interface StructuredWasteMovement {
  id: string;
  itemId: string;
  quantity: number;
  reason: "quality_damage" | "service_misfire";
  sourceEventId: string;
}

export interface SyntheticPosFixture {
  adapter: "synthetic_pos_check_adapter";
  connectedProvider: null;
  checks: SyntheticPosCheck[];
  recipeConsumption: RecipeConsumptionMovement[];
  prepUsage: PrepUsageExpectation[];
  inventoryExpectations: InventoryCountExpectation[];
  waste: StructuredWasteMovement[];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function allocate(total: number, weights: number[]): number[] {
  const weightTotal = sum(weights);
  if (total === 0 || weightTotal === 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / weightTotal);
  const allocated = exact.map(Math.floor);
  const remainder = total - sum(allocated);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort(
      (left, right) =>
        right.fraction - left.fraction || left.index - right.index,
    );
  for (let index = 0; index < remainder; index += 1) {
    allocated[order[index % order.length]!.index]! += 1;
  }
  return allocated;
}

function expandMenuLines(lines: ServiceScenarioMenuLine[]): SyntheticPosCheckLine[] {
  return lines.flatMap((line) =>
    Array.from({ length: line.quantity }, (_, index) => ({
      id: `${line.id}-${String(index + 1).padStart(2, "0")}`,
      menuLineId: line.id,
      name: line.name,
      unitPriceCents: line.unitPriceCents,
      disposition: line.disposition,
      recipeId: line.recipeId,
    })),
  );
}

function createCheckShells(
  scenario: ServiceScenarioV1,
  period: ServiceScenarioServicePeriod,
): Array<Pick<SyntheticPosCheck, "id" | "servicePeriodId" | "tableLabel" | "openedAt" | "covers">> {
  if (period.id === "dinner") {
    return scenario.floor.assignments.map((assignment, index) => ({
      id: `scenario-check-dinner-${String(index + 1).padStart(2, "0")}`,
      servicePeriodId: "dinner",
      tableLabel: assignment.tableLabel,
      openedAt: assignment.startsAt,
      covers: assignment.partySize,
    }));
  }
  return Array.from({ length: 12 }, (_, index) => ({
    id: `scenario-check-lunch-${String(index + 1).padStart(2, "0")}`,
    servicePeriodId: "lunch" as const,
    tableLabel: `L${String(index + 1).padStart(2, "0")}`,
    openedAt: `2026-04-18T${index < 4 ? "11:30" : index < 8 ? "11:45" : "12:00"}:00-04:00`,
    covers: 3,
  }));
}

function createPeriodChecks(
  scenario: ServiceScenarioV1,
  period: ServiceScenarioServicePeriod,
): SyntheticPosCheck[] {
  const shells = createCheckShells(scenario, period);
  const lines = expandMenuLines(
    scenario.menuLines.filter((line) => line.servicePeriodId === period.id),
  );
  const linesByCheck = shells.map(() => [] as SyntheticPosCheckLine[]);
  lines.forEach((line, index) => {
    linesByCheck[index % shells.length]!.push(line);
  });
  const netWeights = linesByCheck.map((checkLines) =>
    sum(
      checkLines
        .filter((line) => line.disposition === "sale")
        .map((line) => line.unitPriceCents),
    ),
  );
  const cashSales = allocate(period.cashSalesCents, netWeights);
  const cashTips = allocate(period.cashTipsCents, netWeights);
  const cardTips = allocate(period.cardTipsCents, netWeights);

  return shells.map((shell, index) => {
    const checkLines = linesByCheck[index]!;
    const sale = sum(
      checkLines
        .filter((line) => line.disposition === "sale")
        .map((line) => line.unitPriceCents),
    );
    const comps = sum(
      checkLines
        .filter((line) => line.disposition === "comp")
        .map((line) => line.unitPriceCents),
    );
    const voids = sum(
      checkLines
        .filter((line) => line.disposition === "void")
        .map((line) => line.unitPriceCents),
    );
    return {
      ...shell,
      lines: checkLines,
      grossSalesCents: sale + comps + voids,
      compsCents: comps,
      voidsCents: voids,
      netSalesCents: sale,
      cashSalesCents: cashSales[index]!,
      cardSalesCents: sale - cashSales[index]!,
      cashTipsCents: cashTips[index]!,
      cardTipsCents: cardTips[index]!,
      ticketSeconds:
        period.id === "dinner" && shell.tableLabel === "9" ? 1_920 : 1_080 + index * 17,
      source: "synthetic_pos_check_adapter",
    };
  });
}

export function createSyntheticPosFixture(
  scenario: ServiceScenarioV1 = fullServiceDayScenario,
): SyntheticPosFixture {
  const checks = scenario.servicePeriods.flatMap((period) =>
    createPeriodChecks(scenario, period),
  );
  const recipeConsumption = scenario.menuLines
    .filter(
      (line) =>
        line.recipeId !== null &&
        (line.disposition === "sale" || line.disposition === "comp"),
    )
    .map((line) => ({
      id: `consumption-${line.id}`,
      servicePeriodId: line.servicePeriodId,
      recipeId: line.recipeId!,
      menuLineId: line.id,
      quantity: line.quantity,
      movementKind: "recipe_consumption" as const,
      source: "synthetic_pos_check_adapter" as const,
    }));
  const waste: StructuredWasteMovement[] = [
    {
      id: "waste-oyster-quality",
      itemId: "dinner-oysters",
      quantity: 1,
      reason: "quality_damage",
      sourceEventId: "oysters-86-substitution",
    },
    {
      id: "waste-cocktail-misfire",
      itemId: "dinner-cocktail-void",
      quantity: 2,
      reason: "service_misfire",
      sourceEventId: "lost-response",
    },
  ];
  const prepUsage: PrepUsageExpectation[] = recipeConsumption.map((movement) => ({
    recipeId: movement.recipeId,
    plannedQuantity:
      movement.quantity + (movement.recipeId === "dinner-oysters" ? 1 : 2),
    usedQuantity: movement.quantity,
    remainingQuantity: movement.recipeId === "dinner-oysters" ? 1 : 2,
    source: "synthetic_pos_check_adapter",
  }));
  const inventoryExpectations: InventoryCountExpectation[] =
    recipeConsumption.map((movement) => {
      const wasteQuantity =
        waste.find((entry) => entry.itemId === movement.menuLineId)?.quantity ?? 0;
      const buffer = movement.recipeId === "dinner-oysters" ? 0 : 2;
      const expectedCountQuantity = buffer;
      const hasBlindCountVariance = movement.recipeId === "dinner-steak";
      return {
        itemId: movement.recipeId,
        startingQuantity: movement.quantity + wasteQuantity + buffer,
        recipeConsumptionQuantity: movement.quantity,
        wasteQuantity,
        expectedCountQuantity,
        firstBlindCountQuantity: hasBlindCountVariance
          ? expectedCountQuantity - 1
          : expectedCountQuantity,
        finalCountQuantity: expectedCountQuantity,
        varianceResolved: true,
        unit: "portion" as const,
      };
    });
  return {
    adapter: "synthetic_pos_check_adapter",
    connectedProvider: null,
    checks,
    recipeConsumption,
    prepUsage,
    inventoryExpectations,
    waste,
  };
}
