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
  const [eligibleMembers, setEligibleMembers] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [memberSearch, setMemberSearch] = useState("");
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
          eligibleMembers?: Array<{ id: number; name: string }>;
        };
        if (!response.ok) {
          setError(payload.error ?? "Failed to load contributions access.");
          return;
        }

        const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
        const nextCountries = Array.isArray(payload.countryOptions)
          ? payload.countryOptions
          : [];
        const nextEligible = Array.isArray(payload.eligibleMembers)
          ? payload.eligibleMembers
          : [];

        if (!cancelled) {
          setRows(nextRows);
          setCountryOptions(nextCountries);
          setEligibleMembers(nextEligible);
          if (!selectedMemberId && nextEligible.length) {
            setSelectedMemberId(String(nextEligible[0].id));
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

  async function resendInvite(row: AccessRow) {
    if (deletingId) return;
    setDeletingId(row.memberId);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/contributions/access-admin", {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ memberId: row.memberId, action: "resend" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to resend invitation.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend invitation.");
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

            {eligibleMembers.length ? (
              <div className={forms.actions} style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
                <label className={forms.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  Member name
                  <input
                    className={forms.field}
                    type="text"
                    value={memberSearch}
                    placeholder="Type 2+ letters to filter"
                    onChange={(event) => setMemberSearch(event.target.value)}
                    style={{ minWidth: 260 }}
                  />
                </label>
                {memberSearch.trim().length >= 2 ? (
                  <select
                    className={forms.field}
                    value={selectedMemberId}
                    onChange={(event) => setSelectedMemberId(event.target.value)}
                    style={{ minWidth: 280 }}
                  >
                    {eligibleMembers
                      .filter((member) =>
                        member.name.toLowerCase().includes(memberSearch.trim().toLowerCase()),
                      )
                      .slice(0, 25)
                      .map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  <span style={{ color: "#6b7280" }}>Enter at least 2 characters to search.</span>
                )}
                <Link
                  href={
                    selectedMemberId
                      ? `/contributions/access/edit?memberId=${encodeURIComponent(selectedMemberId)}`
                      : "/contributions/access/edit"
                  }
                  className={`${forms.button} ${forms.actionsRowPrimaryButton}`}
                  aria-disabled={!selectedMemberId}
                  style={{ pointerEvents: selectedMemberId ? "auto" : "none", opacity: selectedMemberId ? 1 : 0.6 }}
                >
                  Add
                </Link>
              </div>
            ) : (
              <p style={{ marginBottom: 12 }}>
                No additional eligible members without contributions access were found.
              </p>
            )}

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
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <Link
                                href={`/contributions/access/edit?memberId=${encodeURIComponent(String(row.memberId))}`}
                                className={forms.button}
                              >
                                Edit
                              </Link>
                              {row.memberId !== access.memberId ? (
                                <button
                                  type="button"
                                  className={`${forms.button} ${forms.buttonDanger}`}
                                  onClick={() => void deleteAccess(row)}
                                  disabled={deletingId === row.memberId}
                                >
                                  {deletingId === row.memberId ? "Removing..." : "Delete"}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={forms.button}
                                onClick={() => void resendInvite(row)}
                                disabled={deletingId === row.memberId}
                              >
                                Resend Invite
                              </button>
                            </div>
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
