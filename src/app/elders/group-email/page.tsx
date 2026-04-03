"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import { fetchCountryAndUSStateLookups } from "@/lib/lookups";
import { BackLink } from "@/components/BackLink";
import forms from "@/styles/forms.module.css";
import type { RoleName, RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";

type AreaRow = {
  id: number;
  memberid: number;
  countrycode: string | null;
  statecode: string | null;
  congregationid: number | null;
};

type CongregationRecord = {
  id: number;
  name: string | null;
};

function displayName(m: { fname: string | null; lname: string | null }) {
  const ln = (m.lname ?? "").trim();
  const fn = (m.fname ?? "").trim();
  if (!ln && !fn) return "";
  if (!ln) return fn;
  if (!fn) return ln;
  return `${fn} ${ln}`;
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


export default function EldersGroupEmailPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [selectedAreaIds, setSelectedAreaIds] = useState<number[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [includeAllMembers, setIncludeAllMembers] = useState(false);
  const [emailList, setEmailList] = useState("");
  const [noEmailList, setNoEmailList] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

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
  const [congregationNameById, setCongregationNameById] = useState<
    Record<number, string>
  >({});

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
        setIsAdmin(admin || superuser);
        const allowed = admin || superuser || hasAnyRole(roles, ["emc_user", "user"]);
        if (!allowed) {
          setError("You are logged in, but you do not have access to EMC.");
          return;
        }

        if (!account.memberid) {
          setError("No member record linked to this account.");
          return;
        }

        const lookups = await fetchCountryAndUSStateLookups();
        if (!cancelled) {
          setCountryNameByCode(lookups.countryNameByCode);
          setUsStateNameByCode(lookups.usStateNameByCode);
          setCanadaStateNameByCode(lookups.canadaStateNameByCode);
          setAustraliaStateNameByCode(lookups.australiaStateNameByCode);
        }

        let areaRows: AreaRow[] = [];
        let aErr: { message: string } | null = null;
        if (account.memberid) {
          const areaResult = await supabase
            .from("emcelderarea")
            .select("id,memberid,countrycode,statecode,congregationid")
            .eq("memberid", account.memberid);
          areaRows = (areaResult.data ?? []) as AreaRow[];
          aErr = areaResult.error;
        }

        if (aErr) {
          setError(`Failed to load areas: ${aErr.message}`);
          return;
        }

        if (areaRows.length === 0) {
          const fallback = await fetch("/api/elders/areas/self", {
            method: "GET",
            headers: await getAuthHeaders(),
            credentials: "same-origin",
          });
          const payload = (await fallback.json().catch(() => ({}))) as {
            error?: string;
            areas?: AreaRow[];
          };
          if (!fallback.ok) {
            setError(payload.error ?? "Failed to load areas.");
            return;
          }
          areaRows = Array.isArray(payload.areas) ? payload.areas : [];
        }

        if (!cancelled) {
          const list = areaRows;
          const congregationIds = Array.from(
            new Set(list.map((row) => row.congregationid).filter(Boolean)),
          ) as number[];
          const lookup: Record<number, string> = {};
          if (congregationIds.length > 0) {
            const headers = await getAuthHeaders();
            const response = await fetch(
              `/api/elders/congregations/view?ids=${congregationIds.join(",")}`,
              {
                method: "GET",
                headers,
                credentials: "same-origin",
              },
            );
            const payload = (await response.json().catch(() => ({}))) as {
              error?: string;
              congregations?: CongregationRecord[];
            };
            if (!response.ok) {
              setError(payload.error ?? "Failed to load congregations.");
              return;
            }
            (payload.congregations ?? []).forEach((row) => {
              if (row?.id != null) lookup[row.id] = row.name ?? "";
            });
          }
          setAreas(list);
          setCongregationNameById(lookup);
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

  const areasWithLabels = useMemo(() => {
    return areas.map((row) => {
      const cc = normalizeCode(row.countrycode);
      const sc = normalizeCode(row.statecode);
      let label = "";
      if (row.congregationid) {
        const congregationName = String(
          congregationNameById[row.congregationid] ?? "",
        ).trim();
        label = congregationName
          ? `Congregation: ${congregationName}`
          : `Congregation #${row.congregationid}`;
      } else if (sc) {
        const stateName =
          cc === "CA"
            ? (canadaStateNameByCode[sc] ?? sc)
            : cc === "AU"
              ? (australiaStateNameByCode[sc] ?? sc)
              : (usStateNameByCode[sc] ?? sc);
        const countryName = countryNameByCode[cc] ?? cc;
        label = `${stateName} (${countryName})`;
      } else if (cc) {
        label = countryNameByCode[cc] ?? cc;
      }
      return { ...row, label: label || "Unknown area" };
    });
  }, [
    areas,
    congregationNameById,
    countryNameByCode,
    australiaStateNameByCode,
    usStateNameByCode,
    canadaStateNameByCode,
  ]);

  const areaOptions = useMemo(() => {
    const options = areasWithLabels.map((area) => ({
      ...area,
      isAllMembers: false,
    }));
    if (!isAdmin) return options;
    return [
      {
        id: -1,
        memberid: 0,
        countrycode: null,
        statecode: null,
        congregationid: null,
        label: "All members worldwide",
        isAllMembers: true,
      },
      ...options,
    ];
  }, [areasWithLabels, isAdmin]);

  useEffect(() => {
    let cancelled = false;

    async function loadEmails() {
      setEmailError(null);
      setEmailList("");
      setNoEmailList("");
      setCopyMsg(null);

      if (!includeAllMembers && selectedAreaIds.length === 0) return;

      setEmailLoading(true);
      try {
        let query = supabase
          .from("emcmember")
          .select("id,fname,lname,email")
          .eq("baptized", true)
          .eq("statusid", 1)
          .order("lname", { ascending: true })
          .order("fname", { ascending: true });

        if (!includeAllMembers) {
          const selectedAreas = areas.filter((a) =>
            selectedAreaIds.includes(a.id),
          );
          if (selectedAreas.length === 0) return;

          const congregationIds = Array.from(
            new Set(
              selectedAreas
                .map((area) => area.congregationid)
                .filter((id): id is number => !!id),
            ),
          );

          const stateAreas = selectedAreas.filter(
            (area) => !area.congregationid && area.statecode,
          );
          const countryAreas = selectedAreas.filter(
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
            query = query.or(filters.join(","));
          } else {
            setEmailList("");
            setNoEmailList("");
            return;
          }
        }

        const { data, error } = await query;
        if (cancelled) return;
        let list = (data ?? []) as {
          id: number;
          fname: string | null;
          lname: string | null;
          email: string | null;
        }[];

        if (error || list.length === 0) {
          const response = await fetch("/api/elders/group-email", {
            method: "POST",
            headers: await getAuthHeaders(),
            credentials: "same-origin",
            body: JSON.stringify({
              includeAllMembers,
              selectedAreaIds,
            }),
          });
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
            members?: {
              id: number;
              fname: string | null;
              lname: string | null;
              email: string | null;
            }[];
          };
          if (!response.ok) {
            setEmailError(payload.error ?? error?.message ?? "Failed to load email addresses.");
            return;
          }
          list = Array.isArray(payload.members) ? payload.members : [];
        }

        const emails = list
          .map((row) => String(row.email ?? "").trim())
          .filter(Boolean);
        const uniqueEmails = Array.from(new Set(emails)).sort((a, b) =>
          a.localeCompare(b),
        );
        setEmailList(uniqueEmails.join(", "));

        const noEmailNames = list
          .filter((row) => !String(row.email ?? "").trim())
          .map((row) => displayName(row))
          .filter(Boolean);
        setNoEmailList(noEmailNames.join("\n"));
      } finally {
        if (!cancelled) setEmailLoading(false);
      }
    }

    loadEmails();
    return () => {
      cancelled = true;
    };
  }, [areas, selectedAreaIds, supabase, includeAllMembers]);

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>Group Email</h1>
      <div className={forms.backRow}>
        <BackLink fallbackHref="/elders" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          &lt;- Back to Elders
        </BackLink>
      </div>
      {pageLoading ? (
        <p>Loading…</p>
      ) : error ? (
        <p className={forms.error}>{error}</p>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <p>
            You can use this page to gather the email addresses from your
            area(s) and then copy and <strong>paste them into the BCC</strong> of your own email
            account and send them.
          </p>

          <div className={forms.col} style={{ gap: 10, marginTop: 12 }}>
            <label className={forms.label}>Get email addresses of…</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className={forms.button}
                onClick={() => {
                  setIncludeAllMembers(false);
                  setSelectedAreaIds(areasWithLabels.map((area) => area.id));
                }}
                disabled={areasWithLabels.length === 0 || includeAllMembers}
              >
                All of my areas
              </button>
              <button
                type="button"
                className={forms.button}
                onClick={() => {
                  setIncludeAllMembers(false);
                  setSelectedAreaIds([]);
                }}
                disabled={areasWithLabels.length === 0 || includeAllMembers}
              >
                None
              </button>
            </div>

            <p style={{ margin: 0, color: "#4b5563", fontSize: 13 }}>
              Or select specific areas below:
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              {areaOptions.map((area) => {
                const checked = area.isAllMembers
                  ? includeAllMembers
                  : selectedAreaIds.includes(area.id);
                return (
                  <label
                    key={area.id}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const nextChecked = e.target.checked;
                        if (area.isAllMembers) {
                          setIncludeAllMembers(nextChecked);
                          if (nextChecked) {
                            setSelectedAreaIds([]);
                          }
                          return;
                        }
                        setIncludeAllMembers(false);
                        setSelectedAreaIds((prev) => {
                          if (nextChecked) return [...prev, area.id];
                          return prev.filter((id) => id !== area.id);
                        });
                      }}
                      disabled={includeAllMembers && !area.isAllMembers}
                    />
                    <span
                      style={
                        area.isAllMembers
                          ? { fontStyle: "italic", color: "#555" }
                          : undefined
                      }
                    >
                      {area.label}
                    </span>
                  </label>
                );
              })}
              {areaOptions.length === 0 && <span>No areas available.</span>}
            </div>
          </div>

          {emailError && <p className={forms.error}>{emailError}</p>}

          <div className={forms.col} style={{ gap: 6, marginTop: 12 }}>
            <label className={forms.label} htmlFor="elder-area-email-list">
              Email addresses:
            </label>
            <div style={{ display: "grid", gap: 8 }}>
              <textarea
                id="elder-area-email-list"
                className={`${forms.field} ${forms.textarea}`}
                value={emailLoading ? "Loading…" : emailList}
                onFocus={(e) => e.currentTarget.select()}
                readOnly
              />
              <div className={forms.actions} style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className={forms.button}
                  onClick={async () => {
                    if (!emailList) return;
                    try {
                      await navigator.clipboard.writeText(emailList);
                      setCopyMsg("Copied.");
                      setTimeout(() => setCopyMsg(null), 2000);
                    } catch {
                      setCopyMsg("Copy failed.");
                    }
                  }}
                  disabled={!emailList || emailLoading}
                >
                  Copy emails
                </button>
                {copyMsg && <span>{copyMsg}</span>}
              </div>
            </div>
          </div>

          <div className={forms.col} style={{ gap: 6, marginTop: 12 }}>
            <label className={forms.label} htmlFor="elder-area-no-email-list">
              The following contacts have no email address:
            </label>
            <textarea
              id="elder-area-no-email-list"
              className={`${forms.field} ${forms.textarea}`}
              value={emailLoading ? "Loading…" : noEmailList}
              readOnly
            />
          </div>
        </div>
      )}
    </main>
  );
}
