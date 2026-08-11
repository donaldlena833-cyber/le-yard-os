export interface AvailabilityTable {
  id: string;
  label: string;
  minCapacity: number;
  maxCapacity: number;
  isBookable: boolean;
  isActive: boolean;
}

export interface AvailabilityCombination {
  id: string;
  label: string;
  minCapacity: number;
  maxCapacity: number;
  tableIds: string[];
  isActive: boolean;
}

export interface AvailabilityAllocation {
  tableId: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  expiresAt?: string | null;
}

export interface TableSuggestion {
  key: string;
  label: string;
  tableIds: string[];
  capacity: number;
  excessSeats: number;
  combined: boolean;
}

export interface PacingReservation {
  startsAt: string;
  partySize: number;
  status: string;
}

export function isIsoCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function suggestTables(input: {
  partySize: number;
  startsAt: string;
  durationMinutes: number;
  tables: AvailabilityTable[];
  combinations?: AvailabilityCombination[];
  allocations: AvailabilityAllocation[];
  now?: string;
}): TableSuggestion[] {
  const startsAt = new Date(input.startsAt).valueOf();
  const endsAt = startsAt + input.durationMinutes * 60_000;
  const now = new Date(input.now ?? new Date().toISOString()).valueOf();
  const unavailable = new Set(
    input.allocations
      .filter((allocation) => {
        if (!allocation.isActive) return false;
        if (allocation.expiresAt && new Date(allocation.expiresAt).valueOf() <= now) return false;
        return overlaps(
          startsAt,
          endsAt,
          new Date(allocation.startsAt).valueOf(),
          new Date(allocation.endsAt).valueOf(),
        );
      })
      .map((allocation) => allocation.tableId),
  );

  const tableById = new Map(input.tables.map((table) => [table.id, table]));
  const singles: TableSuggestion[] = input.tables
    .filter((table) =>
      table.isActive
      && table.isBookable
      && table.minCapacity <= input.partySize
      && table.maxCapacity >= input.partySize
      && !unavailable.has(table.id),
    )
    .map((table) => ({
      key: `table:${table.id}`,
      label: table.label,
      tableIds: [table.id],
      capacity: table.maxCapacity,
      excessSeats: table.maxCapacity - input.partySize,
      combined: false,
    }));

  const combinations: TableSuggestion[] = (input.combinations ?? [])
    .filter((combination) => {
      if (!combination.isActive) return false;
      if (combination.minCapacity > input.partySize || combination.maxCapacity < input.partySize) return false;
      return combination.tableIds.every((id) => {
        const table = tableById.get(id);
        return table?.isActive && table.isBookable && !unavailable.has(id);
      });
    })
    .map((combination) => ({
      key: `combination:${combination.id}`,
      label: combination.label,
      tableIds: [...combination.tableIds],
      capacity: combination.maxCapacity,
      excessSeats: combination.maxCapacity - input.partySize,
      combined: true,
    }));

  return [...singles, ...combinations].sort((left, right) =>
    left.excessSeats - right.excessSeats
    || Number(left.combined) - Number(right.combined)
    || left.tableIds.length - right.tableIds.length
    || left.label.localeCompare(right.label, "en-US"),
  );
}

export function isPacingAvailable(input: {
  startsAt: string;
  partySize: number;
  intervalMinutes: number;
  coverLimit: number;
  reservations: PacingReservation[];
}) {
  const startsAt = new Date(input.startsAt).valueOf();
  const interval = input.intervalMinutes * 60_000;
  const covers = input.reservations
    .filter((reservation) =>
      !["cancelled", "no_show"].includes(reservation.status)
      && Math.abs(new Date(reservation.startsAt).valueOf() - startsAt) < interval,
    )
    .reduce((total, reservation) => total + reservation.partySize, 0);
  return covers + input.partySize <= input.coverLimit;
}

export function selectTurnDuration(
  partySize: number,
  fallbackMinutes: number,
  rules: Array<{ minPartySize: number; maxPartySize: number; durationMinutes: number }>,
) {
  return rules.find((rule) => partySize >= rule.minPartySize && partySize <= rule.maxPartySize)
    ?.durationMinutes ?? fallbackMinutes;
}
