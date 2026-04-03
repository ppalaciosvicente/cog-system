"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import styles from "@/styles/auth.module.css";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const noAccess = useMemo(() => searchParams.get("noAccess") === "1", [searchParams]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const normalizedEmail = email.trim().toLowerCase();
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) {
        setErr(error.message);
        return;
      }
    } catch (signInError) {
      const message =
        signInError instanceof Error
          ? signInError.message
          : "Unable to reach the authentication service. Please try again.";
      setErr(message);
      return;
    }

    router.push("/");
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>
          Management System
          <br />
          COG PKG
        </p>
        <h1 className={`${styles.title} ${styles.titleMuted}`}>Welcome back</h1>

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

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              autoComplete="current-password"
            />
          </div>

          <button className={styles.submit}>Sign in</button>

          <div className={styles.links}>
            <Link href="/forgot-password" className={styles.link}>
              Forgot password?
            </Link>
          </div>

          <p className={styles.subtitle} style={{ marginTop: 12 }}>
            Invite link expired? Use <em>Forgot password</em> to receive a fresh setup link.
          </p>

          {noAccess ? (
            <p className={styles.error} style={{ marginTop: 12 }}>
              You don&apos;t have access. Please contact an administrator.
            </p>
          ) : null}

          {err && <p className={styles.error}>{err}</p>}
        </form>
      </div>
    </div>
  );
}
