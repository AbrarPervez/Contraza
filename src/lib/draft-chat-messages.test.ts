import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const firestore = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  orderBy: vi.fn(() => ({ field: "createdAt" })),
  query: vi.fn((_collection: unknown, _order: unknown) => ({ path: "draft-chat-messages" })),
  draftChatMessagesCollection: vi.fn((_chatId: string) => ({ path: "draft-chat" })),
}));

vi.mock("firebase/firestore", () => ({
  onSnapshot: firestore.onSnapshot,
  orderBy: firestore.orderBy,
  query: firestore.query,
}));

vi.mock("@/integrations/firebase/data", () => ({
  draftChatMessagesCollection: firestore.draftChatMessagesCollection,
}));

import {
  hasAssistantCompletionForUser,
  mapDraftChatSnapshot,
  subscribeToDraftChatMessages,
  upsertDraftChatMessage,
  type DraftChatMessage,
} from "./draft-chat-messages";

describe("draft chat Firestore messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps streaming snapshots and replaces the same assistant message on completion", () => {
    let onSnapshotUpdate: ((snapshot: { docs: { id: string; data: () => object }[] }) => void) | undefined;
    firestore.onSnapshot.mockImplementation((_query, next) => {
      onSnapshotUpdate = next;
      return vi.fn();
    });
    const updates = vi.fn<(messages: DraftChatMessage[]) => void>();
    const stop = subscribeToDraftChatMessages("chat-1", updates, vi.fn());

    const userMessage = { id: "user-1", role: "user", content: "Draft an agreement" };
    const streamingAssistant = {
      id: "assistant-1",
      role: "assistant",
      content: "I can help with that.",
      status: "streaming",
    };
    onSnapshotUpdate?.({
      docs: [
        { id: "user-1", data: () => userMessage },
        { id: "assistant-1", data: () => streamingAssistant },
      ],
    });
    expect(updates).toHaveBeenLastCalledWith([
      { ...userMessage },
      { ...streamingAssistant },
    ]);

    const completedAssistant = {
      ...streamingAssistant,
      content: "I can help with that. What jurisdiction?",
      status: "complete",
    };
    onSnapshotUpdate?.({
      docs: [
        { id: "user-1", data: () => userMessage },
        { id: "assistant-1", data: () => completedAssistant },
      ],
    });
    const completedMessages = updates.mock.lastCall?.[0] ?? [];

    expect(completedMessages).toEqual([
      { ...userMessage },
      { ...completedAssistant },
    ]);
    expect(upsertDraftChatMessage(completedMessages, completedMessages[1]!)).toHaveLength(2);
    expect(hasAssistantCompletionForUser(completedMessages, "user-1")).toBe(true);
    stop();
  });

  it("filters empty streaming placeholders until they contain visible content", () => {
    expect(
      mapDraftChatSnapshot([
        {
          id: "assistant-1",
          data: () => ({
            role: "assistant",
            content: "",
            status: "streaming",
            createdAt: "2026-11-12T00:00:00.000Z",
          }),
        },
      ]),
    ).toEqual([]);
  });

  it("resubscribes after a terminal listener error so updated rules can take effect", async () => {
    vi.useFakeTimers();
    let onListenerError: ((error: Error) => void) | undefined;
    let onSnapshotUpdate: ((snapshot: { docs: { id: string; data: () => object }[] }) => void) | undefined;
    const firstUnsubscribe = vi.fn();
    const secondUnsubscribe = vi.fn();
    firestore.onSnapshot
      .mockImplementationOnce((_query, _next, onError) => {
        onListenerError = onError;
        return firstUnsubscribe;
      })
      .mockImplementationOnce((_query, next) => {
        onSnapshotUpdate = next;
        return secondUnsubscribe;
      });
    const onMessages = vi.fn();
    const onError = vi.fn();
    const stop = subscribeToDraftChatMessages("chat-1", onMessages, onError);

    onListenerError?.(new Error("Missing or insufficient permissions."));
    expect(firstUnsubscribe).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(firestore.onSnapshot).toHaveBeenCalledTimes(2);

    const completed = { id: "assistant-1", role: "assistant", content: "Done", status: "complete" };
    onSnapshotUpdate?.({ docs: [{ id: "assistant-1", data: () => completed }] });
    expect(onMessages).toHaveBeenCalledWith([completed]);

    stop();
    expect(secondUnsubscribe).toHaveBeenCalledOnce();
  });
});
