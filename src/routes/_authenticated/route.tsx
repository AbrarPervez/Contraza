import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getFirebaseAuth } from "@/integrations/firebase/client";
import { onAuthStateChanged } from "firebase/auth";
import { AppHeader } from "@/components/AppHeader";

function getInitialUser() {
  const auth = getFirebaseAuth();
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise<import("firebase/auth").User | null>((resolve, reject) => {
    let unsubscribe = () => {};
    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const user = await getInitialUser();
    if (!user) throw redirect({ to: "/auth" });
    return { user };
  },
  component: Layout,
});

function Layout() {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <Outlet />
    </div>
  );
}
