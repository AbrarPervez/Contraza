import { createMiddleware } from "@tanstack/react-start";
import { getFirebaseAuth } from "./client";

export const attachFirebaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token = await getFirebaseAuth().currentUser?.getIdToken();
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
