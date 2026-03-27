"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ContributionPage } from "@/components/contributions/ContributionPage";
import { getAuthHeaders } from "@/lib/supabase/client";
import forms from "@/styles/forms.module.css";

type AccessRow = {
  memberId: number;
  accountId: number;
  memberName: string;
  roleName: "contrib_admin" | "contrib_user" | null;
  countryCodes: string[];
};

type CountryOption = {
  code: string;
  name: string;
};

function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

export default function ContributionsAccessPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [countryOptions, setCountryOptions] = useState<CountryOption[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const countryNameByCode = useMemo(() => {
    const map: Record<string, string> = {};
    countryOptions.forEach((option) => {
      map[normalizeCode(option.code)] = option.name;
    });
    return map;
  }, [countryOptions]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const headers = await getAuthHeaders();
        const response = await fetch("/api/contributions/access-admin", {
          method: "GET",
          headers,
          credentials: "include",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          rows?: AccessRow[];
          countryOptions?: CountryOption[];
        };
        if (!response.ok) {
          setError(payload.error ?? "Failed to load contributions access.");
          return;
        }

        const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
        const nextCountries = Array.isArray(payload.countryOptions)
          ? payload.countryOptions
          : [];

        if (!cancelled) {
          setRows(nextRows);
          setCountryOptions(nextCountries);
          if (!selectedMemberId && nextRows.length) {
            setSelectedMemberId(String(nextRows[0].memberId));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function roleLabel(roleName: AccessRow["roleName"]) {
    if (roleName === "contrib_admin") return "Admin";
    if (roleName === "contrib_user") return "User";
    return "-";
  }

  async function deleteAccess(row: AccessRow) {
    if (deletingId) return;
    const confirm = window.confirm(`Remove contributions access for ${row.memberName}?`);
    if (!confirm) return;
    setDeletingId(row.memberId);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/contributions/access-admin", {
        method: "PUT",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          memberId: row.memberId,
          roleName: null,
          countryCodes: [],
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to remove access.");
      }
      setRows((current) =>
        current.map((item) =>
          item.memberId === row.memberId ? { ...item, roleName: null, countryCodes: [] } : item,
        ),
      );
    } catch (deleteErr) {
      setError(deleteErr instanceof Error ? deleteErr.message : "Failed to remove access.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <ContributionPage
      title="Contributions Access"
      description="Manage contribution role and country scope per user."
    >
      {(access) => {
        if (!access.isAdmin) {
          return <p className={forms.error}>Only contrib_admin can access this page.</p>;
        }

        if (loading) return <p>Loading access list...</p>;

        return (
          <div>
            {error ? <p className={forms.error}>{error}</p> : null}

            <div className={forms.actions} style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
              <label className={forms.label}>
                Select member
                <select
                  className={forms.field}
                  value={selectedMemberId}
                  onChange={(event) => setSelectedMemberId(event.target.value)}
                  style={{ minWidth: 240, marginLeft: 8 }}
                >
                  {rows.map((row) => (
                    <option key={row.memberId} value={row.memberId}>
                      {row.memberName}
                    </option>
                  ))}
                </select>
              </label>
              <Link
                href={
                  selectedMemberId
                    ? `/contributions/access/edit?memberId=${encodeURIComponent(selectedMemberId)}`
                    : "/contributions/access/edit"
                }
                className={`${forms.button} ${forms.actionsRowPrimaryButton}`}
              >
                Add
              </Link>
            </div>

            {rows.length ? (
              <div className={forms.tableWrap}>
                <table className={forms.table}>
                  <thead>
                    <tr>
                      <th className={forms.th}>Member</th>
                      <th className={forms.th}>Contributions Access</th>
                      <th className={forms.th}>Countries</th>
                      <th className={forms.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const selectedCountryLabels = (row.countryCodes ?? [])
                        .map((code) => countryNameByCode[normalizeCode(code)] ?? code)
                        .sort((a, b) => a.localeCompare(b))
                        .join(", ");

                      return (
                        <tr key={row.memberId}>
                          <td className={forms.td}>{row.memberName}</td>
                          <td className={forms.td}>{roleLabel(row.roleName)}</td>
                          <td className={forms.td}>
                            {row.roleName === "contrib_user" ? selectedCountryLabels || "-" : "-"}
                          </td>
                          <td className={forms.td}>
                            <Link
                              href={`/contributions/access/edit?memberId=${encodeURIComponent(String(row.memberId))}`}
                              className={forms.button}
                            >
                              Edit
                            </Link>
                            <button
                              type="button"
                              className={`${forms.button} ${forms.buttonDanger}`}
                              style={{ marginLeft: 8 }}
                              onClick={() => void deleteAccess(row)}
                              disabled={deletingId === row.memberId}
                            >
                              {deletingId === row.memberId ? "Removing..." : "Delete"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No active accounts found.</p>
            )}
          </div>
        );
      }}
    </ContributionPage>
  );
}
