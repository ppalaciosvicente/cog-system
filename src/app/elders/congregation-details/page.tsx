 "use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import { fetchCountryAndUSStateLookups } from "@/lib/lookups";
import { buildHouseholdOptions } from "@/lib/households";
import { BackLink } from "@/components/BackLink";
import forms from "@/styles/forms.module.css";
import type { RoleName, RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";


type CongregationRow = {
  id: number;
  name: string | null;
  comments: string | null;
};

type ElderAreaRow = {
  emcmember?:
    | {
        id: number;
        fname: string | null;
        lname: string | null;
      }
    | {
        id: number;
        fname: string | null;
        lname: string | null;
      }[]
    | null;
};

type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  email: string | null;
  homephone: string | null;
  cellphone: string | null;
  city: string | null;
  statecode: string | null;
  countrycode: string | null;
  congregationid?: number | null;
  householdid: number | null;
  spouseid: number | null;
};

type MemberOptionRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  city: string | null;
  statecode: string | null;
  countrycode: string | null;
  congregationid: number | null;
  householdid: number | null;
  spouseid: number | null;
};

type HouseholdGroup<T extends MemberRow | MemberOptionRow> = {
  value: number;
  label: string;
  memberIds: number[];
  members: T[];
  representative: T;
};

type LocationRow = {
  statecode: string | null;
  countrycode: string | null;
};

function displayName(m?: { fname: string | null; lname: string | null } | null) {
  if (!m) return "";
  const ln = (m.lname ?? "").trim();
  const fn = (m.fname ?? "").trim();
  if (!ln && !fn) return "";
  if (!ln) return fn;
  if (!fn) return ln;
  return `${ln}, ${fn}`;
}

function displayPhone(m: { cellphone: string | null; homephone: string | null }) {
  return (m.cellphone || m.homephone || "").trim();
}

function joinDistinct(values: (string | null | undefined)[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).join(" / ");
}

function buildMemberGroups<T extends MemberRow | MemberOptionRow>(members: T[]) {
  const byId = new Map(members.map((member) => [member.id, member]));
  return buildHouseholdOptions(members)
    .map((option): HouseholdGroup<T> | null => {
      const groupMembers = option.memberIds
        .map((id) => byId.get(id))
        .filter((member): member is T => Boolean(member));
      if (!groupMembers.length) return null;
      return {
        value: option.value,
        label: option.label,
        memberIds: option.memberIds,
        members: groupMembers,
        representative: byId.get(option.value) ?? groupMembers[0],
      };
    })
    .filter((group): group is HouseholdGroup<T> => Boolean(group));
}

function normalizeCode(code?: string | null) {
  return String(code ?? "")
    .trim()
    .toUpperCase();
}

function normalizeElderMemberRelation(
  m?:
    | {
        id: number;
        fname: string | null;
        lname: string | null;
      }
    | {
        id: number;
        fname: string | null;
        lname: string | null;
      }[]
    | null,
) {
  if (!m) return null;
  return Array.isArray(m) ? (m[0] ?? null) : m;
}

