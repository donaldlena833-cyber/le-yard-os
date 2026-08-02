import type { Guest } from "@/types";
import { encodeCsvRows } from "@/lib/exports/csv";

export function buildGuestCsv(guests: readonly Guest[]): string {
  return encodeCsvRows([
    ["name", "email", "phone", "vip", "visits", "lifetime_spend_cents"],
    ...guests.map((guest) => [
      `${guest.firstName} ${guest.lastName}`,
      guest.contact.email ?? "",
      guest.contact.phone ?? "",
      String(guest.vip),
      String(guest.visitCount),
      String(guest.lifetimeSpendCents),
    ]),
  ]);
}
