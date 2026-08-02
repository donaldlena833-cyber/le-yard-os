import { demoWorkspace } from "@/lib/demo";
import type { AICitation } from "@/types";
import type { OperationsAnswer } from "./guardrails";

function citation(
  id: string,
  entityType: string,
  entityId: string,
  label: string,
  excerpt: string,
  occurredAt: string,
): AICitation {
  return { id, entityType, entityId, label, excerpt, occurredAt };
}

function receiptAnswer(): OperationsAnswer {
  const review = demoWorkspace.receipts.filter((item) => item.reviewStatus === "needs_review");
  const total = review.reduce((sum, item) => sum + item.totalCents, 0);
  return {
    id: "answer-receipts",
    title: `${review.length} receipt${review.length === 1 ? "" : "s"} need review`,
    summary: `The synthetic review queue totals $${(total / 100).toFixed(2)}. Verify extracted vendor, date, tax, total, and duplicate status before linking any document to an expense or inventory purchase.`,
    confidence: 0.99,
    citations: review.slice(0, 3).map((item) => citation(
      `answer-receipt-${item.id}`,
      "receipt",
      item.id,
      item.documentNumber || "Unnumbered receipt",
      `Review status: ${item.reviewStatus}; detected total $${(item.totalCents / 100).toFixed(2)}`,
      item.updatedAt,
    )),
    proposedAction: null,
    sourceMode: "deterministic_demo",
  };
}

function inventoryAnswer(): OperationsAnswer {
  const belowPar = demoWorkspace.inventoryCounts.flatMap((count) =>
    count.lines.flatMap((line) => {
      const item = demoWorkspace.inventoryItems.find((candidate) => candidate.id === line.itemId);
      const par = item?.locationSettings.find((setting) => setting.locationId === count.locationId)?.parLevel;
      return item && par !== undefined && line.countedQuantity < par
        ? [{ item, quantity: line.countedQuantity, par, locationId: count.locationId, occurredAt: count.updatedAt }]
        : [];
    }),
  );
  const priceInsight = demoWorkspace.aiInsights.find((item) => item.kind === "anomaly");
  return {
    id: "answer-inventory",
    title: `${belowPar.length} item${belowPar.length === 1 ? " is" : "s are"} below par`,
    summary: `${belowPar.map(({ item }) => item.name).join(", ") || "No items"} are below their configured demo par levels. The most recent recorded price anomaly should be reviewed against its cited vendor prices before changing a purchase plan.`,
    confidence: 0.98,
    citations: [
      ...belowPar.slice(0, 2).map(({ item, quantity, par, locationId, occurredAt }) => citation(
        `answer-inventory-${item.id}-${locationId}`,
        "inventory_item",
        item.id,
        item.name,
        `${quantity} ${item.baseUnit} counted; par ${par}`,
        occurredAt,
      )),
      ...(priceInsight?.citations.slice(0, 1) || []),
    ],
    proposedAction: null,
    sourceMode: "deterministic_demo",
  };
}

function laborAnswer(): OperationsAnswer {
  const minutes = demoWorkspace.timecards.reduce((sum, item) => sum + item.regularMinutes, 0);
  const overtime = demoWorkspace.timecards.reduce((sum, item) => sum + item.overtimeMinutes, 0);
  const pending = demoWorkspace.timecardCorrections.filter((item) => item.status === "pending");
  const firstTimecard = demoWorkspace.timecards[0];
  return {
    id: "answer-labor",
    title: "Labor snapshot requires one human review",
    summary: `Recorded demo timecards contain ${(minutes / 60).toFixed(1)} regular hours and ${(overtime / 60).toFixed(1)} overtime hours. ${pending.length} punch correction remains pending; reported hours should not be exported as final payroll until it is approved or declined.`,
    confidence: 0.97,
    citations: [
      citation("answer-labor-timecards", "timecard", firstTimecard?.id || "timecards", "Current timecards", `${demoWorkspace.timecards.length} timecards included in the local snapshot`, firstTimecard?.updatedAt || demoWorkspace.asOf),
      ...pending.slice(0, 2).map((item) => citation("answer-labor-correction", "timecard_correction", item.id, "Pending punch correction", item.reason, item.updatedAt)),
    ],
    proposedAction: null,
    sourceMode: "deterministic_demo",
  };
}

function guestAnswer(): OperationsAnswer {
  const vipGuests = demoWorkspace.guests.filter((guest) => guest.vip);
  const reservations = demoWorkspace.reservations.filter((reservation) => reservation.status === "booked" || reservation.status === "seated");
  const guest = vipGuests[0] || demoWorkspace.guests[0];
  return {
    id: "answer-guests",
    title: `${reservations.length} active reservation${reservations.length === 1 ? "" : "s"} in the demo snapshot`,
    summary: `${vipGuests.length} guest profile${vipGuests.length === 1 ? " is" : "s are"} flagged VIP. Allergy and contact details remain permission-restricted; this answer does not change any guest record.`,
    confidence: 0.96,
    citations: guest ? [citation("answer-guest-profile", "guest", guest.id, `${guest.firstName} ${guest.lastName}`, `VIP: ${guest.vip ? "yes" : "no"}; visits: ${guest.visitCount}`, guest.updatedAt)] : [],
    proposedAction: null,
    sourceMode: "deterministic_demo",
  };
}

function serviceAnswer(): OperationsAnswer {
  const open = demoWorkspace.shifts.filter((shift) => shift.status === "open");
  const alerts = demoWorkspace.alerts.filter((alert) => alert.status === "open");
  return {
    id: "answer-service",
    title: `${alerts.length} operational signal${alerts.length === 1 ? "" : "s"} need attention`,
    summary: `${open.length} published shift remains open. The current synthetic snapshot also includes ${alerts.filter((alert) => alert.kind === "inventory").length} inventory warning and ${alerts.filter((alert) => alert.kind === "attendance").length} attendance review. Open the cited records before making a decision.`,
    confidence: 0.94,
    citations: alerts.slice(0, 4).map((alert) => citation(
      `answer-alert-${alert.id}`,
      alert.sourceEntityType,
      alert.sourceEntityId,
      alert.title,
      alert.detail,
      alert.updatedAt,
    )),
    proposedAction: null,
    sourceMode: "deterministic_demo",
  };
}

export function runDemoOperationsQuery(query: string): OperationsAnswer {
  const normalized = query.toLowerCase();
  if (/receipt|invoice|expense|vendor bill/.test(normalized)) return receiptAnswer();
  if (/inventory|stock|par|waste|cost|price|cogs/.test(normalized)) return inventoryAnswer();
  if (/labor|hour|overtime|payroll|punch|clock/.test(normalized)) return laborAnswer();
  if (/guest|vip|reservation|allerg|crm/.test(normalized)) return guestAnswer();
  return serviceAnswer();
}
