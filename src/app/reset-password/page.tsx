"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "@/styles/auth.module.css";

export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError(null);
      try {
        const urlError = new URLSearchParams(window.location.search).get(
          "error",
        );
        if (urlError && !cancelled) setError(urlError);

        const { data } = await supabase.auth.getSession();
        if (!cancelled) {
          setReady(Boolean(data.session));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const loginEmail = String(userData.user?.email ?? "")
        .trim()
        .toLowerCase();

      const { error: updateErr } = await supabase.auth.updateUser({
        password,
      });
      if (updateErr) {
        setError(updateErr.message);
        return;
      }

      await supabase.auth.signOut();

      if (!loginEmail) {
        setError("Password saved, but could not verify login email.");
        return;
      }

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (signInErr) {
        setError(
          `Password saved, but login failed: ${signInErr.message}. Try Forgot Password.`,
        );
        return;
      }

      router.replace("/");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.brand}>COG PKG Management System</p>
          <h1 className={styles.title}>Loading</h1>
          <p className={styles.subtitle}>Preparing your reset session…</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.brand}>COG PKG Management System</p>
          <h1 className={styles.title}>Set password</h1>
          <p className={styles.error}>
            {error ?? "Reset link is invalid or expired. Request a new one."}
          </p>
          <div className={styles.links}>
            <Link href="/forgot-password" className={styles.link}>
              Go to Forgot Password
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>COG PKG Management System</p>
        <h1 className={styles.title}>Set password</h1>
        <p className={styles.subtitle}>
          Invite accepted. Please set your password to finish account setup.
        </p>
        <p className={styles.subtitle}>
          If this link is expired, request a new one from Reset your password.
        </p>
        <form onSubmit={onSubmit}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              autoComplete="new-password"
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={styles.input}
              autoComplete="new-password"
            />
          </div>

          <button className={styles.submit} disabled={saving}>
            {saving ? "Saving…" : "Save password"}
          </button>
        </form>

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
