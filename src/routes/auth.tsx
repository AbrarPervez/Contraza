import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getFirebaseAuth } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/AppHeader";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Contraza" },
      { name: "description", content: "Sign in to draft and review commercial lease agreements." },
      { property: "og:title", content: "Sign in — Contraza" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:description", content: "Access your lease drafts and review conversations." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) void navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
      } else {
        await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
      }
      toast.success(mode === "in" ? "Signed in" : "Account created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    try {
      await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    const recipient = email.trim();
    if (!recipient) {
      toast.error("Enter your email address first.");
      return;
    }

    setBusy(true);
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), recipient);
      toast.success("If an account exists for that email, Firebase will send a password reset link.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the password reset email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="paper-sheet w-full max-w-sm rounded-md border p-8">
        <Logo />
        <h1 className="mt-6 text-2xl font-semibold">{mode === "in" ? "Sign in" : "Create account"}</h1>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pw">Password</Label>
            <Input id="pw" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {mode === "in" && (
            <div className="flex justify-end">
              <button
                type="button"
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={resetPassword}
                disabled={busy}
              >
                Forgot password?
              </button>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "in" ? "Sign in" : "Sign up"}
          </Button>
        </form>
        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span>or</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button type="button" variant="outline" className="w-full" onClick={signInWithGoogle} disabled={busy}>
          Continue with Google
        </Button>
        <button
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          type="button"
          disabled={busy}
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
          }}
        >
          {mode === "in" ? "No account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
