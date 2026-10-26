import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CateringRegister } from "@/components/catering/catering-register";
import { parseCateringRegisterQuery, decodeCateringRegisterRows } from "@/lib/catering-register";
import { demoCateringRegister } from "@/lib/catering-register-demo";
import { loadCateringRegister } from "@/data/read-models/catering-inquiries";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
const query = { audience: "all" as const, page: 1 };
const sample = demoCateringRegister(query);
if (!sample.ok) throw Error("Fixture unavailable");
const row = { id: sample.entries[0].id, created_at: sample.entries[0].createdAt, status: "received", notification_status: "not_configured", payload: sample.entries[0].brief };
const workspace = { role: "owner", mode: "live", organization: { id: "org" }, activeLocation: { id: "location" } } as WorkspaceContextValue;
function client(data: unknown = [row], error: unknown = null) {
 const request = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue({ data, error }) };
 for (const method of [request.select, request.eq, request.order]) method.mockReturnValue(request);
 const from = vi.fn().mockReturnValue(request); createClient.mockResolvedValue({ from }); return { from, ...request };
}
beforeEach(() => vi.resetAllMocks());
describe("catering register boundaries", () => {
 it("bounds repeated, negative, huge and injected query parameters", () => {
   for (const page of ["0", "-1", "1001", "999999999", "1 or 1=1", ["2"]]) expect(parseCateringRegisterQuery({ page }).page).toBe(1);
   expect(parseCateringRegisterQuery({ page: "3", audience: "private_party" })).toEqual({ page: 3, audience: "private_party" });
   expect(parseCateringRegisterQuery({ audience: ["corporate"] }).audience).toBe("all");
 });
 it("fails closed on malformed records instead of reporting a zero", () => {
   for (const bad of [null, [{}], [{ ...row, payload: { ...row.payload, profileConsent: true } }], [{ ...row, status: "won" }], [{ ...row, id: "bad" }]]) expect(decodeCateringRegisterRows(bad).ok).toBe(false);
 });
 it("returns only a bounded page with a further-page indicator", () => {
   const result = decodeCateringRegisterRows(Array.from({ length: 21 }, () => row));
   expect(result.ok && result.entries.length).toBe(20); expect(result.ok && result.hasNext).toBe(true);
   expect(decodeCateringRegisterRows(Array.from({ length: 22 }, () => row)).ok).toBe(false);
 });
 it("rejects non-owners and demo contexts before a database call", async () => {
   for (const role of ["admin", "manager", "employee"] as const) expect((await loadCateringRegister({ ...workspace, role }, query)).ok).toBe(false);
   expect((await loadCateringRegister({ ...workspace, mode: "demo" }, query)).ok).toBe(false);
   expect(createClient).not.toHaveBeenCalled();
 });
 it("uses the session client and both active scope filters with stable bounded ordering", async () => {
   const db = client(); const result = await loadCateringRegister(workspace, { audience: "corporate", page: 2 });
   expect(result.ok).toBe(true); expect(db.from).toHaveBeenCalledWith("catering_inquiries");
   expect(db.eq.mock.calls).toEqual([["organization_id", "org"], ["location_id", "location"], ["payload->>audience", "corporate"]]);
   expect(db.order.mock.calls).toEqual([["created_at", { ascending: false }], ["id", { ascending: false }]]);
   expect(db.range).toHaveBeenCalledWith(20, 40);
   expect(db.select.mock.calls[0][0]).not.toMatch(/client_id|payload_hash|request_id/);
 });
 it("keeps all-audience reads equal and handles provider failure without raw errors", async () => {
   const db = client(null, { message: "SECRET DATABASE ERROR" }); const result = await loadCateringRegister(workspace, query);
   expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("SECRET"); expect(db.eq).toHaveBeenCalledTimes(2);
   createClient.mockRejectedValue(Error("SECRET")); expect((await loadCateringRegister(workspace, query)).ok).toBe(false);
 });
 it("labels synthetic requests and never implies customer, delivery or order outcomes", () => {
   const html = renderToStaticMarkup(<CateringRegister result={sample} query={query} demo locationName="Example location" />);
   expect(html).toContain("demonstration only"); expect(html).toContain("Corporate catering"); expect(html).toContain("Offsite private-party catering");
   expect(html).toContain("Notification not configured"); expect(html).toContain("Initial inquiry owner: Donald"); expect(html).not.toContain("mailto:");
 });
 it("escapes customer text and separates read failure from a genuine empty page", () => {
   const result = decodeCateringRegisterRows([{ ...row, payload: { ...row.payload, occasion: "<script>alert(1)</script>" } }]);
   const html = renderToStaticMarkup(<CateringRegister result={result} query={query} demo={false} locationName="Example" />);
   expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>alert");
   const error = renderToStaticMarkup(<CateringRegister result={{ ok: false, message: "Try again" }} query={query} demo={false} locationName="Example" />);
   expect(error).toContain("Inquiries unavailable"); expect(error).not.toContain("0 stored");
   const empty = renderToStaticMarkup(<CateringRegister result={{ ok: true, entries: [], hasNext: false }} query={query} demo={false} locationName="Example" />);
   expect(empty).toContain("Email inquiries and activity elsewhere are not counted");
 });
});
