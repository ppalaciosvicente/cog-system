"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";

export default function HomePage() {
  const supabase = createClient();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr || !user) {
          router.replace("/login");
          return;
        }

        // IMPORTANT: lowercase table name
        const { data: account, error: accErr } = await supabase
          .from("emcaccounts")
          .select("id, isactive")
          .eq("authuserid", user.id)
          .single();

        if (accErr || !account || !account.isactive) {
          setError("No active EMC account linked to this login.");
          return;
        }

        // IMPORTANT: lowercase table names
        const { data: roleRows, error: roleErr } = await supabase
          .from("emcaccountroles")
          .select("emcroles(rolename)")
          .eq("accountid", account.id);

        if (roleErr) {
          setError(`Failed to load roles: ${roleErr.message}`);
          return;
        }

        const roleNames = (roleRows ?? [])
          .map((r: any) => r.emcroles?.rolename)
          .filter(Boolean) as string[];

        const allowed = roleNames.includes("emc_admin") || roleNames.includes("emc_user");
        if (!allowed) {
          setError("You are logged in, but you do not have access to the EMC app.");
          return;
        }

        if (!cancelled) {
          setRoles(roleNames);
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
    return <main style={{ padding: 24, fontFamily: "system-ui" }}>Loading…</main>;
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>EMC Dashboard</h1>

      {error ? (
        <p style={{ color: "crimson" }}>{error}</p>
      ) : (
        <>
          <p>Logged in. Roles: {roles.join(", ")}</p>
          <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
            <a href="/members">Members</a>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </main>
  );
}

