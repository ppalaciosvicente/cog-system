"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ContributionPage } from "@/components/contributions/ContributionPage";
import { getAuthHeaders } from "@/lib/supabase/client";
import forms from "@/styles/forms.module.css";

export const dynamic = "force-dynamic";

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

function ContributionAccessEditInner() {
  const params = useSearchParams();
  const memberIdParam = Number(params.get("memberId") ?? "");

const [loading, setLoading] = useState(true);
const [saving, setSaving] = useState(false);
const [error, setError] = useState<string | null>(null);
const [saveMsg, setSaveMsg] = useState<string | null>(null);
const [row, setRow] = useState<AccessRow | null>(null);
const [accessRows, setAccessRows] = useState<AccessRow[]>([]);
const [countryOptions, setCountryOptions] = useState<CountryOption[]>([]);
const [eligibleMembers, setEligibleMembers] = useState<Array<{ id: number; name: string }>>([]);
const [memberSearch, setMemberSearch] = useState("");
const [selectedMemberId, setSelectedMemberId] = useState<number | null>(Number.isFinite(memberIdParam) && memberIdParam > 0 ? memberIdParam : null);
const [roleName, setRoleName] = useState<"contrib_admin" | "contrib_user" | "">("");
const [countryCodes, setCountryCodes] = useState<string[]>([]);

  const countryNameByCode = useMemo(() => {
    const map: Record<string, string> = {};
    countryOptions.forEach((option) => {
      map[normalizeCode(option.code)] = option.name;
    });
    return map;
  }, [countryOptions]);

  const sortedCountryOptions = useMemo(
    () => [...countryOptions].sort((a, b) => a.name.localeCompare(b.name)),
    [countryOptions],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setSaveMsg(null);

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

        const allRows = Array.isArray(payload.rows) ? payload.rows : [];
        const allEligible = Array.isArray(payload.eligibleMembers) ? payload.eligibleMembers : [];

        if (!cancelled) {
          setAccessRows(allRows);
          setCountryOptions(Array.isArray(payload.countryOptions) ? payload.countryOptions : []);
          setEligibleMembers(allEligible);
          const initialId =
            Number.isFinite(memberIdParam) && memberIdParam > 0
              ? memberIdParam
              : allEligible[0]?.id ?? null;
          setSelectedMemberId(initialId);

          const targetId = initialId;
          if (targetId) {
            const foundRow = allRows.find((candidate) => candidate.memberId === targetId) ?? null;
            let nextRow: AccessRow | null = foundRow;
            if (!nextRow) {
              const eligibleName = allEligible.find((m) => m.id === targetId)?.name;
              if (!eligibleName) {
                setError("Member was not found or is not eligible for contributions access.");
              } else {
                nextRow = {
                  memberId: targetId,
                  accountId: targetId,
                  memberName: eligibleName,
                  roleName: null,
                  countryCodes: [],
                };
              }
            }
            if (nextRow) {
              setRow(nextRow);
              setRoleName(nextRow.roleName ?? "");
              setCountryCodes(nextRow.countryCodes ?? []);
            }
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
  }, [memberIdParam]);

  useEffect(() => {
    if (!selectedMemberId) {
      setRow(null);
      setRoleName("");
      setCountryCodes([]);
      return;
    }
    const foundRow = accessRows.find((candidate) => candidate.memberId === selectedMemberId) ?? null;
    let nextRow: AccessRow | null = foundRow;
    if (!nextRow) {
      const eligibleName = eligibleMembers.find((m) => m.id === selectedMemberId)?.name;
      if (!eligibleName) {
        setError("Member was not found or is not eligible for contributions access.");
        return;
      }
      nextRow = {
        memberId: selectedMemberId,
        accountId: selectedMemberId,
        memberName: eligibleName,
        roleName: null,
        countryCodes: [],
      };
    }
    setRow(nextRow);
    setRoleName(nextRow.roleName ?? "");
    setCountryCodes(nextRow.countryCodes ?? []);
  }, [selectedMemberId, accessRows, eligibleMembers]);

  async function saveChanges() {
    if (!row || saving) return;
    if (roleName === "contrib_user" && countryCodes.length === 0) {
      setError("Contrib user requires at least one country.");
      return;
    }

    setSaving(true);
    setError(null);
    setSaveMsg(null);
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
          roleName: roleName || null,
          countryCodes: roleName === "contrib_user" ? countryCodes : [],
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Failed to save contributions access.");
        return;
      }
      setSaveMsg("Saved.");
      setRow((prev) =>
        prev
          ? {
              ...prev,
              roleName: roleName || null,
              countryCodes: roleName === "contrib_user" ? countryCodes : [],
            }
          : prev,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ContributionPage
      title="Edit Contributions Access"
      description="Configure role and country scope for this user."
      backHref="/contributions/access"
    >
      {(access) => {
        if (!access.isAdmin) {
          return <p className={forms.error}>Only contrib_admin can access this page.</p>;
        }

        if (loading) return <p>Loading access details...</p>;
        if (error && !row) return <p className={forms.error}>{error}</p>;
        if (!row) return <p className={forms.error}>Could not load this member.</p>;

        const selectedCountryLabels = [...countryCodes]
          .map((code) => countryNameByCode[normalizeCode(code)] ?? code)
          .sort((a, b) => a.localeCompare(b))
          .join(", ");

        return (
          <div style={{ display: "grid", gap: 12, maxWidth: 640 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <label className={forms.label}>Select member</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  type="text"
                  className={forms.field}
                  placeholder="Type to filter members"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  style={{ minWidth: 240 }}
                />
                <select
                  className={forms.field}
                  value={selectedMemberId ?? ""}
                  onChange={(e) => setSelectedMemberId(Number(e.target.value) || null)}
                  style={{ minWidth: 260 }}
                >
                  <option value="">Select a member</option>
                  {eligibleMembers
                    .filter((m) =>
                      m.name.toLowerCase().includes(memberSearch.trim().toLowerCase()),
                    )
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  {accessRows
                    .filter((m) => m.roleName && !eligibleMembers.find((e) => e.id === m.memberId))
                    .filter((m) =>
                      m.memberName.toLowerCase().includes(memberSearch.trim().toLowerCase()),
                    )
                    .map((member) => (
                      <option key={member.memberId} value={member.memberId}>
                        {member.memberName} (has access)
                      </option>
                    ))}
                </select>
              </div>
              {row ? (
                <div>
                  <strong>Editing:</strong> {row.memberName}
                </div>
              ) : null}
            </div>

            <div className={forms.row}>
              <div className={forms.label}>Contributions Access:</div>
              <div className={forms.control}>
                <select
                  className={forms.field}
                  value={roleName}
                  disabled={saving}
                  onChange={(event) => {
                    const nextRole = event.target.value as "contrib_admin" | "contrib_user" | "";
                    setRoleName(nextRole);
                    if (nextRole !== "contrib_user") {
                      setCountryCodes([]);
                    }
                    setError(null);
                    setSaveMsg(null);
                  }}
                >
                  <option value="">No access</option>
                  <option value="contrib_admin">Admin</option>
                  <option value="contrib_user">User</option>
                </select>
              </div>
            </div>

            {roleName === "contrib_user" ? (
              <div className={forms.row}>
                <div className={forms.label}>Countries:</div>
                <div className={forms.control}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div
                      style={{
                        maxHeight: 280,
                        overflowY: "auto",
                        border: "1px solid #d1d5db",
                        borderRadius: 8,
                        padding: 10,
                        background: "#fff",
                      }}
                    >
                      {sortedCountryOptions.map((option) => {
                        const code = normalizeCode(option.code);
                        const checked = countryCodes.includes(code);
                        return (
                          <label
                            key={code}
                            style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={saving}
                              onChange={(event) => {
                                const next = new Set(countryCodes);
                                if (event.target.checked) next.add(code);
                                else next.delete(code);
                                setCountryCodes(Array.from(next).sort((a, b) => a.localeCompare(b)));
                                setError(null);
                                setSaveMsg(null);
                              }}
                            />
                            <span>{option.name}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 12, color: "#4b5563" }}>
                      Selected: {selectedCountryLabels || "-"}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#4b5563" }}>Countries: -</div>
            )}

            {error ? <p className={forms.error}>{error}</p> : null}
            {saveMsg ? <p style={{ color: "#166534" }}>{saveMsg}</p> : null}

            <div className={forms.actions}>
              <button type="button" className={forms.button} onClick={() => void saveChanges()} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        );
      }}
    </ContributionPage>
  );
}

export default function ContributionAccessEditPage() {
  return (
    <Suspense fallback={<p>Loading access details...</p>}>
      <ContributionAccessEditInner />
    </Suspense>
  );
}
