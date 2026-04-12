"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  emceldertype?:
    | {
        name: string | null;
      }
    | {
        name: string | null;
      }[]
    | null;
  emcaccessrole: "emc_admin" | "emc_superuser" | "emc_user" | null;
  contribaccessrole: "contrib_admin" | "contrib_user" | null;
  datecreated: string;
  dateupdated: string | null;
};

type ElderType = { id: number; name: string };

type AreaRow = {
  id: number;
  countrycode: string | null;
  statecode: string | null;
  congregationid: number | null;
};

type BaseElderDetail = Omit<MemberDetail, "emcaccessrole" | "contribaccessrole">;

function normalizeElderTypeRelation(
  value?:
    | {
        name: string | null;
      }
    | {
        name: string | null;
      }[]
    | null,
) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

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

export default function EldersDetailsPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [pageLoading, setPageLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [detailLoading, setDetailLoading] = useState(false);
  const [member, setMember] = useState<MemberDetail | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<MemberDetail | null>(null);
  const [dirty, setDirty] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);

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
  const detailCacheRef = useRef<Record<number, BaseElderDetail>>({});
  const accessCacheRef = useRef<
    Record<
      number,
      {
        emcaccessrole: MemberDetail["emcaccessrole"];
        contribaccessrole: MemberDetail["contribaccessrole"];
      }
    >
  >({});

  const sortedOptions = useMemo(() => {
    const list = [...memberOptions];
    list.sort((a, b) => displayName(a).localeCompare(displayName(b)));
    return list;
  }, [memberOptions]);
  const canSeeAll = isAdmin || isSuperuser;

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
        const allowed = admin || superuser || hasAnyRole(roles, ["emc_user", "user"]);
        if (!allowed) {
          setError("You are logged in, but you do not have access to EMC.");
          return;
        }

        if (!cancelled) setIsAdmin(admin);
        if (!cancelled) setIsSuperuser(superuser);

        const [lookups, elderTypesResult, memberOptionsResult] = await Promise.all([
          fetchCountryAndUSStateLookups(),
          supabase.from("emceldertype").select("id,name").order("id", { ascending: true }),
          (async () => {
            const { data: opts, error: optErr } = await supabase
              .from("emcmember")
              .select("id,fname,lname,statecode,countrycode,eldertypeid")
              .not("eldertypeid", "is", null)
              .order("lname", { ascending: true })
              .order("fname", { ascending: true })
              .limit(2000);

            let list = (opts ?? []) as (MemberOption & {
              eldertypeid: number | null;
            })[];

            if ((admin || superuser) && (optErr || list.length === 0)) {
              const fallback = await fetch("/api/elders/members?view=options", {
                method: "GET",
                headers: await getAuthHeaders(),
                credentials: "same-origin",
              });
              const payload = (await fallback.json().catch(() => ({}))) as {
                error?: string;
                members?: (MemberOption & { eldertypeid: number | null })[];
              };
              if (!fallback.ok) {
                return {
                  list: [] as (MemberOption & { eldertypeid: number | null })[],
                  error: payload.error ?? optErr?.message ?? "Failed to load members list.",
                };
              }
              list = Array.isArray(payload.members) ? payload.members : [];
              return { list, error: null as string | null };
            }

            if (optErr) {
              return {
                list: [] as (MemberOption & { eldertypeid: number | null })[],
                error: `Failed to load members list: ${optErr.message}`,
              };
            }

            return { list, error: null as string | null };
          })(),
        ]);

        if (elderTypesResult.error) {
          setError(`Failed to load elder types: ${elderTypesResult.error.message}`);
          return;
        }
        if (memberOptionsResult.error) {
          setError(memberOptionsResult.error);
          return;
        }

        if (!cancelled) {
          setCountryNameByCode(lookups.countryNameByCode);
          setUsStateNameByCode(lookups.usStateNameByCode);
          setCanadaStateNameByCode(lookups.canadaStateNameByCode);
          setAustraliaStateNameByCode(lookups.australiaStateNameByCode);
          setCountryOptions(lookups.countryOptions);
          setUsStateOptions(lookups.usStateOptions);
          setCanadaStateOptions(lookups.canadaStateOptions);
          setAustraliaStateOptions(lookups.australiaStateOptions);
          setElderTypes((elderTypesResult.data ?? []) as ElderType[]);
          setMemberOptions(memberOptionsResult.list);

          const params = new URLSearchParams(window.location.search);
          const pre = params.get("selected");
          if (pre) setSelectedId(Number(pre));
          else if (memberOptionsResult.list.length > 0) setSelectedId(memberOptionsResult.list[0].id);
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

  const fetchElderDetail = useCallback(async (id: number) => {
    const cached = detailCacheRef.current[id];
    if (cached) {
      return { data: { ...cached } as BaseElderDetail, error: null as string | null };
    }

    if (canSeeAll) {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/elders/members?memberId=${id}`, {
        method: "GET",
        headers,
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        member?: BaseElderDetail;
      };
      if (!response.ok) {
        return {
          data: null as BaseElderDetail | null,
          error: payload.error ?? "Failed to load elder details.",
        };
      }
      const detail = payload.member ?? null;
      if (detail) detailCacheRef.current[id] = detail;
      return { data: detail, error: null as string | null };
    }

    const { data, error } = await supabase
      .from("emcmember")
      .select(
        `
        id,
        fname, lname,
        address, address2, city, statecode, zip, countrycode,
        homephone, cellphone, email,
        eldertypeid,
        emceldertype(name),
        datecreated, dateupdated
      `,
      )
      .eq("id", id)
      .single();
    if (error) {
      return {
        data: null as BaseElderDetail | null,
        error: error.message,
      };
    }
    const detail = (data ?? null) as BaseElderDetail | null;
    if (detail) detailCacheRef.current[id] = detail;
    return { data: detail, error: null as string | null };
  }, [canSeeAll, supabase]);

  const fetchElderAccess = useCallback(async (id: number) => {
    const cached = accessCacheRef.current[id];
    if (cached) return { ...cached };

    const headers = await getAuthHeaders();
    const response = await fetch(`/api/elders/accounts?memberId=${id}`, {
      method: "GET",
      headers,
      credentials: "same-origin",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      accessByMemberId?: Record<string, "emc_admin" | "emc_superuser" | "emc_user" | null>;
      contribAccessByMemberId?: Record<string, "contrib_admin" | "contrib_user" | null>;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load account access roles.");
    }
    const access = {
      emcaccessrole: payload.accessByMemberId?.[String(id)] ?? null,
      contribaccessrole: payload.contribAccessByMemberId?.[String(id)] ?? null,
    };
    accessCacheRef.current[id] = access;
    return access;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMember(id: number) {
      setDetailLoading(true);
      setDetailError(null);
      setValidationError(null);
      setSaveMsg(null);
      setInviteMsg(null);

      setMember(null);
      setForm(null);
      setDirty(false);
      setEditMode(false);

      try {
        const accessPromise = isAdmin
          ? fetchElderAccess(id)
          : Promise.resolve(null);

        const detailResult = await fetchElderDetail(id);
        const detailRow = detailResult.data;
        const detailErr = detailResult.error;

        if (detailErr || !detailRow) {
          setDetailError(detailErr ?? "Failed to load elder details.");
          return;
        }

        if (!cancelled) {
          const d = {
            ...detailRow,
            emcaccessrole: null,
            contribaccessrole: null,
          } as MemberDetail;

          if (isAdmin) {
            const payload = await accessPromise;
            if (!payload) {
              setDetailError("Failed to load account access roles.");
              return;
            }
            d.emcaccessrole = payload.emcaccessrole;
            d.contribaccessrole = payload.contribaccessrole;
          } else {
            d.emcaccessrole = null;
            d.contribaccessrole = null;
          }

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
  }, [canSeeAll, fetchElderAccess, fetchElderDetail, isAdmin, selectedId]);

  function setField<K extends keyof MemberDetail>(
    key: K,
    value: MemberDetail[K],
  ) {
    setForm((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: value };
    });
    setDirty(true);
    setSaveMsg(null);
    setInviteMsg(null);
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
    setInviteMsg(null);
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
    setInviteMsg(null);
    setValidationError(null);
    setDetailError(null);
  }

  async function resendInvitationEmail() {
    if (!isAdmin || !form || sendingInvite) return;

    const effectiveRole =
      form.emcaccessrole ??
      form.contribaccessrole ??
      member?.emcaccessrole ??
      member?.contribaccessrole ??
      null;
    if (!effectiveRole) {
      setDetailError(
        "Cannot resend invitation: this elder has no EMC/Contributions access assigned.",
      );
      setInviteMsg(null);
      return;
    }

    const ok = window.confirm(
      `Resend invitation email to ${displayName(form)}?`,
    );
    if (!ok) return;

    setSendingInvite(true);
    setDetailError(null);
    setInviteMsg(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/elders/accounts/resend-invite", {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ memberId: form.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        sent?: "reset" | "invite";
      };
      if (!response.ok) {
        setDetailError(payload.error ?? "Failed to resend invitation email.");
        return;
      }
      if (payload.sent === "invite") {
        setInviteMsg("Invite email sent with first-time password setup link.");
      } else if (payload.sent === "reset") {
        setInviteMsg("Password reset email sent.");
      } else {
        setInviteMsg("Email sent.");
      }
    } finally {
      setSendingInvite(false);
    }
  }

  async function saveChanges() {
    if (!isAdmin || !editMode || !dirty || !form) return;

    setSaveMsg(null);
    setDetailError(null);
    setValidationError(null);

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

    const removingElderType =
      form.eldertypeid == null && member?.eldertypeid !== form.eldertypeid;
    const emcRoleChanged = form.emcaccessrole !== member?.emcaccessrole;
    const contribRoleChanged =
      form.contribaccessrole !== member?.contribaccessrole;
    const roleChanged = emcRoleChanged || contribRoleChanged;

    if (removingElderType) {
      const headers = await getAuthHeaders();
      const areaResponse = await fetch("/api/elders/areas/member", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ memberId: form.id }),
      });
      const areaBody = await areaResponse.json().catch(() => null);
      if (!areaResponse.ok) {
        setDetailError(
          areaBody?.error ?? "Failed to load areas of responsibility.",
        );
        return;
      }

      const areas = (areaBody?.areas ?? []) as AreaRow[];
      const congregationNameById =
        (areaBody?.congregationNameById ?? {}) as Record<number, string>;

      if (areas.length > 0) {
        const labels = areas
          .map((row) => {
            const cc = normalizeCode(row.countrycode);
            const sc = normalizeCode(row.statecode);
            if (row.congregationid) {
              return `Congregation: ${congregationNameById[row.congregationid] ?? ""}`;
            }
            if (sc) {
              const stateName =
                cc === "CA"
                  ? (canadaStateNameByCode[sc] ?? sc)
                  : cc === "AU"
                    ? (australiaStateNameByCode[sc] ?? sc)
                    : (usStateNameByCode[sc] ?? sc);
              const countryName = countryNameByCode[cc] ?? cc;
              return `${stateName} (${countryName})`;
            }
            if (cc) return countryNameByCode[cc] ?? cc;
            return "Unknown area";
          })
          .filter(Boolean);

        const confirmed = window.confirm(
          `You are trying to remove an elder who has the following areas of responsibility: ${labels.join(
            ", ",
          )}. Are you sure you want to continue?`,
        );
        if (!confirmed) return;

        const deleteResponse = await fetch("/api/elders/areas/member", {
          method: "DELETE",
          headers,
          credentials: "same-origin",
          body: JSON.stringify({ memberId: form.id }),
        });
        const deleteBody = await deleteResponse.json().catch(() => null);
        if (!deleteResponse.ok) {
          setDetailError(
            deleteBody?.error ?? "Failed to remove areas of responsibility.",
          );
          return;
        }
      }
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
    if (roleChanged) {
      let responsePayload: { error?: string; sent?: "invite" | "reset" } = {};
      try {
        const response = await fetch("/api/elders/accounts", {
          method: "PUT",
          headers,
          credentials: "same-origin",
          body: JSON.stringify({
            memberId: form.id,
            emcRoleName: form.emcaccessrole,
            contribRoleName: form.contribaccessrole,
          }),
        });
        responsePayload = (await response.json().catch(() => ({}))) as {
          error?: string;
          sent?: "invite" | "reset";
        };
        if (!response.ok) {
          setDetailError(
            `Saved elder changes, but failed to update account access: ${responsePayload.error ?? "Unknown error."}`,
          );
          return;
        }
      } catch (err) {
        setDetailError("Saved elder changes, but failed to update account access (network error).");
        return;
      }
      delete accessCacheRef.current[form.id];
      if (responsePayload.sent === "invite") {
        setInviteMsg("Invite email sent with first-time password setup link.");
      } else if (responsePayload.sent === "reset") {
        setInviteMsg("Password reset email sent.");
      } else {
        setInviteMsg(null);
      }
    }

    setSaveMsg("Saved.");
    setDirty(false);
    setEditMode(false);
    detailCacheRef.current[form.id] = {
      id: form.id,
      fname: form.fname,
      lname: form.lname,
      address: form.address,
      address2: form.address2,
      city: form.city,
      statecode: form.statecode,
      zip: form.zip,
      countrycode: form.countrycode,
      homephone: form.homephone,
      cellphone: form.cellphone,
      email: form.email,
      eldertypeid: form.eldertypeid,
      datecreated: form.datecreated,
      dateupdated: payload.dateupdated,
    };
    setMember(form);

    setSelectedId(form.id);
  }

  if (pageLoading) {
    return <main className={`${forms.page} ${forms.compactPage}`}>Loading…</main>;
  }

  if (error) {
    return (
      <main className={`${forms.page} ${forms.compactPage}`}>
        <h1 className={forms.h1}>Elders Details</h1>
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
    <main className={`${forms.page} ${forms.compactPage}`}>
      <h1 className={forms.h1}>Elders Details</h1>

      <div className={forms.topBar}>
        <div className={forms.topBack}>
          {editMode ? (
            <span
              className={`${forms.linkButton} ${forms.linkButtonLight}`}
              aria-disabled
              style={{ pointerEvents: "none", opacity: 0.5 }}
            >
              &lt;- Back
            </span>
          ) : (
            <BackLink
              fallbackHref="/elders"
              className={`${forms.linkButton} ${forms.linkButtonLight}`}
            >
              &lt;- Back
            </BackLink>
          )}
        </div>

        {isAdmin && (
          <div className={`${forms.topGroup} ${forms.topGroupAdd}`}>
            <Link
              href="/elders/add"
              className={forms.linkButton}
              aria-disabled={editMode}
              style={editMode ? { pointerEvents: "none", opacity: 0.5 } : undefined}
            >
              Add Elder
            </Link>
          </div>
        )}

        <div className={`${forms.topGroup} ${forms.topGroupSelect}`}>
          <label htmlFor="memberSelect" className={forms.topLabel}>
            Select Elder:
          </label>

          <select
            id="memberSelect"
            value={selectedId ?? ""}
            onChange={(e) =>
              setSelectedId(e.target.value ? Number(e.target.value) : null)
            }
            className={forms.selectContact}
            disabled={editMode}
            style={editMode ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
          >
            {sortedOptions.length === 0 && (
              <option value="">(no members)</option>
            )}
            {sortedOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {displayName(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <hr className={forms.hr} />

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
                  setInviteMsg(null);
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
                  setInviteMsg(null);
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
            <button
              className={forms.button}
              disabled={!form || sendingInvite || editMode}
              onClick={() => void resendInvitationEmail()}
              style={{ background: "#1d4ed8", color: "#fff" }}
            >
              {sendingInvite ? "Sending..." : "Resend Invitation Email"}
            </button>

            {saveMsg && <span className={forms.actionsMsg}>{saveMsg}</span>}
            {inviteMsg && <span className={forms.actionsMsg}>{inviteMsg}</span>}
          </div>

          {validationError && (
            <div className={forms.error}>{validationError}</div>
          )}
          {detailError && <div className={forms.error}>{detailError}</div>}
        </div>
      )}

      {detailLoading && <p>Loading elder…</p>}

      {!detailLoading && form && (
        <div className={forms.formGrid} style={{ marginTop: 12 }}>
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
          </div>

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

            {editMode ? (
              <SelectRow
                label="Elder Type"
                value={form.eldertypeid?.toString() ?? ""}
                disabled={!editMode}
                options={[
                  { value: "", label: "(none)" },
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
            ) : (
              <TextRow
                label="Elder Type"
                value={
                  normalizeElderTypeRelation(form.emceldertype)?.name ??
                  (form.eldertypeid != null
                    ? (elderTypes.find((type) => Number(type.id) === Number(form.eldertypeid))?.name ?? "")
                    : "")
                }
                disabled={true}
                onChange={() => {}}
              />
            )}
            {isAdmin && (
              <>
                <SelectRow
                  label="EMC Access*"
                  value={form.emcaccessrole ?? ""}
                  disabled={!editMode || !form.eldertypeid}
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
                  label="Contributions Access**"
                  value={form.contribaccessrole ?? ""}
                  disabled={!editMode || !form.eldertypeid}
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
          </div>
        </div>
      )}

      {isAdmin && form && (
        <div style={{ marginTop: 28, fontSize: 13, color: "#374151" }}>
          <strong>* EMC Access</strong>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            <li>Admin: can view and edit everything.</li>
            <li>Superuser: can view everything.</li>
            <li>User: can only view members in his/her assigned areas.</li>
          </ul>
          <strong style={{ display: "inline-block", marginTop: 18 }}>** Contribution Access</strong>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            <li>Admin: access to everything.</li>
            <li>User: access to specific country/area.</li>
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
