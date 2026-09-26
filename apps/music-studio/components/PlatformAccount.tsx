"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./platform-account.module.css";

/** Fired on window when the platform session changes, so cloud views can reload. */
export const PLATFORM_SESSION_EVENT = "synaptix-platform-session";

type Session =
  | { signedIn: true; profile: { handle: string; email: string }; expiresAt: string }
  | { signedIn: false };

/**
 * SynaptixPlay sign-in for cloud sync, generation, rendering and publishing. Local editing
 * never needs it. The access token stays in an HttpOnly cookie held by the studio's server.
 */
export function PlatformAccount({ compact = false }: { compact?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [expired, setExpired] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const announce = useCallback((next: Session) => {
    setSession(next);
    window.dispatchEvent(new CustomEvent(PLATFORM_SESSION_EVENT, { detail: next }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json() as Promise<Session>)
      .then((value) => { if (!cancelled) setSession(value); })
      .catch(() => { if (!cancelled) setSession({ signedIn: false }); });
    return () => { cancelled = true; };
  }, []);

  // Platform access tokens are short-lived; say so when this one ends.
  useEffect(() => {
    if (!session?.signedIn) return;
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    const timer = window.setTimeout(() => {
      setExpired(true);
      announce({ signedIn: false });
    }, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [session, announce]);

  async function signIn(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const body = (await response.json().catch(() => ({}))) as Session & { message?: string };
      if (!response.ok || !body.signedIn) {
        setError(body.message ?? "Sign-in failed. Try again.");
        return;
      }
      setPassword("");
      setExpired(false);
      announce(body);
      dialogRef.current?.close();
    } catch {
      setError("The studio couldn't reach its server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut(): Promise<void> {
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
    setExpired(false);
    announce({ signedIn: false });
  }

  function openSignIn(): void {
    setError(null);
    dialogRef.current?.showModal();
  }

  if (!session) return <span className={styles.account} aria-hidden="true" />;

  return (
    <div className={`${styles.account}${compact ? ` ${styles.compact}` : ""}`}>
      {session.signedIn ? (
        <>
          <span className={styles.identity} title={session.profile.email}>
            <span className={styles.dot} aria-hidden="true" />
            {session.profile.handle}
          </span>
          <button type="button" className={styles.link} onClick={() => void signOut()}>Sign out</button>
        </>
      ) : (
        <>
          {expired && <span className={styles.expired} role="status">Session ended</span>}
          <button type="button" className={styles.signIn} aria-haspopup="dialog" onClick={openSignIn}>
            {expired ? "Sign in again" : "Sign in to SynaptixPlay"}
          </button>
        </>
      )}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="platform-sign-in-heading"
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
      >
        <form
          className={styles.form}
          onSubmit={(event) => { event.preventDefault(); void signIn(); }}
        >
          <header className={styles.header}>
            <h2 id="platform-sign-in-heading">Sign in to SynaptixPlay</h2>
            <button type="button" aria-label="Close" onClick={() => dialogRef.current?.close()}>✕</button>
          </header>
          <p className={styles.note}>
            Needed for cloud sync, generation, rendering and publishing. Local editing works without it.
          </p>
          <label>
            Email
            <input type="email" autoComplete="username" required value={email}
              onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" required value={password}
              onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </dialog>
    </div>
  );
}
