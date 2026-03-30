"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { BackLink } from "@/components/BackLink";
import { fetchCountryAndUSStateLookups } from "@/lib/lookups";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import forms from "@/styles/forms.module.css";
import type { RoleName, RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";

import styles from "./page.module.css";

type MemberOption = {
  id: number;
  fname: string | null;
  lname: string | null;
};

type LinkableMemberDetail = {
  id: number;
  fname: string | null;
  lname: string | null;
  address: string | null;
  address2: string | null;
  zip: string | null;
  city: string | null;
  statecode: string | null;
  countrycode: string | null;
  homephone: string | null;
};

type ContactFields = {
  lname: string;
  address: string;
  address2: string;
  zip: string;
  city: string;
  statecode: string;
  countrycode: string;
  homephone: string;
};

type ContactKey = keyof ContactFields;

const ADDRESS_FIELDS: { key: ContactKey; label: string }[] = [
  { key: "address", label: "Address" },
  { key: "address2", label: "Address 2" },
  { key: "zip", label: "Zip" },
  { key: "city", label: "City" },
  { key: "statecode", label: "State" },
  { key: "countrycode", label: "Country" },
];

function displayName(m: {
  id: number;
  fname: string | null;
  lname: string | null;
}) {
  const ln = (m.lname ?? "").trim();
  const fn = (m.fname ?? "").trim();
  if (!ln && !fn) return `#${m.id}`;
  if (!ln) return fn;
  if (!fn) return ln;
  return `${ln}, ${fn}`;
}

function toForm(detail: LinkableMemberDetail): ContactFields {
  return {
    lname: detail.lname ?? "",
    address: detail.address ?? "",
    address2: detail.address2 ?? "",
    zip: detail.zip ?? "",
    city: detail.city ?? "",
    statecode: detail.statecode ?? "",
    countrycode: detail.countrycode ?? "",
    homephone: detail.homephone ?? "",
  };
}

function toPayload(form: ContactFields) {
  return {
    lname: form.lname,
    address: form.address,
    address2: form.address2,
    zip: form.zip,
    city: form.city,
    statecode: form.statecode,
    countrycode: form.countrycode,
    homephone: form.homephone,
  };
}

export default function LinkSpousesPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [pageLoading, setPageLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [backHref, setBackHref] = useState("/members");

  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [memberAId, setMemberAId] = useState<number | null>(null);
  const [memberBId, setMemberBId] = useState<number | null>(null);
  const [memberASearch, setMemberASearch] = useState("");
  const [memberBSearch, setMemberBSearch] = useState("");
  const [memberASearchResults, setMemberASearchResults] = useState<
    { value: number; label: string }[]
  >([]);
  const [memberBSearchResults, setMemberBSearchResults] = useState<
    { value: number; label: string }[]
  >([]);
  const [selectedALabel, setSelectedALabel] = useState("");
  const [selectedBLabel, setSelectedBLabel] = useState("");
  const [skipMemberASearch, setSkipMemberASearch] = useState(false);
  const [skipMemberBSearch, setSkipMemberBSearch] = useState(false);

  const [memberADetail, setMemberADetail] =
    useState<LinkableMemberDetail | null>(null);
  const [memberBDetail, setMemberBDetail] =
    useState<LinkableMemberDetail | null>(null);
  const [memberAForm, setMemberAForm] = useState<ContactFields | null>(null);
  const [memberBForm, setMemberBForm] = useState<ContactFields | null>(null);
  const [countryOptions, setCountryOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [usStateOptions, setUsStateOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [canadaStateOptions, setCanadaStateOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [australiaStateOptions, setAustraliaStateOptions] = useState<
    { value: string; label: string }[]
  >([]);

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

        if (!roles.includes("emc_admin")) {
          setError("Only EMC admins can link spouses.");
          return;
        }

        if (!cancelled) {
          setIsAdmin(true);
          const params = new URLSearchParams(window.location.search);
          const returnTo = params.get("returnTo");
          const safeReturnTo =
            returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
              ? returnTo
              : "/members";
          setBackHref(safeReturnTo);
        }

        const lookups = await fetchCountryAndUSStateLookups();
        if (!cancelled) {
          setCountryOptions(lookups.countryOptions);
          setUsStateOptions(lookups.usStateOptions);
          setCanadaStateOptions(lookups.canadaStateOptions);
          setAustraliaStateOptions(lookups.australiaStateOptions);
        }

        const { data: members, error: membersErr } = await supabase
          .from("emcmember")
          .select("id,fname,lname")
          .eq("statusid", 1)
          .is("householdid", null)
          .order("lname", { ascending: true })
          .order("fname", { ascending: true })
          .limit(2000);

        if (membersErr) {
          setError(`Failed to load members: ${membersErr.message}`);
          return;
        }

        if (!cancelled) {
          setMemberOptions((members ?? []) as MemberOption[]);
          setMemberAId(null);
          setMemberBId(null);
          setMemberASearch("");
          setMemberBSearch("");
          setSelectedALabel("");
          setSelectedBLabel("");
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

  useEffect(() => {
    if (!memberAId || !memberBId || memberAId === memberBId) {
      setMemberADetail(null);
      setMemberBDetail(null);
      setMemberAForm(null);
      setMemberBForm(null);
      return;
    }

    let cancelled = false;

    async function loadDetails() {
      setLoadingDetail(true);
      setSaveError(null);

      try {
        const { data, error: detailsErr } = await supabase
          .from("emcmember")
          .select(
            "id,fname,lname,address,address2,zip,city,statecode,countrycode,homephone",
          )
          .in("id", [memberAId, memberBId]);

        if (detailsErr) {
          setSaveError(detailsErr.message);
          return;
        }

        if (cancelled) return;

        const rows = (data ?? []) as LinkableMemberDetail[];
        const a = rows.find((row) => row.id === memberAId) ?? null;
        const b = rows.find((row) => row.id === memberBId) ?? null;

        if (!a || !b) {
          setSaveError("One or both members were not found.");
          return;
        }

        setMemberADetail(a);
        setMemberBDetail(b);
        setMemberAForm(toForm(a));
        setMemberBForm(toForm(b));
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    }

    loadDetails();
    return () => {
      cancelled = true;
    };
  }, [memberAId, memberBId, supabase]);

  useEffect(() => {
    if (skipMemberASearch) {
      setSkipMemberASearch(false);
      setMemberASearchResults([]);
      return;
    }
    const term = memberASearch.trim().toLowerCase();
    if (term && term === selectedALabel.trim().toLowerCase()) {
      setMemberASearchResults([]);
      return;
    }
    if (term.length < 2) {
      setMemberASearchResults([]);
      return;
    }
    const results = memberOptions
      .filter((m) => m.id !== memberBId)
      .filter((m) => displayName(m).toLowerCase().includes(term))
      .slice(0, 50)
      .map((m) => ({ value: m.id, label: displayName(m) }));
    setMemberASearchResults(results);
  }, [memberASearch, memberBId, memberOptions, selectedALabel, skipMemberASearch]);

  useEffect(() => {
    if (skipMemberBSearch) {
      setSkipMemberBSearch(false);
      setMemberBSearchResults([]);
      return;
    }
    const term = memberBSearch.trim().toLowerCase();
    if (term && term === selectedBLabel.trim().toLowerCase()) {
      setMemberBSearchResults([]);
      return;
    }
    if (term.length < 2) {
      setMemberBSearchResults([]);
      return;
    }
    const results = memberOptions
      .filter((m) => m.id !== memberAId)
      .filter((m) => displayName(m).toLowerCase().includes(term))
      .slice(0, 50)
      .map((m) => ({ value: m.id, label: displayName(m) }));
    setMemberBSearchResults(results);
  }, [memberAId, memberBSearch, memberOptions, selectedBLabel, skipMemberBSearch]);

  useEffect(() => {
    if (memberAId == null) return;
    const match = memberOptions.find((m) => m.id === memberAId);
    if (match) {
      const label = displayName(match);
      setSelectedALabel(label);
      setMemberASearch(label);
    }
  }, [memberAId, memberOptions]);

  useEffect(() => {
    if (memberBId == null) return;
    const match = memberOptions.find((m) => m.id === memberBId);
    if (match) {
      const label = displayName(match);
      setSelectedBLabel(label);
      setMemberBSearch(label);
    }
  }, [memberBId, memberOptions]);

  function setFormField(
    side: "left" | "right",
    key: ContactKey,
    value: string,
  ) {
    if (side === "left") {
      setMemberAForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    } else {
      setMemberBForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    }
    setSaveError(null);
  }

  function renderAddressInput(
    side: "left" | "right",
    form: ContactFields,
    key: ContactKey,
  ) {
    if (key === "countrycode") {
      return (
        <select
          className={forms.field}
          value={form.countrycode}
          disabled={saving}
          onChange={(e) => setFormField(side, "countrycode", e.target.value)}
        >
          <option value="">Select country</option>
          {countryOptions.map((o) => (
            <option key={`country-${side}-${o.value}`} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    if (key === "statecode") {
      const cc = String(form.countrycode ?? "").trim().toUpperCase();
      const opts =
        cc === "US"
          ? usStateOptions
          : cc === "CA"
            ? canadaStateOptions
            : cc === "AU"
              ? australiaStateOptions
            : [];
      return (
        <select
          className={forms.field}
          value={form.statecode}
          disabled={saving}
          onChange={(e) => setFormField(side, "statecode", e.target.value)}
        >
          <option value="">
            {cc === "US" ? "Select state" : cc === "CA" ? "Select province" : cc === "AU" ? "Select state" : "N/A"}
          </option>
          {opts.map((o) => (
            <option key={`state-${side}-${o.value}`} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        className={forms.field}
        value={form[key]}
        disabled={saving}
        onChange={(e) => setFormField(side, key, e.target.value)}
      />
    );
  }

  function copyField(
    key: ContactKey,
    direction: "leftToRight" | "rightToLeft",
  ) {
    if (!memberAForm || !memberBForm) return;

    if (direction === "leftToRight") {
      setMemberBForm((prev) =>
        prev ? { ...prev, [key]: memberAForm[key] } : prev,
      );
    } else {
      setMemberAForm((prev) =>
        prev ? { ...prev, [key]: memberBForm[key] } : prev,
      );
    }
    setSaveError(null);
  }

  function copyAddressGroup(direction: "leftToRight" | "rightToLeft") {
    if (!memberAForm || !memberBForm) return;

    if (direction === "leftToRight") {
      setMemberBForm((prev) =>
        prev
          ? {
              ...prev,
              address: memberAForm.address,
              address2: memberAForm.address2,
              zip: memberAForm.zip,
              city: memberAForm.city,
              statecode: memberAForm.statecode,
              countrycode: memberAForm.countrycode,
            }
          : prev,
      );
    } else {
      setMemberAForm((prev) =>
        prev
          ? {
              ...prev,
              address: memberBForm.address,
              address2: memberBForm.address2,
              zip: memberBForm.zip,
              city: memberBForm.city,
              statecode: memberBForm.statecode,
              countrycode: memberBForm.countrycode,
            }
          : prev,
      );
    }
    setSaveError(null);
  }

  async function saveAndLink() {
    if (!isAdmin) return;
    if (!memberAId || !memberBId) {
      setSaveError("Select two members.");
      return;
    }
    if (memberAId === memberBId) {
      setSaveError("Please select two different members.");
      return;
    }
    if (!memberAForm || !memberBForm) {
      setSaveError("Contact information is not loaded yet.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/members/spouses", {
        method: "POST",
        headers,
        body: JSON.stringify({
          memberId: memberAId,
          spouseMemberId: memberBId,
          memberContact: toPayload(memberAForm),
          spouseContact: toPayload(memberBForm),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!res.ok) {
        setSaveError(payload.error ?? "Failed to link spouses.");
        return;
      }

      router.push(
        `/members?selected=${memberAId}&linkedA=${memberAId}&linkedB=${memberBId}`,
      );
    } finally {
      setSaving(false);
    }
  }

  if (pageLoading) {
    return (
      <main
        className={`${forms.page} ${forms.pageNarrow} ${forms.compactPage}`}
      >
        Loading...
      </main>
    );
  }

  if (error) {
    return (
      <main
        className={`${forms.page} ${forms.pageNarrow} ${forms.compactPage}`}
      >
        <h1 className={forms.h1}>Link Spouses</h1>
        <p className={forms.error}>{error}</p>
        <BackLink
          fallbackHref={backHref}
          className={`${forms.linkButton} ${forms.linkButtonLight}`}
        >
          ← Back
        </BackLink>
      </main>
    );
  }

  return (
    <main className={`${forms.page} ${forms.compactPage}`}>
      <h1 className={forms.h1}>Link Spouses</h1>

      <div className={forms.backRow}>
        <BackLink
          fallbackHref={backHref}
          className={`${forms.linkButton} ${forms.linkButtonLight}`}
        >
          ← Back
        </BackLink>
      </div>

      <div className={forms.sectionCard}>
        <div className={styles.selectRow}>
          <Row label="Member 1">
            <div className={forms.autocompleteWrap} style={{ minWidth: 260 }}>
              <input
                type="search"
                className={forms.field}
                placeholder="Type at least 2 letters to search"
                value={memberASearch}
                disabled={saving}
                onChange={(e) => setMemberASearch(e.target.value)}
              />
              {memberASearch.trim().length >= 2 ? (
                memberASearchResults.length ? (
                  <div
                    className={forms.autocompleteMenu}
                    role="listbox"
                    aria-label="Matching members"
                  >
                    {memberASearchResults.map((option) => (
                      <button
                        key={`member-a-${option.value}`}
                        type="button"
                        className={forms.autocompleteOption}
                        onClick={() => {
                          setMemberAId(option.value);
                          setSelectedALabel(option.label);
                          setMemberASearch(option.label);
                          setMemberASearchResults([]);
                          setSkipMemberASearch(true);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : memberASearch.trim() !== selectedALabel.trim() ? (
                  <p style={{ margin: 4, color: "#6b7280" }}>No matches.</p>
                ) : null
              ) : null}
            </div>
          </Row>

          <Row label="Member 2">
            <div className={forms.autocompleteWrap} style={{ minWidth: 260 }}>
              <input
                type="search"
                className={forms.field}
                placeholder="Type at least 2 letters to search"
                value={memberBSearch}
                disabled={saving}
                onChange={(e) => setMemberBSearch(e.target.value)}
              />
              {memberBSearch.trim().length >= 2 ? (
                memberBSearchResults.length ? (
                  <div
                    className={forms.autocompleteMenu}
                    role="listbox"
                    aria-label="Matching members"
                  >
                    {memberBSearchResults.map((option) => (
                      <button
                        key={`member-b-${option.value}`}
                        type="button"
                        className={forms.autocompleteOption}
                        onClick={() => {
                          setMemberBId(option.value);
                          setSelectedBLabel(option.label);
                          setMemberBSearch(option.label);
                          setMemberBSearchResults([]);
                          setSkipMemberBSearch(true);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : memberBSearch.trim() !== selectedBLabel.trim() ? (
                  <p style={{ margin: 4, color: "#6b7280" }}>No matches.</p>
                ) : null
              ) : null}
            </div>
          </Row>
        </div>
      </div>

      {loadingDetail ? <p>Loading contact info...</p> : null}

      {memberAForm && memberBForm && memberADetail && memberBDetail ? (
        <section className={`${forms.sectionCard} ${styles.reviewCard}`}>
          <p className={styles.reviewText}>
            Please review and, if necessary, update the contact information of
            the members to be linked.
          </p>

          <div className={styles.namesRow}>
            <div className={styles.memberName}>
              {displayName(memberADetail)}
            </div>
            <div />
            <div className={styles.memberName}>
              {displayName(memberBDetail)}
            </div>
          </div>

          <div className={styles.compareGrid}>
            <div className={styles.phoneRow}>
              <div className={styles.groupCard}>
                <div className={styles.mobileMemberName}>{displayName(memberADetail)}</div>
                <label className={styles.fieldLabel}>Last Name</label>
                <input
                  className={forms.field}
                  value={memberAForm.lname}
                  disabled={saving}
                  onChange={(e) => setFormField("left", "lname", e.target.value)}
                />
              </div>
              <div className={styles.copyButtons}>
                <button
                  type="button"
                  className={`${forms.button} ${forms.linkButtonLight} ${styles.copyButton}`}
                  disabled={saving}
                  onClick={() => copyField("lname", "rightToLeft")}
                >
                  ← Copy
                </button>
                <button
                  type="button"
                  className={`${forms.button} ${forms.linkButtonLight} ${styles.copyButton}`}
                  disabled={saving}
                  onClick={() => copyField("lname", "leftToRight")}
                >
                  Copy →
                </button>
              </div>
              <div className={styles.groupCard}>
                <div className={styles.mobileMemberName}>{displayName(memberBDetail)}</div>
                <label className={styles.fieldLabel}>Last Name</label>
                <input
                  className={forms.field}
                  value={memberBForm.lname}
                  disabled={saving}
                  onChange={(e) => setFormField("right", "lname", e.target.value)}
                />
              </div>
            </div>

            <div className={styles.groupRow}>
              <div className={styles.groupCard}>
                <div className={styles.mobileMemberName}>{displayName(memberADetail)}</div>
                {ADDRESS_FIELDS.map((field) => (
                  <div
                    key={`left-${field.key}`}
                    className={styles.groupFieldRow}
                  >
                    <label className={styles.fieldLabel}>{field.label}</label>
                    {renderAddressInput("left", memberAForm, field.key)}
                  </div>
                ))}
              </div>

              <div
                className={`${styles.copyButtons} ${styles.groupCopyButtons}`}
              >
                <button
                  type="button"
                  className={`${forms.button} ${forms.linkButtonLight} ${styles.copyButton}`}
                  disabled={saving}
                  onClick={() => copyAddressGroup("rightToLeft")}
                >
                  ← Copy
                </button>
                <button
                  type="button"
                  className={`${forms.button} ${forms.linkButtonLight} ${styles.copyButton}`}
                  disabled={saving}
                  onClick={() => copyAddressGroup("leftToRight")}
                >
                  Copy →
                </button>
              </div>

              <div className={styles.groupCard}>
                <div className={styles.mobileMemberName}>{displayName(memberBDetail)}</div>
                {ADDRESS_FIELDS.map((field) => (
                  <div
                    key={`right-${field.key}`}
                    className={styles.groupFieldRow}
                  >
                    <label className={styles.fieldLabel}>{field.label}</label>
                    {renderAddressInput("right", memberBForm, field.key)}
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.phoneRow}>
              <div className={styles.groupCard}>
                <div className={styles.mobileMemberName}>{displayName(memberADetail)}</div>
                <label className={styles.fieldLabel}>Home Phone</label>
                <input
                  className={forms.field}
                  value={memberAForm.homephone}
                  disabled={saving}
                  onChange={(e) =>
                    setFormField("left", "homephone", e.target.value)
                  }
                />
              </div>
              <div className={styles.copyButtons}>
                <button
                  type="button"
                  className={`${forms.button} ${forms.linkButtonLight} ${styles.copyButton}`}
                  disabled={saving}
                  onClick={() => copyField("homephone", "rightToLeft")}
                >
                  ← Copy
                </button>
                <button
                  type="button"
                  className={`${forms.button} ${forms.linkButtonLight} ${styles.copyButton}`}
                  disabled={saving}
                  onClick={() => copyField("homephone", "leftToRight")}
                >
                  Copy →
                </button>
              </div>
              <div className={styles.groupCard}>
                <div className={styles.mobileMemberName}>{displayName(memberBDetail)}</div>
                <label className={styles.fieldLabel}>Home Phone</label>
                <input
                  className={forms.field}
                  value={memberBForm.homephone}
                  disabled={saving}
                  onChange={(e) =>
                    setFormField("right", "homephone", e.target.value)
                  }
                />
              </div>
            </div>

          </div>

          {saveError ? <p className={forms.error}>{saveError}</p> : null}

          <div className={forms.actions}>
            <button
              type="button"
              className={forms.button}
              disabled={saving}
              onClick={saveAndLink}
            >
              {saving ? "Saving..." : "Save contact info & link spouses"}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={forms.row}>
      <div className={forms.label}>{label}:</div>
      <div className={forms.control}>{children}</div>
    </div>
  );
}
