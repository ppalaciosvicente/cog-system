"use client";

import { useEffect, useMemo, useState } from "react";

import { BackLink } from "@/components/BackLink";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import {
  buildFotInviteHtml,
  buildFotInviteSubject,
} from "@/lib/email/fot-invite-template";
import type { RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";
import forms from "@/styles/forms.module.css";

type FailedRecipient = {
  memberId: number;
  email: string;
  error: string;
};

type PreviewWithEmailRow = {
  memberId: number;
  firstName: string;
  lastName: string;
  email: string;
};

type PreviewMissingEmailRow = {
  memberId: number;
  firstName: string;
  lastName: string;
};

type IssuedInviteRow = {
  memberId: number;
  firstName: string;
  lastName: string;
  email: string;
  link: string;
};

export default function FotSendYearlyPage() {
  const currentYear = new Date().getFullYear();
  const supabase = useMemo(() => createClient(), []);
  const [pageLoading, setPageLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueMsg, setIssueMsg] = useState<string | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [dryRunning, setDryRunning] = useState(false);
  const [failedRecipients, setFailedRecipients] = useState<FailedRecipient[]>(
    [],
  );
  const [previewWithEmail, setPreviewWithEmail] = useState<
    PreviewWithEmailRow[]
  >([]);
  const [previewMissingEmail, setPreviewMissingEmail] = useState<
    PreviewMissingEmailRow[]
  >([]);
  const [issuedInvites, setIssuedInvites] = useState<IssuedInviteRow[]>([]);
  const [dryRunSummary, setDryRunSummary] = useState<{
    withEmail: number;
    withoutEmail: number;
  } | null>(null);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [lastSuccessStep, setLastSuccessStep] = useState<
    "step2" | "step4" | null
  >(null);
  const previewSubject = buildFotInviteSubject(currentYear);
  const previewHtml = buildFotInviteHtml({
    to: "member@example.com",
    firstName: "John",
    lastName: "Doe",
    link: "https://www.domain.com/fot-reg/register?t=example-token",
    year: currentYear,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setPageLoading(true);
      setError(null);
      setIssueMsg(null);

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

        if (!cancelled) {
          const admin = roles.includes("emc_admin");
          setIsAdmin(admin);
          if (!admin) {
            setError("Only EMC admins can use this screen.");
          }
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

  useEffect(() => {
    const handler = () => setIsNarrow(window.innerWidth < 900);
    handler();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  async function runResetAndIssue(options: {
    sendEmails: boolean;
    dryRun?: boolean;
  }) {
    const sendEmails = false;
    const dryRun = Boolean(options.dryRun);
    if (!isAdmin || issuing || emailing || dryRunning) return;

    const confirmed = window.confirm(
      dryRun
        ? "This is a dry run. No FoT registrations, registration links, or emails will be changed or sent. It will only show the lists of active members. Continue?"
        : "This will delete all current FoT registration access links, clear all current FoT registrations, and create new registration links for all active members (in fellowship and baptized). No emails will be sent in this step. Are you sure you want to continue?",
    );
    if (!confirmed) return;

    if (dryRun) setDryRunning(true);
    else if (sendEmails) setEmailing(true);
    else setIssuing(true);
    setIssueMsg(null);
    setLastSuccessStep(null);
    setError(null);
    setFailedRecipients([]);
    if (dryRun) {
      setPreviewWithEmail([]);
      setPreviewMissingEmail([]);
    } else {
      setIssuedInvites([]);
    }
    setDryRunSummary(null);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/fot-reg/tokens/reset-issue", {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sendEmails, dryRun }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        count?: number;
        withoutEmailCount?: number;
        links?: IssuedInviteRow[];
        previewWithEmail?: PreviewWithEmailRow[];
        previewMissingEmail?: PreviewMissingEmailRow[];
        emailResults?: {
          attempted?: number;
          sent?: number;
          failed?: FailedRecipient[];
        };
      };
      if (!res.ok) {
        setError(
          payload.error ?? "Failed to reset and create FoT registration links.",
        );
        return;
      }

      const withoutEmailCount = Number(payload.withoutEmailCount ?? 0);
      const failedList = Array.isArray(payload.emailResults?.failed)
        ? payload.emailResults.failed
        : [];
      setFailedRecipients(failedList);
      setPreviewWithEmail(
        Array.isArray(payload.previewWithEmail) ? payload.previewWithEmail : [],
      );
      setPreviewMissingEmail(
        Array.isArray(payload.previewMissingEmail)
          ? payload.previewMissingEmail
          : [],
      );

      if (dryRun) {
        setDryRunSummary({
          withEmail: Number(payload.count ?? 0),
          withoutEmail: withoutEmailCount,
        });
        setIssueMsg(null);
      } else {
        setDryRunSummary(null);
        setIssuedInvites(Array.isArray(payload.links) ? payload.links : []);
        setLastSuccessStep("step2");
        setIssueMsg(
          `Done. Created ${Number(payload.count ?? 0)} FoT registration links${withoutEmailCount ? `, missing email: ${withoutEmailCount}` : ""}.`,
        );
      }
    } finally {
      setIssuing(false);
      setEmailing(false);
      setDryRunning(false);
    }
  }

  async function runSendIssuedEmails() {
    if (!isAdmin || issuing || emailing || dryRunning) return;
    if (!issuedInvites.length) {
      setError("No issued invite links are available. Run Step 2 first.");
      return;
    }

    const confirmed = window.confirm(
      "This will send FoT invitation emails using the links issued in Step 2. Are you sure you want to continue?",
    );
    if (!confirmed) return;

    setEmailing(true);
    setIssueMsg(null);
    setLastSuccessStep(null);
    setError(null);
    setFailedRecipients([]);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/fot-reg/tokens/send-issued", {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ invites: issuedInvites }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        emailResults?: {
          attempted?: number;
          sent?: number;
          failed?: FailedRecipient[];
        };
      };
      if (!res.ok) {
        setError(payload.error ?? "Failed to send FoT emails.");
        return;
      }

      const attempted = Number(payload.emailResults?.attempted ?? 0);
      const sent = Number(payload.emailResults?.sent ?? 0);
      const failedList = Array.isArray(payload.emailResults?.failed)
        ? payload.emailResults.failed
        : [];
      setFailedRecipients(failedList);
      setLastSuccessStep("step4");
      setIssueMsg(
        `Done. Email send: ${sent}/${attempted} sent${failedList.length ? `, ${failedList.length} failed` : ""}.`,
      );
    } finally {
      setEmailing(false);
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
    a.download = "fot-email-failures.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadPreviewWithEmailCsv() {
    if (!previewWithEmail.length) return;
    const header = "member_id,first_name,last_name,email";
    const rowsCsv = previewWithEmail.map((row) => {
      const safeFirstName = `"${String(row.firstName ?? "").replaceAll('"', '""')}"`;
      const safeLastName = `"${String(row.lastName ?? "").replaceAll('"', '""')}"`;
      const safeEmail = `"${String(row.email ?? "").replaceAll('"', '""')}"`;
      return `${row.memberId},${safeFirstName},${safeLastName},${safeEmail}`;
    });
    const csv = [header, ...rowsCsv].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fot-preview-members-with-email.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadPreviewMissingEmailCsv() {
    if (!previewMissingEmail.length) return;
    const header = "member_id,first_name,last_name";
    const rowsCsv = previewMissingEmail.map((row) => {
      const safeFirstName = `"${String(row.firstName ?? "").replaceAll('"', '""')}"`;
      const safeLastName = `"${String(row.lastName ?? "").replaceAll('"', '""')}"`;
      return `${row.memberId},${safeFirstName},${safeLastName}`;
    });
    const csv = [header, ...rowsCsv].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fot-preview-members-missing-email.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (pageLoading) {
    return <main className={forms.page}>Loading…</main>;
  }

  return (
    <main className={`${forms.page} ${forms.pageWarn}`}>
      <h1 className={forms.h1}>Send yearly FoT invitations</h1>
      <div className={forms.backRow}>
        <BackLink
          fallbackHref="/fot-reg"
          className={`${forms.linkButton} ${forms.linkButtonLight}`}
        >
          &lt;- Back to FoT page
        </BackLink>
      </div>

      <p
        className={forms.error}
        style={{ margin: "20px 0 22px", fontWeight: 400 }}
      >
        <strong>WARNING:</strong> Only use this screen if you know what you are
        doing!
      </p>

      {isNarrow ? (
        <div
          style={{
            margin: "0 0 18px",
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #f97316",
            background: "#fff7ed",
            color: "#7c2d12",
          }}
        >
          This page is best used on a desktop screen. For a safer experience,
          switch to a larger device. You can still scroll horizontally to use it
          here.
        </div>
      ) : null}

      {error ? <p className={forms.error}>{error}</p> : null}

      {isAdmin ? (
        <section
          className={forms.sectionCard}
          style={isNarrow ? { overflowX: "auto" } : undefined}
        >
          <div style={{ display: "grid", gap: 26 }}>
            <div>
              <p style={{ margin: "0 0 8px" }}>
                <strong>Pre-step:</strong> Must be done before using the buttons
                below:
              </p>
              <ul style={{ margin: "0 0 8px 20px" }}>
                <li>
                  Update all FoT sites content on{" "}
                  <code>fot-reg/register/page.tsx</code> (site descriptions,
                  schedules, hotel details and booking links).
                </li>
                <li>
                  Update the exact FoT date range shown on{" "}
                  <code>fot-reg/register/site/SiteRegistrationForm.tsx</code>.
                </li>
                <li>
                  If FoT location names have changed, or if there are new
                  locations, update table <code>FOTLOCATION</code>.
                </li>
              </ul>
              <p style={{ margin: "0" }}>
                Continue with Step 1 only after all sites information is final.
              </p>
            </div>

            <p style={{ margin: "0 0 2px", color: "#1f2937", fontWeight: 700 }}>
              After the pre-step is complete, execute Steps 1, 2, and 3 without
              refreshing the page in between.
            </p>

            <div>
              <p style={{ margin: "0 0 8px" }}>
                <strong>Step 1:</strong> Delete all currently saved FoT
                registrations as well as all access links to the registration
                page. Then create fresh FoT registration links for all active
                members (in fellowship and baptized).
              </p>
              <p
                style={{
                  margin: "0 0 10px",
                  color: "#991b1b",
                  fontWeight: 400,
                }}
              >
                <strong>WARNING:</strong> with this action, all currently saved
                FoT registrations will be deleted and all previously sent FoT
                registration links will stop working.
              </p>
              <button
                type="button"
                className={forms.button}
                onClick={() => runResetAndIssue({ sendEmails: false })}
                disabled={issuing || emailing || dryRunning}
              >
                {issuing
                  ? "Deleting current registrations and creating new links..."
                  : "Delete Current Registrations & Create New FoT Links"}
              </button>
              {lastSuccessStep === "step2" && issueMsg ? (
                <p className={forms.actionsMsg} style={{ marginTop: 12 }}>
                  {issueMsg}
                </p>
              ) : null}
            </div>

            <div>
              <p style={{ margin: "0 0 8px" }}>
                <strong>Step 2:</strong> Preview only. Shows how many members
                are eligible and how many are missing email addresses. No data
                is changed and no emails are sent.
              </p>
              <button
                type="button"
                className={forms.button}
                onClick={() =>
                  runResetAndIssue({ sendEmails: true, dryRun: true })
                }
                disabled={issuing || emailing || dryRunning}
              >
                {dryRunning ? "Dry run in progress..." : "Dry Run Invite Send"}
              </button>

              {dryRunSummary ? (
                <p className={forms.actionsMsg} style={{ marginTop: 12 }}>
                  Eligible members with email: {dryRunSummary.withEmail}.
                  <br />
                  Eligible members without email: {dryRunSummary.withoutEmail}.
                  <br />
                  Dry run only. No data was changed.
                </p>
              ) : null}

              {previewWithEmail.length ? (
                <section
                  className={forms.sectionCard}
                  style={{ marginTop: 14 }}
                >
                  <h2
                    style={{
                      margin: "0 0 10px",
                      fontSize: 22,
                      color: "#111827",
                    }}
                  >
                    Dry Run Preview: Members with email
                  </h2>
                  <div className={forms.actions} style={{ marginBottom: 10 }}>
                    <button
                      type="button"
                      className={`${forms.button} ${forms.linkButtonLight}`}
                      onClick={downloadPreviewWithEmailCsv}
                    >
                      Download list of members with email
                    </button>
                  </div>
                  <div className={forms.tableWrap}>
                    <table className={forms.table}>
                      <thead>
                        <tr>
                          <th className={forms.th}>Member ID</th>
                          <th className={forms.th}>Last name</th>
                          <th className={forms.th}>First name</th>
                          <th className={forms.th}>Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewWithEmail.map((row) => (
                          <tr key={`with-email-${row.memberId}`}>
                            <td className={forms.td}>{row.memberId}</td>
                            <td className={forms.td}>{row.lastName}</td>
                            <td className={forms.td}>{row.firstName}</td>
                            <td className={forms.td}>{row.email}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {previewMissingEmail.length ? (
                <section
                  className={forms.sectionCard}
                  style={{ marginTop: 14 }}
                >
                  <h2
                    style={{
                      margin: "0 0 10px",
                      fontSize: 22,
                      color: "#111827",
                    }}
                  >
                    Dry Run Preview: Members missing email
                  </h2>
                  <div className={forms.actions} style={{ marginBottom: 10 }}>
                    <button
                      type="button"
                      className={`${forms.button} ${forms.linkButtonLight}`}
                      onClick={downloadPreviewMissingEmailCsv}
                    >
                      Download list of members without email
                    </button>
                  </div>
                  <div className={forms.tableWrap}>
                    <table className={forms.table}>
                      <thead>
                        <tr>
                          <th className={forms.th}>Member ID</th>
                          <th className={forms.th}>Last name</th>
                          <th className={forms.th}>First name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewMissingEmail.map((row) => (
                          <tr key={`missing-email-${row.memberId}`}>
                            <td className={forms.td}>{row.memberId}</td>
                            <td className={forms.td}>{row.lastName}</td>
                            <td className={forms.td}>{row.firstName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </div>

            <div>
              <p style={{ margin: "0 0 8px" }}>
                <strong>Step 3:</strong> Sends invitation emails using the links
                already issued in Step 1.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                You can preview the email template by clicking on the button
                below. If you want to make any changes, edit file{" "}
                <code>src/lib/email/fot-invite-template.ts</code>.
              </p>
              <div style={{ margin: "0 0 12px" }}>
                <button
                  type="button"
                  onClick={() => setShowEmailPreview((prev) => !prev)}
                  className={forms.link}
                  style={{
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                    fontSize: "16px",
                  }}
                >
                  {showEmailPreview
                    ? "> Hide email template preview"
                    : "> Show email template preview"}
                </button>
              </div>
              {showEmailPreview ? (
                <section
                  className={forms.sectionCard}
                  style={{ margin: "0 0 12px" }}
                >
                  <h2
                    style={{
                      margin: "0 0 10px",
                      fontSize: 22,
                      color: "#111827",
                    }}
                  >
                    Email template preview
                  </h2>
                  <p style={{ margin: "0 0 8px" }}>
                    <strong>Subject:</strong> {previewSubject}
                  </p>
                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      background: "#fff",
                      padding: 12,
                      color: "#111827",
                      lineHeight: 1.5,
                    }}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </section>
              ) : null}
              <button
                type="button"
                className={forms.button}
                onClick={runSendIssuedEmails}
                disabled={issuing || emailing || dryRunning}
              >
                {emailing ? "Sending..." : "Send FoT invitations"}
              </button>
              {lastSuccessStep === "step4" && issueMsg ? (
                <p className={forms.actionsMsg} style={{ marginTop: 12 }}>
                  {issueMsg}
                </p>
              ) : null}
            </div>

            {failedRecipients.length ? (
              <div>
                <p style={{ margin: "0 0 8px" }}>
                  Download a CSV with recipients whose email delivery failed.
                </p>
                <button
                  type="button"
                  className={`${forms.button} ${forms.linkButtonLight}`}
                  onClick={downloadFailedCsv}
                  disabled={issuing || emailing || dryRunning}
                >
                  Download Failed Recipients CSV
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <div className={forms.actions} style={{ marginTop: 18 }}>
          <a
            href="/fot-reg/resend-invitations"
            className={`${forms.linkButton} ${forms.linkButtonLight}`}
          >
            Resend specific invitations
          </a>
        </div>
      ) : null}
    </main>
  );
}
