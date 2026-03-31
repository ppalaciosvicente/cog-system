"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchCountryAndUSStateLookups } from "@/lib/lookups";
import { CountryStatePicker } from "@/components/CountryStatePicker";
import { BackLink } from "@/components/BackLink";

// ✅ Put this file at: src/styles/forms.module.css (or adjust the import to wherever you place it)
import forms from "@/styles/forms.module.css";
import type { RoleName, RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";

type MemberOption = {
  id: number;
  fname: string | null;
  lname: string | null;
  statecode: string | null;
  countrycode: string | null;
};

type AreaScope = {
  id: number;
  countrycode: string | null;
  statecode: string | null;
  congregationid: number | null;
};

type MemberDetail = {
  id: number;

  fname: string | null;
  lname: string | null;

  address: string | null;
  address2: string | null;
  city: string | null;
  statecode: string | null;
  zip: string | null;
  countrycode: string | null;

  homephone: string | null;
  cellphone: string | null;
  email: string | null;

  baptized: boolean | null;
  baptizeddate: string | null;

  tithestatusid: number | null;
  comments: string | null;

  eldercomments: string | null;
  statusid: number | null;
  congregationid: number | null;

  datecreated: string;
  dateupdated: string | null;
};

type TitheStatus = { id: number; name: string };
type Status = { id: number; name: string };
type Congregation = { id: number; name: string };

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

function toISODateInput(v: string | null | undefined) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeCode(code?: string | null) {
  return String(code ?? "")
    .trim()
    .toUpperCase();
}

export default function MembersPage() {
  const supabase = createClient();
  const router = useRouter();

  const [pageLoading, setPageLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [backHref, setBackHref] = useState("/members");

  const [search] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [member, setMember] = useState<MemberDetail | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<MemberDetail | null>(null);
  const [dirty, setDirty] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null); // API errors
  const [validationError, setValidationError] = useState<string | null>(null); // validation
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [titheStatuses, setTitheStatuses] = useState<TitheStatus[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [congregations, setCongregations] = useState<Congregation[]>([]);
  const [congregationNameById, setCongregationNameById] = useState<
    Record<number, string>
  >({});

  // Lookups for names + dropdown options (provided by your hook)
  const [countryNameByCode, setCountryNameByCode] = useState<
    Record<string, string>
  >({});
  const [usStateNameByCode, setUsStateNameByCode] = useState<
    Record<string, string>
  >({});
  const [canadaStateNameByCode, setCanadaStateNameByCode] = useState<
    Record<string, string>
  >({});
  const [australiaStateNameByCode, setAustraliaStateNameByCode] = useState<
    Record<string, string>
  >({});
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
  const canSeeAll = isAdmin || isSuperuser;

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...memberOptions];
    list.sort((a, b) => displayName(a).localeCompare(displayName(b)));

    if (!q) return list;

    return list.filter((m) => {
      const state = (m.statecode ?? "").toLowerCase();
      const country = (m.countrycode ?? "").toLowerCase();
      const name = displayName(m).toLowerCase();
      return state.includes(q) || country.includes(q) || name.includes(q);
    });
  }, [memberOptions, search]);

  // --- Init: auth + roles + dropdown list + lookups
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
          .select("id, isactive, memberid")
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

        const admin = roles.includes("emc_admin");
        const superuser = roles.includes("emc_superuser");
        if (!(admin || superuser)) {
          setError("You do not have access to this page.");
          return;
        }

        if (!cancelled) setIsAdmin(admin);
        if (!cancelled) setIsSuperuser(superuser);

        // lookups
        const lookups = await fetchCountryAndUSStateLookups();
        if (!cancelled) {
          setCountryNameByCode(lookups.countryNameByCode);
          setUsStateNameByCode(lookups.usStateNameByCode);
          setCanadaStateNameByCode(lookups.canadaStateNameByCode);
          setAustraliaStateNameByCode(lookups.australiaStateNameByCode);
          setCountryOptions(lookups.countryOptions);
          setUsStateOptions(lookups.usStateOptions);
          setCanadaStateOptions(lookups.canadaStateOptions);
          setAustraliaStateOptions(lookups.australiaStateOptions);
        }

        // tithe statuses
        const { data: ts, error: tsErr } = await supabase
          .from("emctithestatus")
          .select("id,name")
          .order("id", { ascending: true });

        if (tsErr) {
          setError(`Failed to load tithing statuses: ${tsErr.message}`);
          return;
        }
        if (!cancelled) setTitheStatuses((ts ?? []) as TitheStatus[]);

        // fellowship statuses
        const { data: s, error: sErr } = await supabase
          .from("emcstatus")
          .select("id,name")
          .order("id", { ascending: true });

        if (sErr) {
          setError(`Failed to load statuses: ${sErr.message}`);
          return;
        }
        if (!cancelled) setStatuses((s ?? []) as Status[]);

        // congregation lookup
        const { data: congregations, error: congregationErr } = await supabase
          .from("emccongregation")
          .select("id,name")
          .order("name", { ascending: true });

        if (congregationErr) {
          setError(`Failed to load congregations: ${congregationErr.message}`);
          return;
        }
        if (!cancelled) {
          const lookup: Record<number, string> = {};
          (congregations ?? []).forEach((row: { id: number; name: string | null }) => {
            if (row.id) lookup[row.id] = (row.name ?? "").trim();
          });
          setCongregations(
            (congregations ?? []).map((row: { id: number; name: string | null }) => ({
              id: row.id,
              name: (row.name ?? "").trim(),
            })),
          );
          setCongregationNameById(lookup);
        }

        // member dropdown
        let opts: MemberOption[] = [];
        if (admin || superuser) {
          const { data: allMembers, error: allMembersErr } = await supabase
            .from("emcmember")
            .select("id,fname,lname,statecode,countrycode")
            .neq("statusid", 1)
            .order("lname", { ascending: true })
            .order("fname", { ascending: true })
            .limit(2000);

          if (allMembersErr) {
            setError(`Failed to load members list: ${allMembersErr.message}`);
            return;
          }
          opts = (allMembers ?? []) as MemberOption[];
        } else {
          if (!account.memberid) {
            setError("No member record linked to this account.");
            return;
          }

          const { data: areaRows, error: areaErr } = await supabase
            .from("emcelderarea")
            .select("id,countrycode,statecode,congregationid")
            .eq("memberid", account.memberid);

          if (areaErr) {
            setError(`Failed to load elder areas: ${areaErr.message}`);
            return;
          }

          const areas = (areaRows ?? []) as AreaScope[];
          if (areas.length > 0) {
            const congregationIds = Array.from(
              new Set(
                areas
                  .map((row) => row.congregationid)
                  .filter((id): id is number => !!id),
              ),
            );
            const stateAreas = areas.filter(
              (area) => !area.congregationid && area.statecode,
            );
            const countryAreas = areas.filter(
              (area) =>
                !area.congregationid && !area.statecode && area.countrycode,
            );

            const filters: string[] = [];
            if (congregationIds.length > 0) {
              filters.push(`congregationid.in.(${congregationIds.join(",")})`);
            }

            stateAreas.forEach((area) => {
              const cc = normalizeCode(area.countrycode);
              const sc = normalizeCode(area.statecode);
              if (cc && sc) {
                filters.push(`and(countrycode.eq.${cc},statecode.eq.${sc})`);
              }
            });

            countryAreas.forEach((area) => {
              const cc = normalizeCode(area.countrycode);
              if (cc) filters.push(`countrycode.eq.${cc}`);
            });

            if (filters.length > 0) {
              const { data: scopedMembers, error: scopedErr } = await supabase
                .from("emcmember")
                .select("id,fname,lname,statecode,countrycode")
                .or(filters.join(","))
                .neq("statusid", 1)
                .order("lname", { ascending: true })
                .order("fname", { ascending: true })
                .limit(2000);

              if (scopedErr) {
                setError(`Failed to load members list: ${scopedErr.message}`);
                return;
              }
              opts = (scopedMembers ?? []) as MemberOption[];
            } else {
              opts = [];
            }
          } else {
            opts = [];
          }
        }

        if (!cancelled) {
          const list = opts;
          setMemberOptions(list);

          const params = new URLSearchParams(window.location.search);
          const pre = params.get("selected");
          const returnTo = params.get("returnTo");
          const safeReturnTo =
            returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
              ? returnTo
              : "/members";
          setBackHref(safeReturnTo);
          const preId = pre ? Number(pre) : NaN;
          if (
            Number.isFinite(preId) &&
            preId > 0 &&
            list.some((row) => row.id === preId)
          ) {
            setSelectedId(preId);
          } else if (list.length > 0) {
            setSelectedId(list[0].id);
          } else {
            setSelectedId(null);
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
    if (selectedId == null) return;
    if (filteredOptions.some((row) => row.id === selectedId)) return;
    setSelectedId(filteredOptions.length > 0 ? filteredOptions[0].id : null);
  }, [filteredOptions, selectedId]);

  // --- Load selected member details
  useEffect(() => {
    let cancelled = false;

    async function loadMember(id: number) {
      setDetailLoading(true);
      setDetailError(null);
      setValidationError(null);
      setSaveMsg(null);

      setMember(null);
      setForm(null);
      setDirty(false);
      setEditMode(false);

      if (
        !canSeeAll &&
        memberOptions.length > 0 &&
        !memberOptions.some((m) => m.id === id)
      ) {
        setDetailError("You do not have access to this contact.");
        setDetailLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("emcmember")
          .select(
            `
            id,
            fname, lname,
            address, address2, city, statecode, zip, countrycode,
            homephone, cellphone, email,
            baptized, baptizeddate,
            tithestatusid,
            comments,
            eldercomments,
            statusid,
            congregationid,
            datecreated, dateupdated
          `,
          )
          .eq("id", id)
          .single();

        if (error) {
          setDetailError(error.message);
          return;
        }

        if (!cancelled) {
          const d = data as MemberDetail;

          // default required lookups if null
          if (d.tithestatusid == null && titheStatuses.length > 0)
            d.tithestatusid = titheStatuses[0].id;
          if (d.statusid == null && statuses.length > 0)
            d.statusid = statuses[0].id;

          setMember(d);
          setForm(d);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }

    if (selectedId != null) loadMember(selectedId);
    return () => {
      cancelled = true;
    };
  }, [canSeeAll, memberOptions, selectedId, supabase, titheStatuses, statuses]);

  function setField<K extends keyof MemberDetail>(
    key: K,
    value: MemberDetail[K],
  ) {
    if (!form) return;
    setForm({ ...form, [key]: value });
    setDirty(true);
    setSaveMsg(null);
    setValidationError(null);
    setDetailError(null);
  }

  function setCountry(code: string) {
    const cc = code.trim().toUpperCase();
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        countrycode: cc,
        statecode: cc === "US" || cc === "CA" || cc === "AU" ? prev.statecode : null,
      };
    });
    setDirty(true);
    setSaveMsg(null);
    setValidationError(null);
    setDetailError(null);
  }

  function setState(codeOrNull: string | null) {
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        statecode: codeOrNull ? codeOrNull.trim().toUpperCase() : null,
      };
    });
    setDirty(true);
    setSaveMsg(null);
    setValidationError(null);
    setDetailError(null);
  }

  async function saveChanges() {
    if (!isAdmin || !editMode || !dirty || !form) return;

    setSaveMsg(null);
    setDetailError(null);
    setValidationError(null);

    if (form.tithestatusid == null) {
      setValidationError("Tithing Status is required.");
      return;
    }

    if (form.statusid == null) {
      setValidationError("Fellowship Status is required.");
      return;
    }

    const cc = (form.countrycode ?? "").trim().toUpperCase();
    if (!cc || cc.length !== 2) {
      setValidationError("Country is required.");
      return;
    }

    if ((cc === "US" || cc === "CA" || cc === "AU") && !form.statecode) {
      setValidationError(
        cc === "CA"
          ? "Province is required when Country is Canada."
          : cc === "AU"
            ? "State is required when Country is Australia."
            : "State is required when Country is US.",
      );
      return;
    }

    const payload = {
      fname: form.fname,
      lname: form.lname,
      address: form.address,
      address2: form.address2,
      city: form.city,
      zip: form.zip,
      countrycode: cc,
      statecode: form.statecode ? form.statecode.trim().toUpperCase() : null,
      homephone: form.homephone,
      cellphone: form.cellphone,
      email: form.email,
      baptized: form.baptized ?? false,
      baptizeddate: form.baptizeddate,
      tithestatusid: form.tithestatusid,
      comments: form.comments,
      eldercomments: form.eldercomments,
      statusid: form.statusid,
      congregationid: form.congregationid,
      dateupdated: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("emcmember")
      .update(payload)
      .eq("id", form.id);

    if (error) {
      setDetailError(error.message);
      return;
    }

    setSaveMsg("Saved.");
    setDirty(false);
    setEditMode(false);

    // refresh the detail row from DB
    setSelectedId(form.id);
  }

  if (pageLoading) {
    return <main className={`${forms.page} ${forms.pageWarn} ${forms.compactPage}`}>Loading…</main>;
  }

  if (error) {
    return (
      <main className={`${forms.page} ${forms.pageWarn} ${forms.compactPage}`}>
        <h1 className={forms.title}>Contacts - Not in fellowship</h1>
        <p style={{ color: "crimson" }}>{error}</p>
        <div style={{ marginTop: 12 }}>
          <BackLink fallbackHref={backHref} className={`${forms.linkButton} ${forms.linkButtonLight}`}>
            ← Back to contacts in fellowship
          </BackLink>
        </div>
      </main>
    );
  }

  return (
    <main className={`${forms.page} ${forms.pageWarn} ${forms.compactPage}`}>
      <h1 className={forms.title}>Contacts - Not in fellowship</h1>

      {/* top bar */}
      <div className={forms.topBar}>
        <div className={forms.topGroup}>
          <label htmlFor="memberSelect" className={forms.topLabel}>
            Select Contact:
          </label>

          <select
            id="memberSelect"
            value={selectedId ?? ""}
            onChange={(e) =>
              setSelectedId(e.target.value ? Number(e.target.value) : null)
            }
            className={forms.selectContact}
          >
            {filteredOptions.length === 0 && (
              <option value="">(no members)</option>
            )}
            {filteredOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {displayName(m)}
              </option>
            ))}
          </select>
        </div>

        <div className={forms.topSpacer}>
          <BackLink fallbackHref={backHref} className={`${forms.linkButton} ${forms.linkButtonLight}`}>
            ← Back to contacts in fellowship
          </BackLink>
        </div>
      </div>

      <hr className={forms.hr} />

      {/* actions row (admin only) */}
      {isAdmin && (
        <div className={forms.actions}>
          <div className={forms.actionsRow}>
            {!editMode ? (
              <button
                disabled={!member}
                onClick={() => {
                  if (!member) return;
                  setEditMode(true);
                  setSaveMsg(null);
                  setValidationError(null);
                  setDetailError(null);
                }}
              >
                Edit
              </button>
            ) : (
              <button
                onClick={() => {
                  setForm(member);
                  setDirty(false);
                  setEditMode(false);
                  setSaveMsg(null);
                  setValidationError(null);
                  setDetailError(null);
                }}
              >
                Cancel edit
              </button>
            )}

            <button
              disabled={!dirty || !editMode}
              onClick={saveChanges}
              style={{ opacity: !dirty || !editMode ? 0.5 : 1 }}
            >
              Save
            </button>

            {saveMsg && <span className={forms.actionsMsg}>{saveMsg}</span>}
          </div>

          {validationError && (
            <div className={forms.error}>{validationError}</div>
          )}
          {detailError && <div className={forms.error}>{detailError}</div>}
        </div>
      )}

      {detailLoading && <p>Loading contact…</p>}

      {!detailLoading && form && (
        <div className={forms.formGrid}>
          {(() => {
            const locationParts = [
              form.address,
              form.address2,
              form.city,
              form.statecode,
              form.zip,
              form.countrycode,
            ]
              .map((v) => String(v ?? "").trim())
              .filter(Boolean);
            const mapsHref =
              locationParts.length > 0
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    locationParts.join(", "),
                  )}`
                : "";

            return (
              <>
          {/* LEFT column */}
          <div className={`${forms.col} ${forms.colTight}`}>
            <TextRow
              label="First Name"
              value={form.fname ?? ""}
              disabled={!editMode}
              onChange={(v) => setField("fname", v)}
            />
            <TextRow
              label="Last Name"
              value={form.lname ?? ""}
              disabled={!editMode}
              onChange={(v) => setField("lname", v)}
            />
            <TextRow
              label="Address"
              value={form.address ?? ""}
              disabled={!editMode}
              onChange={(v) => setField("address", v)}
            />
            <TextRow
              label="Address 2"
              value={form.address2 ?? ""}
              disabled={!editMode}
              onChange={(v) => setField("address2", v)}
            />
            <TextRow
              label="City"
              value={form.city ?? ""}
              disabled={!editMode}
              onChange={(v) => setField("city", v)}
            />
            <TextRow
              label="Zip Code"
              value={form.zip ?? ""}
              disabled={!editMode}
              onChange={(v) => setField("zip", v)}
            />

            {/* Keep picker as-is, but ensure it can shrink in grid */}
            <div style={{ minWidth: 0 }}>
                <CountryStatePicker
                  editMode={editMode}
                  rowGap={8}
                  countrycode={form.countrycode}
                  statecode={form.statecode}
                  countryOptions={countryOptions}
                  usStateOptions={usStateOptions}
                  canadaStateOptions={canadaStateOptions}
                  australiaStateOptions={australiaStateOptions}
                  countryNameByCode={countryNameByCode}
                  usStateNameByCode={usStateNameByCode}
                  canadaStateNameByCode={canadaStateNameByCode}
                  australiaStateNameByCode={australiaStateNameByCode}
                  onChangeCountry={setCountry}
                  onChangeState={setState}
                />
            </div>

            <div className={forms.actions}>
              {mapsHref ? (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${forms.linkButtonLight} ${forms.linkButtonCompactTouch}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#fff",
                    border: "1px solid #d1d5db",
                    color: "#111827",
                    textDecoration: "none",
                    transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.background = "#f9fafb";
                    (e.currentTarget as HTMLAnchorElement).style.borderColor = "#cfd4dc";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.background = "#fff";
                    (e.currentTarget as HTMLAnchorElement).style.borderColor = "#d1d5db";
                  }}
                >
                  <span aria-hidden="true" style={{ textDecoration: "none" }}>
                    📍
                  </span>
                  View Location on Map
                </a>
              ) : (
                <button
                  type="button"
                  className={`${forms.linkButtonLight} ${forms.linkButtonCompactTouch}`}
                  disabled
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    color: "#9ca3af",
                    textDecoration: "none",
                  }}
                >
                  <span aria-hidden="true" style={{ textDecoration: "none" }}>
                    📍
                  </span>
                  View Location on Map
                </button>
              )}
            </div>
          </div>

          {/* RIGHT column */}
          <div className={forms.col}>
            <TextRow
              label="Home Phone"
              value={form.homephone ?? ""}
              disabled={!editMode}
              onChange={(v) => setField("homephone", v)}
            />
            <TextRow
              label="Cell Phone"
              value={form.cellphone ?? ""}
              disabled={!editMode}
              onChange={(v) => setField("cellphone", v)}
            />
            <TextRow
              label="E-Mail"
              value={form.email ?? ""}
              disabled={!editMode}
              onChange={(v) => setField("email", v)}
            />

            <CheckRow
              label="Baptized"
              checked={!!form.baptized}
              disabled={!editMode}
              onChange={(v) => setField("baptized", v)}
            />

            <DateRow
              label="Baptized Date"
              value={toISODateInput(form.baptizeddate)}
              disabled={!editMode}
              onChange={(v) =>
                setField("baptizeddate", v ? new Date(v).toISOString() : null)
              }
            />

            <SelectRow
              label="Fellowship Status"
              value={form.statusid?.toString() ?? ""}
              disabled={!editMode}
              options={statuses.map((s) => ({
                value: String(s.id),
                label: s.name,
              }))}
              onChange={(v) => setField("statusid", v ? Number(v) : null)}
            />

            <SelectRow
              label="Tithing Status"
              value={form.tithestatusid?.toString() ?? ""}
              disabled={!editMode}
              options={titheStatuses.map((s) => ({
                value: String(s.id),
                label: s.name,
              }))}
              onChange={(v) => setField("tithestatusid", v ? Number(v) : null)}
            />

            <TextAreaRow
              label="Comments"
              value={form.comments ?? ""}
              disabled={!editMode}
              onChange={(v) => setField("comments", v)}
            />

            <div style={{ border: "1px solid #000", padding: 8 }}>
              <TextAreaRow
                label="Elder Comments"
                value={form.eldercomments ?? ""}
                disabled={!editMode}
                onChange={(v) => setField("eldercomments", v)}
              />
              {isAdmin ? (
                <SelectRow
                  label="Congregation"
                  value={form.congregationid?.toString() ?? ""}
                  disabled={!editMode}
                  options={[
                    { value: "", label: "(none)" },
                    ...congregations.map((row) => ({
                      value: String(row.id),
                      label: row.name,
                    })),
                  ]}
                  onChange={(v) => setField("congregationid", v ? Number(v) : null)}
                />
              ) : (
                <TextRow
                  label="Congregation"
                  value={
                    form.congregationid
                      ? (congregationNameById[form.congregationid] ?? "")
                      : ""
                  }
                  disabled={true}
                  onChange={() => {}}
                />
              )}
            </div>
          </div>
        </>
            );
          })()}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <p>
          <strong>Note:</strong> To request a change to a contact send an email
          to Audra Weinland (
          <a href="mailto:audra.weinland@gmail.com">audra.weinland@gmail.com</a>
          ). Please, remember to provide all necessary details.
        </p>
        <p>
          It is your responsibility to collect thorough contact information
          (address, email and phone number(s)) on all baptized members and to
          forward it so that it can be included in the Church&apos;s records.
        </p>
      </div>
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

function TextRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={forms.field}
      />
    </Row>
  );
}

function TextAreaRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${forms.field} ${forms.textarea}`}
      />
    </Row>
  );
}

function SelectRow({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={forms.field}
      >
        {options.map((o) => (
          <option key={o.value || "(blank)"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

function CheckRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </Row>
  );
}

function DateRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={forms.field}
      />
    </Row>
  );
}
