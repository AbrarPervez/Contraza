import { onSnapshot, orderBy, query } from "firebase/firestore";
import { draftChatMessagesCollection, type DraftChatMessageData } from "@/integrations/firebase/data";

export type DraftChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  contractText?: string;
  status?: "streaming" | "complete";
};

type SnapshotDocument = {
  id: string;
  data(): DraftChatMessageData;
};

export function mapDraftChatSnapshot(docs: readonly SnapshotDocument[]): DraftChatMessage[] {
  return docs.flatMap((message) => {
    const saved = message.data();
    if (
      (saved.role !== "user" && saved.role !== "assistant") ||
      typeof saved.content !== "string"
    ) {
      return [];
    }
    if (
      saved.role === "assistant" &&
      saved.status === "streaming" &&
      !saved.content.trim() &&
      typeof saved.contractText !== "string"
    ) {
      return [];
    }
    return [
      {
        id: message.id,
        role: saved.role,
        content: saved.content,
        ...(saved.status === "streaming" || saved.status === "complete"
          ? { status: saved.status }
          : {}),
        ...(typeof saved.contractText === "string" ? { contractText: saved.contractText } : {}),
      },
    ];
  });
}

export function upsertDraftChatMessage(
  messages: DraftChatMessage[],
  incoming: DraftChatMessage,
): DraftChatMessage[] {
  const existingIndex = messages.findIndex((message) => message.id === incoming.id);
  if (existingIndex < 0) return [...messages, incoming];
  return messages.map((message) => (message.id === incoming.id ? incoming : message));
}

export function hasAssistantCompletionForUser(
  messages: DraftChatMessage[],
  userMessageId: string,
) {
  const userIndex = messages.findIndex(
    (message) => message.id === userMessageId && message.role === "user",
  );
  if (userIndex < 0) return false;
  return messages
    .slice(userIndex + 1)
    .some((message) => message.role === "assistant" && message.status === "complete");
}

export function subscribeToDraftChatMessages(
  chatId: string,
  onMessages: (messages: DraftChatMessage[]) => void,
  onError: (error: Error) => void,
) {
  let active = true;
  let unsubscribe: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelayMs = 1_000;
  let nextErrorReportAt = Number.NEGATIVE_INFINITY;

  function scheduleRetry(error: Error) {
    if (!active) return;
    unsubscribe?.();
    unsubscribe = undefined;
    if (Date.now() >= nextErrorReportAt) {
      onError(error);
      nextErrorReportAt = Date.now() + 30_000;
    }
    const delay = retryDelayMs;
    retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
    retryTimer = setTimeout(subscribe, delay);
  }

  function subscribe() {
    if (!active) return;
    try {
      unsubscribe = onSnapshot(
        query(draftChatMessagesCollection(chatId), orderBy("createdAt")),
        (snapshot) => {
          retryDelayMs = 1_000;
          onMessages(mapDraftChatSnapshot(snapshot.docs));
        },
        scheduleRetry,
      );
    } catch (error) {
      scheduleRetry(error instanceof Error ? error : new Error("Could not subscribe to draft chat."));
    }
  }

  subscribe();
  return () => {
    active = false;
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    unsubscribe?.();
  };
}
