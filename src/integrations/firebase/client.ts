import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

let app: FirebaseApp | undefined;

export function getFirebaseApp() {
  if (app) return app;

  const config = {
    apiKey: import.meta.env["VITE_FIREBASE_API_KEY"],
    authDomain: import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"],
    projectId: import.meta.env["VITE_FIREBASE_PROJECT_ID"],
    appId: import.meta.env["VITE_FIREBASE_APP_ID"],
    storageBucket: import.meta.env["VITE_FIREBASE_STORAGE_BUCKET"],
    messagingSenderId: import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"],
  };
  const requiredConfig: Record<string, string | undefined> = {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
  };
  const missing = Object.entries(requiredConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      `Missing Firebase environment variable(s): ${missing.map((key) => `VITE_FIREBASE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`).join(", ")}`,
    );
  }

  app = getApps().some((candidate) => candidate.name === "contraza")
    ? getApp("contraza")
    : initializeApp(config, "contraza");
  return app;
}

export function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}

export function getFirestoreDb() {
  return getFirestore(getFirebaseApp());
}
