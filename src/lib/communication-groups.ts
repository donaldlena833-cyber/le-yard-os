export type CommunicationMessage = {
  sid: string;
  from_number: string;
  to_number: string;
  body: string;
  direction: "inbound" | "outbound";
  sender_kind: "client" | "staff" | "automation" | "unknown";
  audience: "client" | "team";
  contact_name: string | null;
  media_count: number;
  status: string;
  error_code: string | null;
  sent_at: string;
};
export type CommunicationNote = {
  id: string;
  case_id: string;
  author_name: string;
  body: string;
  status: "open" | "resolved" | null;
  created_at: string;
};
export type CommunicationCase = {
  id: string;
  kind: "request" | "ticket";
  title: string;
  body: string;
  status?: "open" | "resolved";
  phone: string | null;
  source_sid: string | null;
  created_at: string;
};
export const communicationGroups = [
  {
    id: "clients",
    title: "Client conversations",
    description:
      "Every client text, reply, and attachment in one shared history.",
  },
  {
    id: "team",
    title: "Team requests",
    description:
      "Employees text the Le Yard number for work requests and follow-ups.",
  },
  {
    id: "tickets",
    title: "Tickets",
    description:
      "Issues that need a follow-up, with an open or resolved status.",
  },
] as const;
export type CommunicationGroup = (typeof communicationGroups)[number]["id"];
export function caseStatus(notes: CommunicationNote[]) {
  return (
    [...notes]
      .sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      )
      .filter((n) => n.status)
      .at(-1)?.status ?? "open"
  );
}

export const handoffNotice =
  "Le Yard: I’m bringing a member of our team into this conversation to help. They’ll reply here. Reply STOP to opt out.";
