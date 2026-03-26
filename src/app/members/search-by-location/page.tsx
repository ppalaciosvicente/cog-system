"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import { fetchCountryAndUSStateLookups } from "@/lib/lookups";
import { buildHouseholdOptions } from "@/lib/households";
import { BackLink } from "@/components/BackLink";
import forms from "@/styles/forms.module.css";
import type { RoleName, RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";


type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  address: string | null;
  address2: string | null;
  city: string | null;
  zip: string | null;
  statecode: string | null;
  countrycode: string | null;
  congregationid: number | null;
  homephone: string | null;
  cellphone: string | null;
  email: string | null;
  baptized: boolean | null;
  householdid: number | null;
  spouseid: number | null;
  tithestatusid: number | null;
  emctithestatus?:
    | { name: string | null }
    | { name: string | null }[]
    | null;
};

type HouseholdResultRow = {
  value: number;
  label: string;
  members: MemberRow[];
  representative: MemberRow;
};

type AreaScope = {
  id: number;
  countrycode: string | null;
  statecode: string | null;
  congregationid: number | null;
};

function normalizeTitheStatusRelation(
  v?: { name: string | null } | { name: string | null }[] | null,
) {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
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

export default function MembersSearchByLocationPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  const [countryOptions, setCountryOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [allowedCountryCodes, setAllowedCountryCodes] = useState<string[]>([]);
  const [usStateOptions, setUsStateOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [canadaStateOptions, setCanadaStateOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [australiaStateOptions, setAustraliaStateOptions] = useState<
    { value: string; label: string }[]
  >([]);
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

  const [country, setCountry] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null);

  const normalizedCountry = country.trim().toUpperCase();
  const isUS = normalizedCountry === "US";
  const isCA = normalizedCountry === "CA";
  const isAU = normalizedCountry === "AU";
  const usesState = isUS || isCA || isAU;
  const canSeeAll = isAdmin || isSuperuser;

  function joinDistinct(values: (string | null | undefined)[]) {
    return Array.from(
      new Set(
        values
          .map((value) => String(value ?? "").trim())
          .filter(Boolean),
      ),
    ).join(" / ");
  }

  const groupedRows = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return buildHouseholdOptions(rows)
      .map((option): HouseholdResultRow | null => {
        const members = option.memberIds
          .map((id) => byId.get(id))
          .filter((row): row is MemberRow => Boolean(row));
        if (!members.length) return null;
        return {
          value: option.value,
          label: option.label,
          members,
          representative: byId.get(option.value) ?? members[0],
        };
      })
      .filter((row): row is HouseholdResultRow => Boolean(row));
  }, [rows]);

  function renderGroupedAddresses(members: MemberRow[]) {
    const uniqueAddresses = Array.from(
      new Map(
        members
          .map((member) => {
            const address = String(member.address ?? "").trim();
            const address2 = String(member.address2 ?? "").trim();
            if (!address && !address2) return null;
            return [`${address}__${address2}`, { address, address2 }] as const;
          })
          .filter(Boolean)
          .map((entry) => entry as readonly [string, { address: string; address2: string }]),
      ).values(),
    );

    if (!uniqueAddresses.length) return "";

    return uniqueAddresses.map((entry) => (
      <div key={`${entry.address}-${entry.address2}`}>
        <div>{entry.address}</div>
        {entry.address2 ? <div>{entry.address2}</div> : null}
      </div>
    ));
  }

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

        const admin = hasAnyRole(roles, ["emc_admin", "admin"]);
        const superuser = hasAnyRole(roles, [
          "emc_superuser",
          "emc_super_user",
          "superuser",
          "super_user",
        ]);
        if (!cancelled) setIsAdmin(admin);
        if (!cancelled) setIsSuperuser(superuser);
        const allowed = admin || superuser || hasAnyRole(roles, ["emc_user", "user"]);
        if (!allowed) {
          setError("You are logged in, but you do not have access to EMC.");
          return;
        }

        const lookupsPromise = fetchCountryAndUSStateLookups();
        const areaScopesPromise =
          admin || superuser
            ? Promise.resolve({ data: [] as AreaScope[], error: null as { message: string } | null })
            : (async () => {
                if (!account.memberid) {
                  return { data: [] as AreaScope[], error: { message: "No member record linked to this account." } };
                }
                const { data: areas, error: areaErr } = await supabase
                  .from("emcelderarea")
                  .select("id,countrycode,statecode,congregationid")
                  .eq("memberid", account.memberid);
                return { data: (areas ?? []) as AreaScope[], error: areaErr };
              })();

        const [lookups, areaScopesResult] = await Promise.all([
          lookupsPromise,
          areaScopesPromise,
        ]);

        if (areaScopesResult.error) {
          setError(`Failed to load elder areas: ${areaScopesResult.error.message}`);
          return;
        }

        const areaCountries =
          admin || superuser
            ? []
            : Array.from(
                new Set(
                  (areaScopesResult.data ?? [])
                    .map((area) => String(area.countrycode ?? "").trim().toUpperCase())
                    .filter(Boolean),
                ),
              );
        if (!cancelled && !admin && !superuser) {
          setAllowedCountryCodes(areaCountries);
        }
        if (!cancelled) {
          const filteredCountries =
            admin || superuser
              ? lookups.countryOptions
              : lookups.countryOptions.filter((option) =>
                  areaCountries.length
                    ? areaCountries.includes(option.value.toUpperCase())
                    : false,
                );
          setCountryOptions(filteredCountries);
          setUsStateOptions(lookups.usStateOptions);
          setCanadaStateOptions(lookups.canadaStateOptions);
          setAustraliaStateOptions(lookups.australiaStateOptions);
          setCountryNameByCode(lookups.countryNameByCode);
          setUsStateNameByCode(lookups.usStateNameByCode);
          setCanadaStateNameByCode(lookups.canadaStateNameByCode);
          setAustraliaStateNameByCode(lookups.australiaStateNameByCode);
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
    if (!usesState && stateCode) setStateCode("");
  }, [usesState, stateCode]);

  useEffect(() => {
    if (canSeeAll) return;
    if (!country) return;
    const current = country.trim().toUpperCase();
    const allowed = countryOptions.some(
      (option) => option.value.trim().toUpperCase() === current,
    );
    if (!allowed) {
      setCountry("");
    }
  }, [canSeeAll, country, countryOptions]);

  const resultsLabel = useMemo(() => {
    if (!country) return "";
    const cc = country.trim().toUpperCase();
    const countryUsesState = cc === "US" || cc === "CA" || cc === "AU";
    const countryIsUS = cc === "US";
    const countryIsCA = cc === "CA";
    const countryIsAU = cc === "AU";
    const countryLabel = countryNameByCode[cc] ?? cc;
    if (!countryUsesState) return countryLabel;
    const sc = stateCode.trim().toUpperCase();
    const stateLabel = sc
      ? countryIsUS
        ? usStateNameByCode[sc] ?? sc
        : countryIsCA
          ? canadaStateNameByCode[sc] ?? sc
          : australiaStateNameByCode[sc] ?? sc
      : countryIsCA
        ? "All provinces"
        : countryIsAU
          ? "All states"
        : "All states";
    return `${countryLabel} — ${stateLabel}`;
  }, [
    country,
    countryNameByCode,
    stateCode,
    usStateNameByCode,
    canadaStateNameByCode,
    australiaStateNameByCode,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function runSearch() {
      setFormError(null);
      setSelectionWarning(null);

      const cc = country.trim().toUpperCase();
      const countryUsesState = cc === "US" || cc === "CA" || cc === "AU";
      const countryIsCA = cc === "CA";
      const countryIsAU = cc === "AU";
      if (!cc) {
        setRows([]);
        return;
      }

      const sc = stateCode.trim().toUpperCase();
      if (countryUsesState && !sc) {
        setSelectionWarning(
          countryIsCA
            ? "Please choose a province for Canada."
            : countryIsAU
              ? "Please choose a state for Australia."
              : "Please choose a state for the US.",
        );
        setRows([]);
        return;
      }

      setLoading(true);
      try {
        const params = new URLSearchParams({ country: cc });
        if (countryUsesState && sc) params.set("state", sc);
        const response = await fetch(
          `/api/members/search-by-location?${params.toString()}`,
          {
            method: "GET",
            headers: await getAuthHeaders(),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setFormError(
            typeof payload?.error === "string"
              ? payload.error
              : "Failed to load members.",
          );
          setRows([]);
          return;
        }
        if (cancelled) return;
        const list = (Array.isArray(payload?.members) ? payload.members : []).map(
          (row: MemberRow) => ({
            ...row,
            emctithestatus: normalizeTitheStatusRelation(row.emctithestatus),
          }),
        );
        setRows(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    runSearch();
    return () => {
      cancelled = true;
    };
  }, [country, stateCode, supabase]);

  if (pageLoading) {
    return <main className={forms.page}>Loading…</main>;
  }

  if (error) {
    return (
      <main className={forms.page}>
        <h1 className={forms.h1}>Search by State/Country</h1>
        <p style={{ color: "crimson" }}>{error}</p>
        <div className={forms.backRow}>
          <BackLink fallbackHref="/members" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
            ← Back to members
          </BackLink>
        </div>
      </main>
    );
  }

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>Search by State/Country</h1>
      <div className={forms.backRow}>
        <BackLink fallbackHref="/members" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          ← Back to members
        </BackLink>
      </div>

      <div className={forms.actions}>
        <label>
          Country:
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={forms.field}
          >
            <option value="">Choose a country…</option>
            {countryOptions.map((o) => (
              <option key={o.value || "(blank)"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {usesState && (
          <label>
            {isCA ? "Province:" : "State:"}
            <select
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              className={forms.field}
            >
              <option value="">
                {isCA ? "Choose a province…" : "Choose a state…"}
              </option>
              {(isCA ? canadaStateOptions : isAU ? australiaStateOptions : usStateOptions).map((o) => (
                <option key={o.value || "(blank)"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!canSeeAll ? (
        <p style={{ marginTop: 8, fontStyle: "italic", fontSize: 13, color: "#6b7280" }}>
          Only members in your areas of responsibility are shown.
        </p>
      ) : null}

      {formError && <div className={forms.error}>{formError}</div>}
      {selectionWarning && (
        <div className={forms.error}>{selectionWarning}</div>
      )}

      {resultsLabel && !selectionWarning && (
        <div style={{ marginTop: 16 }}>
          Results for: <strong>{resultsLabel}</strong>
        </div>
      )}

      {groupedRows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontStyle: "italic", fontSize: 13, marginBottom: 6 }}>
            Tip: scroll horizontally to see all columns →
          </div>
          <div style={{ position: "relative" }}>
            <div className={forms.tableWrap}>
              <table className={forms.table}>
                <thead>
                  <tr>
                    <th className={forms.th}>Name</th>
                    <th className={forms.th}>Address</th>
                    <th className={forms.th}>City</th>
                    <th className={forms.th}>Zip</th>
                    <th className={forms.th}>State</th>
                    <th className={forms.th}>Country</th>
                    <th className={forms.th}>Home Phone</th>
                    <th className={forms.th}>Cell Phone</th>
                    <th className={forms.th}>Email</th>
                    <th className={forms.th}>Baptized</th>
                    <th className={forms.th}>Tithing Status</th>
                    <th className={forms.th}>View</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.map((group) => {
                    return (
                      <tr key={group.value}>
                        <td className={forms.td}>{group.label}</td>
                        <td className={forms.td}>
                          {renderGroupedAddresses(group.members)}
                        </td>
                        <td className={forms.td}>{joinDistinct(group.members.map((m) => m.city))}</td>
                        <td className={forms.td}>{joinDistinct(group.members.map((m) => m.zip))}</td>
                        <td className={forms.td}>
                          {joinDistinct(
                            group.members.map((m) => {
                              const cc = (m.countrycode ?? "").trim().toUpperCase();
                              const sc = (m.statecode ?? "").trim().toUpperCase();
                              if (!sc) return "";
                              return cc === "CA"
                                ? canadaStateNameByCode[sc] ?? sc
                                : cc === "AU"
                                  ? australiaStateNameByCode[sc] ?? sc
                                  : usStateNameByCode[sc] ?? sc;
                            }),
                          )}
                        </td>
                        <td className={forms.td}>
                          {joinDistinct(
                            group.members.map((m) => {
                              const cc = (m.countrycode ?? "").trim().toUpperCase();
                              return cc ? countryNameByCode[cc] ?? cc : "";
                            }),
                          )}
                        </td>
                        <td className={forms.td}>{joinDistinct(group.members.map((m) => m.homephone))}</td>
                        <td className={forms.td}>{joinDistinct(group.members.map((m) => m.cellphone))}</td>
                        <td className={forms.td}>{joinDistinct(group.members.map((m) => m.email))}</td>
                        <td className={forms.td}>
                          {group.members.every((m) => m.baptized) ? "Yes" : group.members.some((m) => m.baptized) ? "Mixed" : "No"}
                        </td>
                        <td className={forms.td}>
                          {joinDistinct(
                            group.members.map(
                              (m) => normalizeTitheStatusRelation(m.emctithestatus)?.name ?? "",
                            ),
                          )}
                        </td>
                        <td className={forms.td}>
                          <Link
                            href={`/members?selected=${group.representative.id}`}
                            className={forms.linkButton}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 24,
                height: "100%",
                pointerEvents: "none",
                borderTopRightRadius: 10,
                borderBottomRightRadius: 10,
                background:
                  "linear-gradient(to right, rgba(255,255,255,0), rgba(255,255,255,0.92))",
              }}
            />
          </div>
        </div>
      )}

      {!loading &&
        resultsLabel &&
        groupedRows.length === 0 &&
        !formError &&
        !selectionWarning && (
        <p style={{ marginTop: 12 }}>No members found.</p>
      )}
    </main>
  );
}
