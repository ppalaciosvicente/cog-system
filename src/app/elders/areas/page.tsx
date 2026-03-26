"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import { fetchCountryAndUSStateLookups } from "@/lib/lookups";
import { BackLink } from "@/components/BackLink";
import forms from "@/styles/forms.module.css";
import type { RoleName, RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";

type ElderMember = {
  id: number;
  fname: string | null;
  lname: string | null;
  eldertypeid: number | null;
};

type ElderAreaRow = {
  id: number;
  statecode: string | null;
  countrycode: string | null;
  congregationid: number | null;
  emcmember?: ElderMember | ElderMember[] | null;
};

type MemberOption = {
  id: number;
  fname: string | null;
  lname: string | null;
  eldertypeid: number | null;
};

type CongregationRecord = {
  id: number;
  name: string | null;
};

type AssignmentType = "country" | "state" | "congregation";

function displayName(m?: ElderMember | null) {
  if (!m) return "";
  const ln = (m.lname ?? "").trim();
  const fn = (m.fname ?? "").trim();
  if (!ln && !fn) return `#${m.id}`;
  if (!ln) return fn;
  if (!fn) return ln;
  return `${ln}, ${fn}`;
}

function normalizeMemberRelation(
  m?: ElderMember | ElderMember[] | null,
): ElderMember | null {
  if (!m) return null;
  return Array.isArray(m) ? (m[0] ?? null) : m;
}

function displayAreaValue(primary?: string | null) {
  return (primary ?? "").trim();
}

function normalizeCode(code?: string | null) {
  return String(code ?? "")
    .trim()
    .toUpperCase();
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

function assignmentLabel(
  type: AssignmentType,
  {
    countryCode,
    stateCode,
    congregationId,
  }: {
    countryCode: string;
    stateCode: string;
    congregationId: number | null;
  },
  lookups: {
    countryNameByCode: Record<string, string>;
    usStateNameByCode: Record<string, string>;
    canadaStateNameByCode: Record<string, string>;
    australiaStateNameByCode: Record<string, string>;
    congregationNameById: Record<number, string>;
  },
) {
  if (type === "country") {
    return (
      lookups.countryNameByCode[countryCode] ??
      countryCode ??
      ""
    ).trim();
  }
  if (type === "state") {
    return (
      (countryCode === "CA"
        ? lookups.canadaStateNameByCode[stateCode]
        : countryCode === "AU"
          ? lookups.australiaStateNameByCode[stateCode]
        : lookups.usStateNameByCode[stateCode]) ??
      stateCode ??
      ""
    ).trim();
  }
  if (congregationId != null) {
    return (lookups.congregationNameById[congregationId] ?? "").trim();
  }
  return "";
}

export default function EldersAreasPage() {
  const supabase = createClient();
  const router = useRouter();

  const [pageLoading, setPageLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ElderAreaRow[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [congregationNameById, setCongregationNameById] = useState<
    Record<number, string>
  >({});
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
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [congregationOptions, setCongregationOptions] = useState<
    { value: number; label: string }[]
  >([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    memberId: string;
    assignmentType: AssignmentType;
    countryCode: string;
    stateCountryCode: string;
    stateCode: string;
    congregationId: string;
  }>({
    memberId: "",
    assignmentType: "country",
    countryCode: "",
    stateCountryCode: "US",
    stateCode: "",
    congregationId: "",
  });

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

        const admin = hasAnyRole(roles, ["emc_admin", "admin"]);
        const superuser = hasAnyRole(roles, [
          "emc_superuser",
          "emc_super_user",
          "superuser",
          "super_user",
        ]);
        if (!cancelled) setIsAdmin(admin);
        const allowed = admin || superuser || hasAnyRole(roles, ["emc_user", "user"]);
        if (!allowed) {
          setError("You are logged in, but you do not have access to EMC.");
          return;
        }

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

        if (admin) {
          const { data: members, error: memErr } = await supabase
            .from("emcmember")
            .select("id,fname,lname,eldertypeid")
            .not("eldertypeid", "is", null)
            .order("lname", { ascending: true })
            .order("fname", { ascending: true })
            .limit(2000);

          let memberList = (members ?? []) as MemberOption[];
          if (memErr || memberList.length === 0) {
            const fallback = await fetch("/api/elders/members?view=options", {
              method: "GET",
              headers: await getAuthHeaders(),
              credentials: "same-origin",
            });
            const payload = (await fallback.json().catch(() => ({}))) as {
              error?: string;
              members?: MemberOption[];
            };
            if (!fallback.ok) {
              setError(payload.error ?? memErr?.message ?? "Failed to load elders.");
              return;
            }
            memberList = Array.isArray(payload.members) ? payload.members : [];
          }

          if (!cancelled) {
            setMemberOptions(memberList);
          }
        } else if (!cancelled) {
          setMemberOptions([]);
        }

        const { data, error } = await supabase
          .from("emcelderarea")
          .select(
            "id,congregationid,statecode,countrycode,emcmember(id,fname,lname,eldertypeid)",
          )
          .not("emcmember.eldertypeid", "is", null);

        let list = ((data ?? []) as ElderAreaRow[]).map((row) => ({
          ...row,
          emcmember: normalizeMemberRelation(row.emcmember),
        }));
        let rowsErr = error?.message ?? null;

        if ((admin || superuser) && (rowsErr || list.length === 0)) {
          const fallback = await fetch("/api/elders/areas/view", {
            method: "GET",
            headers: await getAuthHeaders(),
            credentials: "same-origin",
          });
          const payload = (await fallback.json().catch(() => ({}))) as {
            error?: string;
            rows?: ElderAreaRow[];
          };
          if (!fallback.ok) {
            rowsErr = payload.error ?? rowsErr ?? "Failed to load assignments.";
            list = [];
          } else {
            rowsErr = null;
            list = (Array.isArray(payload.rows) ? payload.rows : []).map((row) => ({
              ...row,
              emcmember: normalizeMemberRelation(row.emcmember),
            }));
          }
        }

        if (rowsErr) {
          setError(rowsErr);
          return;
        }

        if (!cancelled) {
          list.sort((a, b) =>
            displayName(a.emcmember).localeCompare(displayName(b.emcmember)),
          );
          setRows(list);

          const congregationIds = Array.from(
            new Set(list.map((row) => row.congregationid).filter(Boolean)),
          ) as number[];

          if (congregationIds.length > 0) {
            const { data: congregations, error: congErr } = await supabase
              .from("emccongregation")
              .select("id,name")
              .in("id", congregationIds);

            let congregationRows = (congregations ?? []) as CongregationRecord[];
            if ((admin || superuser) && (congErr || congregationRows.length === 0)) {
              const fallback = await fetch(
                `/api/elders/congregations/view?ids=${congregationIds.join(",")}`,
                {
                  method: "GET",
                  headers: await getAuthHeaders(),
                  credentials: "same-origin",
                },
              );
              const payload = (await fallback.json().catch(() => ({}))) as {
                error?: string;
                congregations?: CongregationRecord[];
              };
              if (!fallback.ok) {
                setError(
                  payload.error ??
                    congErr?.message ??
                    "Failed to load congregations.",
                );
                return;
              }
              congregationRows = Array.isArray(payload.congregations)
                ? payload.congregations
                : [];
            } else if (congErr) {
              setError(`Failed to load congregations: ${congErr.message}`);
              return;
            }

            if (!cancelled) {
              const lookup: Record<number, string> = {};
              congregationRows.forEach((row) => {
                if (row?.id != null) lookup[row.id] = row.name ?? "";
              });
              setCongregationNameById(lookup);
            }
          } else {
            setCongregationNameById({});
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
    let cancelled = false;
    async function loadCongregations() {
      if (!isAdmin) {
        setCongregationOptions([]);
        return;
      }
      const { data, error } = await supabase
        .from("emccongregation")
        .select("id,name")
        .order("name", { ascending: true });
      if (error) {
        setError(`Failed to load congregations: ${error.message}`);
        return;
      }
      if (!cancelled) {
        setCongregationOptions(
          (data ?? []).map((row: CongregationRecord) => ({
            value: row.id,
            label: row.name ?? "",
          })),
        );
      }
    }
    loadCongregations();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, supabase]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const byName = displayName(normalizeMemberRelation(a.emcmember)).localeCompare(
        displayName(normalizeMemberRelation(b.emcmember)),
      );
      if (byName !== 0) return byName;
      const congA = a.congregationid
        ? congregationNameById[a.congregationid] ?? ""
        : "";
      const congB = b.congregationid
        ? congregationNameById[b.congregationid] ?? ""
        : "";
      return displayAreaValue(congA).localeCompare(displayAreaValue(congB));
    });
    return list;
  }, [rows, congregationNameById]);

  const memberSelectOptions = useMemo(() => {
    const list = [...memberOptions];
    list.sort((a, b) => displayName(a).localeCompare(displayName(b)));
    return list;
  }, [memberOptions]);

  function findMatchingAssignment({
    assignmentType,
    countryCode,
    stateCode,
    congregationId,
  }: {
    assignmentType: AssignmentType;
    countryCode: string;
    stateCode: string;
    congregationId: number | null;
  }) {
    return rows.find((row) => {
      const member = normalizeMemberRelation(row.emcmember);
      if (!member?.id) return false;
      if (assignmentType === "country") {
        return (
          normalizeCode(row.countrycode) === countryCode &&
          !row.statecode &&
          !row.congregationid
        );
      }
      if (assignmentType === "state") {
        return (
          normalizeCode(row.countrycode) === countryCode &&
          normalizeCode(row.statecode) === stateCode
        );
      }
      if (assignmentType === "congregation") {
        return row.congregationid === congregationId;
      }
      return false;
    });
  }

  async function handleDelete(row: ElderAreaRow) {
    const member = normalizeMemberRelation(row.emcmember);
    const name = displayName(member);
    const assignmentType: AssignmentType = row.congregationid
      ? "congregation"
      : row.statecode
        ? "state"
        : "country";
    const label = assignmentLabel(
      assignmentType,
      {
        countryCode: normalizeCode(row.countrycode),
        stateCode: normalizeCode(row.statecode),
        congregationId: row.congregationid,
      },
      {
        countryNameByCode,
        usStateNameByCode,
        canadaStateNameByCode,
        congregationNameById,
      },
    );
    const typeLabel =
      assignmentType === "country"
        ? "country"
        : assignmentType === "state"
          ? "state"
          : "congregation";
    const message = name
      ? `Delete the ${typeLabel} of ${label || "this value"} for ${name}?`
      : `Delete the ${typeLabel} of ${label || "this value"}?`;
    if (!window.confirm(message)) return;

    setDeletingId(row.id);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/elders/areas", {
        method: "DELETE",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ id: row.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error ?? "Failed to delete assignment.");
        return;
      }

      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAdd() {
    setFormError(null);

    const memberId = Number(form.memberId);
    if (!memberId || Number.isNaN(memberId)) {
      setFormError("Select an elder.");
      return;
    }

    const assignmentType = form.assignmentType;
    const payload: {
      memberid: number;
      congregationid?: number | null;
      statecode?: string | null;
      countrycode?: string | null;
    } = {
      memberid: memberId,
      congregationid: null,
      statecode: null,
      countrycode: null,
    };

    const normalizedCountry = normalizeCode(form.countryCode);
    const normalizedStateCountry = normalizeCode(form.stateCountryCode || "US");
    const normalizedState = normalizeCode(form.stateCode);

    if (assignmentType === "country") {
      const code = normalizeCode(form.countryCode);
      if (!code) {
        setFormError("Select a country.");
        return;
      }
      payload.countrycode = code;
    } else if (assignmentType === "state") {
      const code = normalizeCode(form.stateCode);
      if (!code) {
        setFormError(
          normalizedStateCountry === "CA"
            ? "Select a Canadian province."
            : normalizedStateCountry === "AU"
              ? "Select an Australian state."
            : "Select a US state.",
        );
        return;
      }
      if (normalizedStateCountry !== "US" && normalizedStateCountry !== "CA" && normalizedStateCountry !== "AU") {
        setFormError("Select a country for the state/province.");
        return;
      }
      payload.countrycode = normalizedStateCountry;
      payload.statecode = code;
    } else if (assignmentType === "congregation") {
      const congregationId = Number(form.congregationId);
      if (!congregationId || Number.isNaN(congregationId)) {
        setFormError("Select a congregation.");
        return;
      }
      payload.congregationid = congregationId;
    }

    const congregationId =
      assignmentType === "congregation" ? Number(form.congregationId) : null;
    const match = findMatchingAssignment({
      assignmentType,
      countryCode:
        assignmentType === "state" ? normalizedStateCountry : normalizedCountry,
      stateCode: normalizedState,
      congregationId,
    });

    if (match) {
      const matchMember = normalizeMemberRelation(match.emcmember);
      if (matchMember?.id === memberId) {
        setFormError("This assignment already exists for that elder.");
        return;
      }

      const label = assignmentLabel(
        assignmentType,
        {
          countryCode:
            assignmentType === "country" ? normalizedCountry : normalizedStateCountry,
          stateCode: normalizedState,
          congregationId,
        },
        {
          countryNameByCode,
          usStateNameByCode,
          canadaStateNameByCode,
          congregationNameById,
        },
      );
      const typeLabel =
        assignmentType === "country"
          ? "country"
          : assignmentType === "state"
            ? "state"
            : "congregation";
      const warnMessage = `The ${typeLabel} ${label || "this value"} is already assigned to ${displayName(
        matchMember,
      )}. Are you sure you want to continue?`;
      if (!window.confirm(warnMessage)) return;
    }

    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/elders/areas", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          memberId,
          countryCode: payload.countrycode,
          stateCode: payload.statecode,
          congregationId: payload.congregationid,
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setFormError(body?.error ?? "Failed to add assignment.");
        return;
      }

      const assignment = body?.data as ElderAreaRow | undefined;
      if (assignment) {
        const normalized = {
          ...assignment,
          emcmember: normalizeMemberRelation(assignment.emcmember),
        };
        setRows((prev) => [...prev, normalized]);
      }

      setForm({
        memberId: "",
        assignmentType,
        countryCode: "",
        stateCountryCode: "US",
        stateCode: "",
        congregationId: "",
      });
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
        <h1 className={forms.h1}>Elders and Areas of Responsibility</h1>
        <div className={forms.backRow}>
          <BackLink fallbackHref="/elders" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
            &lt;- Back to Elders
          </BackLink>
        </div>
        <p className={forms.error}>{error}</p>
      </main>
    );
  }

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>Elders and Areas of Responsibility</h1>
      <div className={forms.backRow}>
        <BackLink fallbackHref="/elders" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          &lt;- Back to Elders
        </BackLink>
      </div>

      {isAdmin && (
        <section
          style={{
            marginBottom: 16,
            border: "1px solid #e2e2e2",
            borderRadius: 10,
            padding: 16,
            background: "#fff",
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>
            Add Elder/Area Relationship
          </h2>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="elder-area-member">
              Elder
            </label>
            <select
              id="elder-area-member"
              className={forms.field}
              value={form.memberId}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, memberId: e.target.value }))
              }
            >
              <option value="">Select elder…</option>
              {memberSelectOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {displayName(m)}
                </option>
              ))}
            </select>
          </div>
          <div className={forms.row}>
            <label className={forms.label} htmlFor="elder-area-type">
              Assign
            </label>
            <select
              id="elder-area-type"
              className={forms.field}
              value={form.assignmentType}
              onChange={(e) => {
                const next = e.target.value as AssignmentType;
                setForm((prev) => ({
                  ...prev,
                  assignmentType: next,
                  countryCode: next === "country" ? prev.countryCode : "",
                  stateCountryCode:
                    next === "state" ? prev.stateCountryCode ?? "US" : "US",
                  stateCode: next === "state" ? prev.stateCode : "",
                  congregationId: next === "congregation" ? prev.congregationId : "",
                }));
              }}
            >
              <option value="country">Country</option>
              <option value="state">State/Province (US, Canada, or Australia)</option>
              <option value="congregation">Congregation</option>
            </select>
          </div>

          {form.assignmentType === "country" && (
            <div className={forms.row}>
              <label className={forms.label} htmlFor="elder-area-country">
                Country
              </label>
              <select
                id="elder-area-country"
                className={forms.field}
                value={form.countryCode}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, countryCode: e.target.value }))
                }
              >
                <option value="">Select country…</option>
                {countryOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {form.assignmentType === "state" && (
            <>
            <div className={forms.row}>
              <label className={forms.label} htmlFor="elder-area-state-country">
                Country
              </label>
              <select
                id="elder-area-state-country"
                className={forms.field}
                value={form.stateCountryCode}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    stateCountryCode: e.target.value,
                    stateCode: "",
                  }))
                }
              >
                <option value="US">United States</option>
                <option value="CA">Canada</option>
                <option value="AU">Australia</option>
              </select>
            </div>
            <div className={forms.row}>
              <label className={forms.label} htmlFor="elder-area-state">
                {form.stateCountryCode === "CA" ? "Province" : "State"}
              </label>
              <select
                id="elder-area-state"
                className={forms.field}
                value={form.stateCode}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, stateCode: e.target.value }))
                }
              >
                <option value="">
                  {form.stateCountryCode === "CA"
                    ? "Select province…"
                    : "Select state…"}
                </option>
                {(form.stateCountryCode === "CA"
                  ? canadaStateOptions
                  : form.stateCountryCode === "AU"
                    ? australiaStateOptions
                  : usStateOptions
                ).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            </>
          )}

          {form.assignmentType === "congregation" && (
            <div className={forms.row}>
              <label className={forms.label} htmlFor="elder-area-congregation">
                Congregation
              </label>
              <select
                id="elder-area-congregation"
                className={forms.field}
                value={form.congregationId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, congregationId: e.target.value }))
                }
              >
                <option value="">Select congregation…</option>
                {congregationOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {formError && <p className={forms.error}>{formError}</p>}
          <div className={forms.actions}>
            <button
              type="button"
              className={forms.button}
              onClick={handleAdd}
              disabled={saving}
            >
              {saving ? "Saving…" : "Add Assignment"}
            </button>
          </div>
        </section>
      )}

      {sortedRows.length > 0 ? (
        <div className={forms.tableWrap} style={{ marginTop: 12 }}>
          <table className={forms.table}>
            <thead>
              <tr>
                <th className={forms.th}>Elder Name</th>
                <th className={forms.th}>Congregation</th>
                <th className={forms.th}>State</th>
                <th className={forms.th}>Country</th>
                {isAdmin && <th className={forms.th}>Delete</th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id}>
                  <td className={forms.td}>
                    {displayName(normalizeMemberRelation(row.emcmember))}
                  </td>
                  <td className={forms.td}>
                    {displayAreaValue(
                      row.congregationid
                        ? congregationNameById[row.congregationid] ?? ""
                        : "",
                    )}
                  </td>
                  <td className={forms.td}>
                    {displayAreaValue(
                      (normalizeCode(row.countrycode) === "CA"
                        ? canadaStateNameByCode[normalizeCode(row.statecode)]
                        : normalizeCode(row.countrycode) === "AU"
                          ? australiaStateNameByCode[normalizeCode(row.statecode)]
                        : usStateNameByCode[normalizeCode(row.statecode)]) ??
                        row.statecode,
                    )}
                  </td>
                  <td className={forms.td}>
                    {displayAreaValue(
                      countryNameByCode[normalizeCode(row.countrycode)] ??
                        row.countrycode,
                    )}
                  </td>
                  {isAdmin && (
                    <td className={forms.td}>
                      <button
                        type="button"
                        className={`${forms.button} ${forms.buttonDanger}`}
                        onClick={() => handleDelete(row)}
                        disabled={deletingId === row.id}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No elder area assignments found.</p>
      )}
    </main>
  );
}
