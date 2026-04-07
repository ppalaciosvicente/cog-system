"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import { fetchCountryAndUSStateLookups } from "@/lib/lookups";
import { BackLink } from "@/components/BackLink";
import { CountryStatePicker } from "@/components/CountryStatePicker";
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
  eldertypeid: number | null;
  emcaccessrole: "emc_admin" | "emc_superuser" | "emc_user" | null;
  contribaccessrole: "contrib_admin" | "contrib_user" | null;
  datecreated: string;
  dateupdated: string | null;
};

type ElderType = { id: number; name: string };

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

export default function EldersAddPage() {
  const supabase = createClient();
  const router = useRouter();

  const [pageLoading, setPageLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberSearchResults, setMemberSearchResults] = useState<MemberOption[]>([]);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [skipMemberSearch, setSkipMemberSearch] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);

  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState<MemberDetail | null>(null);

  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [elderTypes, setElderTypes] = useState<ElderType[]>([]);

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

  const sortedOptions = useMemo(() => {
    const list = [...memberOptions];
    list.sort((a, b) => displayName(a).localeCompare(displayName(b)));
    return list;
  }, [memberOptions]);

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

        const admin = roles.includes("emc_admin");
        const allowed = admin || roles.includes("emc_superuser") || roles.includes("emc_user");
        if (!allowed) {
          setError("You are logged in, but you do not have access to EMC.");
          return;
        }

        if (!cancelled) setIsAdmin(admin);

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

        const { data: et, error: etErr } = await supabase
          .from("emceldertype")
          .select("id,name")
          .order("id", { ascending: true });

        if (etErr) {
          setError(`Failed to load elder types: ${etErr.message}`);
          return;
        }
        if (!cancelled) setElderTypes((et ?? []) as ElderType[]);

        const { data: opts, error: optErr } = await supabase
          .from("emcmember")
          .select("id,fname,lname,statecode,countrycode,eldertypeid")
          .is("eldertypeid", null)
          .eq("baptized", true)
          .eq("statusid", 1)
          .order("lname", { ascending: true })
          .order("fname", { ascending: true })
          .limit(2000);

        if (optErr) {
          setError(`Failed to load members list: ${optErr.message}`);
          return;
        }

        if (!cancelled) {
          const list = (opts ?? []) as MemberOption[];
          setMemberOptions(list);

          const params = new URLSearchParams(window.location.search);
          const pre = params.get("selected");
          if (pre) setSelectedId(Number(pre));
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
    if (skipMemberSearch) {
      setSkipMemberSearch(false);
      setMemberSearchResults([]);
      return;
    }
    const term = memberSearch.trim().toLowerCase();
    if (term && term === selectedLabel.trim().toLowerCase()) {
      setMemberSearchResults([]);
      return;
    }
    if (term.length < 2) {
      setMemberSearchResults([]);
      return;
    }
    const results = sortedOptions
      .filter((m) => displayName(m).toLowerCase().includes(term))
      .slice(0, 50);
    setMemberSearchResults(results);
  }, [memberSearch, selectedLabel, skipMemberSearch, sortedOptions]);

  useEffect(() => {
    if (selectedId == null) return;
    const match = sortedOptions.find((m) => m.id === selectedId);
    if (match) {
      const label = displayName(match);
      setSelectedLabel(label);
      setMemberSearch(label);
    }
  }, [selectedId, sortedOptions]);

  useEffect(() => {
    let cancelled = false;

    async function loadMember(id: number) {
      setDetailLoading(true);
      setDetailError(null);
      setValidationError(null);
      setSaveMsg(null);

      setForm(null);
      setDirty(false);

      try {
        const { data, error } = await supabase
          .from("emcmember")
          .select(
            `
            id,
            fname, lname,
            address, address2, city, statecode, zip, countrycode,
            homephone, cellphone, email,
            eldertypeid,
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
          const d = {
            ...(data as Omit<MemberDetail, "emcaccessrole" | "contribaccessrole">),
            emcaccessrole: "emc_user" as MemberDetail["emcaccessrole"],
            contribaccessrole: null,
          } as MemberDetail;
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
  }, [selectedId, supabase]);

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
    if (!isAdmin || !dirty || !form) return;

    setSaveMsg(null);
    setDetailError(null);
    setValidationError(null);

    if (form.eldertypeid == null) {
      setValidationError("Elder Type is required.");
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
      eldertypeid: form.eldertypeid,
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

    const headers = await getAuthHeaders();
    const hasAnyAccess = Boolean(form.emcaccessrole || form.contribaccessrole);

    if (hasAnyAccess) {
      const roleResponse = await fetch("/api/elders/accounts", {
        method: "PUT",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          memberId: form.id,
          emcRoleName: form.emcaccessrole,
          contribRoleName: form.contribaccessrole,
        }),
      });
      if (!roleResponse.ok) {
        const rolePayload = (await roleResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        setDetailError(
          `Elder was saved, but failed to set access: ${rolePayload.error ?? "Unknown error."}`,
        );
        return;
      }
    } else {
      const deactivateResponse = await fetch("/api/elders/accounts", {
        method: "PATCH",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ memberId: form.id }),
      });
      if (!deactivateResponse.ok) {
        const deactivatePayload = (await deactivateResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        setDetailError(
          `Elder was saved, but failed to apply No access: ${deactivatePayload.error ?? "Unknown error."}`,
        );
        return;
      }
    }

    setSaveMsg("Saved.");
    setDirty(false);
  }

  if (pageLoading) {
    return <main className={forms.page}>Loading…</main>;
  }

  if (error) {
    return (
      <main className={forms.page}>
        <h1 className={forms.h1}>Add Elder</h1>
        <p style={{ color: "crimson" }}>{error}</p>
        <div className={forms.backRow}>
          <BackLink fallbackHref="/elders" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
            &lt;- Back
          </BackLink>
        </div>
      </main>
    );
  }

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>Add Elder</h1>

      <div className={forms.topBar}>
        <div className={forms.topGroup}>
          <label htmlFor="memberSelect" className={forms.topLabel}>
            Select Member:
          </label>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div
              className={forms.autocompleteWrap}
              style={{ minWidth: 260, flex: "1 1 260px", maxWidth: 420 }}
            >
            <input
              id="memberSelect"
              type="search"
              className={forms.field}
              placeholder="Type at least 2 letters to search"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
            {memberSearch.trim().length >= 2 ? (
              memberSearchResults.length ? (
                <div className={forms.autocompleteMenu} role="listbox" aria-label="Matching members">
                  {memberSearchResults.map((m) => (
                    <button
                      key={`member-opt-${m.id}`}
                      type="button"
                      className={forms.autocompleteOption}
                      onClick={() => {
                        setSelectedId(m.id);
                        const label = displayName(m);
                        setSelectedLabel(label);
                        setMemberSearch(label);
                        setMemberSearchResults([]);
                        setSkipMemberSearch(true);
                        setBrowseAll(false);
                      }}
                    >
                      {displayName(m)}
                    </button>
                  ))}
                </div>
              ) : memberSearch.trim() !== selectedLabel.trim() ? (
                <p style={{ margin: 4, color: "#6b7280" }}>No matches.</p>
              ) : null
            ) : null}
            </div>
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <button
                type="button"
                className={forms.button}
                style={{ flex: "0 0 auto", maxWidth: 260, alignSelf: "stretch" }}
                onClick={() => setBrowseAll((prev) => !prev)}
              >
                {browseAll ? "Hide all members" : "Browse all members"}
              </button>
            </div>
          </div>
          {browseAll ? (
            <div
              style={{
                marginTop: 8,
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                maxHeight: 240,
                overflow: "auto",
                padding: 6,
                minWidth: 240,
              }}
            >
              {sortedOptions.map((m) => (
                <button
                  key={`browse-member-${m.id}`}
                  type="button"
                  className={forms.autocompleteOption}
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => {
                    setSelectedId(m.id);
                    const label = displayName(m);
                    setSelectedLabel(label);
                    setMemberSearch(label);
                    setMemberSearchResults([]);
                    setSkipMemberSearch(true);
                    setBrowseAll(false);
                  }}
                >
                  {displayName(m)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={forms.topSpacer}>
          <BackLink fallbackHref="/elders" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
            &lt;- Back
          </BackLink>
        </div>
      </div>

      <hr className={forms.hr} />

      {saveMsg && <div className={forms.actionsMsg}>{saveMsg}</div>}
      {validationError && <div className={forms.error}>{validationError}</div>}
      {detailError && <div className={forms.error}>{detailError}</div>}

      {detailLoading && <p>Loading member…</p>}

      {!detailLoading && form && (
        <div className={forms.formGrid}>
          <div className={forms.col}>
            <div style={{ opacity: 0.6 }}>
              <TextRow
                label="First Name"
                value={form.fname ?? ""}
                disabled={true}
                onChange={(v) => setField("fname", v)}
              />
              <TextRow
                label="Last Name"
                value={form.lname ?? ""}
                disabled={true}
                onChange={(v) => setField("lname", v)}
              />
              <TextRow
                label="Address"
                value={form.address ?? ""}
                disabled={true}
                onChange={(v) => setField("address", v)}
              />
              <TextRow
                label="Address 2"
                value={form.address2 ?? ""}
                disabled={true}
                onChange={(v) => setField("address2", v)}
              />
              <TextRow
                label="City"
                value={form.city ?? ""}
                disabled={true}
                onChange={(v) => setField("city", v)}
              />
              <TextRow
                label="Zip Code"
                value={form.zip ?? ""}
                disabled={true}
                onChange={(v) => setField("zip", v)}
              />

              <div style={{ minWidth: 0 }}>
                <CountryStatePicker
                  editMode={false}
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
            </div>
          </div>

          <div className={forms.col}>
            <div style={{ opacity: 0.6 }}>
              <TextRow
                label="Home Phone"
                value={form.homephone ?? ""}
                disabled={true}
                onChange={(v) => setField("homephone", v)}
              />
              <TextRow
                label="Cell Phone"
                value={form.cellphone ?? ""}
                disabled={true}
                onChange={(v) => setField("cellphone", v)}
              />
              <TextRow
                label="E-Mail"
                value={form.email ?? ""}
                disabled={true}
                onChange={(v) => setField("email", v)}
              />
            </div>

            <SelectRow
              label="Elder Type"
              value={form.eldertypeid?.toString() ?? ""}
              disabled={!isAdmin}
              options={[
                { value: "", label: "Choose an elder type…" },
                ...elderTypes.map((t) => ({
                  value: String(t.id),
                  label: t.name,
                })),
              ]}
              onChange={(v) => {
                const nextElderTypeId = v ? Number(v) : null;
                setField("eldertypeid", nextElderTypeId);
                if (!nextElderTypeId) {
                  setField("emcaccessrole", null);
                  setField("contribaccessrole", null);
                }
              }}
            />
            {isAdmin && (
              <>
                <SelectRow
                  label="EMC Access"
                  value={form.emcaccessrole ?? ""}
                  disabled={!isAdmin || !form.eldertypeid}
                  options={[
                    { value: "", label: "No access" },
                    { value: "emc_admin", label: "Admin" },
                    { value: "emc_superuser", label: "Superuser" },
                    { value: "emc_user", label: "User" },
                  ]}
                  onChange={(v) =>
                    setField("emcaccessrole", v ? (v as MemberDetail["emcaccessrole"]) : null)
                  }
                />
                <SelectRow
                  label="Contribution Access"
                  value={form.contribaccessrole ?? ""}
                  disabled={!isAdmin || !form.eldertypeid}
                  options={[
                    { value: "", label: "No access" },
                    { value: "contrib_admin", label: "Admin" },
                    { value: "contrib_user", label: "User" },
                  ]}
                  onChange={(v) =>
                    setField(
                      "contribaccessrole",
                      v ? (v as MemberDetail["contribaccessrole"]) : null,
                    )
                  }
                />
              </>
            )}

            <div className={forms.actions}>
              <button
                className={forms.button}
                disabled={!dirty || !isAdmin}
                onClick={saveChanges}
                style={{ opacity: !dirty || !isAdmin ? 0.5 : 1 }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && form && (
        <div style={{ marginTop: 28, fontSize: 13, color: "#374151" }}>
          <strong>EMC Access</strong>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            <li>Admin: can view and edit everything.</li>
            <li>Superuser: can view everything.</li>
            <li>User: can only view members in his/her assigned areas.</li>
            <li>No access: no active EMC account role.</li>
          </ul>
          <strong style={{ display: "inline-block", marginTop: 18 }}>Contribution Access</strong>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            <li>Admin: access to everything.</li>
            <li>User: access to specific country/area.</li>
            <li>No access: no active Contribution access.</li>
          </ul>
        </div>
      )}
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
