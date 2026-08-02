import "server-only";

export {
  addIsoDays,
  formatLocalDateTime,
  formatLocalTime,
  isIsoCalendarDate,
  isoDayDistance,
  localDateKey,
  localDateTimeParts,
  startOfWeekDate,
  zonedLocalToIso,
} from "./local-time";

export type LiveReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export function readSuccess<T>(data: T): LiveReadResult<T> {
  return { ok: true, data };
}

export function readFailure<T>(
  message = "Live restaurant data could not be loaded. Try again.",
): LiveReadResult<T> {
  return { ok: false, message };
}
