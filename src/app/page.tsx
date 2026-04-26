"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { loadCurrentAppAccess } from "@/lib/app-access";
import forms from "@/styles/forms.module.css";

export default function HomePage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleSummary, setRoleSummary] = useState<string | null>(null);
  const [appAccess, setAppAccess] = useState({
    canAccessEmc: false,
    canAccessContributions: false,
  });

  useEffect(() => {
    let cancelled = false;
    let redirected = false;

    async function run() {
      setLoading(true);
      setError(null);
      setRoleSummary(null);
      setAppAccess({ canAccessEmc: false, canAccessContributions: false });

      try {
        const access = await loadCurrentAppAccess(supabase);
        if (!access.ok) {
          if (access.unauthenticated) {
            setRedirecting(true);
            router.replace("/login");
            redirected = true;
            return;
          }

          setError(access.error);
          return;
        }

        const nextAppAccess = access.appAccess;
        if (nextAppAccess.canAccessEmc && !nextAppAccess.canAccessContributions) {
          router.replace("/emc");
          return;
        }

        if (!nextAppAccess.canAccessEmc && nextAppAccess.canAccessContributions) {
          router.replace("/contributions");
          return;
        }

        if (nextAppAccess.canAccessEmc && nextAppAccess.canAccessContributions) {
          if (!cancelled) {
            setError(null);
            setAppAccess(nextAppAccess);
            setRoleSummary(access.roleSummary);
          }
          return;
        }

        if (!cancelled) {
          setError("You are logged in, but you do not have access to any app area.");
        }
      } finally {
        if (!cancelled && !redirected) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  if (loading) {
    return (
      <main
        className={forms.page}
        style={{ marginTop: "calc(72px + env(safe-area-inset-top, 0px))" }}
      >
        Loading…
      </main>
    );
  }

  if (redirecting) return null;

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main
      className={forms.page}
      style={{ marginTop: "calc(72px + env(safe-area-inset-top, 0px))" }}
    >
      <h1 className={forms.h1}>COG PKG Management System</h1>
      {!error && roleSummary ? <p>Logged in as {roleSummary}</p> : null}
      {!error && (
        <div className={forms.topGroup} style={{ marginTop: 8 }}>
          <button
            type="button"
            className={`${forms.button} ${forms.buttonDanger}`}
            onClick={handleLogout}
          >
            Log out
          </button>
        </div>
      )}

      {error ? (
        <p className={forms.error}>{error}</p>
      ) : (
        <section className={forms.sectionCard} style={{ marginTop: 12 }}>
          <ul
            className={forms.listButtons}
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}
          >
            {appAccess.canAccessEmc ? (
              <li>
                <Link href="/emc" className={forms.listButtonLink}>
                  <span className={forms.listButtonIcon}>EMC</span>
                  <span>
                    <span style={{ display: "block" }}>Elders Management Console</span>
                  </span>
                </Link>
              </li>
            ) : null}

            {appAccess.canAccessContributions ? (
              <li>
                <Link href="/contributions" className={forms.listButtonLink}>
                  <span className={forms.listButtonIcon}>CTR</span>
                  <span>
                    <span style={{ display: "block" }}>Contributions</span>
                  </span>
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
      )}
    </main>
  );
}
