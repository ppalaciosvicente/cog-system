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
  const memberId = Number(params.get("memberId") ?? "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [row, setRow] = useState<AccessRow | null>(null);
  const [countryOptions, setCountryOptions] = useState<CountryOption[]>([]);
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
      if (!Number.isFinite(memberId) || memberId <= 0) {
        setError("Missing member id.");
        setLoading(false);
        return;
      }

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

        const foundRow =
          (Array.isArray(payload.rows) ? payload.rows : []).find(
            (candidate) => candidate.memberId === memberId,
          ) ?? null;

        let nextRow: AccessRow | null = foundRow;
        if (!nextRow) {
          const eligibleName = (payload.eligibleMembers ?? []).find((m) => m.id === memberId)?.name;
          if (!eligibleName) {
            setError("Member was not found or is not eligible for contributions access.");
            return;
          }
          nextRow = {
            memberId,
            accountId: memberId, // placeholder; API will resolve on save
            memberName: eligibleName,
            roleName: null,
            countryCodes: [],
          };
        }

        if (!cancelled) {
          setRow(nextRow);
          setCountryOptions(Array.isArray(payload.countryOptions) ? payload.countryOptions : []);
          setRoleName(nextRow.roleName ?? "");
          setCountryCodes(nextRow.countryCodes ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [memberId]);

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
            <div>
              <strong>Member:</strong> {row.memberName}
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
