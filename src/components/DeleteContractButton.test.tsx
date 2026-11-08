import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteContractButton } from "./DeleteContractButton";

const mocks = vi.hoisted(() => ({
  deleteDoc: vi.fn(),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
  batchDelete: vi.fn(),
  commit: vi.fn(),
  deleted: vi.fn(),
}));
vi.mock("firebase/firestore", () => ({
  deleteDoc: mocks.deleteDoc,
  getDocs: mocks.getDocs,
  writeBatch: mocks.writeBatch,
}));
vi.mock("@/integrations/firebase/client", () => ({ getFirestoreDb: vi.fn() }));
vi.mock("@/integrations/firebase/data", () => ({
  userDocument: (_collection: string, id: string) => `user-document/${id}`,
  reviewMessagesCollection: (id: string) => `review-messages/${id}`,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteDoc.mockResolvedValue(undefined);
  mocks.getDocs.mockResolvedValue({ docs: [] });
  mocks.commit.mockResolvedValue(undefined);
  mocks.writeBatch.mockReturnValue({ delete: mocks.batchDelete, commit: mocks.commit });
});

function mount(kind: "draft" | "review") {
  return render(<QueryClientProvider client={new QueryClient()}><DeleteContractButton id="item-1" title="Test contract" kind={kind} onDeleted={mocks.deleted} /></QueryClientProvider>);
}

describe("confirmed contract deletion", () => {
  it("does not delete when confirmation is cancelled", () => {
    mount("draft");
    fireEvent.click(screen.getByRole("button", { name: "Delete draft: Test contract" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
  });

  it.each([["draft", "item-1"], ["review", "item-1"]] as const)("deletes the selected %s after confirmation", async (kind, id) => {
    mount(kind);
    fireEvent.click(screen.getByRole("button", { name: `Delete ${kind}: Test contract` }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(mocks.deleted).toHaveBeenCalledOnce());
    expect(mocks.deleteDoc).toHaveBeenCalledWith(`user-document/${id}`);
  });
});