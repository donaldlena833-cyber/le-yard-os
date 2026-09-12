"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  communicationGroups,
  caseStatus,
  type CommunicationCase,
  type CommunicationGroup,
  type CommunicationMessage,
  type CommunicationNote,
} from "@/lib/communication-groups";
import s from "./communication-groups.module.css";

type Model = {
  messages: CommunicationMessage[];
  more: boolean;
  moreCases?: boolean;
  cases: CommunicationCase[];
  notes: CommunicationNote[];
  threads: {
    phone: string;
    mode: "human" | "automation";
    reason: string | null;
  }[];
};
function mergeMessages(a: CommunicationMessage[], b: CommunicationMessage[]) {
  return [...new Map([...a, ...b].map((m) => [m.sid, m])).values()].sort(
    (x, y) => x.sent_at.localeCompare(y.sent_at) || x.sid.localeCompare(y.sid),
  );
}
const stamp = (at: string) =>
  new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
const counterpart = (m: CommunicationMessage) =>
  m.direction === "outbound" ? m.to_number : m.from_number;
export function CommunicationGroups({
  group,
  initialPhone = "",
}: {
  group: CommunicationGroup;
  initialPhone?: string;
}) {
  const [model, setModel] = useState<Model | null>(null);
  const [phone, setPhone] = useState(initialPhone);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [consent, setConsent] = useState(false);
  const [attachments, setAttachments] = useState<
    { path: string; name: string }[]
  >([]);
  const [newNumber, setNewNumber] = useState("");
  const [creating, setCreating] = useState(false);
  const [ticket, setTicket] = useState<CommunicationCase | null>(null);
  const [ticketNotes, setTicketNotes] = useState<CommunicationNote[]>([]);
  const [moreNotes, setMoreNotes] = useState(false);
  const [source, setSource] = useState<{
    sid: string;
    media_count: number;
    audience: string;
  } | null>(null);
  const [newTicket, setNewTicket] = useState<{
    title: string;
    body: string;
    phone?: string;
    sourceSid?: string;
  } | null>(null);
  const [needsHuman, setNeedsHuman] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const loading = useRef(false);
  const config = communicationGroups.find((g) => g.id === group)!;
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    const current = ++generation.current;
    try {
      const response = await fetch(
        `/api/communications/groups?group=${group}${phone ? `&phone=${encodeURIComponent(phone)}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(20000) },
      );
      if (!response.ok)
        throw Error(
          response.status === 401
            ? "Your session has ended. Sign in again."
            : "Groups could not refresh. Saved messages are still available when the connection returns.",
        );
      const data = await response.json();
      if (mounted.current && current === generation.current) {
        setModel((previous) =>
          previous
            ? {
                ...data,
                messages: mergeMessages(previous.messages, data.messages),
                cases: [
                  ...new Map(
                    [...previous.cases, ...data.cases].map((c) => [c.id, c]),
                  ).values(),
                ].sort((a, b) => b.created_at.localeCompare(a.created_at)),
                more: previous.more && data.more,
                moreCases: previous.moreCases && data.moreCases,
              }
            : data,
        );
        setError("");
      }
    } catch (e) {
      if (mounted.current && current === generation.current)
        setError(e instanceof Error ? e.message : "Groups unavailable.");
    } finally {
      loading.current = false;
    }
  }, [group, phone]);
  const invalidateRequests = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    mounted.current = true;
    loading.current = false;
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    return () => {
      mounted.current = false;
      invalidateRequests();
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh, invalidateRequests]);
  const loadTicket = useCallback(async (item: CommunicationCase) => {
    const response = await fetch(
      `/api/communications/groups?caseId=${item.id}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw Error("Ticket conversation could not load.");
    const data = await response.json();
    setTicket(data.item);
    setTicketNotes((previous) => {
      const same = previous.every((n) => n.case_id === item.id);
      return same
        ? [
            ...new Map(
              [...previous, ...data.notes].map((n) => [n.id, n]),
            ).values(),
          ].sort(
            (a, b) =>
              a.created_at.localeCompare(b.created_at) ||
              a.id.localeCompare(b.id),
          )
        : data.notes;
    });
    setMoreNotes(data.moreNotes);
    setSource(data.source);
  }, []);
  useEffect(() => {
    if (!ticket) return;
    let active = true;
    const timer = setInterval(() => {
      if (active && document.visibilityState === "visible")
        void loadTicket(ticket).catch(() =>
          setError("Ticket updates are unavailable."),
        );
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ticket, loadTicket]);
  function choosePhone(value: string) {
    if (busy) return;
    generation.current++;
    setPhone(value);
    setModel(null);
    setDraft("");
    setAttachments([]);
    setConsent(false);
    setNotice("");
    setCreating(false);
    pending.current = null;
  }
  async function mutate(
    payload: Record<string, unknown>,
    endpoint = "/api/communications/groups",
  ) {
    const fingerprint = JSON.stringify(payload);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, id: crypto.randomUUID() };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        ...(payload.action === "mode" ? {} : { requestId: pending.current.id }),
      }),
    });
    const data = await response.json().catch(() => ({
      error: "The response was unavailable. Refresh before retrying.",
    }));
    if (!response.ok)
      throw Error(data.error ?? "The request could not be completed.");
    if (data.status === "pending" || data.status === "uncertain")
      throw Error(
        "This request is still unconfirmed. Check the history before trying again.",
      );
    pending.current = null;
    return data;
  }
  async function act(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    await act(async () => {
      if (attachments.length >= 3) throw Error("Attach up to three images.");
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/phone/attachments", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setAttachments((a) => [...a, data]);
    });
  }
  const modes = new Map(model?.threads.map((t) => [t.phone, t]) ?? []);
  const messages = (model?.messages ?? []).filter(
    (m) =>
      (!needsHuman || modes.get(counterpart(m))?.mode === "human") &&
      `${m.body} ${counterpart(m)} ${m.contact_name ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const conversations = [
    ...new Map(
      (model?.messages ?? []).map((m) => [counterpart(m), m]),
    ).entries(),
  ].reverse();
  const mode = modes.get(phone)?.mode ?? "automation";
  const currentStatus = ticket?.status ?? caseStatus(ticketNotes);
  async function older() {
    if (!model?.messages.length) return;
    await act(async () => {
      const first = model.messages[0];
      const response = await fetch(
        `/api/communications/groups?group=${group}${phone ? `&phone=${encodeURIComponent(phone)}` : ""}&before=${encodeURIComponent(first.sent_at)}&beforeSid=${first.sid}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw Error("Older messages could not load.");
      const data = await response.json();
      setModel((m) =>
        m
          ? {
              ...m,
              messages: [...data.messages, ...m.messages],
              more: data.more,
            }
          : m,
      );
    });
  }
  return (
    <section aria-label={config.title}>
      <div className={s.heading} style={{ marginTop: 24 }}>
        <div>
          <h2>{config.title}</h2>
          <p>{config.description}</p>
        </div>
        <button
          className={s.button}
          onClick={() => void refresh()}
          disabled={busy}
        >
          Refresh
        </button>
      </div>
      {group === "team" ? (
        <p className={s.notice}>
          For work requests, employees can text or send pictures to{" "}
          <a href="sms:+13328779035">(332) 877-9035</a>. Active employees are
          recognized by the phone number recorded in People. Replies go out from
          Le Yard.
        </p>
      ) : null}
      {error ? (
        <div role="alert" className={s.alert}>
          {error}{" "}
          <button onClick={() => void refresh()} className={s.button}>
            Retry
          </button>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className={s.notice}>
          {notice}
        </p>
      ) : null}
      {!model && !error ? (
        <p role="status" className={s.empty}>
          Loading saved conversations…
        </p>
      ) : null}
      {group === "tickets" ? (
        <>
          <div className={s.row}>
            <button
              className={s.button}
              onClick={() => setNewTicket({ title: "", body: "" })}
            >
              New ticket
            </button>
            <label>
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />{" "}
              Show resolved
            </label>
          </div>
          {ticket ? (
            <div className={s.layout}>
              <aside className={s.sidebar}>
                <button
                  onClick={() => {
                    setTicket(null);
                    setDraft("");
                  }}
                >
                  ← All tickets
                </button>
                <h3>{ticket.title}</h3>
                <p className={s.muted}>{ticket.phone}</p>
                {ticket.phone ? (
                  <a
                    className={s.button}
                    href={`/messages?group=${source?.audience === "team" ? "team" : "clients"}&phone=${encodeURIComponent(ticket.phone)}`}
                  >
                    Reply in conversation
                  </a>
                ) : null}
                <span className={s.badge}>{currentStatus}</span>
              </aside>
              <div className={s.content}>
                <div className={s.history}>
                  {moreNotes && ticketNotes[0] ? (
                    <button
                      className={s.button}
                      onClick={() =>
                        void act(async () => {
                          const first = ticketNotes[0];
                          const r = await fetch(
                            `/api/communications/groups?caseId=${ticket.id}&beforeNote=${encodeURIComponent(first.created_at)}&beforeNoteId=${first.id}`,
                          );
                          if (!r.ok) throw Error("Older notes unavailable.");
                          const d = await r.json();
                          setTicketNotes((n) => [...d.notes, ...n]);
                          setMoreNotes(d.moreNotes);
                        })
                      }
                    >
                      Load older notes
                    </button>
                  ) : null}
                  <p className={s.caseBody}>{ticket.body}</p>
                  {source
                    ? Array.from({ length: source.media_count }, (_, i) => (
                        <a
                          key={i}
                          href={`/api/phone/media?message=${source.sid}&index=${i}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open source attachment {i + 1}
                        </a>
                      ))
                    : null}
                  {ticketNotes.map((n) => (
                    <article className={s.message} key={n.id}>
                      <p>{n.body}</p>
                      <small>
                        {n.author_name} · {stamp(n.created_at)}
                        {n.status ? ` · ${n.status}` : ""}
                      </small>
                    </article>
                  ))}
                </div>
                <form
                  className={s.composer}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      await mutate({
                        action: "note",
                        caseId: ticket.id,
                        body: draft,
                      });
                      setDraft("");
                      await loadTicket(ticket);
                      await refresh();
                    });
                  }}
                >
                  <label>
                    Internal ticket note
                    <textarea
                      className={s.field}
                      rows={3}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      required
                      maxLength={10000}
                    />
                  </label>
                  <p className={s.muted}>
                    Visible to owners and admins. This note stays inside Le Yard
                    OS.
                  </p>
                  <div className={s.row}>
                    <button
                      className={s.button}
                      data-primary
                      type="submit"
                      disabled={busy || !draft.trim()}
                    >
                      Post internal note
                    </button>
                    <button
                      className={s.button}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const status =
                            currentStatus === "resolved" ? "open" : "resolved";
                          await mutate({
                            action: "note",
                            caseId: ticket.id,
                            status,
                            body:
                              status === "resolved"
                                ? "Marked resolved."
                                : "Reopened for follow-up.",
                          });
                          await loadTicket(ticket);
                          await refresh();
                        })
                      }
                    >
                      {currentStatus === "resolved"
                        ? "Reopen"
                        : "Resolve ticket"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <div
              className={s.layout}
              style={{ display: "block", minHeight: 200 }}
            >
              {model?.cases
                .filter(
                  (c) => showResolved || (c.status ?? "open") !== "resolved",
                )
                .map((c) => (
                  <button
                    className={s.ticket}
                    key={c.id}
                    onClick={() => void act(() => loadTicket(c))}
                  >
                    <strong>{c.title}</strong>
                    <p className={s.muted}>
                      {c.phone ?? "Internal request"} · {stamp(c.created_at)}
                    </p>
                    <span className={s.badge}>{c.status ?? "open"}</span>
                  </button>
                ))}
              {model?.moreCases ? (
                <button
                  className={s.button}
                  onClick={() =>
                    void act(async () => {
                      const last = model.cases.at(-1)!;
                      const r = await fetch(
                        `/api/communications/groups?group=tickets&beforeCase=${encodeURIComponent(last.created_at)}&beforeCaseId=${last.id}`,
                      );
                      if (!r.ok) throw Error("Older tickets unavailable.");
                      const d = await r.json();
                      setModel((m) =>
                        m
                          ? {
                              ...m,
                              cases: [...m.cases, ...d.cases],
                              moreCases: d.moreCases,
                            }
                          : m,
                      );
                    })
                  }
                >
                  Load older tickets
                </button>
              ) : null}
              {model && !model.cases.length ? (
                <p className={s.empty}>
                  No tickets yet. Create one from a message or add one here.
                </p>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <>
          <div className={s.row}>
            <button className={s.button} onClick={() => setCreating(!creating)}>
              New SMS / MMS
            </button>
            <input
              className={s.field}
              style={{ maxWidth: 320, margin: 0 }}
              aria-label="Search loaded messages"
              placeholder="Search loaded messages or numbers"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {group === "clients" ? (
              <label>
                <input
                  type="checkbox"
                  checked={needsHuman}
                  onChange={(e) => setNeedsHuman(e.target.checked)}
                />{" "}
                Needs a human
              </label>
            ) : null}
          </div>
          {creating ? (
            <form
              className={s.row}
              onSubmit={(e) => {
                e.preventDefault();
                const digits = newNumber.replace(/\D/g, "");
                const value = `+${digits.length === 10 ? "1" : ""}${digits}`;
                if (
                  !/^\+1[2-9]\d{9}$/.test(value) ||
                  value === "+13328779035"
                ) {
                  setError("Enter the recipient’s US or Canadian number.");
                  return;
                }
                choosePhone(value);
              }}
            >
              <label>
                Recipient phone
                <input
                  className={s.field}
                  type="tel"
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  required
                />
              </label>
              <button className={s.button}>Open conversation</button>
            </form>
          ) : null}
          <div className={s.layout}>
            <aside className={s.sidebar} aria-label="Twilio conversations">
              <button aria-pressed={!phone} onClick={() => choosePhone("")}>
                All conversations
              </button>
              {conversations.map(([p, m]) => (
                <button
                  key={p}
                  aria-pressed={phone === p}
                  onClick={() => choosePhone(p)}
                >
                  <strong>{m.contact_name ?? p}</strong>
                  <small>{m.body || "MMS attachment"}</small>
                  {modes.get(p)?.mode === "human" ? (
                    <span className={s.badge}>Needs a human</span>
                  ) : null}
                </button>
              ))}
            </aside>
            <div className={s.content}>
              <header className={s.toolbar}>
                <div>
                  <h3>{phone || "All messages"}</h3>
                  <p className={s.muted}>
                    {phone
                      ? mode === "human"
                        ? "Human handling · automated replies paused"
                        : "Automation may reply until a human takes over"
                      : "Conversation history."}
                  </p>
                </div>
                {phone ? (
                  <button
                    className={s.button}
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await mutate({
                          action: "mode",
                          phone,
                          mode: mode === "human" ? "automation" : "human",
                        });
                        await refresh();
                      })
                    }
                  >
                    {mode === "human" ? "Return to automation" : "Take over"}
                  </button>
                ) : null}
              </header>
              <div className={s.history} aria-label="Twilio message history">
                {model?.more ? (
                  <button
                    className={s.button}
                    disabled={busy}
                    onClick={() => void older()}
                  >
                    Load older messages
                  </button>
                ) : null}
                {messages.map((m) => (
                  <article
                    className={s.message}
                    data-outbound={m.direction === "outbound"}
                    key={m.sid}
                  >
                    <strong className={s.muted}>
                      {m.direction === "inbound"
                        ? (m.contact_name ?? m.from_number)
                        : m.sender_kind === "automation"
                          ? "Le Yard · automated"
                          : m.sender_kind === "staff"
                            ? "Le Yard · human"
                            : "Le Yard · sender unverified"}
                      {!phone && m.direction === "outbound"
                        ? ` → ${m.to_number}`
                        : ""}
                    </strong>
                    <p>{m.body}</p>
                    {Array.from({ length: m.media_count }, (_, i) => (
                      <a
                        key={i}
                        href={`/api/phone/media?message=${m.sid}&index=${i}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open attachment {i + 1}
                      </a>
                    ))}
                    <small>
                      {stamp(m.sent_at)} · {m.status}
                      {m.error_code ? ` · error ${m.error_code}` : ""}
                    </small>
                    <button onClick={() => choosePhone(counterpart(m))}>
                      Open conversation
                    </button>
                    <button
                      onClick={() =>
                        setNewTicket({
                          title: "",
                          body: m.body,
                          phone: counterpart(m),
                          sourceSid: m.sid,
                        })
                      }
                    >
                      Create ticket
                    </button>
                  </article>
                ))}
                {model && !messages.length ? (
                  <p className={s.empty}>
                    {query || needsHuman
                      ? "No loaded messages match this filter."
                      : "No messages saved in this view yet."}
                  </p>
                ) : null}
              </div>
              {phone ? (
                <form
                  className={s.composer}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      const result = await mutate(
                        {
                          action: "sms",
                          to: phone,
                          body: draft,
                          consent,
                          attachments: attachments.map((a) => a.path),
                        },
                        "/api/phone",
                      );
                      setDraft("");
                      setAttachments([]);
                      setNotice(
                        `Message ${result.status}. The delivery status will update in the transcript.`,
                      );
                      await refresh();
                    });
                  }}
                >
                  <label>
                    Reply to {phone} from Le Yard
                    <textarea
                      className={s.field}
                      rows={3}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      maxLength={1200}
                      placeholder="Type your reply…"
                    />
                  </label>
                  <div className={s.row}>
                    <label className={s.button}>
                      Attach image
                      <input
                        aria-label="Attach MMS image"
                        type="file"
                        accept="image/jpeg,image/png"
                        disabled={busy || attachments.length >= 3}
                        onChange={(e) => {
                          void upload(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                        style={{
                          display: "block",
                          maxWidth: 220,
                          fontSize: 12,
                        }}
                      />
                    </label>
                    {attachments.map((a) => (
                      <button
                        type="button"
                        key={a.path}
                        className={s.button}
                        onClick={() =>
                          setAttachments((x) =>
                            x.filter((y) => y.path !== a.path),
                          )
                        }
                      >
                        Remove {a.name}
                      </button>
                    ))}
                  </div>
                  <label className={s.row}>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    Recipient agreed to service texts about this conversation.
                  </label>
                  <div className={s.row}>
                    <button
                      className={s.button}
                      data-primary
                      type="submit"
                      disabled={busy || (!draft.trim() && !attachments.length)}
                    >
                      {busy
                        ? "Submitting…"
                        : attachments.length
                          ? "Send MMS from Le Yard"
                          : "Send SMS from Le Yard"}
                    </button>
                    <p className={s.muted}>
                      Replying assigns this conversation to a human.
                    </p>
                  </div>
                </form>
              ) : null}
            </div>
          </div>
        </>
      )}
      {newTicket ? (
        <form
          className={s.composer}
          style={{
            marginTop: 20,
            border: "1px solid var(--line)",
            borderRadius: 16,
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await mutate({ action: "create", ...newTicket });
              setNewTicket(null);
              setNotice("Ticket created. Open Tickets for internal follow-up.");
              await refresh();
            });
          }}
        >
          <h3>Create a ticket</h3>
          <label>
            Ticket title
            <input
              className={s.field}
              autoFocus
              value={newTicket.title}
              maxLength={160}
              required
              onChange={(e) =>
                setNewTicket({ ...newTicket, title: e.target.value })
              }
            />
          </label>
          <label>
            Details
            <textarea
              className={s.field}
              rows={3}
              value={newTicket.body}
              maxLength={10000}
              onChange={(e) =>
                setNewTicket({ ...newTicket, body: e.target.value })
              }
            />
          </label>
          <div className={s.row}>
            <button className={s.button} data-primary disabled={busy}>
              Create ticket
            </button>
            <button
              className={s.button}
              type="button"
              onClick={() => setNewTicket(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      <p className={s.muted} style={{ marginTop: 18 }}>
        Shared team inbox.
      </p>
    </section>
  );
}
