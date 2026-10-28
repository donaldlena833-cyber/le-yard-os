import { cateringInquirySchema, cateringRequestId, type CateringInquiry } from "@/lib/catering-inquiry";

export const cateringPageSize = 20;
export type CateringAudience = "all" | "corporate" | "private_party";
export type CateringRegisterQuery = { audience: CateringAudience; page: number };
export type CateringRegisterEntry = { id: string; createdAt: string; brief: CateringInquiry };
export type CateringRegisterResult =
  | { ok: true; entries: CateringRegisterEntry[]; hasNext: boolean }
  | { ok: false; message: string };

export function parseCateringRegisterQuery(params: { audience?: string | string[]; page?: string | string[] }): CateringRegisterQuery {
  const audience = typeof params.audience === "string" && ["corporate", "private_party"].includes(params.audience)
    ? params.audience as CateringAudience : "all";
  const page = typeof params.page === "string" && /^[1-9]\d{0,3}$/.test(params.page) && Number(params.page) <= 1000
    ? Number(params.page) : 1;
  return { audience, page };
}

export function decodeCateringRegisterRows(rows: unknown): CateringRegisterResult {
  if (!Array.isArray(rows) || rows.length > cateringPageSize + 1) return { ok: false, message: "Catering inquiries could not be loaded. Try again." };
  const entries: CateringRegisterEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || !cateringRequestId.safeParse(row.id).success ||
      typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at)) ||
      row.status !== "received" || row.notification_status !== "not_configured") {
      return { ok: false, message: "Catering inquiries could not be loaded. Try again." };
    }
    const brief = cateringInquirySchema.safeParse(row.payload);
    if (!brief.success) return { ok: false, message: "Catering inquiries could not be loaded. Try again." };
    entries.push({ id: row.id, createdAt: row.created_at, brief: brief.data });
  }
  return { ok: true, entries: entries.slice(0, cateringPageSize), hasNext: entries.length > cateringPageSize };
}

export function cateringRegisterHref(query: CateringRegisterQuery, page: number) {
  return `/catering-inquiries?audience=${query.audience}&page=${page}`;
}
