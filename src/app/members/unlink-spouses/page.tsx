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

type LinkedMember = {
  id: number;
  fname: string | null;
  lname: string | null;
  householdid: number | null;
  spouseid: number | null;
  address: string | null;
  address2: string | null;
  zip: string | null;
  city: string | null;
  statecode: string | null;
  countrycode: string | null;
  homephone: string | null;
  cellphone: string | null;
  statusid: number | null;
  tithestatusid: number | null;
};

type TitheStatus = { id: number; name: string };
type Status = { id: number; name: string };

type HouseholdOption = {
  householdId: number;
  memberAId: number;
  memberBId: number;
  label: string;
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
  cellphone: string;
  statusid: string;
  tithestatusid: string;
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

function displayName(m: { id: number; fname: string | null; lname: string | null }) {
  const ln = (m.lname ?? "").trim();
  const fn = (m.fname ?? "").trim();
  if (!ln && !fn) return `#${m.id}`;
  if (!ln) return fn;
  if (!fn) return ln;
  return `${ln}, ${fn}`;
}

function toForm(detail: LinkedMember): ContactFields {
  return {
    lname: detail.lname ?? "",
    address: detail.address ?? "",
    address2: detail.address2 ?? "",
    zip: detail.zip ?? "",
    city: detail.city ?? "",
    statecode: detail.statecode ?? "",
    countrycode: detail.countrycode ?? "",
    homephone: detail.homephone ?? "",
    cellphone: detail.cellphone ?? "",
    statusid: detail.statusid != null ? String(detail.statusid) : "",
    tithestatusid: detail.tithestatusid != null ? String(detail.tithestatusid) : "",
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
    cellphone: form.cellphone,
    statusid: form.statusid,
    tithestatusid: form.tithestatusid,
  };
}

function buildHouseholdOptions(rows: LinkedMember[]) {
  const byId = new Map<number, LinkedMember>();
  rows.forEach((row) => byId.set(row.id, row));

  const seenPairs = new Set<string>();
  const options: HouseholdOption[] = [];

  rows.forEach((member) => {
    if (!member.householdid || !member.spouseid) return;
    const spouse = byId.get(member.spouseid);
    if (!spouse) return;
    if (spouse.spouseid !== member.id) return;
    if (spouse.householdid !== member.householdid) return;

    const pairKey = [Math.min(member.id, spouse.id), Math.max(member.id, spouse.id)].join("-");
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);

    const [first, second] = [member, spouse].sort((a, b) => a.id - b.id);
    const firstLast = (first.lname ?? "").trim();
    const secondLast = (second.lname ?? "").trim();
    const firstName = (first.fname ?? "").trim();
    const secondName = (second.fname ?? "").trim();
    options.push({
      householdId: member.householdid,
      memberAId: first.id,
      memberBId: second.id,
      label:
        firstLast &&
        secondLast &&
        firstName &&
        secondName &&
        firstLast.localeCompare(secondLast) === 0
          ? `${firstLast}, ${firstName} & ${secondName}`
          : `${displayName(first)} & ${displayName(second)}`,
    });
  });

  options.sort((a, b) => a.label.localeCompare(b.label));
  return options;
}

