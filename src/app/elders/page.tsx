"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { createClient } from "@/lib/supabase/client";
import type { RoleName, RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";
import forms from "@/styles/forms.module.css";

function EldersMenuItem({
  href,
  icon,
  title,
}: {
  href: string;
  icon: string;
  title: string;
}) {
  return (
    <li>
      <Link href={href} className={forms.listButtonLink}>
        <span className={forms.listButtonIcon}>{icon}</span>
        <span>{title}</span>
      </Link>
    </li>
  );
}

export default function EldersPage() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isUser, setIsUser] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError(null);

      try {
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr || !user) {
          router.replace("/login");
          return;
        }

        const { data: account, error: accErr } = await supabase
          .from("emcaccounts")
          .select("id, isactive")
          .eq("authuserid", user.id)
          .single();

        if (accErr || !account || !account.isactive) {
          setError("No active EMC account linked to this login.");
          return;
        }

        const { data: roleRows, error: roleErr } = await supabase
          .from("emcaccountroles")
          .select("emcroles(rolename)")
          .eq("accountid", account.id);

        if (roleErr) {
          setError(`Failed to load roles: ${roleErr.message}`);
          return;
        }

        const roles = (roleRows ?? [])
          .map((r: RoleRow) => normalizeRoleRow(r)?.rolename)
          .filter(Boolean)
          .map((r) => String(r).trim().toLowerCase()) as RoleName[];

        const admin = roles.includes("emc_admin");
        const superuser = roles.includes("emc_superuser");
        const emcUser = roles.includes("emc_user");
        const allowed = admin || superuser || emcUser;
        if (!allowed) {
          setError("You are logged in, but you do not have access to EMC.");
          return;
        }

        if (!cancelled) {
          setIsAdmin(admin);
          setIsUser(emcUser);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  if (loading) {
    return <main className={forms.page}>Loading…</main>;
  }

  if (error) {
    return (
      <main className={forms.page}>
        <h1 className={forms.h1}>Elders</h1>
        <div className={forms.backRow}>
          <BackLink fallbackHref="/" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
            &lt;- Back to Dashboard
          </BackLink>
        </div>
        <p className={forms.error}>{error}</p>
      </main>
    );
  }

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>Elders</h1>
      <div className={forms.backRow}>
        <BackLink fallbackHref="/" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          &lt;- Back to Dashboard
        </BackLink>
      </div>
      <section className={forms.sectionCard}>
        <ul
          className={forms.listButtons}
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
        >
          <EldersMenuItem
            href="/elders/elders-list"
            icon="EL"
            title="Elders List"
          />
          {!isUser && (
            <EldersMenuItem
              href="/elders/elders-details"
              icon="ED"
              title="Elders Contact Information"
            />
          )}
        </ul>
        {isAdmin && (
          <>
            <h3 style={{ margin: "20px 0 10px", fontWeight: 700 }}>Administration</h3>
            <ul
              className={forms.listButtons}
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
            >
              <EldersMenuItem
                href="/elders/areas"
                icon="AR"
                title="Areas of Responsibility"
              />
              <EldersMenuItem
                href="/elders/congregations"
                icon="CG"
                title="Congregations Configuration"
              />
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
