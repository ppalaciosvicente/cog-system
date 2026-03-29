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

type EligibleMember = { id: number; name: string };

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
  const [eligibleMembers, setEligibleMembers] = useState<EligibleMember[]>([]);
  const [memberId, setMemberId] = useState<number | null>(
    Number.isFinite(memberIdParam) && memberIdParam > 0 ? memberIdParam : null,
  );
  const [memberSearch, setMemberSearch] = useState("");
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

  const [searchResults, setSearchResults] = useState<Array<{ id: number; name: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedName, setSelectedName] = useState<string>("");

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
          eligibleMembers?: EligibleMember[];
        };
        if (!response.ok) {
          setError(payload.error ?? "Failed to load contributions access.");
          return;
        }
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        const elig = Array.isArray(payload.eligibleMembers) ? payload.eligibleMembers : [];
        setAccessRows(rows);
        setCountryOptions(Array.isArray(payload.countryOptions) ? payload.countryOptions : []);
        setEligibleMembers(elig);
        if (!memberId && memberIdParam > 0) {
          setMemberId(memberIdParam);
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
    const controller = new AbortController();
    let cancelled = false;
    const term = memberSearch.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const resp = await fetch(
          `/api/contributions/donor-options?q=${encodeURIComponent(term)}&limit=25`,
          { credentials: "include", headers, signal: controller.signal },
        );
        const payload = (await resp.json().catch(() => ({}))) as {
          households?: Array<{ value: number; label: string }>;
          error?: string;
        };
        if (!resp.ok) throw new Error(payload.error ?? "Failed to search members.");
        if (!cancelled) {
          const opts =
            payload.households?.map((h) => ({ id: h.value, name: h.label })) ?? [];
          setSearchResults(opts);
        }
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to search members.");
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [memberSearch]);

  useEffect(() => {
    if (!memberId) {
      setRow(null);
      setRoleName("");
      setCountryCodes([]);
      return;
    }
    const existing = accessRows.find((r) => r.memberId === memberId);
    const eligibleName = eligibleMembers.find((m) => m.id === memberId)?.name;
    const name = existing?.memberName ?? eligibleName ?? selectedName;
    if (!name) {
      setRow(null);
      setRoleName("");
      setCountryCodes([]);
      return;
    }
    const next: AccessRow = {
      memberId,
      accountId: existing?.accountId ?? memberId,
      memberName: name,
      roleName: existing?.roleName ?? null,
      countryCodes: existing?.countryCodes ?? [],
    };
    setRow(next);
    setRoleName(next.roleName ?? "");
    setCountryCodes(next.countryCodes ?? []);
  }, [memberId, accessRows, eligibleMembers, selectedName]);

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
        headers: { ...headers, "content-type": "application/json" },
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
    } finally {
      setSaving(false);
    }
  }

  const pageTitle = row?.roleName ? "Edit Contributions Access" : "Add Contributions Access";

  return (
    <ContributionPage
      title={pageTitle}
      description="Configure role and country scope for this user."
      backHref="/contributions/access"
    >
      {(access) => {
        if (!access.isAdmin) {
          return <p className={forms.error}>Only contrib_admin can access this page.</p>;
        }
        if (loading) return <p>Loading access details...</p>;
        if (error) return <p className={forms.error}>{error}</p>;

        const selectedCountryLabels = [...countryCodes]
          .map((code) => countryNameByCode[normalizeCode(code)] ?? code)
          .sort((a, b) => a.localeCompare(b))
          .join(", ");

        return (
          <div style={{ display: "grid", gap: 12, maxWidth: 640 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <label className={forms.label}>Select member</label>
              <input
                type="text"
                className={forms.field}
                placeholder="Type at least 2 letters to search members"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                style={{ minWidth: 260 }}
              />
              {memberSearch.trim().length >= 2 ? (
                searchResults.length ? (
                  <div className={forms.autocompleteMenu} role="listbox" aria-label="Matching members">
                    {searchResults.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        className={forms.autocompleteOption}
                        onClick={() => {
                          setMemberId(member.id);
                          setSelectedName(member.name);
                        }}
                      >
                        {member.name}
                      </button>
                    ))}
                  </div>
                ) : searchLoading ? (
                  <p style={{ margin: 0, color: "#6b7280" }}>Searching members…</p>
                ) : (
                  <p style={{ margin: 0, color: "#6b7280" }}>No matches. Try another name.</p>
                )
              ) : (
                <p style={{ margin: 0, color: "#6b7280" }}>Type at least 2 letters to search for a member.</p>
              )}
              <div>
                <strong>Editing:</strong>{" "}
                {row ? row.memberName : <span style={{ color: "#6b7280" }}>No member selected</span>}
              </div>
            </div>

            <div className={forms.row}>
              <div className={forms.label}>Contributions Access:</div>
              <div className={forms.control}>
                <select
                  className={forms.field}
                  value={roleName}
                  disabled={saving || !row}
                  onChange={(event) => {
                    const nextRole = event.target.value as "contrib_admin" | "contrib_user" | "";
                    setRoleName(nextRole);
                    if (nextRole !== "contrib_user") setCountryCodes([]);
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
              <button
                type="button"
                className={`${forms.button} ${forms.actionsRowPrimaryButton}`}
                onClick={() => void saveChanges()}
                disabled={saving || !row}
              >
                {saving ? "Saving..." : "Save & Send Email Invitation"}
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
