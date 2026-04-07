"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import { BackLink } from "@/components/BackLink";
import forms from "@/styles/forms.module.css";
import type { RoleName, RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";

type CongregationRow = {
  id: number;
  name: string | null;
  comments: string | null;
};

type ElderAreaRow = {
  congregationid: number | null;
  emcmember?:
    | {
        id: number;
        fname: string | null;
        lname: string | null;
      }
    | {
        id: number;
        fname: string | null;
        lname: string | null;
      }[]
    | null;
};

function displayName(m?: { fname: string | null; lname: string | null } | null) {
  if (!m) return "";
  const ln = (m.lname ?? "").trim();
  const fn = (m.fname ?? "").trim();
  if (!ln && !fn) return "";
  if (!ln) return fn;
  if (!fn) return ln;
  return `${ln}, ${fn}`;
}

function normalizeElderMemberRelation(
  m?:
    | {
        id: number;
        fname: string | null;
        lname: string | null;
      }
    | {
        id: number;
        fname: string | null;
        lname: string | null;
      }[]
    | null,
) {
  if (!m) return null;
  return Array.isArray(m) ? (m[0] ?? null) : m;
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

export default function CongregationsPage() {
  const supabase = createClient();
  const router = useRouter();

  const [pageLoading, setPageLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [rows, setRows] = useState<CongregationRow[]>([]);
  const [eldersByCongregationId, setEldersByCongregationId] = useState<
    Record<number, string[]>
  >({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editComments, setEditComments] = useState("");
  const [savingEditId, setSavingEditId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setPageLoading(true);
      setError(null);
      setActionError(null);
      setActionMsg(null);

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
        const allowed = admin || superuser || hasAnyRole(roles, ["emc_user", "user"]);
        if (!allowed) {
          setError("You are logged in, but you do not have access to EMC.");
          return;
        }
        if (!cancelled) setIsAdmin(admin);

        const [{ data: congregations, error: congregationErr }, { data: areas, error: areaErr }] =
          await Promise.all([
            supabase
              .from("emccongregation")
              .select("id,name,comments")
              .order("name", { ascending: true }),
            supabase
              .from("emcelderarea")
              .select("congregationid,emcmember(id,fname,lname)")
              .not("congregationid", "is", null),
          ]);

        let congregationRows = (congregations ?? []) as CongregationRow[];
        let areaRows = (areas ?? []) as ElderAreaRow[];
        let loadErr: string | null = null;

        if ((admin || superuser) && (congregationErr || areaErr || congregationRows.length === 0)) {
          const fallback = await fetch("/api/elders/congregations/list", {
            method: "GET",
            headers: await getAuthHeaders(),
            credentials: "same-origin",
          });
          const payload = (await fallback.json().catch(() => ({}))) as {
            error?: string;
            congregations?: CongregationRow[];
            areas?: ElderAreaRow[];
          };
          if (!fallback.ok) {
            loadErr =
              payload.error ??
              congregationErr?.message ??
              areaErr?.message ??
              "Failed to load congregations.";
          } else {
            congregationRows = Array.isArray(payload.congregations) ? payload.congregations : [];
            areaRows = Array.isArray(payload.areas) ? payload.areas : [];
          }
        } else if (congregationErr) {
          loadErr = `Failed to load congregations: ${congregationErr.message}`;
        } else if (areaErr) {
          loadErr = `Failed to load elder assignments: ${areaErr.message}`;
        }

        if (loadErr) {
          setError(loadErr);
          return;
        }

        if (!cancelled) {
          setRows(congregationRows);

          const map: Record<number, string[]> = {};
          areaRows.forEach((row) => {
            const congregationId = row.congregationid;
            if (!congregationId) return;

            const name = displayName(normalizeElderMemberRelation(row.emcmember));
            if (!name) return;

            const current = map[congregationId] ?? [];
            if (!current.includes(name)) current.push(name);
            map[congregationId] = current;
          });

          Object.keys(map).forEach((key) => {
            const id = Number(key);
            map[id].sort((a, b) => a.localeCompare(b));
          });

          setEldersByCongregationId(map);
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, router, supabase]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return list;
  }, [rows]);

  async function handleDelete(row: CongregationRow) {
    if (!isAdmin) return;
    const name = (row.name ?? "").trim() || `#${row.id}`;
    const ok = window.confirm(`Delete congregation "${name}"?`);
    if (!ok) return;

    setDeletingId(row.id);
    setActionError(null);
    setActionMsg(null);
    try {
      const [{ count: memberCount, error: memberErr }, { count: areaCount, error: areaErr }] =
        await Promise.all([
          supabase
            .from("emcmember")
            .select("id", { count: "exact", head: true })
            .eq("congregationid", row.id),
          supabase
            .from("emcelderarea")
            .select("id", { count: "exact", head: true })
            .eq("congregationid", row.id),
        ]);

      if (memberErr) {
        setActionError(`Failed to verify members: ${memberErr.message}`);
        return;
      }
      if (areaErr) {
        setActionError(`Failed to verify elder assignments: ${areaErr.message}`);
        return;
      }
      if ((memberCount ?? 0) > 0 || (areaCount ?? 0) > 0) {
        setActionError(
          "Congregation cannot be deleted: it still has assigned members or responsible elders.",
        );
        return;
      }

      const { data } = await supabase.auth.getSession();
      const session = data?.session ?? null;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const response = await fetch("/api/elders/congregations", {
        method: "DELETE",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ id: row.id }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = payload?.error ?? "Failed to delete congregation.";
        setActionError(message);
        return;
      }

      setActionMsg("Congregation deleted.");
      setReloadKey((v) => v + 1);
    } finally {
      setDeletingId(null);
    }
  }

  function startEdit(row: CongregationRow) {
    setEditingId(row.id);
    setEditName(row.name ?? "");
    setEditComments(row.comments ?? "");
    setActionError(null);
    setActionMsg(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditComments("");
  }

  async function handleSave(row: CongregationRow) {
    if (!isAdmin || editingId !== row.id) return;
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setActionError("Congregation name is required.");
      return;
    }
    setActionError(null);
    setActionMsg(null);
    setSavingEditId(row.id);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/elders/congregations", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          id: row.id,
          name: trimmedName,
          comments: editComments.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error ?? "Failed to save congregation.";
        setActionError(message);
        return;
      }
      setRows((prev) =>
        prev.map((item) =>
          item.id === row.id
            ? { ...item, name: trimmedName, comments: editComments.trim() }
            : item,
        ),
      );
      setActionMsg("Congregation updated.");
      cancelEdit();
    } finally {
      setSavingEditId(null);
    }
  }

  if (pageLoading) {
    return <main className={forms.page}>Loading…</main>;
  }

  if (error) {
    return (
      <main className={forms.page}>
        <h1 className={forms.h1}>Congregations</h1>
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
      <h1 className={forms.h1}>Congregations</h1>
      <div className={`${forms.backRow} ${forms.topGroup}`}>
        <BackLink fallbackHref="/elders" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          &lt;- Back to Elders
        </BackLink>
        {isAdmin && (
          <button
            type="button"
            className={forms.linkButton}
            onClick={() => router.push("/elders/congregations/edit")}
            disabled={editingId !== null}
          >
            Add congregation
          </button>
        )}
      </div>
      {actionError && <p className={forms.error}>{actionError}</p>}
      {actionMsg && <p>{actionMsg}</p>}

      {sortedRows.length > 0 ? (
        <div className={forms.tableWrap} style={{ marginTop: 12 }}>
          <p
            style={{
              marginTop: 0,
              marginBottom: 8,
              fontStyle: "italic",
              fontSize: 13,
              color: "#6b7280",
            }}
            className={forms.mobileOnly}
          >
            Tip: scroll horizontally to see all columns →
          </p>
          <table className={forms.table}>
            <thead>
              <tr>
                <th className={forms.th}>Congregation name</th>
                <th className={forms.th}>Comments</th>
                <th className={forms.th}>Responsible elder(s)</th>
                <th className={forms.th}>Configuration</th>
                {isAdmin && <th className={forms.th}>Edit</th>}
                {isAdmin && <th className={forms.th}>Delete</th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id}>
                <td className={forms.td}>
                  {editingId === row.id ? (
                    <input
                      className={forms.field}
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      disabled={savingEditId === row.id}
                    />
                  ) : (
                    (row.name ?? "").trim()
                  )}
                </td>
                <td className={forms.td}>
                  {editingId === row.id ? (
                    <textarea
                      className={`${forms.field} ${forms.textarea}`}
                      value={editComments}
                      onChange={(event) => setEditComments(event.target.value)}
                      disabled={savingEditId === row.id}
                    />
                  ) : (
                    (row.comments ?? "").trim()
                  )}
                </td>
                  <td className={forms.td}>
                    {(eldersByCongregationId[row.id] ?? []).join(", ")}
                  </td>
                <td className={forms.td}>
                  {editingId === null ? (
                    <Link
                      href={`/elders/congregation-details?selected=${row.id}`}
                      className={forms.linkButton}
                    >
                      View/edit members
                    </Link>
                  ) : (
                    <button className={forms.linkButton} disabled>
                      View/edit members
                    </button>
                  )}
                </td>
                {isAdmin && (
                  <td className={forms.td}>
                    {editingId === row.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className={forms.button}
                          onClick={() => handleSave(row)}
                          disabled={savingEditId === row.id}
                        >
                          Save
                        </button>
                        <button className={forms.button} onClick={cancelEdit} disabled={savingEditId === row.id}>
                          Cancel
                        </button>
                      </div>
                      ) : (
                        <button
                          className={forms.button}
                          onClick={() => startEdit(row)}
                          disabled={editingId !== null}
                        >
                          Edit
                        </button>
                      )}
                  </td>
                )}
                {isAdmin && (
                    <td className={forms.td}>
                      <button
                        className={`${forms.button} ${forms.buttonDanger}`}
                        onClick={() => handleDelete(row)}
                        disabled={editingId !== null || deletingId === row.id}
                      >
                        Delete
                      </button>
                    </td>
                )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No congregations found.</p>
      )}
      {isAdmin && (
        <p style={{ marginTop: 16 }}>
          To assign a congregation to an elder, go to{" "}
          <Link href="/elders/areas" className={forms.link}>
            Elders and Areas of Responsibility
          </Link>
          .
        </p>
      )}
    </main>
  );
}
