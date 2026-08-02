import {
  DEFAULT_REPORT_FILTERS,
  getReportView,
  isReportKind,
  type ReportFilters,
} from "../../../../components/reports/report-data";
import { demoWorkspace } from "../../../../lib/demo";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function realDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function reportFromRequest(request: Request) {
  const search = new URL(request.url).searchParams;
  const kind = search.get("kind");
  if (!isReportKind(kind)) return { error: "Unknown report kind." } as const;

  const locationId = search.get("locationId") ?? DEFAULT_REPORT_FILTERS.locationId;
  if (
    locationId !== "all" &&
    !demoWorkspace.locations.some((location) => location.id === locationId)
  ) {
    return { error: "Unknown location." } as const;
  }

  const startsOn = search.get("startsOn") ?? DEFAULT_REPORT_FILTERS.startsOn;
  const endsOn = search.get("endsOn") ?? DEFAULT_REPORT_FILTERS.endsOn;
  if (!realDate(startsOn) || !realDate(endsOn) || startsOn > endsOn) {
    return { error: "Use a valid date range." } as const;
  }

  const filters: ReportFilters = { locationId, startsOn, endsOn };
  return { kind, filters, view: getReportView(kind, filters) } as const;
}
