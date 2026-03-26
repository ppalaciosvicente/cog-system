"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import styles from "@/styles/auth.module.css";

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSending(true);
    try {
      const appOrigin = (process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin)
        .trim()
        .replace(/\/+$/, "");
      const redirectTo = `${appOrigin}/auth/callback?next=/reset-password`;
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo },
      );
      if (resetErr) {
        setError(resetErr.message);
        return;
      }
      setMessage("If that email exists, a reset link has been sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>Elders Management Console</p>
        <h1 className={styles.title}>Reset your password</h1>
        <p className={styles.subtitle}>
          Enter the email address associated with your account.
        </p>
        <form onSubmit={onSubmit}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              autoComplete="username"
            />
          </div>
          <button className={styles.submit} disabled={sending}>
            {sending ? "Sending…" : "Send reset link"}
          </button>
        </form>
        {message && <p className={styles.message}>{message}</p>}
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.links}>
          <Link href="/login" className={styles.link}>
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
