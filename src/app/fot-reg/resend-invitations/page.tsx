"use client";

import { useEffect, useMemo, useState } from "react";

import { BackLink } from "@/components/BackLink";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import type { RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";
import forms from "@/styles/forms.module.css";

type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  email: string | null;
};

type FailedRecipient = {
  memberId: number;
  email: string;
  error: string;
};

function fullName(member: MemberRow) {
  const first = String(member.fname ?? "").trim();
  const last = String(member.lname ?? "").trim();
  return [last, first].filter(Boolean).join(", ");
}

export default function FotResendInvitationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [pageLoading, setPageLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemberRow[]>([]);
  const [skipSearch, setSkipSearch] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgIsError, setMsgIsError] = useState(false);
  const [failedRecipients, setFailedRecipients] = useState<FailedRecipient[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setPageLoading(true);
      setError(null);
      setMsg(null);
      setMsgIsError(false);

      try {
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr || !user) {
          setError("Session not found. Please sign in again.");
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
          .filter((name): name is string => Boolean(name))
          .map((name) => name.trim().toLowerCase());

        const admin = roles.includes("emc_admin");
        if (!cancelled) {
          setIsAdmin(admin);
          if (!admin) {
            setError("Only EMC admins can use this screen.");
            return;
          }
        }

        const headers = await getAuthHeaders();
        const res = await fetch("/api/elders/group-email", {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          body: JSON.stringify({ includeAllMembers: true }),
        });

        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          members?: MemberRow[];
        };
        if (!res.ok) {
          setError(payload.error ?? "Failed to load member list.");
          return;
        }

        if (!cancelled) {
          const members = (payload.members ?? []).filter((m) => String(m.email ?? "").trim().length > 0);
          setRows(members);
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return rows
      .filter((row) => {
        const name = fullName(row).toLowerCase();
        const email = String(row.email ?? "").trim().toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .slice(0, 50);
  }, [query, rows]);

  useEffect(() => {
    if (skipSearch) {
      setSkipSearch(false);
      return;
    }
    setSearchResults(filteredRows);
  }, [filteredRows, skipSearch]);

  function toggleMember(memberId: number) {
    setSelectedIds((prev) => (prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]));
  }

  function toggleAllFiltered() {
    const filteredIds = filteredRows.map((row) => row.id);
    const allSelected = filteredIds.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) => {
      if (allSelected) {
        return prev.filter((id) => !filteredIds.includes(id));
      }
      return Array.from(new Set([...prev, ...filteredIds]));
    });
  }

  async function sendSelectedInvites() {
    if (!isAdmin || !selectedIds.length || sending) return;

    const confirmed = window.confirm(
      `Send FoT invitation emails to ${selectedIds.length} selected member(s)? Missing FoT registration links will be generated automatically.`,
    );
    if (!confirmed) return;

    setSending(true);
    setError(null);
    setMsg(null);
    setMsgIsError(false);
    setFailedRecipients([]);

    try {
      const headers = await getAuthHeaders();
      const issueRes = await fetch("/api/fot-reg/tokens/issue", {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ memberIds: selectedIds }),
      });
      const issuePayload = (await issueRes.json().catch(() => ({}))) as {
        error?: string;
        count?: number;
        skippedCount?: number;
      };

      if (!issueRes.ok) {
        setError(issuePayload.error ?? "Failed to generate missing FoT registration links.");
        return;
      }

      const res = await fetch("/api/fot-reg/tokens/resend", {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ memberIds: selectedIds }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        eligibleCount?: number;
        emailResults?: {
          attempted?: number;
          sent?: number;
          failed?: FailedRecipient[];
        };
      };

      if (!res.ok) {
        setError(payload.error ?? "Failed to resend invitations.");
        return;
      }

      const attempted = Number(payload.emailResults?.attempted ?? 0);
      const sent = Number(payload.emailResults?.sent ?? 0);
      const failed = Array.isArray(payload.emailResults?.failed) ? payload.emailResults.failed : [];
      const issuedCount = Number(issuePayload.count ?? 0);
      const skippedExistingCount = Number(issuePayload.skippedCount ?? 0);
      setFailedRecipients(failed);
      setMsgIsError(failed.length > 0);
      setMsg(
        `Done. Created ${issuedCount} missing FoT registration link(s), existing links kept: ${skippedExistingCount}. Email send: ${sent}/${attempted} sent${failed.length ? `, ${failed.length} failed` : ""}.`,
      );
    } finally {
      setSending(false);
    }
  }

  function downloadFailedCsv() {
    if (!failedRecipients.length) return;
    const header = "member_id,email,error";
    const rowsCsv = failedRecipients.map((row) => {
      const safeEmail = `"${String(row.email ?? "").replaceAll('"', '""')}"`;
      const safeError = `"${String(row.error ?? "").replaceAll('"', '""')}"`;
      return `${row.memberId},${safeEmail},${safeError}`;
    });
    const csv = [header, ...rowsCsv].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fot-resend-failed-recipients.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (pageLoading) {
    return <main className={forms.page}>Loading…</main>;
  }

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>Resend specific FoT registration emails</h1>
      <div className={forms.backRow}>
        <BackLink fallbackHref="/fot-reg/send-yearly" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          &lt;- Back to yearly send page
        </BackLink>
      </div>

      {error ? <p className={forms.error}>{error}</p> : null}
      {msg ? <p className={msgIsError ? forms.error : forms.actionsMsg}>{msg}</p> : null}

      {isAdmin ? (
        <>
          <div className={forms.actions}>
            <div className={forms.autocompleteWrap} style={{ minWidth: 320 }}>
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setBrowseAll(false);
                }}
                placeholder="Type at least 2 letters to search by name or email"
                className={forms.field}
              />
              {query.trim().length >= 2 ? (
                searchResults.length ? (
                  <div className={forms.autocompleteMenu} role="listbox" aria-label="Matching members">
                    {searchResults.map((row) => (
                      <button
                        key={`resend-${row.id}`}
                        type="button"
                        className={forms.autocompleteOption}
                        onClick={() => {
                          toggleMember(row.id);
                          setQuery(fullName(row));
                          setSkipSearch(true);
                          setSearchResults([]);
                        }}
                      >
                        {fullName(row)} — {String(row.email ?? "").trim()}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 4, color: "#6b7280" }}>No matches.</p>
                )
              ) : null}
            </div>
            <button
              type="button"
              className={forms.button}
              style={{ marginLeft: 8 }}
              onClick={() => setBrowseAll((prev) => !prev)}
            >
              {browseAll ? "Hide all members" : "Browse all members"}
            </button>
            <button type="button" className={`${forms.button} ${forms.linkButtonLight}`} onClick={toggleAllFiltered}>
              Toggle all filtered
            </button>
            <button
              type="button"
              className={forms.button}
              onClick={sendSelectedInvites}
              disabled={!selectedIds.length || sending}
            >
              {sending ? "Sending..." : `Send selected invitations (${selectedIds.length})`}
            </button>
            {failedRecipients.length ? (
              <button
                type="button"
                className={`${forms.button} ${forms.linkButtonLight}`}
                onClick={downloadFailedCsv}
              >
                Download failed recipients CSV
              </button>
            ) : null}
          </div>

          {browseAll ? (
            <div
              style={{
                marginTop: 8,
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                maxHeight: 280,
                overflow: "auto",
                padding: 6,
                minWidth: 320,
              }}
            >
              {rows.map((row) => (
                <button
                  key={`browse-resend-${row.id}`}
                  type="button"
                  className={forms.autocompleteOption}
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => {
                    toggleMember(row.id);
                    setQuery(fullName(row));
                    setSkipSearch(true);
                    setSearchResults([]);
                    setBrowseAll(false);
                  }}
                >
                  {fullName(row)} — {String(row.email ?? "").trim()}
                </button>
              ))}
            </div>
          ) : null}

          <div className={forms.tableWrap} style={{ marginTop: 12 }}>
            <table className={forms.table}>
              <thead>
                <tr>
                  <th className={forms.th}>Select</th>
                  <th className={forms.th}>Name</th>
                  <th className={forms.th}>Email</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const checked = selectedIds.includes(row.id);
                  return (
                    <tr key={`resend-member-${row.id}`}>
                      <td className={forms.td}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMember(row.id)}
                          aria-label={`Select member ${fullName(row)}`}
                        />
                      </td>
                      <td className={forms.td}>{fullName(row)}</td>
                      <td className={forms.td}>{String(row.email ?? "").trim()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </main>
  );
}
