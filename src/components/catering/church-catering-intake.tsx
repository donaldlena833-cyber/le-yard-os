"use client";

import { type FormEvent, useRef, useState } from "react";
import {
  convertChurchCateringIntakeAction,
  getChurchCateringIntakeAction,
  listChurchCateringIntakeAction,
} from "@/app/actions/workflows/church-catering-intake";
import { Button } from "@/components/ui/button";
import type { WorkflowActionResult } from "@/data/types";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import type { ChurchCateringIntakeDetail, ChurchCateringIntakeSummary } from "@/lib/integrations/church-catering-intake";
import {
  cateringJobServiceDate,
  cateringJobTitle,
  type CateringJob,
} from "@/lib/integrations/church-square-catering-jobs";

const audiences = { corporate: "Corporate event", private_party: "Private party" };
const sources: Readonly<Record<string, string>> = {
  direct: "Direct",
  google_business_profile: "Google Business Profile",
  tripadvisor: "Tripadvisor",
  apple_maps: "Apple Maps",
  bing_places: "Bing Places",
  instagram: "Instagram",
  facebook: "Facebook",
  nextdoor: "Nextdoor",
  website: "Website",
};
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" });
const labelClass = "grid min-w-0 gap-1 text-xs font-semibold";
const fieldClass = "focus-ring block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 text-sm text-[var(--ink)] disabled:opacity-60";