function CongregationDetailsContent() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();

  const [pageLoading, setPageLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canViewMemberDetails, setCanViewMemberDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [congregation, setCongregation] = useState<CongregationRow | null>(null);
  const [responsibleElders, setResponsibleElders] = useState<string[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberOptions, setMemberOptions] = useState<MemberOptionRow[]>([]);
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

  const [addNameFilter, setAddNameFilter] = useState("");
  const [addCountryCode, setAddCountryCode] = useState("");
  const [addStateCode, setAddStateCode] = useState("");
  const [addCityFilter, setAddCityFilter] = useState("");
  const [addSelectedIds, setAddSelectedIds] = useState<number[]>([]);
  const [removeSelectedIds, setRemoveSelectedIds] = useState<number[]>([]);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [addSearchLoading, setAddSearchLoading] = useState(false);
  const [addSearchAttempted, setAddSearchAttempted] = useState(false);
  const [addSearchTruncated, setAddSearchTruncated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const selected = params.get("selected");
  const congregationId = selected ? Number(selected) : NaN;

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setPageLoading(true);
      setError(null);
      setActionError(null);
      setActionMsg(null);

      try {
        if (!Number.isFinite(congregationId) || congregationId <= 0) {
          setError("Missing or invalid congregation id.");
          return;
        }

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
        const superuser = roles.includes("emc_superuser");
        const allowed = admin || superuser || roles.includes("emc_user");
        if (!allowed) {
          setError("You are logged in, but you do not have access to EMC.");
          return;
        }
        if (!cancelled) {
          setIsAdmin(admin);
          setCanViewMemberDetails(admin || superuser);
        }

        const [
          { data: congregationRowRaw, error: congregationErrRaw },
          { data: areaRowsRaw, error: areaErrRaw },
          { data: congregationMembersRaw, error: membersErrRaw },
          lookups,
        ] = await Promise.all([
          supabase
            .from("emccongregation")
            .select("id,name,comments")
            .eq("id", congregationId)
            .maybeSingle(),
          supabase
            .from("emcelderarea")
            .select("emcmember(id,fname,lname)")
            .eq("congregationid", congregationId),
          supabase
            .from("emcmember")
            .select(
              "id,fname,lname,email,homephone,cellphone,city,statecode,countrycode,congregationid,householdid,spouseid",
            )
            .eq("congregationid", congregationId)
            .eq("statusid", 1)
            .order("lname", { ascending: true })
            .order("fname", { ascending: true }),
          fetchCountryAndUSStateLookups(),
        ]);

        let congregationRow = congregationRowRaw as CongregationRow | null;
        let areaRows = (areaRowsRaw ?? []) as ElderAreaRow[];
        let congregationMembers = (congregationMembersRaw ?? []) as MemberRow[];
        let loadErr =
          congregationErrRaw?.message ??
          areaErrRaw?.message ??
          membersErrRaw?.message ??
          null;

        if ((admin || superuser) && (loadErr || !congregationRow)) {
          const response = await fetch(
            `/api/elders/congregations/detail?selected=${congregationId}`,
            {
              method: "GET",
              headers: await getAuthHeaders(),
              credentials: "same-origin",
            },
          );
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
            congregation?: CongregationRow;
            areaRows?: ElderAreaRow[];
            members?: MemberRow[];
          };
          if (!response.ok) {
            setError(payload.error ?? "Failed to load congregation details.");
            return;
          }
          congregationRow = payload.congregation ?? null;
          areaRows = Array.isArray(payload.areaRows) ? payload.areaRows : [];
          congregationMembers = Array.isArray(payload.members) ? payload.members : [];
          loadErr = null;
        }

        if (loadErr) {
          if (congregationErrRaw) {
            setError(`Failed to load congregation: ${congregationErrRaw.message}`);
          } else if (areaErrRaw) {
            setError(`Failed to load responsible elders: ${areaErrRaw.message}`);
          } else if (membersErrRaw) {
            setError(`Failed to load congregation members: ${membersErrRaw.message}`);
          } else {
            setError("Failed to load congregation details.");
          }
          return;
        }
        if (!congregationRow) {
          setError("Congregation not found.");
          return;
        }

        if (!cancelled) {
          setCongregation(congregationRow);

          const elders = Array.from(
            new Set(
              areaRows
                .map((row) => displayName(normalizeElderMemberRelation(row.emcmember)))
                .filter(Boolean),
            ),
          ).sort((a, b) => a.localeCompare(b));
          setResponsibleElders(elders);

          setMembers(congregationMembers);
          setMemberOptions([]);
          setCountryNameByCode(lookups.countryNameByCode);
          setUsStateNameByCode(lookups.usStateNameByCode);
          setCanadaStateNameByCode(lookups.canadaStateNameByCode);
          setAustraliaStateNameByCode(lookups.australiaStateNameByCode);
          setAddNameFilter("");
          setAddCountryCode("");
          setAddStateCode("");
          setAddCityFilter("");
          setAddSelectedIds([]);
          setAddSearchAttempted(false);
          setAddSearchTruncated(false);
          setRemoveSelectedIds([]);
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [congregationId, reloadKey, router, supabase]);

  const sortedMembers = useMemo(() => {
    const list = [...members];
    list.sort((a, b) => displayName(a).localeCompare(displayName(b)));
    return list;
  }, [members]);

  const sortedMemberGroups = useMemo(() => buildMemberGroups(sortedMembers), [sortedMembers]);

  const allCurrentMembersSelected =
    sortedMembers.length > 0 &&
    sortedMembers.every((m) => removeSelectedIds.includes(m.id));

  function toggleRemoveSelectedGroup(memberIds: number[]) {
    const allSelected = memberIds.every((memberId) => removeSelectedIds.includes(memberId));
    if (allSelected) {
      setRemoveSelectedIds((prev) => prev.filter((id) => !memberIds.includes(id)));
      return;
    }
    setRemoveSelectedIds((prev) => Array.from(new Set([...prev, ...memberIds])));
  }

  function toggleSelectAllCurrentMembers(checked: boolean) {
    const visibleIds = sortedMembers.map((m) => m.id);
    if (checked) {
      setRemoveSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
      return;
    }
    setRemoveSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
  }

  const addOptions = useMemo(() => {
    const list = memberOptions.filter((m) => m.congregationid !== congregationId);
    list.sort((a, b) => displayName(a).localeCompare(displayName(b)));
    return list;
  }, [memberOptions, congregationId]);

  const addGroups = useMemo(() => buildMemberGroups(addOptions), [addOptions]);

  function displayStateName(m: LocationRow) {
    const cc = normalizeCode(m.countrycode);
    const sc = normalizeCode(m.statecode);
    if (!sc) return "";
    if (cc === "CA") return canadaStateNameByCode[sc] ?? sc;
    if (cc === "AU") return australiaStateNameByCode[sc] ?? sc;
    if (cc === "US") return usStateNameByCode[sc] ?? sc;
    return sc;
  }

  function displayCountryName(m: LocationRow) {
    const cc = normalizeCode(m.countrycode);
    if (!cc) return "";
    return countryNameByCode[cc] ?? cc;
  }

  const addCountryOptions = useMemo(() => {
    return Object.entries(countryNameByCode)
      .map(([code, label]) => ({
        value: code,
        label,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [countryNameByCode]);

  const addStateOptions = useMemo(() => {
    if (!addCountryCode) return [];

    const source =
      addCountryCode === "CA"
        ? canadaStateNameByCode
        : addCountryCode === "AU"
          ? australiaStateNameByCode
          : addCountryCode === "US"
            ? usStateNameByCode
            : null;

    if (!source) return [];

    return Object.entries(source)
      .map((code) => ({
        value: code[0],
        label: code[1],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [addCountryCode, australiaStateNameByCode, canadaStateNameByCode, usStateNameByCode]);

  const filteredAddGroups = useMemo(() => {
    const nameQ = addNameFilter.trim().toLowerCase();
    const cityQ = addCityFilter.trim().toLowerCase();
    return addGroups.filter((group) => {
      const members = group.members;
      if (
        addCountryCode &&
        !members.some((m) => normalizeCode(m.countrycode) === addCountryCode)
      ) {
        return false;
      }
      if (
        addStateCode &&
        !members.some((m) => normalizeCode(m.statecode) === addStateCode)
      ) {
        return false;
      }
      if (
        nameQ &&
        !members.some((m) => displayName(m).toLowerCase().includes(nameQ))
      ) {
        return false;
      }
      if (
        cityQ &&
        !members.some((m) => (m.city ?? "").toLowerCase().includes(cityQ))
      ) {
        return false;
      }
      return true;
    });
  }, [addGroups, addCountryCode, addStateCode, addNameFilter, addCityFilter]);

  useEffect(() => {
    if (!showAddMembers || !addSearchAttempted) return;
    setMemberOptions([]);
    setAddSelectedIds([]);
    setAddSearchTruncated(false);
    setAddSearchAttempted(false);
  }, [addCityFilter, addCountryCode, addNameFilter, addStateCode, showAddMembers, addSearchAttempted]);

  const visibleMemberIds = useMemo(
    () => filteredAddGroups.flatMap((g) => g.memberIds),
    [filteredAddGroups],
  );

  const allVisibleSelected =
    visibleMemberIds.length > 0 &&
    visibleMemberIds.every((id) => addSelectedIds.includes(id));

  function toggleAddSelectedGroup(memberIds: number[]) {
    const allSelected = memberIds.every((memberId) => addSelectedIds.includes(memberId));
    if (allSelected) {
      setAddSelectedIds((prev) => prev.filter((id) => !memberIds.includes(id)));
      return;
    }
    setAddSelectedIds((prev) => Array.from(new Set([...prev, ...memberIds])));
  }

  function toggleSelectAllVisible(checked: boolean) {
    if (checked) {
      setAddSelectedIds((prev) =>
        Array.from(new Set([...prev, ...visibleMemberIds])),
      );
      return;
    }
    setAddSelectedIds((prev) => prev.filter((id) => !visibleMemberIds.includes(id)));
  }

  async function handleSearchAddMembers() {
    if (!isAdmin || !Number.isFinite(congregationId) || congregationId <= 0) return;

    const hasFilter =
      Boolean(addNameFilter.trim()) ||
      Boolean(addCityFilter.trim()) ||
      Boolean(addCountryCode) ||
      Boolean(addStateCode);

    setActionError(null);
    setActionMsg(null);
    setAddSearchAttempted(true);
    setAddSearchTruncated(false);

    if (addNameFilter.trim() && addNameFilter.trim().length < 2) {
      setActionError("Enter at least 2 letters to filter by name.");
      setMemberOptions([]);
      setAddSelectedIds([]);
      return;
    }

    if (!hasFilter) {
      setMemberOptions([]);
      setAddSelectedIds([]);
      setActionError("Enter at least one filter before searching.");
      return;
    }

    setAddSearchLoading(true);
    try {
      const searchParams = new URLSearchParams({
        congregationId: String(congregationId),
      });
      if (addNameFilter.trim()) searchParams.set("name", addNameFilter.trim());
      if (addCityFilter.trim()) searchParams.set("city", addCityFilter.trim());
      if (addCountryCode) searchParams.set("countryCode", addCountryCode);
      if (addStateCode) searchParams.set("stateCode", addStateCode);

      const response = await fetch(`/api/elders/congregations/member-search?${searchParams.toString()}`, {
        method: "GET",
        headers: await getAuthHeaders(),
        credentials: "same-origin",
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; members?: MemberOptionRow[]; truncated?: boolean }
        | null;

      if (!response.ok) {
        setActionError(payload?.error ?? "Failed to search members.");
        setMemberOptions([]);
        setAddSelectedIds([]);
        return;
      }

      let nextOptions = Array.isArray(payload?.members) ? payload.members : [];

      // Ensure households are shown: if any result belongs to a household, fetch the rest of that household.
      const householdIds = Array.from(
        new Set(
          nextOptions
            .map((m) => m.householdid)
            .filter((id): id is number => Number.isFinite(id)),
        ),
      );
      if (householdIds.length > 0) {
        const { data: householdMembers, error: hhErr } = await supabase
          .from("emcmember")
          .select(
            "id,fname,lname,email,homephone,cellphone,city,statecode,countrycode,congregationid,householdid,spouseid",
          )
          .in("householdid", householdIds)
          .eq("statusid", 1);
        if (!hhErr && Array.isArray(householdMembers)) {
          const merged = [...nextOptions];
          const existingIds = new Set(merged.map((m) => m.id));
          (householdMembers as MemberOptionRow[]).forEach((m) => {
            if (!existingIds.has(m.id)) merged.push(m);
          });
          nextOptions = merged;
        }
      }

      setMemberOptions(nextOptions);
      setAddSelectedIds((prev) => prev.filter((id) => nextOptions.some((m) => m.id === id)));
      setAddSearchTruncated(Boolean(payload?.truncated));
      if (nextOptions.length === 0) {
        setActionError("No members match your filters.");
      }
    } finally {
      setAddSearchLoading(false);
    }
  }

  async function handleAddSelectedMembers() {
    if (!isAdmin || !Number.isFinite(congregationId) || congregationId <= 0) return;
    if (addSelectedIds.length === 0) {
      setActionError("Select at least one member to add.");
      setActionMsg(null);
      return;
    }

    setSaving(true);
    setActionError(null);
    setActionMsg(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/elders/congregations/members", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          action: "add",
          congregationId,
          memberIds: addSelectedIds,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = payload?.error ?? "Failed to add member(s).";
        setActionError(message);
        return;
      }

      const payload = await response.json().catch(() => null);
      setActionMsg(
        payload?.count
          ? `${payload.count} member(s) added to congregation.`
          : `${addSelectedIds.length} member(s) added to congregation.`,
      );
      setAddSelectedIds([]);
      setReloadKey((v) => v + 1);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveSelectedMembers() {
    if (!isAdmin) return;
    if (removeSelectedIds.length === 0) {
      setActionError("Select at least one member to remove.");
      setActionMsg(null);
      return;
    }

    const selectedNames = sortedMembers
      .filter((m) => removeSelectedIds.includes(m.id))
      .slice(0, 5)
      .map((m) => displayName(m))
      .filter(Boolean);

    const preview = selectedNames.length > 0 ? `\n\n${selectedNames.join("\n")}` : "";
    const suffix = removeSelectedIds.length > 5 ? "\n..." : "";
    const ok = window.confirm(
      `Remove ${removeSelectedIds.length} member(s) from this congregation?${preview}${suffix}`,
    );
    if (!ok) return;

    setSaving(true);
    setActionError(null);
    setActionMsg(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/elders/congregations/members", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          action: "remove",
          memberIds: removeSelectedIds,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = payload?.error ?? "Failed to remove member(s).";
        setActionError(message);
        return;
      }

      const payload = await response.json().catch(() => null);
      setActionMsg(
        payload?.count
          ? `${payload.count} member(s) removed from congregation.`
          : `${removeSelectedIds.length} member(s) removed from congregation.`,
      );
      setRemoveSelectedIds([]);
      setReloadKey((v) => v + 1);
    } finally {
      setSaving(false);
    }
  }

  if (pageLoading) {
    return <main className={forms.page}>Loading…</main>;
  }

  if (error) {
    return (
      <main className={forms.page}>
        <h1 className={forms.h1}>Congregation Details</h1>
        <div className={forms.backRow}>
          <BackLink fallbackHref="/elders/congregations" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
            &lt;- Back to Congregations
          </BackLink>
        </div>
        <p style={{ color: "crimson" }}>{error}</p>
      </main>
    );
  }

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>Congregation Details</h1>
      <div className={forms.backRow}>
        <BackLink fallbackHref="/elders/congregations" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          &lt;- Back to Congregations
        </BackLink>
      </div>

      <p>
        <strong>Congregation:</strong> {(congregation?.name ?? "").trim()}
      </p>
      <p>
        <strong>Responsible elder(s):</strong>{" "}
        {responsibleElders.length > 0 ? responsibleElders.join(", ") : "None assigned"}
      </p>

      <h2 style={{ margin: "16px 0 8px", fontSize: 20 }}>Members of this congregation</h2>
      {isAdmin && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={allCurrentMembersSelected}
              onChange={(e) => toggleSelectAllCurrentMembers(e.target.checked)}
              disabled={saving || sortedMemberGroups.length === 0}
            />
            Select all
          </label>
          <button
            className={`${forms.button} ${forms.buttonDanger}`}
            onClick={handleRemoveSelectedMembers}
            disabled={saving || removeSelectedIds.length === 0}
          >
            Remove selected ({removeSelectedIds.length})
          </button>
        </div>
      )}

      <div className={forms.tableWrap} style={{ marginTop: 12, marginBottom: 24 }}>
        <table className={forms.table}>
          <thead>
            <tr>
              {isAdmin && <th className={forms.th}>Select</th>}
              <th className={forms.th}>Name</th>
              <th className={forms.th}>City</th>
              <th className={forms.th}>State</th>
              <th className={forms.th}>Country</th>
              <th className={forms.th}>Email</th>
              <th className={forms.th}>Telephone</th>
            </tr>
          </thead>
          <tbody>
            {sortedMemberGroups.map((group) => (
              <tr key={group.value}>
                {isAdmin && (
                  <td className={forms.td}>
                    <input
                      type="checkbox"
                      checked={group.memberIds.every((memberId) => removeSelectedIds.includes(memberId))}
                      onChange={() => toggleRemoveSelectedGroup(group.memberIds)}
                      disabled={saving}
                    />
                  </td>
                )}
                <td className={forms.td}>
                  <Link
                    href={`/members?selected=${group.representative.id}&returnTo=${encodeURIComponent(
                      `/elders/congregation-details?selected=${congregationId}`,
                    )}`}
                    className={forms.linkButton}
                    style={{ textDecoration: "none" }}
                  >
                    {group.label}
                  </Link>
                </td>
                <td className={forms.td}>{joinDistinct(group.members.map((member) => member.city))}</td>
                <td className={forms.td}>
                  {joinDistinct(group.members.map((member) => displayStateName(member)))}
                </td>
                <td className={forms.td}>
                  {joinDistinct(group.members.map((member) => displayCountryName(member)))}
                </td>
                <td className={forms.td}>{joinDistinct(group.members.map((member) => member.email))}</td>
                <td className={forms.td}>
                  {joinDistinct(group.members.map((member) => displayPhone(member)))}
                </td>
              </tr>
            ))}
            {sortedMemberGroups.length === 0 && (
              <tr>
                <td className={forms.td} colSpan={isAdmin ? 7 : 6}>
                  No members in this congregation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div style={{ marginTop: 16 }}>
          {!showAddMembers ? (
            <button className={forms.button} onClick={() => setShowAddMembers(true)}>
              Add members
            </button>
          ) : (
            <>
              <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Add members</h2>
              <div
                style={{
                  marginTop: 8,
                  border: "1px solid #e2e2e2",
                  borderRadius: 10,
                  padding: 12,
                  background: "#fff",
                }}
              >
                <div className={forms.row} style={{ marginBottom: 8 }}>
                  <label className={forms.label} htmlFor="filter-by-name">
                    Filter by name
                  </label>
                  <div className={forms.control}>
                    <input
                      id="filter-by-name"
                      className={forms.field}
                      placeholder="Enter at least 2 letters to filter by name."
                      value={addNameFilter}
                      onChange={(e) => setAddNameFilter(e.target.value)}
                      disabled={saving || addSearchLoading}
                    />
                  </div>
                </div>

                <div className={forms.row} style={{ marginBottom: 10 }}>
                  <label className={forms.label}>Filter by location</label>
                  <div
                    className={forms.control}
                    style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}
                  >
                    <select
                      className={forms.field}
                      value={addCountryCode}
                      onChange={(e) => {
                        setAddCountryCode(e.target.value);
                        setAddStateCode("");
                      }}
                      disabled={saving || addSearchLoading}
                    >
                      <option value="">All countries</option>
                      {addCountryOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className={forms.field}
                      value={addStateCode}
                      onChange={(e) => setAddStateCode(e.target.value)}
                      disabled={saving || addSearchLoading || !addCountryCode}
                    >
                      <option value="">All states/provinces</option>
                      {addStateOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className={forms.field}
                      placeholder="City"
                      value={addCityFilter}
                      onChange={(e) => setAddCityFilter(e.target.value)}
                      disabled={saving || addSearchLoading}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <button
                    className={forms.button}
                    onClick={handleSearchAddMembers}
                    disabled={saving || addSearchLoading}
                  >
                    {addSearchLoading ? "Searching..." : "Search members"}
                  </button>
                  <span style={{ fontSize: 14, color: actionError ? "#b91c1c" : "#555" }}>
                    {actionError ?? "Enter at least one filter before searching."}
                  </span>
                </div>

                    {addSearchTruncated && (
                  <p style={{ margin: "0 0 8px", color: "#555" }}>
                    Showing the first 100 matches. Refine the filters to narrow the list.
                  </p>
                )}

                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                      disabled={saving || addSearchLoading || filteredAddGroups.length === 0}
                    />
                    Select all
                  </label>
                  <button
                    className={forms.button}
                    onClick={handleAddSelectedMembers}
                    disabled={saving || addSearchLoading || addSelectedIds.length === 0}
                  >
                    Add selected ({addSelectedIds.length})
                  </button>
                </div>

                <div className={forms.tableWrap}>
                  <table className={forms.table}>
                    <thead>
                      <tr>
                        <th className={forms.th}>Select</th>
                        <th className={forms.th}>Name</th>
                        <th className={forms.th}>City</th>
                        <th className={forms.th}>State</th>
                        <th className={forms.th}>Country</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAddGroups.map((group) => (
                        <tr key={group.value}>
                          <td className={forms.td}>
                            <input
                              type="checkbox"
                              checked={group.memberIds.every((memberId) => addSelectedIds.includes(memberId))}
                              onChange={() => toggleAddSelectedGroup(group.memberIds)}
                              disabled={saving || addSearchLoading}
                            />
                          </td>
                          <td className={forms.td}>{group.label}</td>
                          <td className={forms.td}>{joinDistinct(group.members.map((member) => member.city))}</td>
                          <td className={forms.td}>
                            {joinDistinct(group.members.map((member) => displayStateName(member)))}
                          </td>
                          <td className={forms.td}>
                            {joinDistinct(group.members.map((member) => displayCountryName(member)))}
                          </td>
                        </tr>
                      ))}
                      {filteredAddGroups.length === 0 && addSearchAttempted && (
                        <tr>
                          <td className={forms.td} colSpan={5}></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {actionError && !addSearchAttempted && <p className={forms.error}>{actionError}</p>}
          {actionMsg && <p>{actionMsg}</p>}
        </div>
      )}
    </main>
  );
}

export default function CongregationDetailsPage() {
  return (
    <Suspense fallback={<main className={forms.page}>Loading…</main>}>
      <CongregationDetailsContent />
    </Suspense>
  );
}
