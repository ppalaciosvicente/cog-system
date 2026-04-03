"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { getAuthHeaders } from "@/lib/supabase/client";
import forms from "@/styles/forms.module.css";
import type { ContributionAccess } from "@/lib/contributions";

type ContributionPageProps = {
  title: string;
  description?: string;
  backHref?: string;
  showBackLink?: boolean;
  showRoleSummary?: boolean;
  pageClassName?: string;
  children: (access: ContributionPageAccess) => ReactNode;
};

type ContributionPageAccess = Extract<ContributionAccess, { ok: true }> & {
  scopeCountries?: string[];
  scopeLabel?: string;
};

let cachedContributionAccess: ContributionPageAccess | null = null;
let cachedContributionAccessAt = 0;
const CONTRIBUTION_ACCESS_CACHE_TTL_MS = 300_000;

export function ContributionPage({
  title,
  description,
  backHref = "/contributions",
  showBackLink = true,
  pageClassName,
  children,
}: ContributionPageProps) {
  const router = useRouter();
  const [access, setAccess] = useState<ContributionAccess | ContributionPageAccess | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Always fetch fresh access to avoid stale role state.
      setLoading(true);

      try {
        const headers = await getAuthHeaders();
        const response = await fetch("/api/contributions/access", {
          credentials: "include",
          headers,
        });

        if (response.status === 401 || response.status === 403) {
          router.replace("/login");
          return;
        }

        const payload = (await response.json()) as ContributionAccess;
        if (!cancelled) {
          setAccess(payload);
          if (payload.ok) {
            cachedContributionAccess = payload as ContributionPageAccess;
            cachedContributionAccessAt = Date.now();
          }
        }
      } catch (error) {
        if (!cancelled) {
          setAccess({
            ok: false,
            error: error instanceof Error ? error.message : "Failed to load access.",
            status: 500,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) {
    return <main className={forms.page}>Loading…</main>;
  }

  if (!access || !access.ok) {
    return (
      <main className={forms.page}>
        <div className={forms.topBar}>
          <h1 className={forms.h1}>{title}</h1>
        </div>
        {showBackLink ? (
          <div className={forms.backRow}>
            <BackLink
              fallbackHref={backHref}
              className={`${forms.linkButton} ${forms.linkButtonLight}`}
            >
              ← Back to Dashboard
            </BackLink>
          </div>
        ) : null}
        <p className={forms.error}>{access?.error ?? "Access could not be loaded."}</p>
      </main>
    );
  }

  return (
    <main className={[forms.page, pageClassName].filter(Boolean).join(" ")}>
      <div className={forms.topBar}>
        <h1 className={forms.h1}>{title}</h1>
      </div>
      {showBackLink ? (
        <div className={forms.backRow}>
          <BackLink
            fallbackHref={backHref}
            className={`${forms.linkButton} ${forms.linkButtonLight}`}
          >
            ← Back to Dashboard
          </BackLink>
        </div>
      ) : null}
      {description ? <p>{description}</p> : null}
      {access.scopeWarning ? (
        <p style={{ margin: "8px 0 0", color: "#92400e" }}>{access.scopeWarning}</p>
      ) : null}
      <div style={{ marginTop: 16 }}>{children(access)}</div>
    </main>
  );
}
