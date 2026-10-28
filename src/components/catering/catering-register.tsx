import Link from "next/link";
import { PageFrame, PageHeader } from "@/components/ui/page-frame";
import { ReadState } from "@/components/ui/read-state";
import { cateringRegisterHref, type CateringRegisterQuery, type CateringRegisterResult } from "@/lib/catering-register";

const value = (text: string | number | null) => text === "" || text === null ? "Not supplied" : text;
const label = (audience: string) => audience === "corporate" ? "Corporate catering" : "Offsite private-party catering";

export function CateringRegister({ result, query, demo, locationName }: { result: CateringRegisterResult; query: CateringRegisterQuery; demo: boolean; locationName: string }) {
  return <PageFrame width="standard">
    <PageHeader eyebrow={locationName} title="Catering inquiries" detail="Corporate gatherings and offsite private celebrations. Onsite private dining is a separate offer." />
    <aside className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-5 text-sm leading-6">
      {demo && <p className="mb-2 font-semibold">Sample inquiries — demonstration only. These are not customer requests.</p>}
      <p><strong>Initial inquiry owner: Donald.</strong> Check office@leyardny.com and follow up personally before delegating.</p>
      <p>Stored requests do not confirm availability, a quote or an order. Catering formats, capacity and first service date remain pending.</p>
      <p>Email delivery and follow-up are not recorded here. Review the brief, check feasibility with the kitchen, then prepare a reply.</p>
    </aside>
    <form action="/catering-inquiries" method="get" className="mb-6 flex flex-wrap items-end gap-3">
      <label className="grid gap-2 text-sm font-medium">Inquiry type
        <select name="audience" defaultValue={query.audience} className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-[var(--ink)]">
          <option value="all">Both catering audiences</option><option value="corporate">Corporate catering</option><option value="private_party">Offsite private-party catering</option>
        </select>
      </label>
      <button type="submit" className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-5 text-sm font-semibold">Apply filter</button>
    </form>
    {!result.ok ? <ReadState state="unavailable" title="Inquiries unavailable" description={result.message} /> : <>
      <p className="mb-4 text-sm">Page {query.page} · {result.entries.length} stored {result.entries.length === 1 ? "request" : "requests"} shown{demo ? " · sample data" : ""}. Quote, order and fulfillment outcomes are unavailable.</p>
      {!result.entries.length ? <ReadState state="empty" title="No stored inquiries on this page" description="This view covers only requests saved by direct intake for this location and filter. Email inquiries and activity elsewhere are not counted." /> :
        <div className="grid gap-4">{result.entries.map(({ id, createdAt, brief }) => <article key={id} className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide">{label(brief.audience)} · Received</p>
          <h2 className="mt-2 break-words text-lg font-semibold">{brief.occasion}</h2>
          <p className="mt-1 text-sm">{brief.contactName}{brief.company ? ` · ${brief.company}` : ""}</p>
          <p className="mt-2 break-all text-sm">{brief.email}{brief.phone ? ` · ${brief.phone}` : ""}</p>
          <dl className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div><dt className="font-semibold">Preferred date / time</dt><dd>{value(brief.eventDate)} · {value(brief.eventTime)}</dd></div>
            <div><dt className="font-semibold">Guests requested</dt><dd>{value(brief.guestCount)} · feasibility unconfirmed</dd></div>
            <div><dt className="font-semibold">Source</dt><dd>{brief.source.replaceAll("_", " ")}</dd></div>
          </dl>
          <details className="mt-5 border-t border-[var(--line)] pt-4">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold">Read full brief and receipt</summary>
            <dl className="grid gap-3 break-words text-sm leading-6">{[
              ["Offsite location", brief.location], ["Requested format", brief.format], ["Dietary requests", brief.dietaryNeeds],
              ["Budget", brief.budget], ["Notes", brief.notes],
              ["Stored at", new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(createdAt)) + " · New York"],
              ["Receipt ID", id], ["Service notice", brief.noticeVersion],
            ].map(([name, text]) => <div key={name}><dt className="font-semibold">{name}</dt><dd className="whitespace-pre-wrap">{value(text)}</dd></div>)}</dl>
            <p className="mt-4 text-sm">Service inquiry only. No marketing or profiling permission. Notification not configured; follow-up, quote, order and fulfillment not recorded.</p>
          </details>
        </article>)}</div>}
      <nav aria-label="Inquiry pages" className="mt-6 flex gap-4 text-sm font-semibold">
        {query.page > 1 && <Link className="inline-flex min-h-11 items-center underline" href={cateringRegisterHref(query, query.page - 1)}>Previous page</Link>}
        {result.hasNext && query.page < 1000 && <Link className="inline-flex min-h-11 items-center underline" href={cateringRegisterHref(query, query.page + 1)}>Next page</Link>}
      </nav>
    </>}
  </PageFrame>;
}
