"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import { fetchCountryAndUSStateLookups } from "@/lib/lookups";
import { CountryStatePicker } from "@/components/CountryStatePicker";
import { BackLink } from "@/components/BackLink";

// ✅ Put this file at: src/styles/forms.module.css (or adjust the import to wherever you place it)
import forms from "@/styles/forms.module.css";
import Link from "next/link";
import type { RoleName, RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";

type MemberOption = {
  id: number;
  fname: string | null;
  lname: string | null;
  statecode: string | null;
  countrycode: string | null;
  householdid: number | null;
  spouseid: number | null;
};

type HouseholdOption = {
  value: number;
  label: string;
  memberIds: number[];
  searchText: string;
};

type LinkedHouseholdOption = {
  value: number;
  label: string;
};

type AreaScope = {
  id: number;
  countrycode: string | null;
  statecode: string | null;
  congregationid: number | null;
};

type MemberDetail = {
  id: number;
  spouseid: number | null;
  householdid: number | null;

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

const MEMBER_DETAIL_SELECT = `
  id,
  spouseid,
  householdid,
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
`;

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

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
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

export default function MembersPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [pageLoading, setPageLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [backHref, setBackHref] = useState("/");
  const [memberSearch, setMemberSearch] = useState("");
  const [searchResults, setSearchResults] = useState<HouseholdOption[]>([]);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [skipMemberSearch, setSkipMemberSearch] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [member, setMember] = useState<MemberDetail | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<MemberDetail | null>(null);
  const [dirty, setDirty] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null); // API errors
  const [validationError, setValidationError] = useState<string | null>(null); // validation
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [linkSuccessModalMsg, setLinkSuccessModalMsg] = useState<string | null>(null);
  const [unlinkSuccessModalMsg, setUnlinkSuccessModalMsg] = useState<string | null>(null);
  const [showSharedContactScopeModal, setShowSharedContactScopeModal] = useState(false);
  const [showHouseholdCongregationModal, setShowHouseholdCongregationModal] = useState(false);
  const [pendingCongregationSaveScope, setPendingCongregationSaveScope] = useState<
    "single" | "both" | null
  >(null);

  const [linkedSpouse, setLinkedSpouse] = useState<MemberDetail | null>(null);
  const [linkedSpouseLoading, setLinkedSpouseLoading] = useState(false);
  const [linkedSpouseError, setLinkedSpouseError] = useState<string | null>(null);
  const [linkedSpouseRefreshKey, setLinkedSpouseRefreshKey] = useState(0);

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
  const memberDetailCacheRef = useRef<Record<number, MemberDetail>>({});
  const canSeeAll = isAdmin || isSuperuser;

  const sortedMemberOptions = useMemo(() => {
    const list = [...memberOptions];
    list.sort((a, b) => displayName(a).localeCompare(displayName(b)));
    return list;
  }, [memberOptions]);

  const householdOptions = useMemo(() => {
    const grouped = new Map<number, MemberOption[]>();
    sortedMemberOptions.forEach((m) => {
      const key = m.householdid ?? m.id;
      const rows = grouped.get(key) ?? [];
      rows.push(m);
      grouped.set(key, rows);
    });

    const list: HouseholdOption[] = [];
    grouped.forEach((members) => {
      const rows = [...members].sort((a, b) => displayName(a).localeCompare(displayName(b)));
      let representative = rows[0];
      const names = rows.map((m) => displayName(m)).filter(Boolean);
      let label = names[0] ?? `#${representative.id}`;

      if (rows.length === 2) {
        const [a, b] = rows;
        const reciprocal = a.spouseid === b.id && b.spouseid === a.id;
        if (reciprocal) {
          const [firstMember, secondMember] = [a, b].sort((x, y) => x.id - y.id);
          representative = firstMember;
          const aLast = (a.lname ?? "").trim();
          const bLast = (b.lname ?? "").trim();
          const firstName = (firstMember.fname ?? "").trim();
          const secondName = (secondMember.fname ?? "").trim();
          if (aLast && bLast && firstName && secondName && aLast.localeCompare(bLast) === 0) {
            label = `${aLast}, ${firstName} & ${secondName}`;
          } else {
            label = `${displayName(firstMember)} & ${displayName(secondMember)}`;
          }
        } else {
          label = `${displayName(a)} (+1 household member)`;
        }
      } else if (rows.length > 2) {
        label = `${displayName(representative)} (+${rows.length - 1} household members)`;
      }

      list.push({
        value: representative.id,
        label,
        memberIds: rows.map((m) => m.id),
        searchText: `${label} ${names.join(" ")}`.toLowerCase(),
      });
    });

    list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
  }, [sortedMemberOptions]);

  const householdOptionValueByMemberId = useMemo(() => {
    const map = new Map<number, number>();
    householdOptions.forEach((row) => {
      row.memberIds.forEach((memberId) => map.set(memberId, row.value));
    });
    return map;
  }, [householdOptions]);

  useEffect(() => {
    if (skipMemberSearch) {
      setSkipMemberSearch(false);
      setSearchResults([]);
      return;
    }
    const term = memberSearch.trim().toLowerCase();
    if (term && term === selectedLabel.trim().toLowerCase()) {
      setSearchResults([]);
      return;
    }
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }
    const results = householdOptions
      .filter((option) => option.searchText.includes(term))
      .slice(0, 50);
    setSearchResults(results);
  }, [householdOptions, memberSearch, skipMemberSearch]);

  const linkableMemberOptions = useMemo(
    () => sortedMemberOptions.filter((row) => row.householdid == null),
    [sortedMemberOptions],
  );
  const linkedHouseholdOptions = useMemo(() => {
    const list: LinkedHouseholdOption[] = [];

    householdOptions.forEach((household) => {
      const members = household.memberIds
        .map((id) => sortedMemberOptions.find((row) => row.id === id))
        .filter((row): row is MemberOption => Boolean(row));
      if (!members.length) return;

      const primary = members.find(
        (member) =>
          member.spouseid != null &&
          members.some((other) => other.id === member.spouseid),
      );
      if (!primary) return;

      list.push({
        value: primary.id,
        label: household.label,
      });
    });

    list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
  }, [householdOptions, sortedMemberOptions]);

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

        const admin = hasAnyRole(roles, ["emc_admin", "admin"]);
        const superuser = hasAnyRole(roles, [
          "emc_superuser",
          "emc_super_user",
          "superuser",
          "super_user",
        ]);
        const allowed = admin || superuser || hasAnyRole(roles, ["emc_user", "user"]);
        if (!allowed) {
          setError("You are logged in, but you do not have access to EMC.");
          return;
        }

        if (!cancelled) setIsAdmin(admin);
        if (!cancelled) setIsSuperuser(superuser);

        const memberOptionsResult = await (async () => {
          let opts: MemberOption[] = [];
          if (admin || superuser) {
            const { data: allMembers, error: allMembersErr } = await supabase
              .from("emcmember")
              .select("id,fname,lname,statecode,countrycode,householdid,spouseid")
              .eq("statusid", 1)
              .order("lname", { ascending: true })
              .order("fname", { ascending: true })
              .limit(2000);

            opts = (allMembers ?? []) as MemberOption[];

            if (opts.length === 0 || allMembersErr) {
              const fallback = await fetch("/api/members/options", {
                method: "GET",
                headers: await getAuthHeaders(),
              });
              if (!fallback.ok) {
                const payload = await fallback.json().catch(() => ({}));
                const fallbackMessage =
                  typeof payload?.error === "string" ? payload.error : "Unknown error";
                if (allMembersErr) {
                  return {
                    opts: [] as MemberOption[],
                    error: `Failed to load members list: ${allMembersErr.message}. Fallback failed: ${fallbackMessage}`,
                  };
                }
                return {
                  opts: [] as MemberOption[],
                  error: `Failed to load members list: ${fallbackMessage}`,
                };
              }
              const payload = await fallback.json().catch(() => ({}));
              opts = Array.isArray(payload?.members)
                ? (payload.members as MemberOption[])
                : [];
            }
            return { opts, error: null as string | null };
          }

          if (!account.memberid) {
            return {
              opts: [] as MemberOption[],
              error: "No member record linked to this account.",
            };
          }

          const { data: areaRows, error: areaErr } = await supabase
            .from("emcelderarea")
            .select("id,countrycode,statecode,congregationid")
            .eq("memberid", account.memberid);

          if (areaErr) {
            return {
              opts: [] as MemberOption[],
              error: `Failed to load elder areas: ${areaErr.message}`,
            };
          }

          const areas = (areaRows ?? []) as AreaScope[];
          if (!areas.length) {
            return { opts: [] as MemberOption[], error: null as string | null };
          }

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

          if (!filters.length) {
            return { opts: [] as MemberOption[], error: null as string | null };
          }

          const { data: scopedMembers, error: scopedErr } = await supabase
            .from("emcmember")
            .select("id,fname,lname,statecode,countrycode,householdid,spouseid")
            .or(filters.join(","))
            .eq("statusid", 1)
            .order("lname", { ascending: true })
            .order("fname", { ascending: true })
            .limit(2000);

          if (scopedErr) {
            return {
              opts: [] as MemberOption[],
              error: `Failed to load members list: ${scopedErr.message}`,
            };
          }
          return {
            opts: (scopedMembers ?? []) as MemberOption[],
            error: null as string | null,
          };
        })();

        if (memberOptionsResult.error) {
          setError(memberOptionsResult.error);
          return;
        }

        const opts = memberOptionsResult.opts;

        if (!cancelled) {
          const list = opts;
          setMemberOptions(list);
          setLinkSuccessModalMsg(null);
          setUnlinkSuccessModalMsg(null);

          const params = new URLSearchParams(window.location.search);
          const pre = params.get("selected");
          const linkedA = Number(params.get("linkedA"));
          const linkedB = Number(params.get("linkedB"));
          const unlinkedA = Number(params.get("unlinkedA"));
          const unlinkedB = Number(params.get("unlinkedB"));
          const returnTo = params.get("returnTo");
          const safeReturnTo =
            returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
              ? returnTo
              : "/";
          setBackHref(safeReturnTo);
          const preId = pre ? Number(pre) : NaN;
          if (
            Number.isFinite(preId) &&
            preId > 0 &&
            list.some((row) => row.id === preId)
          ) {
            setSelectedId(preId);
          } else {
            setSelectedId(null);
          }

          if (Number.isFinite(linkedA) && linkedA > 0 && Number.isFinite(linkedB) && linkedB > 0) {
            const a = list.find((row) => row.id === linkedA);
            const b = list.find((row) => row.id === linkedB);
            if (a && b) {
              setLinkSuccessModalMsg(
                `Spouses ${displayName(a)} and ${displayName(b)} have been successfully linked.`,
              );
              params.delete("linkedA");
              params.delete("linkedB");
              const nextQuery = params.toString();
              window.history.replaceState(
                null,
                "",
                nextQuery ? `/members?${nextQuery}` : "/members",
              );
            }
          }
          if (
            Number.isFinite(unlinkedA) &&
            unlinkedA > 0 &&
            Number.isFinite(unlinkedB) &&
            unlinkedB > 0
          ) {
            const a = list.find((row) => row.id === unlinkedA);
            const b = list.find((row) => row.id === unlinkedB);
            if (a && b) {
              setUnlinkSuccessModalMsg(
                `You have successfully unlinked ${displayName(a)} and ${displayName(b)}.`,
              );
              params.delete("unlinkedA");
              params.delete("unlinkedB");
              const nextQuery = params.toString();
              window.history.replaceState(
                null,
                "",
                nextQuery ? `/members?${nextQuery}` : "/members",
              );
            }
          }
        }

        void (async () => {
          const [lookups, titheStatusResult, statusResult, congregationResult] = await Promise.all([
            fetchCountryAndUSStateLookups(),
            supabase.from("emctithestatus").select("id,name").order("id", { ascending: true }),
            supabase.from("emcstatus").select("id,name").order("id", { ascending: true }),
            supabase.from("emccongregation").select("id,name").order("name", { ascending: true }),
          ]);

          if (cancelled) return;

          if (titheStatusResult.error) {
            setError(`Failed to load tithing statuses: ${titheStatusResult.error.message}`);
            return;
          }
          if (statusResult.error) {
            setError(`Failed to load statuses: ${statusResult.error.message}`);
            return;
          }
          if (congregationResult.error) {
            setError(`Failed to load congregations: ${congregationResult.error.message}`);
            return;
          }

          setCountryNameByCode(lookups.countryNameByCode);
          setUsStateNameByCode(lookups.usStateNameByCode);
          setCanadaStateNameByCode(lookups.canadaStateNameByCode);
          setAustraliaStateNameByCode(lookups.australiaStateNameByCode);
          setCountryOptions(lookups.countryOptions);
          setUsStateOptions(lookups.usStateOptions);
          setCanadaStateOptions(lookups.canadaStateOptions);
          setAustraliaStateOptions(lookups.australiaStateOptions);
          setTitheStatuses((titheStatusResult.data ?? []) as TitheStatus[]);
          setStatuses((statusResult.data ?? []) as Status[]);
          const congregations = congregationResult.data ?? [];
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
        })();
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
    const householdOptionValue = householdOptionValueByMemberId.get(selectedId);
    if (householdOptionValue && householdOptions.some((row) => row.value === householdOptionValue)) {
      return;
    }
    setSelectedId(null);
  }, [householdOptions, householdOptionValueByMemberId, selectedId]);

  useEffect(() => {
    if (selectedId == null) return;
    const match = householdOptions.find(
      (row) => row.value === selectedId || row.memberIds.includes(selectedId),
    );
    if (match) {
      setSelectedLabel(match.label);
      setMemberSearch(match.label);
    }
  }, [householdOptions, selectedId]);

  const fetchMemberDetail = useCallback(async (
    id: number,
    fallbackErrorMessage: string,
  ) => {
    const cached = memberDetailCacheRef.current[id];
    if (cached) {
      return { data: { ...cached } as MemberDetail, error: null as string | null };
    }

    if (canSeeAll) {
      const response = await fetch(`/api/members/detail?memberId=${id}`, {
        method: "GET",
        headers: await getAuthHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          data: null as MemberDetail | null,
          error:
            typeof payload?.error === "string"
              ? payload.error
              : fallbackErrorMessage,
        };
      }
      const member = (payload?.member ?? null) as MemberDetail | null;
      if (member) {
        memberDetailCacheRef.current[id] = member;
      }
      return { data: member, error: null as string | null };
    }

    const { data, error } = await supabase
      .from("emcmember")
      .select(MEMBER_DETAIL_SELECT)
      .eq("id", id)
      .single();
    if (error) {
      return {
        data: null as MemberDetail | null,
        error: error.message,
      };
    }
    const member = (data ?? null) as MemberDetail | null;
    if (member) {
      memberDetailCacheRef.current[id] = member;
    }
    return { data: member, error: null as string | null };
  }, [canSeeAll, supabase]);

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
        const result = await fetchMemberDetail(id, "Failed to load member details.");
        const detailRow = result.data;
        const detailErr = result.error;

        if (detailErr || !detailRow) {
          setDetailError(detailErr ?? "Failed to load member details.");
          return;
        }

        if (!cancelled) {
          const d = detailRow;

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
  }, [canSeeAll, fetchMemberDetail, memberOptions, selectedId, supabase, titheStatuses, statuses]);

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

  async function saveChanges(
    scope: "ask" | "single" | "both" = "ask",
    confirmedHouseholdCongregation = false,
  ) {
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
    const linkedSpouseId = member?.spouseid ?? null;
    const householdMemberIds = Array.from(
      new Set(selectedHouseholdMembers.map((row) => row.id)),
    );
    const congregationChanged = form.congregationid !== member?.congregationid;
    const shouldConfirmHouseholdCongregation =
      householdMemberIds.length > 1 && congregationChanged && !confirmedHouseholdCongregation;

    const sharedFieldsChanged =
      normalizeText(form.address) !== normalizeText(member?.address) ||
      normalizeText(form.address2) !== normalizeText(member?.address2) ||
      normalizeText(form.city) !== normalizeText(member?.city) ||
      normalizeText(form.zip) !== normalizeText(member?.zip) ||
      normalizeCode(form.countrycode) !== normalizeCode(member?.countrycode) ||
      normalizeCode(form.statecode) !== normalizeCode(member?.statecode) ||
      normalizeText(form.homephone) !== normalizeText(member?.homephone);

    if (
      scope === "ask" &&
      linkedSpouseId != null &&
      sharedFieldsChanged
    ) {
      setShowSharedContactScopeModal(true);
      return;
    }
    if (shouldConfirmHouseholdCongregation) {
      setPendingCongregationSaveScope(scope === "ask" ? "single" : scope);
      setShowHouseholdCongregationModal(true);
      return;
    }

    const { error } = await supabase
      .from("emcmember")
      .update(payload)
      .eq("id", form.id);

    if (error) {
      setDetailError(error.message);
      return;
    }

    if (householdMemberIds.length > 1 && congregationChanged) {
      const householdUpdate = await supabase
        .from("emcmember")
        .update({
          congregationid: form.congregationid,
          dateupdated: new Date().toISOString(),
        })
        .in("id", householdMemberIds);
      if (householdUpdate.error) {
        setDetailError(householdUpdate.error.message);
        return;
      }
      householdMemberIds.forEach((memberId) => {
        delete memberDetailCacheRef.current[memberId];
      });
      setLinkedSpouseRefreshKey((prev) => prev + 1);
    }

    if (scope === "both" && linkedSpouseId != null) {
      const sharedPayload = {
        address: form.address,
        address2: form.address2,
        city: form.city,
        zip: form.zip,
        countrycode: cc,
        statecode: form.statecode ? form.statecode.trim().toUpperCase() : null,
        homephone: form.homephone,
        dateupdated: new Date().toISOString(),
      };
      const spouseUpdate = await supabase
        .from("emcmember")
        .update(sharedPayload)
        .eq("id", linkedSpouseId);
      if (spouseUpdate.error) {
        setDetailError(spouseUpdate.error.message);
        return;
      }
      delete memberDetailCacheRef.current[linkedSpouseId];
      setLinkedSpouseRefreshKey((prev) => prev + 1);
    }
    delete memberDetailCacheRef.current[form.id];

    setSaveMsg("Saved.");
    setShowSharedContactScopeModal(false);
    setShowHouseholdCongregationModal(false);
    setPendingCongregationSaveScope(null);
    setDirty(false);
    setEditMode(false);

    // refresh the detail row from DB
    setSelectedId(form.id);
  }

  const selectedHouseholdValue = selectedId
    ? (householdOptionValueByMemberId.get(selectedId) ?? selectedId)
    : null;
  const selectedHousehold = selectedHouseholdValue
    ? (householdOptions.find((row) => row.value === selectedHouseholdValue) ?? null)
    : null;
  const selectedHouseholdMembers = (selectedHousehold?.memberIds ?? [])
    .map((id) => sortedMemberOptions.find((row) => row.id === id))
    .filter((row): row is MemberOption => Boolean(row))
    .sort((a, b) => a.id - b.id);
  const selectedSpouseId =
    selectedHouseholdMembers.length > 1 && selectedId
      ? ((selectedHouseholdMembers.find((row) => row.id !== selectedId)?.id) ?? null)
      : null;

  useEffect(() => {
    let cancelled = false;

    async function loadLinkedSpouse(memberId: number) {
      setLinkedSpouseLoading(true);
      setLinkedSpouseError(null);
      try {
        const result = await fetchMemberDetail(
          memberId,
          "Failed to load linked spouse details.",
        );
        if (cancelled) return;
        const detailRow = result.data;
        const detailErr = result.error;
        if (detailErr || !detailRow) {
          setLinkedSpouseError(detailErr ?? "Failed to load linked spouse details.");
          setLinkedSpouse(null);
          return;
        }
        setLinkedSpouse(detailRow);
      } finally {
        if (!cancelled) setLinkedSpouseLoading(false);
      }
    }

    if (!selectedSpouseId) {
      setLinkedSpouse(null);
      setLinkedSpouseError(null);
      setLinkedSpouseLoading(false);
      return;
    }

    loadLinkedSpouse(selectedSpouseId);
    return () => {
      cancelled = true;
    };
  }, [canSeeAll, fetchMemberDetail, linkedSpouseRefreshKey, selectedSpouseId, supabase]);

  if (pageLoading) {
    return <main className={`${forms.page} ${forms.compactPage}`}>Loading…</main>;
  }

  if (error) {
    return (
      <main className={`${forms.page} ${forms.compactPage}`}>
        <h1 className={forms.title}>Contacts</h1>
        <p style={{ color: "crimson" }}>{error}</p>
        <div style={{ marginTop: 12 }}>
          <BackLink fallbackHref={backHref} className={`${forms.linkButton} ${forms.linkButtonLight}`}>
            ← Back
          </BackLink>
        </div>
      </main>
    );
  }

  return (
    <main className={`${forms.page} ${forms.compactPage}`}>
      <h1 className={forms.title}>Contacts</h1>

      <div className={forms.topGroup} style={{ marginBottom: 22 }}>
        <BackLink fallbackHref={backHref} className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          ← Back
        </BackLink>
        <Link href="/members/search-by-location" className={forms.linkButton}>
          Search by State/Country
        </Link>
      </div>

      {/* top bar */}
      <div className={forms.topBar} style={{ marginTop: 24, justifyContent: "flex-start", flexWrap: "wrap", rowGap: 8 }}>
          <div className={forms.topGroup} style={{ marginBottom: 12, alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label htmlFor="memberSelect" className={forms.topLabel}>
            Select Contact:
          </label>

          <div
            className={forms.autocompleteWrap}
            style={{
              minWidth: 240,
              maxWidth: 420,
              width: "100%",
            }}
          >
            <input
              id="memberSelect"
              type="search"
              className={forms.field}
              placeholder="Type at least 2 letters to search contacts"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
            {memberSearch.trim().length >= 2 ? (
              searchResults.length ? (
                <div className={forms.autocompleteMenu} role="listbox" aria-label="Matching contacts">
                  {searchResults.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={forms.autocompleteOption}
                      onClick={() => {
                        setSelectedId(option.value);
                        setSelectedLabel(option.label);
                        setMemberSearch(option.label);
                        setSearchResults([]);
                        setSkipMemberSearch(true);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : memberSearch.trim() !== selectedLabel.trim() ? (
                <p style={{ margin: 4, color: "#6b7280" }}>No matches.</p>
              ) : null
            ) : null}
          </div>
          {selectedHouseholdMembers.length > 1 && (
            <>
              <label htmlFor="householdRecordSelect" className={forms.topLabel}>
                Spouse:
              </label>
              <select
                id="householdRecordSelect"
                value={selectedId ?? ""}
                onChange={(e) =>
                  setSelectedId(e.target.value ? Number(e.target.value) : null)
                }
                className={forms.selectContact}
              >
                {selectedHouseholdMembers.map((m) => (
                  <option key={`household-member-${m.id}`} value={m.id}>
                    {displayName(m)}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            type="button"
            className={forms.button}
            style={{ marginLeft: 8 }}
            onClick={() => setBrowseAll((prev) => !prev)}
          >
            {browseAll ? "Hide all contacts" : "Browse all contacts"}
          </button>

          {browseAll ? (
            <div
              style={{
                marginTop: 10,
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                maxHeight: 280,
                overflow: "auto",
                padding: 6,
                minWidth: 320,
              }}
            >
              {householdOptions.map((option) => (
                <button
                  key={`browse-${option.value}`}
                  type="button"
                  className={forms.autocompleteOption}
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => {
                    setSelectedId(option.value);
                    const label = option.label;
                    setSelectedLabel(label);
                    setMemberSearch(label);
                    setSearchResults([]);
                    setSkipMemberSearch(true);
                    setBrowseAll(false);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <hr className={forms.hr} />

      {/* actions row (admin only) */}
      {isAdmin && (
        <div className={forms.actions}>
          <div className={forms.actionsRow} style={{ width: "100%", marginBottom: 6 }}>
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
              onClick={() => saveChanges()}
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

      {!detailLoading && !form && !detailError && (
        <p>Select a contact to view details.</p>
      )}

      {selectedSpouseId && (
        <section className={forms.sectionCard} style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Linked spouse record</h2>
          {linkedSpouseLoading ? <p>Loading spouse record...</p> : null}
          {linkedSpouseError ? <p className={forms.error}>{linkedSpouseError}</p> : null}
          {linkedSpouse ? (
            <div className={forms.formGrid}>
              <div className={forms.col} style={{ alignContent: "start" }}>
                <div><strong>Name:</strong> {displayName(linkedSpouse)}</div>
                <div><strong>Email:</strong> {linkedSpouse.email ?? ""}</div>
                {String(linkedSpouse.cellphone ?? "").trim() ? (
                  <div><strong>Cell phone:</strong> {linkedSpouse.cellphone ?? ""}</div>
                ) : null}
                <div><strong>Baptized:</strong> {linkedSpouse.baptized ? "Yes" : "No"}</div>
                <div>
                  <strong>Fellowship status:</strong>{" "}
                  {statuses.find((s) => s.id === linkedSpouse.statusid)?.name ?? ""}
                </div>
                <div>
                  <strong>Tithing status:</strong>{" "}
                  {titheStatuses.find((s) => s.id === linkedSpouse.tithestatusid)?.name ?? ""}
                </div>
              </div>
              <div className={forms.col} style={{ alignContent: "start" }}>
                <div>
                  <strong>Address:</strong>
                  <div style={{ marginTop: 2 }}>
                    {(() => {
                      const cc = String(linkedSpouse.countrycode ?? "")
                        .trim()
                        .toUpperCase();
                      const sc = String(linkedSpouse.statecode ?? "")
                        .trim()
                        .toUpperCase();
                      const countryLabel = cc ? (countryNameByCode[cc] ?? cc) : "";
                      const stateLabel = sc
                        ? cc === "US"
                          ? (usStateNameByCode[sc] ?? sc)
                          : cc === "CA"
                            ? (canadaStateNameByCode[sc] ?? sc)
                            : cc === "AU"
                              ? (australiaStateNameByCode[sc] ?? sc)
                              : sc
                        : "";
                      const line1 = String(linkedSpouse.address ?? "").trim();
                      const line2 = String(linkedSpouse.address2 ?? "").trim();
                      const line3 = [
                        linkedSpouse.city,
                        stateLabel,
                        linkedSpouse.zip,
                        countryLabel,
                      ]
                        .map((v) => String(v ?? "").trim())
                        .filter(Boolean)
                        .join(", ");

                      return (
                        <>
                          <div>{line1}</div>
                          {line2 ? <div>{line2}</div> : null}
                          {line3 ? <div>{line3}</div> : null}
                        </>
                      );
                    })()}
                  </div>
                </div>
                {String(linkedSpouse.homephone ?? "").trim() ? (
                  <div><strong>Home phone:</strong> {linkedSpouse.homephone ?? ""}</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
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

      {linkSuccessModalMsg && (
        <div className={forms.modalBackdrop} role="dialog" aria-modal="true">
          <div className={forms.modalCard}>
            <h2 className={forms.modalTitle}>Spouses Linked</h2>
            <p className={forms.modalText}>{linkSuccessModalMsg}</p>
            <div className={forms.modalActions} style={{ marginTop: 10 }}>
              <button
                type="button"
                className={forms.button}
                onClick={() => setLinkSuccessModalMsg(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {unlinkSuccessModalMsg && (
        <div className={forms.modalBackdrop} role="dialog" aria-modal="true">
          <div className={forms.modalCard}>
            <h2 className={forms.modalTitle}>Spouses Unlinked</h2>
            <p className={forms.modalText}>{unlinkSuccessModalMsg}</p>
            <div className={forms.modalActions} style={{ marginTop: 10 }}>
              <button
                type="button"
                className={forms.button}
                onClick={() => setUnlinkSuccessModalMsg(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {showSharedContactScopeModal && (
        <div className={forms.modalBackdrop} role="dialog" aria-modal="true">
          <div className={forms.modalCard}>
            <h2 className={forms.modalTitle}>Shared Contact Info</h2>
            <p className={forms.modalText}>
              Do you want to change this contact information only for this specific member or for both spouses?
            </p>
            <div className={forms.modalActions} style={{ marginTop: 10 }}>
              <button
                type="button"
                className={`${forms.button} ${forms.linkButtonLight}`}
                onClick={() => {
                  setShowSharedContactScopeModal(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${forms.button} ${forms.linkButtonLight}`}
                onClick={() => saveChanges("single")}
              >
                This member only
              </button>
              <button
                type="button"
                className={forms.button}
                onClick={() => saveChanges("both")}
              >
                Both spouses
              </button>
            </div>
          </div>
        </div>
      )}

      {showHouseholdCongregationModal && (
        <div className={forms.modalBackdrop} role="dialog" aria-modal="true">
          <div className={forms.modalCard}>
            <h2 className={forms.modalTitle}>Update Household Congregation</h2>
            <p className={forms.modalText}>
              You are changing the congregation of the entire household. Are you sure you want to proceed?
            </p>
            <div className={forms.modalActions} style={{ marginTop: 10 }}>
              <button
                type="button"
                className={`${forms.button} ${forms.buttonLight}`}
                onClick={() => {
                  setShowHouseholdCongregationModal(false);
                  setPendingCongregationSaveScope(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={forms.button}
                onClick={() => {
                  void saveChanges(pendingCongregationSaveScope ?? "single", true);
                }}
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && (
        <section style={{ marginTop: 28 }}>
          <h3 style={{ margin: "0 0 10px" }}>Administration</h3>
          <div className={forms.actions} style={{ flexWrap: "wrap", gap: 8 }}>
            <Link
              href="/members/not-in-fellowship"
              className={`${forms.linkButton} ${forms.linkButtonWarn}`}
            >
              Members not in fellowship
            </Link>
            <Link href="/members/new" className={forms.linkButton}>
              Add New Contact
            </Link>
            <button
              type="button"
              className={forms.button}
              disabled={linkableMemberOptions.length < 2}
              onClick={() => {
                const params = new URLSearchParams({ returnTo: "/members" });
                if (selectedId) params.set("selected", String(selectedId));
                router.push(`/members/link-spouses?${params.toString()}`);
              }}
            >
              Link spouses
            </button>
            <button
              type="button"
              className={forms.button}
              disabled={linkedHouseholdOptions.length === 0}
              onClick={() => {
                const params = new URLSearchParams({ returnTo: "/members" });
                if (selectedId) params.set("selected", String(selectedId));
                const selectedHouseholdId = selectedHouseholdMembers[0]?.householdid ?? null;
                if (selectedHouseholdId) {
                  params.set("household", String(selectedHouseholdId));
                }
                router.push(`/members/unlink-spouses?${params.toString()}`);
              }}
            >
              Unlink spouses
            </button>
          </div>
        </section>
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
        readOnly={disabled}
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
        readOnly={disabled}
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
