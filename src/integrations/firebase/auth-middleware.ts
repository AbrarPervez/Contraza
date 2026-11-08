import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const serviceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

function getFirebaseAdminApp() {
  const projectId = process.env["FIREBASE_PROJECT_ID"];
  const serviceAccountPath = process.env["FIREBASE_SERVICE_ACCOUNT_PATH"];
  if (!projectId) {
    throw new Error("Missing Firebase Admin environment variable: FIREBASE_PROJECT_ID");
  }

  let credential;
  if (serviceAccountPath) {
    const serviceAccountFile = resolve(process.cwd(), serviceAccountPath);
    let serviceAccountJson: unknown;
    try {
      serviceAccountJson = JSON.parse(readFileSync(serviceAccountFile, "utf8"));
    } catch (error) {
      throw new Error(
        `Could not read Firebase service-account file at "${serviceAccountFile}".`,
        { cause: error },
      );
    }

    const serviceAccount = serviceAccountSchema.parse(serviceAccountJson);
    if (serviceAccount.project_id !== projectId) {
      throw new Error("Firebase service-account project_id does not match FIREBASE_PROJECT_ID.");
    }
    credential = cert({
      projectId,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key,
    });
  } else {
    const clientEmail = process.env["FIREBASE_CLIENT_EMAIL"];
    const privateKey = process.env["FIREBASE_PRIVATE_KEY"]?.replace(/\\n/g, "\n");
    if (!clientEmail || !privateKey) {
      throw new Error(
        "Set FIREBASE_SERVICE_ACCOUNT_PATH or both FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.",
      );
    }
    credential = cert({ projectId, clientEmail, privateKey });
  }

  return (
    getApps().find((app) => app.name === "contraza-admin") ??
    initializeApp(
      {
        credential,
        projectId,
      },
      "contraza-admin",
    )
  );
}

export const requireFirebaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    const authorization = request?.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new Error("Unauthorized: Firebase sign-in is required.");
    }

    const app = getFirebaseAdminApp();
    const token = authorization.slice("Bearer ".length);
    const user = await getAuth(app).verifyIdToken(token);
    return next({
      context: {
        firebaseUser: user,
        userId: user.uid,
        adminDb: getFirestore(app),
      },
    });
  },
);