function CateringIntakeDetail({ inquiry }: { inquiry: ChurchCateringIntakeDetail }) {
  const fields = [
    ["Contact", inquiry.contactName], ["Email", inquiry.email], ["Phone", inquiry.phone], ["Company", inquiry.company],
    ["Occasion", inquiry.occasion], ["Requested time", inquiry.eventTime], ["Event location", inquiry.location],
    ["Service format", inquiry.format], ["Budget", inquiry.budget],
  ].filter(([, value]) => value);
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
      {fields.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-semibold text-[var(--ink-soft)]">{label}</dt>
          <dd className="whitespace-pre-wrap break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ChurchCateringIntake({ onConverted }: { onConverted: (job: CateringJob) => void }) {
  const [inquiries, setInquiries] = useState<readonly ChurchCateringIntakeSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChurchCateringIntakeDetail | null>(null);
  const [reading, setReading] = useState<"list" | "detail" | null>(null);
  const [saving, setSaving] = useState(false);
  const [listMessage, setListMessage] = useState("");
  const [detailMessage, setDetailMessage] = useState("");
  const readToken = useRef(0);
  const writePending = useRef(false);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();

  function closeDetails() {
    readToken.current += 1;
    setSelectedId(null);
    setDetail(null);
    setReading(null);
    setDetailMessage("");
  }

  function accessLost(result: WorkflowActionResult<unknown>) {
    if (result.ok || (result.code !== "unauthenticated" && result.code !== "forbidden")) return false;
    closeDetails();
    setInquiries(null);
    setListMessage("Church Street catering intake access is required.");
    return true;
  }

  async function loadIntake() {
    if (writePending.current) return;
    closeDetails();
    const token = readToken.current;
    setListMessage("");
    setReading("list");
    try {
      const result = await listChurchCateringIntakeAction();
      if (token !== readToken.current) return;
      if (result.ok && result.mode === "live") {
        setInquiries(result.data);
      } else if (!accessLost(result)) {
        setListMessage("The intake list could not be loaded. Try again.");
      }
    } catch {
      if (token === readToken.current) setListMessage("The intake list could not be loaded. Try again.");
    } finally {
      if (token === readToken.current) setReading(null);
    }
  }

  async function loadDetails(inquiryId: string) {
    if (writePending.current) return;
    closeDetails();
    const token = readToken.current;
    setSelectedId(inquiryId);
    setReading("detail");
    setListMessage("");
    try {
      const result = await getChurchCateringIntakeAction({ inquiryId });
      if (token !== readToken.current) return;
      if (result.ok && result.mode === "live" && result.data.id === inquiryId) {
        const received = result.data;
        setDetail(received);
        setInquiries((rows) => rows?.map((row) => row.id === inquiryId ? { ...row, jobId: received.jobId } : row) ?? null);
      } else if (!accessLost(result)) {
        setDetailMessage("These request details could not be loaded. Refresh intake and try again.");
      }
    } catch {
      if (token === readToken.current) setDetailMessage("These request details could not be loaded. Refresh intake and try again.");
    } finally {
      if (token === readToken.current) setReading(null);
    }
  }

  async function convert(event: FormEvent<HTMLFormElement>, inquiryId: string) {
    event.preventDefault();
    if (writePending.current || detail?.id !== inquiryId || detail.jobId) return;
    const fields = new FormData(event.currentTarget);
    const title = cateringJobTitle.safeParse(fields.get("title"));
    const serviceDate = cateringJobServiceDate.safeParse(fields.get("serviceDate"));
    if (!title.success || !serviceDate.success) {
      setDetailMessage("Enter an internal event name and a valid service date.");
      return;
    }
    const scope = `church-catering-intake:${inquiryId}`;
    const payload = { inquiryId, title: title.data, serviceDate: serviceDate.data };
    writePending.current = true;
    setSaving(true);
    setDetailMessage("");
    try {
      const result = await convertChurchCateringIntakeAction({ ...payload, requestId: requestIdFor(scope, payload) });
      if (result.ok && result.mode === "live" && result.persisted) {
        setInquiries((rows) => rows?.map((row) => row.id === inquiryId ? { ...row, jobId: result.data.id } : row) ?? null);
        rotateRequestId(scope);
        closeDetails();
        setListMessage("Catering job created in the Inquiry stage.");
        onConverted(result.data);
      } else if (!accessLost(result)) {
        setDetailMessage(!result.ok && (result.code === "conflict" || result.code === "stale")
          ? "The request may have changed. Refresh intake before trying again."
          : "The intake request could not be converted. Try again.");
      }
    } catch {
      setDetailMessage("The intake request could not be converted. Try again.");
    } finally {
      writePending.current = false;
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="church-catering-intake-heading" className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="church-catering-intake-heading" className="text-lg font-semibold">Church Street catering intake</h2>
          <p className="text-xs text-[var(--ink-soft)]">Review up to 50 website requests, with unlinked requests first. Create a catering job once you have a service date.</p>
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={saving || reading === "list"} onClick={() => void loadIntake()}>
          {reading === "list" ? "Loading intake…" : inquiries ? "Refresh intake" : "Load intake"}
        </Button>
      </div>
      {listMessage && <p role="status" className="text-sm">{listMessage}</p>}
      {inquiries?.length === 0 && <p className="text-sm text-[var(--ink-soft)]">No Church Street catering requests were returned.</p>}
      {inquiries && inquiries.length > 0 && (
        <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {inquiries.map((inquiry) => {
            const selected = selectedId === inquiry.id;
            const panelId = `church-catering-intake-detail-${inquiry.id}`;
            return (
              <li key={inquiry.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold">{audiences[inquiry.audience]} · <span className="font-mono text-xs">{inquiry.id.slice(-8)}</span></p>
                    <p className="text-xs text-[var(--ink-soft)]">
                      Requested date {inquiry.eventDate
                        ? <time dateTime={inquiry.eventDate}>{date.format(new Date(inquiry.eventDate))}</time>
                        : "undecided"} · {inquiry.guestCount === null ? "Guest count undecided" : `${inquiry.guestCount} guests`}
                    </p>
                    <p className="text-xs text-[var(--ink-soft)]">
                      Received <time dateTime={inquiry.receivedAt}>{time.format(new Date(inquiry.receivedAt))} ET</time>
                      {Object.hasOwn(sources, inquiry.source) && ` · ${sources[inquiry.source]}`} · {inquiry.jobId ? "Job created" : "Needs review"}
                    </p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" disabled={saving || reading === "list"}
                    aria-expanded={selected} aria-controls={selected ? panelId : undefined}
                    onClick={() => selected ? closeDetails() : void loadDetails(inquiry.id)}>
                    {selected ? "Close details" : "View private details"}
                    <span className="sr-only"> for {audiences[inquiry.audience]} {inquiry.id.slice(-8)}</span>
                  </Button>
                </div>
                {selected && (
                  <div id={panelId} className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3">
                    {reading === "detail" && <p role="status" className="text-sm text-[var(--ink-soft)]">Loading private details…</p>}
                    {detail?.id === inquiry.id && <>
                      <CateringIntakeDetail inquiry={detail} />
                      {detail.jobId ? <p className="text-sm font-semibold">A catering job is already linked to this request.</p> : (
                        <form className="space-y-2 border-t border-[var(--line)] pt-3" onSubmit={(event) => void convert(event, inquiry.id)}>
                          <p id={`${panelId}-help`} className="text-xs text-[var(--ink-soft)]">Use a short event label without guest names or contact details. This creates an internal inquiry for follow-up.</p>
                          <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_auto] sm:items-end">
                            <label className={labelClass}>
                              Internal event name
                              <input name="title" autoComplete="off" className={fieldClass} required maxLength={120} aria-describedby={`${panelId}-help`} />
                            </label>
                            <label className={labelClass}>
                              Service date
                              <input name="serviceDate" className={fieldClass} type="date" min="2000-01-01" max="2100-12-31" required />
                            </label>
                            <Button type="submit" variant="primary" size="sm">{saving ? "Creating inquiry…" : "Create inquiry job"}</Button>
                          </fieldset>
                        </form>
                      )}
                    </>}
                    {detailMessage && <p role="status" className="text-sm">{detailMessage}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
