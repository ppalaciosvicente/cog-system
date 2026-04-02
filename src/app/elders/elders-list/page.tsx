"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import { BackLink } from "@/components/BackLink";
import forms from "@/styles/forms.module.css";
import type { RoleName, RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";

type ElderRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  homephone: string | null;
  cellphone: string | null;
  email: string | null;
  eldertypeid: number | null;
  emceldertype?:
    | { name: string | null; sortorder: number | null }
    | { name: string | null; sortorder: number | null }[]
    | null;
};

function displayName(m: { fname: string | null; lname: string | null }) {
  const ln = (m.lname ?? "").trim();
  const fn = (m.fname ?? "").trim();
  if (!ln && !fn) return "";
  if (!ln) return fn;
  if (!fn) return ln;
  return `${ln}, ${fn}`;
}

function normalizeElderTypeRelation(
  v?:
    | { name: string | null; sortorder: number | null }
    | { name: string | null; sortorder: number | null }[]
    | null,
) {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function highestAccessLabel(roleNames: string[]) {
  if (roleNames.includes("emc_admin")) return "Admin";
  if (roleNames.includes("emc_superuser")) return "Superuser";
  if (roleNames.includes("emc_user")) return "User";
  return "-";
}

function highestContribAccessLabel(roleNames: string[]) {
  if (roleNames.includes("contrib_admin")) return "Admin";
  if (roleNames.includes("contrib_user")) return "User";
  return "-";
}

function normalizeRoleName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function hasAnyRole(roleNames: (string | null | undefined)[], candidates: string[]) {
  const normalizedRoles = roleNames
    .map((role) => normalizeRoleName(role))
    .filter(Boolean);
  const normalizedCandidates = candidates.map((candidate) =>
    normalizeRoleName(candidate),
  );
  return normalizedRoles.some((role) => normalizedCandidates.includes(role));
}

export default function EldersListPage() {
  const supabase = createClient();
  const router = useRouter();

  const [pageLoading, setPageLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canViewDetails, setCanViewDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ElderRow[]>([]);
  const [accessByMemberId, setAccessByMemberId] = useState<Record<number, string>>({});
  const [contribAccessByMemberId, setContribAccessByMemberId] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setPageLoading(true);
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
          .filter(Boolean) as RoleName[];

        const admin = hasAnyRole(roles, ["emc_admin", "admin"]);
        const superuser = hasAnyRole(roles, [
          "emc_superuser",
          "emc_super_user",
          "superuser",
          "super_user",
        ]);
        if (!cancelled) setIsAdmin(admin);
        if (!cancelled) setCanViewDetails(admin || superuser);
        const allowed =
          admin || superuser || hasAnyRole(roles, ["emc_user", "user"]);
        if (!allowed) {
          setError("You are logged in, but you do not have access to EMC.");
          return;
        }

        const { data, error } = await supabase
          .from("emcmember")
          .select(
            "id,fname,lname,homephone,cellphone,email,eldertypeid,emceldertype(name,sortorder)",
          )
          .not("eldertypeid", "is", null)
          .order("sortorder", {
            foreignTable: "emceldertype",
            ascending: true,
          })
          .order("lname", { ascending: true })
          .order("fname", { ascending: true });

        let list = ((data ?? []) as ElderRow[]).map((row) => ({
          ...row,
          emceldertype: normalizeElderTypeRelation(row.emceldertype),
        }));

        if ((admin || superuser) && (error || list.length === 0)) {
          const fallback = await fetch("/api/elders/members?view=list", {
            method: "GET",
            headers: await getAuthHeaders(),
            credentials: "same-origin",
          });
          const payload = (await fallback.json().catch(() => ({}))) as {
            error?: string;
            members?: ElderRow[];
          };
          if (!fallback.ok) {
            setError(payload.error ?? error?.message ?? "Failed to load elders.");
            return;
          }
          list = (Array.isArray(payload.members) ? payload.members : []).map((row) => ({
            ...row,
            emceldertype: normalizeElderTypeRelation(row.emceldertype),
          }));
        } else if (error) {
          setError(error.message);
          return;
        }

        if (!cancelled) {
          list.sort((a, b) => {
            const sa =
              normalizeElderTypeRelation(a.emceldertype)?.sortorder ??
              Number.MAX_SAFE_INTEGER;
            const sb =
              normalizeElderTypeRelation(b.emceldertype)?.sortorder ??
              Number.MAX_SAFE_INTEGER;
            if (sa !== sb) return sa - sb;
            const ln = displayName(a).localeCompare(displayName(b));
            return ln;
          });
          setRows(list);

          if (!admin || list.length === 0) {
            setAccessByMemberId({});
            setContribAccessByMemberId({});
            return;
          }

          const memberIds = list.map((row) => row.id);
          const headers = await getAuthHeaders();
          const response = await fetch(
            `/api/elders/accounts?memberIds=${memberIds.join(",")}`,
            {
              method: "GET",
              headers,
              credentials: "same-origin",
            },
          );
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
            accessByMemberId?: Record<string, "emc_admin" | "emc_superuser" | "emc_user" | null>;
            contribAccessByMemberId?: Record<string, "contrib_admin" | "contrib_user" | null>;
          };
          if (!response.ok) {
            setError(payload.error ?? "Failed to load EMC access roles.");
            return;
          }

          const nextAccessByMemberId: Record<number, string> = {};
          const nextContribAccessByMemberId: Record<number, string> = {};
          memberIds.forEach((memberId) => {
            const roleName = payload.accessByMemberId?.[String(memberId)] ?? null;
            nextAccessByMemberId[memberId] = highestAccessLabel(roleName ? [roleName] : []);
            const contribRoleName = payload.contribAccessByMemberId?.[String(memberId)] ?? null;
            nextContribAccessByMemberId[memberId] = highestContribAccessLabel(
              contribRoleName ? [contribRoleName] : [],
            );
          });
          setAccessByMemberId(nextAccessByMemberId);
          setContribAccessByMemberId(nextContribAccessByMemberId);
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  if (pageLoading) {
    return <main className={forms.page}>Loading…</main>;
  }

  if (error) {
    return (
      <main className={forms.page}>
        <h1 className={forms.h1}>Elders General Listing</h1>
        <div className={forms.backRow}>
          <BackLink fallbackHref="/elders" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
            &lt;- Back to Elders
          </BackLink>
        </div>
        <p style={{ color: "crimson" }}>{error}</p>
      </main>
    );
  }

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>Elders General Listing</h1>
      <div className={forms.topBar}>
        <BackLink fallbackHref="/elders" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          &lt;- Back to Elders
        </BackLink>
        {isAdmin && (
          <Link href="/elders/add" className={forms.linkButton}>
            Add Elder
          </Link>
        )}
      </div>

      {rows.length > 0 ? (
        <div className={forms.tableWrap} style={{ marginTop: 12 }}>
          <table className={forms.table}>
            <thead>
              <tr>
                <th className={forms.th}>Name</th>
                <th className={forms.th}>Elder Type</th>
                <th className={forms.th}>Phone</th>
                <th className={forms.th}>Email</th>
                {isAdmin && <th className={forms.th}>EMC Access*</th>}
                {isAdmin && <th className={forms.th}>Contribution Access**</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className={forms.td}>
                    <Link
                      href={`/elders/elders-details?selected=${m.id}`}
                      className={forms.linkButton}
                      style={{ textDecoration: "none" }}
                    >
                      {displayName(m)}
                    </Link>
                  </td>
                  <td className={forms.td}>
                    {normalizeElderTypeRelation(m.emceldertype)?.name ?? ""}
                  </td>
                  <td className={forms.td}>
                    {(m.cellphone || m.homephone || "").trim()}
                  </td>
                  <td className={forms.td}>{m.email ?? ""}</td>
                  {isAdmin && (
                    <td className={forms.td}>{accessByMemberId[m.id] ?? "-"}</td>
                  )}
                  {isAdmin && (
                    <td className={forms.td}>{contribAccessByMemberId[m.id] ?? "-"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No elders found.</p>
      )}
      {isAdmin && rows.length > 0 && (
        <div style={{ marginTop: 18, fontSize: 13, color: "#374151" }}>
          <strong>* EMC Access</strong>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            <li>Admin: can view and edit everything.</li>
            <li>Superuser: can view everything.</li>
            <li>User: can only view members in his/her assigned areas.</li>
          </ul>
          <strong style={{ display: "inline-block", marginTop: 18 }}>** Contribution Access</strong>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            <li>Admin: access to everything.</li>
            <li>User: access to specific country/area.</li>
          </ul>
        </div>
      )}

    </main>
  );
}
