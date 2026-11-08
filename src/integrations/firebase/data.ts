import { collection, doc, type CollectionReference, type DocumentReference } from "firebase/firestore";
import { getFirebaseAuth, getFirestoreDb } from "./client";

export type UserCollection = "leaseDrafts" | "reviewThreads";

export interface LeaseDraftData {
  title: string;
  params: unknown;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewThreadData {
  title: string;
  contractText: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewMessageData {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

function currentUserId() {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Sign in to access your contracts.");
  return user.uid;
}

export function userCollection(name: "leaseDrafts"): CollectionReference<LeaseDraftData>;
export function userCollection(name: "reviewThreads"): CollectionReference<ReviewThreadData>;
export function userCollection(name: UserCollection) {
  return collection(getFirestoreDb(), "users", currentUserId(), name);
}

export function userDocument(name: "leaseDrafts", id: string): DocumentReference<LeaseDraftData>;
export function userDocument(name: "reviewThreads", id: string): DocumentReference<ReviewThreadData>;
export function userDocument(name: UserCollection, id: string) {
  return doc(getFirestoreDb(), "users", currentUserId(), name, id);
}

export function reviewMessagesCollection(threadId: string) {
  const messages = collection(
    getFirestoreDb(),
    "users",
    currentUserId(),
    "reviewThreads",
    threadId,
    "messages",
  );
  return messages as CollectionReference<ReviewMessageData>;
}
