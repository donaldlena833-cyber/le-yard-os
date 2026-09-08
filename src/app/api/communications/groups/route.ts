import { z } from "zod";
import { requirePhoneAccess } from "@/lib/phone-access.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setCommunicationThreadMode } from "@/lib/communication-groups.server";

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);
const querySchema = z.object({
  group: z.enum(["clients", "team", "tickets"]).default("clients"),
  phone: phoneSchema.optional(),
  before: z.string().datetime({ offset: true }).optional(),
  beforeSid: z
    .string()
    .regex(/^(SM|MM)[a-f0-9]{32}$/i)
    .optional(),
  beforeCase: z.string().datetime({ offset: true }).optional(),
  beforeCaseId: z.string().uuid().optional(),
  beforeNote: z.string().datetime({ offset: true }).optional(),
  beforeNoteId: z.string().uuid().optional(),
  caseId: z.string().uuid().optional(),
});
export async function GET(request: Request) {
  try {
    const w = await requirePhoneAccess();
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return json({ error: "Invalid history filter." }, 400);
    const q = parsed.data;
    const admin = createAdminClient();
    const org = w.organization.id;
    const loc = w.activeLocation.id;
    if (q.caseId) {
      const item = await admin
        .from("communication_case_summaries")
        .select("*")
        .eq("organization_id", org)
        .eq("location_id", loc)
        .eq("id", q.caseId)
        .maybeSingle();
      if (item.error) throw item.error;
      if (!item.data) return json({ error: "Ticket not found." }, 404);
      let noteQuery = admin
        .from("communication_case_notes")
        .select("id,case_id,author_name,body,status,created_at")
        .eq("organization_id", org)
        .eq("case_id", q.caseId);
      if (q.beforeNote && q.beforeNoteId)
        noteQuery = noteQuery.or(
          `created_at.lt.${q.beforeNote},and(created_at.eq.${q.beforeNote},id.lt.${q.beforeNoteId})`,
        );
      const notes = await noteQuery
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(101);
      if (notes.error) throw notes.error;
      const source = item.data.source_sid
        ? await admin
            .from("communication_messages")
            .select("sid,media_count,audience")
            .eq("organization_id", org)
            .eq("location_id", loc)
            .eq("sid", item.data.source_sid)
            .maybeSingle()
        : { data: null, error: null };
      if (source.error) throw source.error;
      return json({
        item: item.data,
        notes: notes.data.slice(0, 100).reverse(),
        moreNotes: notes.data.length > 100,
        source: source.data,
      });
    }
    let messages = admin
      .from("communication_messages")
      .select(
        "sid,from_number,to_number,body,direction,sender_kind,audience,contact_name,media_count,status,error_code,sent_at",
      )
      .eq("organization_id", org)
      .eq("location_id", loc)
      .eq("audience", q.group === "team" ? "team" : "client");
    if (q.phone) messages = messages.eq("phone", q.phone);
    if (q.before && q.beforeSid)
      messages = messages.or(
        `sent_at.lt.${q.before},and(sent_at.eq.${q.before},sid.lt.${q.beforeSid})`,
      );
    let caseQuery = admin
      .from("communication_case_summaries")
      .select("id,kind,title,body,phone,source_sid,created_at,status")
      .eq("organization_id", org)
      .eq("location_id", loc);
    if (q.beforeCase && q.beforeCaseId)
      caseQuery = caseQuery.or(
        `created_at.lt.${q.beforeCase},and(created_at.eq.${q.beforeCase},id.lt.${q.beforeCaseId})`,
      );
    const [history, cases, threads] = await Promise.all([
      messages
        .order("sent_at", { ascending: false })
        .order("sid", { ascending: false })
        .limit(101),
      caseQuery
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(101),
      admin
        .from("communication_threads")
        .select("phone,mode,reason")
        .eq("organization_id", org)
        .eq("location_id", loc),
    ]);
    if (history.error || cases.error || threads.error)
      throw new Error("History unavailable.");
    return json({
      messages: history.data.slice(0, 100).reverse(),
      more: history.data.length > 100,
      cases: cases.data.slice(0, 100),
      moreCases: cases.data.length > 100,
      notes: [],
      threads: threads.data,
    });
  } catch (e) {
    return e instanceof Response
      ? e
      : json(
          {
            error:
              "Groups are temporarily unavailable. Your saved history has not been cleared.",
          },
          503,
        );
  }
}
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      requestId: z.string().uuid(),
      title: z.string().trim().min(1).max(160),
      body: z.string().max(10000),
      phone: phoneSchema.optional(),
      sourceSid: z
        .string()
        .regex(/^(SM|MM)[a-f0-9]{32}$/i)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("note"),
      requestId: z.string().uuid(),
      caseId: z.string().uuid(),
      body: z.string().trim().min(1).max(10000),
      status: z.enum(["open", "resolved"]).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("mode"),
      phone: phoneSchema,
      mode: z.enum(["human", "automation"]),
    })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    if (
      request.headers.get("origin") !==
      new URL(process.env.NEXT_PUBLIC_APP_URL!).origin
    )
      return json({ error: "Forbidden" }, 403);
    const w = await requirePhoneAccess();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return json({ error: "Check the request details." }, 400);
    const input = parsed.data;
    const admin = createAdminClient();
    const org = w.organization.id;
    const loc = w.activeLocation.id;
    if (input.action === "mode") {
      await setCommunicationThreadMode(
        input.phone,
        input.mode,
        "Changed by an operator in Groups.",
      );
      return json({ ok: true });
    }
    if (input.action === "create") {
      if (input.sourceSid) {
        const source = await admin
          .from("communication_messages")
          .select("sid,from_number,to_number")
          .eq("organization_id", org)
          .eq("location_id", loc)
          .eq("sid", input.sourceSid)
          .maybeSingle();
        if (source.error) throw source.error;
        if (
          !source.data ||
          (input.phone &&
            source.data.from_number !== input.phone &&
            source.data.to_number !== input.phone)
        )
          return json(
            { error: "Source message not found in this conversation." },
            404,
          );
      }
      const payload = {
        id: input.requestId,
        organization_id: org,
        location_id: loc,
        kind: "ticket",
        title: input.title,
        body: input.body,
        phone: input.phone ?? null,
        source_sid: input.sourceSid ?? null,
        created_by: w.identity.userId,
      };
      const prior = await admin
        .from("communication_cases")
        .select("*")
        .eq("id", input.requestId)
        .maybeSingle();
      if (prior.error) throw prior.error;
      if (prior.data)
        return Object.entries(payload).every(
          ([k, v]) => prior.data![k as keyof typeof prior.data] === v,
        )
          ? json({ ok: true, id: input.requestId })
          : json({ error: "This request ID is already in use." }, 409);
      const saved = await admin.from("communication_cases").insert(payload);
      if (saved.error) {
        if (saved.error.code === "23505")
          return json(
            {
              error:
                "This message already has a ticket. Open Tickets to continue.",
            },
            409,
          );
        throw saved.error;
      }
      return json({ ok: true, id: input.requestId }, 201);
    }
    const item = await admin
      .from("communication_cases")
      .select("id")
      .eq("organization_id", org)
      .eq("location_id", loc)
      .eq("id", input.caseId)
      .maybeSingle();
    if (item.error) throw item.error;
    if (!item.data) return json({ error: "Ticket not found." }, 404);
    const payload = {
      id: input.requestId,
      organization_id: org,
      case_id: input.caseId,
      author_id: w.identity.userId,
      author_name: w.identity.displayName,
      body: input.body,
      status: input.status ?? null,
    };
    const prior = await admin
      .from("communication_case_notes")
      .select("*")
      .eq("id", input.requestId)
      .maybeSingle();
    if (prior.error) throw prior.error;
    if (prior.data)
      return Object.entries(payload).every(
        ([k, v]) => prior.data![k as keyof typeof prior.data] === v,
      )
        ? json({ ok: true })
        : json({ error: "This request ID is already in use." }, 409);
    const saved = await admin.from("communication_case_notes").insert(payload);
    if (saved.error) throw saved.error;
    return json({ ok: true }, 201);
  } catch (e) {
    return e instanceof Response
      ? e
      : json(
          { error: "The change could not be saved. Refresh before retrying." },
          503,
        );
  }
}
