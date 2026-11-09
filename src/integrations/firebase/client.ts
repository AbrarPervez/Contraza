import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config";

let app: FirebaseApp | undefined;

export function getFirebaseApp() {
  if (app) return app;

  app = getApps().some((candidate) => candidate.name === "contraza")
    ? getApp("contraza")
    : initializeApp(firebaseConfig, "contraza");
  return app;
}

export function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}

export function getFirestoreDb() {
  return getFirestore(getFirebaseApp());
}
