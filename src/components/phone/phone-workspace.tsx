"use client";

import { LyMonogram } from "@/components/ly-monogram";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ComponentType,
} from "react";
import {
  ArrowLeft,
  Delete,
  Grid3X3,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  LoaderCircle,
  Moon,
  Paperclip,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Settings2,
  Smartphone,
  SquarePen,
  Sun,
  X,
  Voicemail,
} from "lucide-react";
import s from "./phone-workspace.module.css";

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

function time(at: string) {
  return new Date(at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}
function day(at: string) {
  return new Date(at).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}
function shortDate(at: string) {
  return day(at) === day(new Date().toISOString())
    ? time(at)
    : new Date(at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "America/New_York",
      });
}
function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function isMissed(status: string) {
  return ["no-answer", "busy", "failed", "canceled"].includes(status);
}
function callStatus(status: string) {
  return (
    (
      {
        "no-answer": "Missed",
        busy: "Busy",
        failed: "Failed",
        canceled: "Canceled",
      } as Record<string, string>
    )[status] ?? status
  );
}
function Avatar({ value }: { value: string }) {
  const tone = ["sage", "sand", "stone", "olive"][
    Number(value.replace(/\D/g, "").slice(-1)) % 4
  ];
  return (
    <span className={s.avatar} data-tone={tone} aria-hidden="true">
      {value.replace(/\D/g, "").slice(-2) || "?"}
    </span>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className={s.empty}>
      <span>
        <Icon size={27} strokeWidth={1.3} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function PhoneWorkspace({
  live,
  defaultStaff,
  accountAction,
}: {
  live: boolean;
  defaultStaff: "donald" | "maris";
  accountAction?: ReactNode;
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [preferences, setPreferences] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("le-yard-phone-appearance");
      } catch {
        /* Storage may be unavailable in private browsing. */
      }
      setTheme(
        saved === "dark" ||
          (saved !== "light" &&
            window.matchMedia?.("(prefers-color-scheme: dark)").matches)
          ? "dark"
          : "light",
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
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
  const searchDigits = search.replace(/\D/g, "");
  const filteredConversations = conversations.filter(
    ([phone, m]) =>
      `${phone} ${m.body}`.toLowerCase().includes(search.toLowerCase()) ||
      (/^[+\d\s().-]+$/.test(search) &&
        Boolean(searchDigits) &&
        phone.includes(searchDigits)),
  );
  const startConversation = () => {
    setCreating(true);
    setSelected("");
    setTab("texts");
    setNewNumber("");
    setNotice("");
  };
  const goTo = (next: typeof tab) => {
    setTab(next);
    setCreating(false);
    setSearch("");
    setPreferences(false);
  };
  const prepareCall = (phone: string) => {
    setDial(phone);
    goTo("keypad");
  };
  const recentCalls = (model?.calls ?? []).filter(
    (c) =>
      (!missedOnly || isMissed(c.status)) &&
      (!search ||
        `${c.from} ${c.to}`
          .replace(/\D/g, "")
          .includes(search.replace(/\D/g, "") || search)),
  );
  const founder = staff === "donald" ? "Donald" : "Maris";
  const title = {
    keypad: "Keypad",
    texts: "Messages",
    calls: "Recents",
    voicemail: "Voicemail",
  }[tab];
  const founderSelector = (
    <div
      className={s.founderSelector}
      role="group"
      aria-label="Ring this cellphone"
    >
      {(["donald", "maris"] as const).map((person) => (
        <button
          key={person}
          aria-pressed={staff === person}
          onClick={() => setStaff(person)}
        >
          <span
            className={s.founderInitial}
            aria-hidden="true"
            data-tone={person === "donald" ? "sage" : "sand"}
          >
            {person[0].toUpperCase()}
          </span>
          {person === "donald" ? "Donald" : "Maris"}
          {staff === person ? <Check size={14} /> : null}
        </button>
      ))}
    </div>
  );
  const callRows = (calls: Call[], compact = false) =>
    calls.map((c, index) => {
      const phone = c.to === model?.business ? c.from : c.to;
      const incoming = c.to === model?.business;
      const missed = isMissed(c.status);
      const Direction = missed
        ? PhoneMissed
        : incoming
          ? PhoneIncoming
          : PhoneOutgoing;
      return (
        <div key={c.sid}>
          {!compact &&
          (index === 0 || day(c.at) !== day(calls[index - 1].at)) ? (
            <h3 className={s.groupLabel}>{day(c.at)}</h3>
          ) : null}
          <div className={s.callRow}>
            <Avatar value={phone} />
            <button
              className={s.rowBody}
              onClick={() => prepareCall(phone)}
              aria-label={`Prepare call to ${displayNumber(phone)}`}
            >
              <strong>{displayNumber(phone)}</strong>
              <span className={missed ? s.missed : ""}>
                <Direction size={13} />
                {missed
                  ? callStatus(c.status)
                  : incoming
                    ? "Incoming"
                    : "Outgoing"}
                {c.status === "completed"
                  ? ` · ${duration(Number(c.duration))}`
                  : !missed
                    ? ` · ${c.status}`
                    : ""}
              </span>
            </button>
            <time className={s.rowTime} dateTime={c.at} title={date(c.at)}>
              {compact ? shortDate(c.at) : time(c.at)}
            </time>
            {!compact ? (
              <button
                className={s.rowAction}
                aria-label={`Message ${displayNumber(phone)}`}
                onClick={() => openConversation(phone)}
              >
                <MessageSquare size={18} />
              </button>
            ) : null}
          </div>
        </div>
      );
    });

  return (
    <main className={s.phone} data-theme={theme}>
      <div className={s.workspace}>
        <header className={s.brandHeader}>
          <div className={s.brand}>
            <div>
              <span className={s.wordmark}>LE YARD</span>
              <span className={s.brandDetail}>SHARED PHONE</span>
            </div>
          </div>
          <div className={s.headerActions}>
            <a className={s.iconButton} href="https://operations.leyardny.com/messages?group=clients" aria-label="Open Groups"><MessageSquare size={18}/></a>
            <button
              className={s.iconButton}
              aria-label={
                theme === "dark"
                  ? "Switch to light appearance"
                  : "Switch to dark appearance"
              }
              onClick={() => {
                const next = theme === "dark" ? "light" : "dark";
                setTheme(next);
                try {
                  localStorage.setItem("le-yard-phone-appearance", next);
                } catch {
                  /* The current choice still works without storage. */
                }
              }}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className={s.iconButton}
              aria-label="Phone preferences"
              aria-expanded={preferences}
              onClick={() => setPreferences((value) => !value)}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>

        {preferences ? (
          <section className={s.preferences} aria-label="Phone preferences">
            <div className={s.sectionHeading}>
              <h2>Your phone</h2>
              <button
                className={s.iconButton}
                aria-label="Close preferences"
                onClick={() => setPreferences(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className={s.profileRow}>
              <div>
                <strong>Le Yard</strong>
                <p>{displayNumber(model?.business ?? "+13328779035")}</p>
              </div>
              <span className={s.smallTag}>Shared line</span>
            </div>
            <div className={s.preferenceRow}>
              <span>
                <Smartphone size={17} /> Ring first
              </span>
              <strong>{founder}’s cellphone</strong>
            </div>
            {founderSelector}
            <div className={s.preferenceRow}>
              <span>
                <Sun size={17} /> Appearance
              </span>
              <strong>{theme === "dark" ? "Dark" : "Light"}</strong>
            </div>
            <p className={s.helpText}>
              Save this page to your Home Screen for quick access. Call audio
              stays on your cellphone; outgoing calls and texts start here.
            </p>
            {accountAction ? (
              <div className={s.accountAction}>{accountAction}</div>
            ) : null}
          </section>
        ) : null}

        <div className={s.pageHeading}>
          <div>
            <p className={s.numberLabel}>
              {displayNumber(model?.business ?? "+13328779035")}
            </p>
            <h1>{creating ? "New message" : title}</h1>
          </div>
          <button
            className={s.iconButton}
            aria-label={
              tab === "texts" ? "New conversation" : "Refresh phone history"
            }
            disabled={tab !== "texts" && loading}
            onClick={
              tab === "texts"
                ? startConversation
                : async () => {
                    setLoading(true);
                    await refresh();
                    setLoading(false);
                  }
            }
          >
            {tab === "texts" ? (
              <SquarePen size={19} />
            ) : (
              <RefreshCw size={18} className={loading ? s.spinning : ""} />
            )}
          </button>
        </div>
        <div className={s.syncStatus} role="status">
          <span
            data-state={loadError ? "warning" : model ? "ready" : "loading"}
          />
          {loadError
            ? "Connection needs attention"
            : loading
              ? "Syncing phone…"
              : updatedAt
                ? `Updated ${updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                : live
                  ? "Connecting…"
                  : "Preview · calling and texting unavailable"}
        </div>
        {loadError ? (
          <div className={s.alert} role="alert">
            <p>
              {loadError}
              {model ? " Previously synced history is still shown." : ""}
            </p>
            {authExpired ? (
              <a href="/sign-in?next=%2Fphone">Sign in again</a>
            ) : (
              <button
                className={s.textButton}
                disabled={loading}
                onClick={() => void refresh()}
              >
                Retry
              </button>
            )}
          </div>
        ) : null}
        {authExpired && !loadError ? (
          <a className={s.alert} href="/sign-in?next=%2Fphone">
            Session ended. Sign in again
          </a>
        ) : null}
        {notice ? (
          <p role="status" className={s.notice}>
            {notice}
          </p>
        ) : null}

        <div className={s.view} key={tab}>
          {creating ? (
            <form
              className={s.newConversation}
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
              <label htmlFor="new-phone-number">To</label>
              <input
                id="new-phone-number"
                className={s.input}
                aria-label="Phone number"
                type="tel"
                autoFocus
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                placeholder="(212) 555-0123"
                required
              />
              <div className={s.formActions}>
                <button
                  type="button"
                  className={s.textButton}
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
                <button className={s.primaryButton} type="submit">
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </form>
          ) : null}

          {tab === "keypad" ? (
            <section aria-label="Phone keypad" className={s.keypadLayout}>
              <div className={s.dialCard}>
                <div className={s.dialDisplay}>
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
                        e.target.value
                          .replace(/[^0-9+*# ()-]/g, "")
                          .slice(0, 24),
                      )
                    }
                    placeholder="Enter a number"
                  />
                  <p>
                    {dial && !validDial
                      ? "Include a US or Canadian area code"
                      : "Calling from Le Yard"}
                  </p>
                </div>
                <div className={s.dialPad} aria-label="Dial pad">
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
                    >
                      <span>{digit}</span>
                      <small>{letters || "\u00a0"}</small>
                    </button>
                  ))}
                </div>
                <div className={s.dialActions}>
                  <button
                    aria-label="Message this number"
                    disabled={!validDial}
                    onClick={() => openConversation(dialNumber)}
                  >
                    <MessageSquare size={22} />
                  </button>
                  <button
                    className={s.callButton}
                    aria-label="Call from Le Yard"
                    disabled={
                      busy || !validDial || !model?.callsEnabled || authExpired
                    }
                    onClick={() => void submit("call", dialNumber)}
                  >
                    {busy ? (
                      <LoaderCircle className={s.spinning} size={26} />
                    ) : (
                      <Phone size={26} fill="currentColor" strokeWidth={1.5} />
                    )}
                  </button>
                  <button
                    aria-label="Delete last digit"
                    disabled={!dial}
                    onClick={() => setDial((value) => value.slice(0, -1))}
                  >
                    <Delete size={23} />
                  </button>
                </div>
                <button
                  className={s.clearNumber}
                  disabled={!dial}
                  onClick={() => setDial("")}
                >
                  Clear number
                </button>
                <div className={s.ringFirst}>
                  <span>RING FIRST</span>
                  {founderSelector}
                  <p>
                    Answer your cellphone and press <strong>1</strong> to
                    connect.
                  </p>
                </div>
                {model && !model.callsEnabled ? (
                  <p className={s.helpText}>Outbound calling is not enabled.</p>
                ) : null}
              </div>
              <aside className={s.keypadAside}>
                <div className={s.lineCard}>
                  <div className={s.lineCardTop}>
                    <span>YOUR BUSINESS LINE</span>
                  </div>
                  <h2>Le Yard</h2>
                  <p>{displayNumber(model?.business ?? "+13328779035")}</p>
                  <div className={s.lineCardFooter}>
                    <span>
                      <Phone size={14} /> Calls
                    </span>
                    <span>
                      <MessageSquare size={14} /> Messages
                    </span>
                    <span>
                      <Voicemail size={14} /> Voicemail
                    </span>
                  </div>
                </div>
                <div className={s.sectionHeading}>
                  <h2>Recent calls</h2>
                  <button
                    className={s.textButton}
                    onClick={() => goTo("calls")}
                  >
                    View all <ArrowUpRight size={14} />
                  </button>
                </div>
                <div className={s.compactCalls}>
                  {callRows((model?.calls ?? []).slice(0, 3), true)}
                  {!model?.calls.length ? (
                    <p className={s.helpText}>
                      {emptyHistory ?? "Your recent calls will appear here."}
                    </p>
                  ) : null}
                </div>
                <details className={s.howItWorks}>
                  <summary>
                    How calling works <ChevronDown size={16} />
                  </summary>
                  <p>
                    We ring {founder} first, then connect the guest. They see
                    your Le Yard number. Use your cellphone’s speaker, mute, and
                    end-call controls.
                  </p>
                </details>
              </aside>
            </section>
          ) : null}

          {tab === "texts" && !creating ? (
            <div className={s.inbox} data-selected={Boolean(selected)}>
              <aside className={s.conversations} aria-label="Conversations">
                <label className={s.search}>
                  <Search size={17} />
                  <input
                    aria-label="Search conversations"
                    type="search"
                    placeholder="Search people, messages…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div
                  className={s.quickContacts}
                  aria-label="Recent conversations"
                >
                  <button className={s.newContact} onClick={startConversation}>
                    <span>
                      <Plus size={21} />
                    </span>
                    <small>New</small>
                  </button>
                  {conversations.slice(0, 4).map(([phone]) => (
                    <button
                      key={phone}
                      onClick={() => openConversation(phone)}
                      aria-label={`Open ${displayNumber(phone)}`}
                    >
                      <Avatar value={phone} />
                      <small>••• {phone.slice(-4)}</small>
                    </button>
                  ))}
                </div>
                <div className={s.sectionHeading}>
                  <h2>Conversations</h2>
                  <span className={s.count}>
                    {model ? conversations.length : "—"}
                  </span>
                </div>
                <div className={s.conversationList}>
                  {filteredConversations.map(([phone, m]) => (
                    <button
                      key={phone}
                      className={s.conversationRow}
                      data-active={selected === phone}
                      onClick={() => openConversation(phone)}
                    >
                      <Avatar value={phone} />
                      <span className={s.rowBody}>
                        <strong>{displayNumber(phone)}</strong>
                        <span>
                          {m.direction === "outbound" ? "You: " : ""}
                          {m.body || "Attachment"}
                        </span>
                      </span>
                      <time
                        className={s.rowTime}
                        dateTime={m.at}
                        title={date(m.at)}
                      >
                        {shortDate(m.at)}
                      </time>
                    </button>
                  ))}
                </div>
                {!filteredConversations.length ? (
                  <Empty
                    icon={MessageSquare}
                    title={search ? "No matches" : "Your conversations"}
                    text={
                      emptyHistory ??
                      (search
                        ? "No matching conversations."
                        : "No messages yet. Start a conversation above.")
                    }
                  />
                ) : null}
              </aside>
              <section className={s.thread} aria-label="Selected conversation">
                {!selected ? (
                  <Empty
                    icon={MessageSquare}
                    title="Your shared inbox"
                    text="Choose a conversation or start a new one."
                    action={
                      <button
                        className={s.primaryButton}
                        onClick={startConversation}
                      >
                        <SquarePen size={16} /> New message
                      </button>
                    }
                  />
                ) : (
                  <>
                    <div className={s.threadHeader}>
                      <button
                        className={`${s.iconButton} ${s.backButton}`}
                        aria-label="Back to conversations"
                        onClick={() => setSelected("")}
                      >
                        <ArrowLeft size={19} />
                      </button>
                      <Avatar value={selected} />
                      <div className={s.threadIdentity}>
                        <h2>{displayNumber(selected)}</h2>
                        <p>Texting as Le Yard</p>
                      </div>
                      <button
                        className={s.iconButton}
                        aria-label="Call this contact"
                        onClick={() => prepareCall(selected)}
                      >
                        <Phone size={18} />
                      </button>
                    </div>
                    <div
                      ref={history}
                      className={s.history}
                      aria-label="Text history"
                    >
                      {messages.map((m, index) => (
                        <div key={m.sid}>
                          {index === 0 ||
                          day(m.at) !== day(messages[index - 1].at) ? (
                            <p className={s.messageDay}>{day(m.at)}</p>
                          ) : null}
                          <article
                            className={s.message}
                            data-outbound={m.direction === "outbound"}
                          >
                            <div className={s.bubble}>
                              <p>{m.body}</p>
                              {Array.from(
                                { length: Math.min(m.mediaCount, 10) },
                                (_, i) => (
                                  <a
                                    key={i}
                                    href={`/api/phone/media?message=${m.sid}&index=${i}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <Paperclip size={14} /> Open attachment{" "}
                                    {i + 1}
                                    <ArrowUpRight size={13} />
                                  </a>
                                ),
                              )}
                            </div>
                            <p className={s.messageMeta}>
                              {time(m.at)} · {m.status}
                              {m.errorCode ? ` · error ${m.errorCode}` : ""}
                            </p>
                          </article>
                        </div>
                      ))}
                      {!messages.length ? (
                        <Empty
                          icon={MessageSquare}
                          title="Start the conversation"
                          text="No texts with this number yet."
                        />
                      ) : null}
                    </div>
                    <form
                      className={s.composer}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submit("sms");
                      }}
                    >
                      <div className={s.composeInput}>
                        <label className="sr-only" htmlFor="phone-message">
                          Message
                        </label>
                        <textarea
                          id="phone-message"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          maxLength={1200}
                          placeholder="Message from Le Yard…"
                          required
                          rows={2}
                        />
                        <button
                          type="submit"
                          aria-label={busy ? "Submitting text" : "Send text"}
                          disabled={
                            busy ||
                            !draft.trim() ||
                            !model?.smsEnabled ||
                            authExpired
                          }
                        >
                          {busy ? (
                            <LoaderCircle size={19} className={s.spinning} />
                          ) : (
                            <ArrowUp size={21} />
                          )}
                        </button>
                      </div>
                      <label className={s.consent}>
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        <span>
                          The recipient agreed to guest-care texts about this
                          request.
                        </span>
                      </label>
                      <div className={s.composeMeta}>
                        <span>Consent required for new conversations.</span>
                        <span>{draft.length}/1200</span>
                      </div>
                      {model && !model.smsEnabled ? (
                        <p className={s.helpText}>
                          Text sending is awaiting activation.
                        </p>
                      ) : null}
                    </form>
                  </>
                )}
              </section>
            </div>
          ) : null}

          {tab === "calls" ? (
            <section aria-label="Call history" className={s.historyPage}>
              <label className={s.search}>
                <Search size={17} />
                <input
                  aria-label="Search calls"
                  type="search"
                  placeholder="Search by number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div
                className={s.segmented}
                role="group"
                aria-label="Filter calls"
              >
                <button
                  aria-pressed={!missedOnly}
                  onClick={() => setMissedOnly(false)}
                >
                  All calls
                </button>
                <button
                  aria-pressed={missedOnly}
                  onClick={() => setMissedOnly(true)}
                >
                  Missed calls
                </button>
              </div>
              {callRows(recentCalls)}
              {!recentCalls.length ? (
                <Empty
                  icon={Phone}
                  title={
                    model && !loadError && missedOnly
                      ? "No missed calls"
                      : "Call history"
                  }
                  text={
                    emptyHistory ??
                    (search
                      ? "No calls match this number."
                      : missedOnly
                        ? "No missed calls in recent history."
                        : "No calls in the recent history.")
                  }
                />
              ) : null}
            </section>
          ) : null}

          {tab === "voicemail" ? (
            <section aria-label="Voicemail" className={s.historyPage}>
              <div className={s.sectionHeading}>
                <h2>Voice messages</h2>
                <span className={s.count}>
                  {model?.voicemails.length ?? "—"}
                </span>
              </div>
              <div className={s.voicemailList}>
                {model?.voicemails.map((v) => (
                  <article className={s.voicemailCard} key={v.id}>
                    <div className={s.voicemailHeading}>
                      <Avatar value={v.from ?? "?"} />
                      <div className={s.rowBody}>
                        <strong>
                          {v.from ? displayNumber(v.from) : "Unknown caller"}
                        </strong>
                        <span>{date(v.at)}</span>
                      </div>
                      <span className={s.duration}>
                        {v.durationSeconds === undefined
                          ? "—"
                          : duration(v.durationSeconds)}
                      </span>
                    </div>
                    {v.recordingSid ? (
                      <audio
                        controls
                        preload="none"
                        aria-label={`Voicemail from ${v.from ? displayNumber(v.from) : "unknown caller"}`}
                        src={`/api/phone/media?recording=${v.recordingSid}`}
                      />
                    ) : (
                      <p className={s.helpText}>Recording unavailable.</p>
                    )}
                    {v.from && /^\+1[2-9]\d{9}$/.test(v.from) ? (
                      <div className={s.voicemailActions}>
                        <button
                          className={s.textButton}
                          onClick={() => openConversation(v.from!)}
                        >
                          <MessageSquare size={15} /> Message
                        </button>
                        <button
                          className={s.textButton}
                          onClick={() => prepareCall(v.from!)}
                        >
                          <Phone size={15} /> Return call
                        </button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
              {!model?.voicemails.length ? (
                <Empty
                  icon={Voicemail}
                  title="Voice messages"
                  text={emptyHistory ?? "No voicemail yet."}
                />
              ) : null}
            </section>
          ) : null}
        </div>
        <footer className={s.footer}>
          <LyMonogram className={s.signature} /><span>New York · One shared line</span>
        </footer>
      </div>
      <div className={s.dockWrap}>
        <nav aria-label="Phone views" className={s.dock}>
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
              aria-current={tab === key ? "page" : undefined}
              onClick={() => goTo(key)}
            >
              <span>
                <Icon size={19} strokeWidth={1.8} />
              </span>
              <small>{label}</small>
            </button>
          ))}
        </nav>
        <button
          className={s.dockCompose}
          aria-label="Compose a new message"
          onClick={startConversation}
        >
          <Plus size={25} strokeWidth={1.7} />
        </button>
      </div>
    </main>
  );
}
