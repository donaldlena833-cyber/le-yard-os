export interface PositionedChatMessage {
  id: string;
  channel_id: string;
  author_id: string;
  created_at: string;
}

export function compareMessagePosition(
  left: Pick<PositionedChatMessage, "id" | "created_at">,
  right: Pick<PositionedChatMessage, "id" | "created_at">,
): number {
  return left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id);
}

export function unreadCountForChannel(
  messages: readonly PositionedChatMessage[],
  currentUserId: string,
  lastReadMessageId: string | null,
): number {
  const ordered = [...messages].sort(compareMessagePosition);
  const lastIndex = lastReadMessageId
    ? ordered.findIndex((message) => message.id === lastReadMessageId)
    : -1;
  return ordered
    .slice(lastIndex + 1)
    .filter((message) => message.author_id !== currentUserId).length;
}
