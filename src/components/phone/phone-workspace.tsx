"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Delete,
  Grid3X3,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Voicemail,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Message = {
  sid: string;
  from: string;
  to: string;
  body: string;
  status: string;
  direction: string;
  at: string;
  mediaCount: number;
  errorCode: number | null;
};
type Call = {
  sid: string;
  from: string;
  to: string;
  status: string;
  duration: string;
  at: string;
};
type Voice = {
  id: string;
  from?: string;
  recordingSid?: string;
  durationSeconds?: number;
  at: string;
};
type Model = {
  business: string;
  smsEnabled: boolean;
  callsEnabled: boolean;
  messages: Message[];
  calls: Call[];
  voicemails: Voice[];
};
const field =
  "min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";
function number(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10
    ? `+1${digits}`
    : value.startsWith("+")
      ? `+${digits}`
      : `+${digits}`;
}
function displayNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  const local =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10
    ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
    : value;
}
function date(at: string) {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}
export function PhoneWorkspace({
  live,
  defaultStaff,
}: {
  live: boolean;
  defaultStaff: "donald" | "maris";
}) {
  const [model, setModel] = useState<Model | null>(null);
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<"keypad" | "texts" | "calls" | "voicemail">(
    "keypad",
  );
  const [draft, setDraft] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [creating, setCreating] = useState(false);
  const [consent, setConsent] = useState(false);
  const [staff, setStaff] = useState(defaultStaff);
  const [dial, setDial] = useState("");
  const [search, setSearch] = useState("");
  const [missedOnly, setMissedOnly] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [authExpired, setAuthExpired] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const refreshing = useRef(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [threadMessages, setThreadMessages] = useState<Message[] | null>(null);
  const history = useRef<HTMLDivElement>(null);
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (!live || refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    try {
      const response = await fetch("/api/phone", {
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (
        response.status === 401 ||
        response.redirected ||
        !response.headers.get("content-type")?.includes("application/json")
      ) {
        if (mounted.current) setAuthExpired(true);
        throw Error("Your session has ended. Sign in to reconnect your phone.");
      }
      if (!response.ok)
        throw Error(
          "Phone history is temporarily unavailable. Try refreshing in a moment.",
        );
      const data = await response.json();
      if (mounted.current) {
        setModel(data);
        setLoadError("");
        setAuthExpired(false);
        setUpdatedAt(new Date());
      }
    } catch (e) {
      if (mounted.current)
        setLoadError(
          e instanceof Error && e.name !== "TimeoutError"
            ? e.message
            : "The connection took too long. Check your internet and try again.",
        );
    } finally {
      refreshing.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [live]);
  useEffect(() => {
    mounted.current = true;
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    return () => {
      mounted.current = false;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!selected || !live) return;
    let active = true;
    fetch(`/api/phone?phone=${encodeURIComponent(selected)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) => {
        if (active) setThreadMessages(data.messages);
      })
      .catch(() => {
        if (active)
          setNotice(
            "Could not load the full conversation. Showing the most recently synced messages.",
          );
      });
    return () => {
      active = false;
    };
  }, [selected, live, model]);
  const conversations = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of model?.messages ?? []) {
      map.set(m.direction === "outbound" ? m.to : m.from, m);
    }
    return [...map.entries()].sort((a, b) => b[1].at.localeCompare(a[1].at));
  }, [model]);
  const messages =
    threadMessages ??
    (model?.messages ?? []).filter(
      (m) => m.from === selected || m.to === selected,
    );
  const lastMessage = messages.at(-1)?.sid;
  useEffect(() => {
    if (history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [selected, lastMessage]);
  async function submit(action: "sms" | "call", destination = selected) {
    if (busy || !destination) return;
    const input = {
      action,
      to: destination,
      ...(action === "sms" ? { body: draft, consent } : { staff }),
    };
    const fingerprint = JSON.stringify(input);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/phone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, requestId: pending.current.id }),
        signal: AbortSignal.timeout(25000),
      });
      if (response.status === 401 || response.redirected) {
        setAuthExpired(true);
        throw Error("Your session ended. Sign in before trying again.");
      }
      const data = await response.json();
      if (!response.ok)
        throw Error(
          data.error || "Request failed. Check history before retrying.",
        );
      if (data.status === "pending" || data.status === "uncertain") {
        setNotice(
          "This request is still being checked. Refresh history before starting another.",
        );
        return;
      }
      pending.current = null;
      setNotice(
        action === "call"
          ? "Your cellphone will ring. Answer and press 1 to connect. The recipient sees Le Yard."
          : `Text ${data.status}. Delivery status updates in this conversation.`,
      );
      if (action === "sms") setDraft("");
      await refresh();
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Request result uncertain. Check history before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  function openConversation(phone: string) {
    setThreadMessages(null);
    setSelected(phone);
    setConsent(false);
    setDraft("");
    setCreating(false);
    setTab("texts");
    setNotice("");
    pending.current = null;
  }
  const dialNumber = number(dial);
  const validDial =
    /^\+1[2-9]\d{9}$/.test(dialNumber) && dialNumber !== model?.business;
  const emptyHistory = loadError
    ? "History could not be refreshed. Use Retry above."
    : !live
      ? "History is available after signing in to the live workspace."
      : !model
        ? "Connecting to your shared phone…"
        : null;
  const filteredConversations = conversations.filter(([phone, m]) =>
    `${phone} ${m.body}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-7 sm:pt-7">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-6">
        <div>
          <p className="eyebrow">Le Yard · Shared phone</p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">
            (332) 877-9035
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--ink-faint)]">
            Your business number. Calls, messages, and voicemail in one place.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="quiet"
            aria-label="Refresh phone history"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              await refresh();
              setLoading(false);
            }}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="accent"
            onClick={() => {
              setCreating(true);
              setSelected("");
              setTab("texts");
            }}
          >
            <Plus className="size-4" />
            New conversation
          </Button>
        </div>
      </header>
      {!live ? (
        <p className="my-5 text-sm">
          The phone is available in the live owner workspace. Demo mode cannot
          send calls or texts.
        </p>
      ) : null}
      <div
        className="flex items-center gap-2 py-3 text-xs text-[var(--ink-faint)]"
        role="status"
      >
        <span
          className={`size-2 rounded-full ${loadError ? "bg-amber-600" : model ? "bg-emerald-600" : "bg-stone-400"}`}
        />
        {loadError
          ? "Connection needs attention"
          : loading
            ? "Syncing phone…"
            : updatedAt
              ? `Updated ${updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
              : "Connecting…"}
      </div>
      <nav
        aria-label="Phone views"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[var(--line)] bg-[var(--paper)] px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] shadow-sm sm:static sm:mb-4 sm:flex sm:gap-2 sm:border-y sm:bg-transparent sm:p-2 sm:shadow-none"
      >
        {(
          [
            ["keypad", "Keypad", Grid3X3],
            ["calls", "Recents", Phone],
            ["texts", "Messages", MessageSquare],
            ["voicemail", "Voicemail", Voicemail],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-3 text-[11px] font-medium transition-colors sm:min-h-11 sm:flex-row sm:gap-2 sm:text-sm ${tab === key ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)]"}`}
            onClick={() => {
              setTab(key);
              setCreating(false);
              setSearch("");
            }}
            aria-current={tab === key ? "page" : undefined}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </nav>
      {loadError ? (
        <div
          role="alert"
          className="my-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <p>
            {loadError}
            {model ? " Previously synced history is still shown." : ""}
          </p>
          {authExpired ? (
            <a
              className="font-semibold underline"
              href="/sign-in?next=%2Fphone"
            >
              Sign in again
            </a>
          ) : (
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => void refresh()}
            >
              Retry
            </Button>
          )}
        </div>
      ) : null}
      {authExpired && !loadError ? (
        <a
          className="my-3 block rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-950 underline"
          href="/sign-in?next=%2Fphone"
        >
          Session ended. Sign in again
        </a>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="my-3 rounded-xl bg-[var(--canvas-strong)] px-4 py-3 text-sm"
        >
          {notice}
        </p>
      ) : null}
      {creating ? (
        <form
          className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] py-5"
          onSubmit={(e) => {
            e.preventDefault();
            const normalized = number(newNumber);
            if (!/^\+1[2-9]\d{9}$/.test(normalized)) {
              setNotice("Enter a valid US or Canadian phone number.");
              return;
            }
            if (normalized === model?.business) {
              setNotice("Enter the other person's number.");
              return;
            }
            openConversation(normalized);
          }}
        >
          <label className="min-w-56 flex-1 text-sm">
            Phone number
            <input
              className={`${field} mt-2`}
              type="tel"
              autoFocus
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              placeholder="(212) 555-0123"
              required
            />
          </label>
          <Button type="submit">Open conversation</Button>
          <Button variant="quiet" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </form>
      ) : null}
      {tab === "keypad" ? (
        <section
          aria-label="Phone keypad"
          className="mx-auto grid max-w-3xl gap-8 py-4 md:grid-cols-[minmax(0,360px)_1fr] md:items-center md:gap-12"
        >
          <div>
            <label className="sr-only" htmlFor="dial-number">
              Number to call
            </label>
            <input
              id="dial-number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={dial}
              onChange={(e) =>
                setDial(
                  e.target.value.replace(/[^0-9+*# ()-]/g, "").slice(0, 24),
                )
              }
              placeholder="Enter a number"
              className="h-16 w-full border-0 bg-transparent text-center text-3xl tracking-wide outline-none focus:ring-2 focus:ring-[var(--accent)] rounded-xl"
            />
            <div
              className="grid grid-cols-3 gap-x-6 gap-y-3 px-5 py-4"
              aria-label="Dial pad"
            >
              {[
                ["1", ""],
                ["2", "ABC"],
                ["3", "DEF"],
                ["4", "GHI"],
                ["5", "JKL"],
                ["6", "MNO"],
                ["7", "PQRS"],
                ["8", "TUV"],
                ["9", "WXYZ"],
                ["*", ""],
                ["0", "+"],
                ["#", ""],
              ].map(([digit, letters]) => (
                <button
                  type="button"
                  key={digit}
                  aria-label={digit}
                  onClick={() =>
                    setDial((value) => (value + digit).slice(0, 24))
                  }
                  className="flex min-h-16 flex-col items-center justify-center rounded-full bg-[var(--canvas-strong)] text-[var(--ink)] transition duration-150 hover:bg-[var(--line)] active:scale-95 motion-reduce:transform-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  <span className="text-3xl leading-8">{digit}</span>
                  <span className="min-h-3 text-[9px] font-semibold tracking-[.2em]">
                    {letters}
                  </span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 items-center gap-6 px-5 pt-2">
              <button
                aria-label="Message this number"
                disabled={!validDial}
                onClick={() => openConversation(dialNumber)}
                className="flex min-h-14 items-center justify-center rounded-full disabled:opacity-30"
              >
                <MessageSquare className="size-6" />
              </button>
              <button
                aria-label="Call from Le Yard"
                disabled={
                  busy || !validDial || !model?.callsEnabled || authExpired
                }
                onClick={() => void submit("call", dialNumber)}
                className="flex min-h-16 items-center justify-center rounded-full bg-emerald-700 text-white transition hover:bg-emerald-800 active:scale-95 disabled:opacity-35 motion-reduce:transform-none"
              >
                <Phone className="size-7" />
              </button>
              <button
                aria-label="Delete last digit"
                disabled={!dial}
                onClick={() => setDial((value) => value.slice(0, -1))}
                className="flex min-h-14 items-center justify-center rounded-full disabled:opacity-30"
              >
                <Delete className="size-6" />
              </button>
            </div>
            <div className="mt-3 flex min-h-8 justify-center">
              <button
                className="px-4 text-xs text-[var(--ink-faint)] underline disabled:invisible"
                disabled={!dial}
                onClick={() => setDial("")}
              >
                Clear number
              </button>
            </div>
            {dial && !validDial ? (
              <p className="text-center text-xs text-[var(--ink-faint)]">
                Enter a US or Canadian number, including area code.
              </p>
            ) : null}
          </div>
          <div className="border-t border-[var(--line)] pt-5 md:border-t-0 md:pt-0">
            <h2 className="text-lg font-semibold">Call as Le Yard</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-faint)]">
              Your cellphone rings first. Answer and press 1 to connect. The
              guest sees (332) 877-9035.
            </p>
            <label className="mt-5 block text-sm font-medium">
              Ring this cellphone
              <select
                className={`${field} mt-2`}
                value={staff}
                onChange={(e) => setStaff(e.target.value as "donald" | "maris")}
              >
                <option value="donald">Donald</option>
                <option value="maris">Maris</option>
              </select>
            </label>
            <p className="mt-3 text-xs leading-5 text-[var(--ink-faint)]">
              Call audio stays on your cellphone. Use its mute, speaker, and
              end-call controls after answering.
            </p>
            {busy ? (
              <p role="status" className="mt-3 text-sm">
                Starting your request…
              </p>
            ) : null}
            {model && !model.callsEnabled ? (
              <p className="mt-3 text-sm">Outbound calling is not enabled.</p>
            ) : null}
          </div>
        </section>
      ) : null}
      {tab === "texts" ? (
        <div className="grid min-h-[480px] md:grid-cols-[280px_minmax(0,1fr)]">
          <aside
            aria-label="Conversations"
            className={`${selected ? "hidden md:block" : ""} border-[var(--line)] md:border-r`}
          >
            <label className="mx-2 my-3 flex items-center gap-2">
              <Search className="size-4 shrink-0" />
              <input
                aria-label="Search conversations"
                type="search"
                className={field}
                placeholder="Search messages or number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {filteredConversations.map(([phone, m]) => (
              <button
                key={phone}
                className={`block w-full border-b border-[var(--line)] px-3 py-4 text-left transition-colors hover:bg-[var(--canvas-strong)] ${selected === phone ? "bg-[var(--canvas-strong)]" : ""}`}
                onClick={() => openConversation(phone)}
              >
                <span className="block text-sm font-semibold">
                  {displayNumber(phone)}
                </span>
                <span className="mt-1 block truncate text-sm text-[var(--ink-faint)]">
                  {m.direction === "outbound" ? "You: " : ""}
                  {m.body || "Attachment"}
                </span>
                <span className="mt-2 block text-xs text-[var(--ink-faint)]">
                  {date(m.at)}
                </span>
              </button>
            ))}
            {!filteredConversations.length ? (
              <p className="px-3 py-7 text-sm text-[var(--ink-faint)]">
                {emptyHistory ??
                  (search
                    ? "No matching conversations."
                    : "No messages yet. Start a conversation above.")}
              </p>
            ) : null}
          </aside>
          <section
            aria-label="Selected conversation"
            className={`${!selected ? "hidden md:flex md:items-center md:justify-center" : "flex"} min-w-0 flex-col md:pl-6`}
          >
            {!selected ? (
              <p className="text-sm text-[var(--ink-faint)]">
                Choose a conversation or start a new one.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] py-4">
                  <Button
                    variant="quiet"
                    size="icon"
                    className="md:hidden"
                    aria-label="Back to conversations"
                    onClick={() => setSelected("")}
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                  <h2 className="flex-1 text-lg font-semibold">
                    {displayNumber(selected)}
                  </h2>
                  <label className="text-xs">
                    Ring
                    <select
                      className="ml-2 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 text-sm"
                      value={staff}
                      onChange={(e) =>
                        setStaff(e.target.value as "donald" | "maris")
                      }
                    >
                      <option value="donald">Donald</option>
                      <option value="maris">Maris</option>
                    </select>
                  </label>
                  <Button
                    disabled={busy || !model?.callsEnabled}
                    variant="secondary"
                    onClick={() => void submit("call")}
                  >
                    <Phone className="size-4" />
                    Call from Le Yard
                  </Button>
                </div>
                <div
                  ref={history}
                  className="flex max-h-[52svh] min-h-52 flex-1 flex-col gap-4 overflow-y-auto py-5"
                  aria-label="Text history"
                >
                  {messages.map((m) => (
                    <article
                      key={m.sid}
                      className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${m.direction === "outbound" ? "ml-auto bg-[var(--accent-soft)]" : "mr-auto bg-[var(--canvas-strong)]"}`}
                    >
                      <p className="whitespace-pre-wrap break-words">
                        {m.body}
                      </p>
                      {Array.from(
                        { length: Math.min(m.mediaCount, 10) },
                        (_, i) => (
                          <a
                            key={i}
                            className="mt-2 block underline"
                            href={`/api/phone/media?message=${m.sid}&index=${i}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open attachment {i + 1}
                          </a>
                        ),
                      )}
                      <p className="mt-2 text-xs text-[var(--ink-faint)]">
                        {date(m.at)} · {m.status}
                        {m.errorCode ? ` · error ${m.errorCode}` : ""}
                      </p>
                    </article>
                  ))}
                  {!messages.length ? (
                    <p className="text-sm text-[var(--ink-faint)]">
                      No texts with this number yet.
                    </p>
                  ) : null}
                </div>
                <form
                  className="border-t border-[var(--line)] py-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit("sms");
                  }}
                >
                  <label className="sr-only" htmlFor="phone-message">
                    Message
                  </label>
                  <textarea
                    id="phone-message"
                    className={`${field} min-h-24 resize-y`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={1200}
                    placeholder="Message from Le Yard…"
                    required
                  />
                  <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--ink-faint)]">
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    The recipient agreed to guest-care texts about this request.
                    Required for a new conversation; never use this number for
                    unsolicited marketing.
                  </label>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-[var(--ink-faint)]">
                      From Le Yard · {draft.length}/1200
                    </p>
                    <Button
                      type="submit"
                      variant="accent"
                      disabled={busy || !draft.trim() || !model?.smsEnabled}
                    >
                      <Send className="size-4" />
                      {busy ? "Submitting…" : "Send text"}
                    </Button>
                  </div>
                  {model && !model.smsEnabled ? (
                    <p className="mt-2 text-xs text-[var(--ink-faint)]">
                      Text sending is awaiting activation.
                    </p>
                  ) : null}
                </form>
              </>
            )}
          </section>
        </div>
      ) : tab === "calls" ? (
        <section
          aria-label="Call history"
          className="divide-y divide-[var(--line)]"
        >
          <div className="flex items-center justify-between gap-3 py-4">
            <h2 className="text-lg font-semibold">Recent calls</h2>
            <button
              className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm"
              aria-pressed={missedOnly}
              onClick={() => setMissedOnly((value) => !value)}
            >
              {missedOnly ? "Show all calls" : "Missed calls"}
            </button>
          </div>
          {model?.calls
            .filter(
              (c) =>
                !missedOnly ||
                ["no-answer", "busy", "failed", "canceled"].includes(c.status),
            )
            .map((c) => (
              <div
                key={c.sid}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {c.to === model.business ? "Incoming from" : "Outgoing to"}{" "}
                    {displayNumber(c.to === model.business ? c.from : c.to)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {date(c.at)} · {c.status} · {c.duration}s
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="quiet"
                    onClick={() =>
                      openConversation(c.to === model.business ? c.from : c.to)
                    }
                  >
                    <MessageSquare className="size-4" />
                    Message
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setDial(c.to === model.business ? c.from : c.to);
                      setTab("keypad");
                    }}
                  >
                    <Phone className="size-4" />
                    Keypad
                  </Button>
                </div>
              </div>
            ))}
          {!model?.calls.filter(
            (c) =>
              !missedOnly ||
              ["no-answer", "busy", "failed", "canceled"].includes(c.status),
          ).length ? (
            <p className="py-8 text-sm text-[var(--ink-faint)]">
              {emptyHistory ??
                (missedOnly
                  ? "No missed calls in recent history."
                  : "No calls in the recent history.")}
            </p>
          ) : null}
        </section>
      ) : tab === "voicemail" ? (
        <section
          aria-label="Voicemail"
          className="divide-y divide-[var(--line)]"
        >
          {model?.voicemails.map((v) => (
            <div key={v.id} className="py-5">
              <p className="text-sm font-semibold">
                {v.from ? displayNumber(v.from) : "Unknown caller"}
              </p>
              <p className="my-2 text-xs text-[var(--ink-faint)]">
                {date(v.at)} · {v.durationSeconds ?? 0}s
              </p>
              {v.recordingSid ? (
                <audio
                  controls
                  preload="none"
                  src={`/api/phone/media?recording=${v.recordingSid}`}
                  className="w-full max-w-md"
                />
              ) : null}
              {v.from && /^\+1[2-9]\d{9}$/.test(v.from) ? (
                <Button
                  className="mt-3"
                  variant="quiet"
                  onClick={() => {
                    setDial(v.from!);
                    setTab("keypad");
                  }}
                >
                  <Phone className="size-4" />
                  Return call
                </Button>
              ) : null}
            </div>
          ))}
          {!model?.voicemails.length ? (
            <p className="py-8 text-sm text-[var(--ink-faint)]">
              {emptyHistory ?? "No voicemail yet."}
            </p>
          ) : null}
        </section>
      ) : null}
      <footer className="mt-6 border-t border-[var(--line)] pt-4 text-xs leading-5 text-[var(--ink-faint)]">
        Save this page to your phone’s Home Screen. Use this workspace for
        outgoing calls and texts; your regular Phone and Messages apps use your
        personal number. History refreshes every 15 seconds while open.
      </footer>
    </div>
  );
}