export default function UnlinkSpousesPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [pageLoading, setPageLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [backHref, setBackHref] = useState("/members");

  const [rowsById, setRowsById] = useState<Map<number, LinkedMember>>(new Map());
  const [householdOptions, setHouseholdOptions] = useState<HouseholdOption[]>([]);
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<number | null>(null);
  const [householdSearch, setHouseholdSearch] = useState("");
  const [householdSearchResults, setHouseholdSearchResults] = useState<HouseholdOption[]>([]);
  const [selectedHouseholdLabel, setSelectedHouseholdLabel] = useState("");
  const [skipHouseholdSearch, setSkipHouseholdSearch] = useState(false);

  const [memberADetail, setMemberADetail] = useState<LinkedMember | null>(null);
  const [memberBDetail, setMemberBDetail] = useState<LinkedMember | null>(null);
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
  const [titheStatuses, setTitheStatuses] = useState<TitheStatus[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);

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
          setError("Only EMC admins can unlink spouses.");
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
        const [{ data: titheData, error: titheErr }, { data: statusData, error: statusErr }] = await Promise.all([
          supabase.from("emctithestatus").select("id,name").order("id", { ascending: true }),
          supabase.from("emcstatus").select("id,name").order("id", { ascending: true }),
        ]);
        if (titheErr) {
          setError(`Failed to load tithing statuses: ${titheErr.message}`);
          return;
        }
        if (statusErr) {
          setError(`Failed to load statuses: ${statusErr.message}`);
          return;
        }
        if (!cancelled) {
          setCountryOptions(lookups.countryOptions);
          setUsStateOptions(lookups.usStateOptions);
          setCanadaStateOptions(lookups.canadaStateOptions);
          setAustraliaStateOptions(lookups.australiaStateOptions);
          setTitheStatuses((titheData ?? []) as TitheStatus[]);
          setStatuses((statusData ?? []) as Status[]);
        }

        const { data: members, error: membersErr } = await supabase
          .from("emcmember")
          .select(
            "id,fname,lname,householdid,spouseid,address,address2,zip,city,statecode,countrycode,homephone,cellphone,statusid,tithestatusid",
          )
          .eq("statusid", 1)
          .not("householdid", "is", null)
          .not("spouseid", "is", null)
          .order("lname", { ascending: true })
          .order("fname", { ascending: true })
          .limit(2000);

        if (membersErr) {
          setError(`Failed to load linked households: ${membersErr.message}`);
          return;
        }

        if (!cancelled) {
          const params = new URLSearchParams(window.location.search);
          const selectedHouseholdParam = Number(params.get("household"));
          const rows = (members ?? []) as LinkedMember[];
          const byId = new Map<number, LinkedMember>();
          rows.forEach((row) => byId.set(row.id, row));
          const options = buildHouseholdOptions(rows);

          setRowsById(byId);
          setHouseholdOptions(options);
          if (
            Number.isFinite(selectedHouseholdParam) &&
            options.some((option) => option.householdId === selectedHouseholdParam)
          ) {
            setSelectedHouseholdId(selectedHouseholdParam);
          } else {
            setSelectedHouseholdId(null);
          }
          const initial = options.find((opt) => opt.householdId === selectedHouseholdParam);
          if (initial) {
            setSelectedHouseholdLabel(initial.label);
            setHouseholdSearch(initial.label);
          }
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
    if (!selectedHouseholdId) {
      setMemberADetail(null);
      setMemberBDetail(null);
      setMemberAForm(null);
      setMemberBForm(null);
      return;
    }

    const selected = householdOptions.find((option) => option.householdId === selectedHouseholdId) ?? null;
    if (!selected) {
      setMemberADetail(null);
      setMemberBDetail(null);
      setMemberAForm(null);
      setMemberBForm(null);
      return;
    }

    const a = rowsById.get(selected.memberAId) ?? null;
    const b = rowsById.get(selected.memberBId) ?? null;
    if (!a || !b) {
      setMemberADetail(null);
      setMemberBDetail(null);
      setMemberAForm(null);
      setMemberBForm(null);
      return;
    }

    setMemberADetail(a);
    setMemberBDetail(b);
    setMemberAForm(toForm(a));
    setMemberBForm(toForm(b));
    setSaveError(null);
  }, [selectedHouseholdId, householdOptions, rowsById]);

  useEffect(() => {
    if (skipHouseholdSearch) {
      setSkipHouseholdSearch(false);
      setHouseholdSearchResults([]);
      return;
    }
    const term = householdSearch.trim().toLowerCase();
    if (term && term === selectedHouseholdLabel.trim().toLowerCase()) {
      setHouseholdSearchResults([]);
      return;
    }
    if (term.length < 2) {
      setHouseholdSearchResults([]);
      return;
    }
    const results = householdOptions
      .filter((opt) => opt.label.toLowerCase().includes(term))
      .slice(0, 50);
    setHouseholdSearchResults(results);
  }, [householdOptions, householdSearch, selectedHouseholdLabel, skipHouseholdSearch]);

  useEffect(() => {
    if (selectedHouseholdId == null) return;
    const match = householdOptions.find((o) => o.householdId === selectedHouseholdId);
    if (match) {
      setSelectedHouseholdLabel(match.label);
      setHouseholdSearch(match.label);
    }
  }, [householdOptions, selectedHouseholdId]);

  function setFormField(side: "left" | "right", key: ContactKey, value: string) {
    if (side === "left") {
      setMemberAForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    } else {
      setMemberBForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    }
    setSaveError(null);
  }

  function renderLookupInput(
    side: "left" | "right",
    form: ContactFields,
    key: "statusid" | "tithestatusid",
  ) {
    const options = key === "statusid" ? statuses : titheStatuses;
    const emptyLabel = key === "statusid" ? "Select fellowship status" : "Select tithing status";
    return (
      <select
        className={forms.field}
        value={form[key]}
        disabled={saving}
        onChange={(e) => setFormField(side, key, e.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={`${key}-${side}-${option.id}`} value={String(option.id)}>
            {option.name}
          </option>
        ))}
      </select>
    );
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

  async function saveAndUnlink() {
    if (!isAdmin) return;
    if (!memberADetail || !memberBDetail || !memberAForm || !memberBForm) {
      setSaveError("Select a household to unlink.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/members/spouses", {
        method: "DELETE",
        headers,
        body: JSON.stringify({
          memberId: memberADetail.id,
          spouseMemberId: memberBDetail.id,
          memberContact: toPayload(memberAForm),
          spouseContact: toPayload(memberBForm),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setSaveError(payload.error ?? "Failed to unlink spouses.");
        return;
      }

      router.push(
        `/members?selected=${memberADetail.id}&unlinkedA=${memberADetail.id}&unlinkedB=${memberBDetail.id}`,
      );
    } finally {
      setSaving(false);
    }
  }

  if (pageLoading) {
    return <main className={`${forms.page} ${forms.pageNarrow} ${forms.compactPage}`}>Loading...</main>;
  }

  if (error) {
    return (
      <main className={`${forms.page} ${forms.pageNarrow} ${forms.compactPage}`}>
        <h1 className={forms.h1}>Unlink Spouses</h1>
        <p className={forms.error}>{error}</p>
        <BackLink fallbackHref={backHref} className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          ← Back
        </BackLink>
      </main>
    );
  }

  return (
    <main className={`${forms.page} ${forms.compactPage}`}>
      <h1 className={forms.h1}>Unlink Spouses</h1>

      <div className={forms.backRow}>
        <BackLink fallbackHref={backHref} className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          ← Back
        </BackLink>
      </div>

      <div className={forms.sectionCard}>
        <Row label="Household">
          <div className={forms.autocompleteWrap} style={{ minWidth: 320 }}>
            <input
              type="search"
              className={forms.field}
              placeholder="Type at least 2 letters to search households"
              value={householdSearch}
              disabled={saving}
              onChange={(e) => setHouseholdSearch(e.target.value)}
            />
            {householdSearch.trim().length >= 2 ? (
              householdSearchResults.length ? (
                <div
                  className={forms.autocompleteMenu}
                  role="listbox"
                  aria-label="Matching households"
                >
                  {householdSearchResults.map((option) => (
                    <button
                      key={`household-${option.householdId}-${option.memberAId}`}
                      type="button"
                      className={forms.autocompleteOption}
                      onClick={() => {
                        setSelectedHouseholdId(option.householdId);
                        setSelectedHouseholdLabel(option.label);
                        setHouseholdSearch(option.label);
                        setHouseholdSearchResults([]);
                        setSkipHouseholdSearch(true);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : householdSearch.trim() !== selectedHouseholdLabel.trim() ? (
                <p style={{ margin: 4, color: "#6b7280" }}>No matches.</p>
              ) : null
            ) : null}
          </div>
        </Row>
      </div>

      {memberAForm && memberBForm && memberADetail && memberBDetail ? (
        <section className={`${forms.sectionCard} ${styles.reviewCard}`}>
          <p className={styles.reviewText}>
            Please review and, if necessary, update the contact information of the members you are about to unlink.
          </p>

          <div className={styles.splitGrid}>
            <div className={styles.groupCard}>
              <div className={styles.memberName}>{displayName(memberADetail)}</div>
              <div className={styles.groupFieldRow}>
                <label className={styles.fieldLabel}>Last Name</label>
                <input
                  className={forms.field}
                  value={memberAForm.lname}
                  disabled={saving}
                  onChange={(e) => setFormField("left", "lname", e.target.value)}
                />
              </div>
              {ADDRESS_FIELDS.map((field) => (
                <div key={`left-${field.key}`} className={styles.groupFieldRow}>
                  <label className={styles.fieldLabel}>{field.label}</label>
                  {renderAddressInput("left", memberAForm, field.key)}
                </div>
              ))}
              <div className={styles.groupFieldRow}>
                <label className={styles.fieldLabel}>Home Phone</label>
                <input
                  className={forms.field}
                  value={memberAForm.homephone}
                  disabled={saving}
                  onChange={(e) => setFormField("left", "homephone", e.target.value)}
                />
              </div>
              <div className={styles.groupFieldRow}>
                <label className={styles.fieldLabel}>Mobile Phone</label>
                <input
                  className={forms.field}
                  value={memberAForm.cellphone}
                  disabled={saving}
                  onChange={(e) => setFormField("left", "cellphone", e.target.value)}
                />
              </div>
              <div className={styles.groupFieldRow}>
                <label className={styles.fieldLabel}>Fellowship Status</label>
                {renderLookupInput("left", memberAForm, "statusid")}
              </div>
              <div className={styles.groupFieldRow}>
                <label className={styles.fieldLabel}>Tithing Status</label>
                {renderLookupInput("left", memberAForm, "tithestatusid")}
              </div>
            </div>

            <div className={styles.groupCard}>
              <div className={styles.memberName}>{displayName(memberBDetail)}</div>
              <div className={styles.groupFieldRow}>
                <label className={styles.fieldLabel}>Last Name</label>
                <input
                  className={forms.field}
                  value={memberBForm.lname}
                  disabled={saving}
                  onChange={(e) => setFormField("right", "lname", e.target.value)}
                />
              </div>
              {ADDRESS_FIELDS.map((field) => (
                <div key={`right-${field.key}`} className={styles.groupFieldRow}>
                  <label className={styles.fieldLabel}>{field.label}</label>
                  {renderAddressInput("right", memberBForm, field.key)}
                </div>
              ))}
              <div className={styles.groupFieldRow}>
                <label className={styles.fieldLabel}>Home Phone</label>
                <input
                  className={forms.field}
                  value={memberBForm.homephone}
                  disabled={saving}
                  onChange={(e) => setFormField("right", "homephone", e.target.value)}
                />
              </div>
              <div className={styles.groupFieldRow}>
                <label className={styles.fieldLabel}>Mobile Phone</label>
                <input
                  className={forms.field}
                  value={memberBForm.cellphone}
                  disabled={saving}
                  onChange={(e) => setFormField("right", "cellphone", e.target.value)}
                />
              </div>
              <div className={styles.groupFieldRow}>
                <label className={styles.fieldLabel}>Fellowship Status</label>
                {renderLookupInput("right", memberBForm, "statusid")}
              </div>
              <div className={styles.groupFieldRow}>
                <label className={styles.fieldLabel}>Tithing Status</label>
                {renderLookupInput("right", memberBForm, "tithestatusid")}
              </div>
            </div>
          </div>

          {saveError ? <p className={forms.error}>{saveError}</p> : null}

          <div className={forms.actions}>
            <button
              type="button"
              className={forms.button}
              disabled={saving}
              onClick={saveAndUnlink}
            >
              {saving ? "Saving..." : "Save info & unlink spouses"}
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
