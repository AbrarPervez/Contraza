import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { getFirebaseAuth } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-seal font-serif text-sm font-semibold text-seal">
        C
      </span>
      <span className="font-serif text-xl font-semibold">Contraza</span>
    </Link>
  );
}

export function AppHeader() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (user) => setEmail(user?.email ?? null));
  }, []);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    try {
      await firebaseSignOut(getFirebaseAuth());
      await navigate({ to: "/auth", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out.");
    }
  }

  const linkCls = "text-sm text-muted-foreground hover:text-foreground";
  const activeCls = "text-sm font-medium text-foreground underline decoration-seal underline-offset-8";

  return (
    <header className="no-print border-b bg-paper">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-10">
          <Logo />
          <nav className="hidden gap-6 sm:flex">
            <Link to="/dashboard" className={linkCls} activeProps={{ className: activeCls }}>
              Dashboard
            </Link>
            <Link to="/draft" className={linkCls} activeProps={{ className: activeCls }}>
              Drafting
            </Link>
            <Link to="/review" className={linkCls} activeProps={{ className: activeCls }}>
              Review
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground md:inline">{email}</span>
          <Button variant="outline" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
