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
  description,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <li>
      <Link href={href} className={forms.listButtonLink}>
        <span className={forms.listButtonIcon}>{icon}</span>
        <span style={{ display: "grid", gap: 2 }}>
          <strong>{title}</strong>
          <span style={{ fontWeight: 400, color: "#374151" }}>{description}</span>
        </span>
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
            title="Elders general listing"
            description="Table listing all elders"
          />
          {!isUser && (
            <EldersMenuItem
              href="/elders/elders-details"
              icon="ED"
              title="Elders details"
              description="Detailed contact information for each elder"
            />
          )}
          <EldersMenuItem
            href="/elders/group-email"
            icon="GE"
            title="Group email"
            description="Gather email addresses of members in your area(s) of responsibility for sending emails"
          />
          {isAdmin && (
            <>
              <EldersMenuItem
                href="/elders/areas"
                icon="AR"
                title="Elders and areas of responsibility"
                description="Table listing the areas of responsibility of each elder"
              />
              <EldersMenuItem
                href="/elders/congregations"
                icon="CG"
                title="Congregations"
                description="List of existing congregations (areas of responsibility that don't match a state/province or country)"
              />
            </>
          )}
        </ul>
      </section>
    </main>
  );
}
