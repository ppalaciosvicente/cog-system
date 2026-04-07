"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { EmcDashboardContent } from "@/components/EmcDashboardContent";
import { loadCurrentAppAccess } from "@/lib/app-access";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import forms from "@/styles/forms.module.css";

export default function EmcHomePage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleLabel, setRoleLabel] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [areasLabel, setAreasLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setRoleLabel(null);
      setAreasLabel(null);

      try {
        const access = await loadCurrentAppAccess(supabase);
        if (!access.ok) {
          if (access.unauthenticated) {
            router.replace("/login");
            return;
          }

          setError(access.error);
          return;
        }

        if (!access.appAccess.canAccessEmc) {
          if (access.appAccess.canAccessContributions) {
            router.replace("/contributions");
            return;
          }

          setError("You are logged in, but you do not have access to the EMC app.");
          return;
        }

        if (!cancelled) {
          setRoleLabel(access.roleSummary);
          const normalizedRoles = access.roleSummary
            .split(",")
            .map((r) => r.trim().toLowerCase());
          setIsAdmin(normalizedRoles.includes("emc_admin"));
          try {
            const headers = await getAuthHeaders();
            const response = await fetch("/api/elders/areas/summary", {
              method: "GET",
              headers,
              credentials: "include",
            });
            const payload = (await response.json().catch(() => ({}))) as {
              label?: string;
            };
            if (!response.ok) return;
            if (!cancelled) {
              setAreasLabel(payload.label ?? null);
            }
          } catch {
            // Keep dashboard usable even if area summary fails.
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  if (loading) {
    return <main className={forms.page}>Loading…</main>;
  }

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>EMC Dashboard</h1>
      {!error && roleLabel ? (
        <p style={{ margin: "8px 0 0", fontStyle: "italic" }}>
          Logged in as: {roleLabel}
        </p>
      ) : null}
      {!error && areasLabel ? (
        <p style={{ margin: "8px 0 0", fontStyle: "italic" }}>
          Areas of responsibility: {areasLabel}
        </p>
      ) : null}
      {error ? <p className={forms.error}>{error}</p> : <EmcDashboardContent isAdmin={isAdmin} />}
    </main>
  );
}
