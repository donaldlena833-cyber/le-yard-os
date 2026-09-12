"use client";
import { useState, type ReactNode } from "react";
import {
  communicationGroups,
  type CommunicationGroup,
} from "@/lib/communication-groups";
import { CommunicationGroups } from "./communication-groups";
import { SmsPilotStatus } from "./sms-pilot-status";
import s from "./communication-groups.module.css";
type MessagesHubProps = {
  children: ReactNode;
  initialGroup: CommunicationGroup | "channels";
  initialPhone?: string;
  messageLinkError?: string;
};

export function MessagesHub(props: MessagesHubProps) {
  return <MessagesHubSelection key={JSON.stringify([props.initialGroup, props.initialPhone, props.messageLinkError])} {...props} />;
}

function MessagesHubSelection({
  children,
  initialGroup,
  initialPhone,
  messageLinkError,
}: MessagesHubProps) {
  const [selection, setSelection] = useState({
    group: initialGroup,
    phone: initialPhone,
    error: messageLinkError,
  });
  const { group, phone, error } = selection;
  function select(value: typeof group) {
    setSelection({ group: value, phone: undefined, error: undefined });
    window.history.replaceState(null, "", `/messages?group=${value}`);
  }
  return (
    <div className={s.hub}>
      <div className={s.heading}>
        <div>
          <h2>Groups</h2>
          <p>
            Client conversations, team requests, and follow-up in one place.
          </p>
        </div>
        <a className={s.button} href="/phone">
          Open Phone
        </a>
      </div>
      <aside className={s.notice} aria-label="Le Yard Messages phone alerts">
        <strong>Le Yard Messages on your phone</strong>
        <p>
          Save the Le Yard business number as “Le Yard Messages” to keep its texts
          together. When phone alerts are enabled, open the link in each alert to
          view that guest or team conversation. Reply here from the Le Yard
          number; a manual reply pauses AI for that conversation.
        </p>
        <p>Replying to the alert text on your phone sends a message to Le Yard, not to the guest.</p>
        <div className={s.row}>
          <a className={s.button} href="/le-yard-messages.vcf" download="Le Yard Messages.vcf">
            Save Le Yard Messages contact
          </a>
          <span className={s.muted}>(332) 877-9035</span>
        </div>
      </aside>
      <SmsPilotStatus />
      <nav className={s.tabs} aria-label="Groups">
        {communicationGroups.map((g) => (
          <button
            key={g.id}
            aria-pressed={!error && group === g.id}
            onClick={() => select(g.id)}
          >
            {g.title}
          </button>
        ))}
        <button
          aria-pressed={!error && group === "channels"}
          onClick={() => select("channels")}
        >
          Team channels
        </button>
      </nav>
      {error ? (
        <p role="alert" className={s.alert}>{error}</p>
      ) : group === "channels" ? (
        children
      ) : (
        <CommunicationGroups
          key={`${group}:${phone ?? ""}`}
          group={group}
          initialPhone={phone}
        />
      )}
    </div>
  );
}
