"use client";
import { useState, type ReactNode } from "react";
import {
  communicationGroups,
  type CommunicationGroup,
} from "@/lib/communication-groups";
import { CommunicationGroups } from "./communication-groups";
import { SmsPilotStatus } from "./sms-pilot-status";
import s from "./communication-groups.module.css";
export function MessagesHub({
  children,
  initialGroup,
  initialPhone,
}: {
  children: ReactNode;
  initialGroup: CommunicationGroup | "channels";
  initialPhone?: string;
}) {
  const [group, setGroup] = useState(initialGroup);
  function select(value: typeof group) {
    setGroup(value);
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
      <SmsPilotStatus />
      <nav className={s.tabs} aria-label="Groups">
        {communicationGroups.map((g) => (
          <button
            key={g.id}
            aria-pressed={group === g.id}
            onClick={() => select(g.id)}
          >
            {g.title}
          </button>
        ))}
        <button
          aria-pressed={group === "channels"}
          onClick={() => select("channels")}
        >
          Team channels
        </button>
      </nav>
      {group === "channels" ? (
        children
      ) : (
        <CommunicationGroups
          key={group}
          group={group}
          initialPhone={initialPhone}
        />
      )}
    </div>
  );
}
