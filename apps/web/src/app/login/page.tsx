"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2, Sparkles, WifiOff } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Reveal } from "@/components/motion/reveal";

/** Only ever redirect to an in-app path — never follow an absolute/external URL from the query string. */
function safeRedirectTarget(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, status, apiUnreachable } = useAuth();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const redirectTarget = safeRedirectTarget(searchParams.get("redirect"));

  // Already authenticated (e.g. a valid session restored from localStorage)
  // — AppShell redirects too, but bounce here as well so the form never
  // flashes for a signed-in user who lands on /login directly.
  React.useEffect(() => {
    if (status === "authenticated") {
      router.replace(redirectTarget);
    }
  }, [status, router, redirectTarget]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await login(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.replace(redirectTarget);
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      {/* Subtle brand mesh glow (fixed backdrop, taste-skill "Ethereal Glass"),
          never on a scrolling container, pointer-events-none. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_50%_-8%,rgba(109,94,252,0.14),transparent_60%),radial-gradient(40rem_24rem_at_90%_110%,rgba(109,94,252,0.08),transparent_60%)]"
      />
      <Reveal className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <Sparkles className="size-5" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Constellation</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">The single pane of glass over every module.</p>
          {searchParams.get("redirect") && apiUnreachable ? (
            <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
              Your session ended and the API is currently unreachable. Sign in again once it&apos;s back.
            </p>
          ) : searchParams.get("redirect") ? (
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">Welcome back — sign in to continue where you left off.</p>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Welcome back</CardTitle>
            <CardDescription>Enter your credentials to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@constellation.local"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
                >
                  {apiUnreachable ? (
                    <WifiOff className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  )}
                  <span>{error}</span>
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
          © {new Date().getFullYear()} Constellation Platform
        </p>
      </Reveal>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-neutral-400" aria-label="Loading" />
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams() needs a Suspense boundary in the app router (it can
  // otherwise force the whole route to bail out of static rendering with a
  // build warning) — this page is fully client-rendered anyway, so the
  // fallback only flashes for a frame.
  return (
    <React.Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </React.Suspense>
  );
}
