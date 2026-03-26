"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import forms from "@/styles/forms.module.css";

type NotAttendingRegistrationFormProps = {
  firstName: string;
  token: string;
};

export default function NotAttendingRegistrationForm({
  firstName,
  token,
}: NotAttendingRegistrationFormProps) {
  const currentYear = new Date().getFullYear();
  const maxPartySize = 9;
  const [partySize, setPartySize] = useState(1);
  const [names, setNames] = useState<string[]>([""]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const backHref = useMemo(() => {
    const p = new URLSearchParams();
    if (token) p.set("t", token);
    return `/fot-reg/register${p.toString() ? `?${p.toString()}` : ""}`;
  }, [token]);

  function handlePartySizeChange(next: number) {
    const clamped = Math.max(1, Math.min(maxPartySize, next || 1));
    setPartySize(clamped);
    setNames((prev) => {
      if (prev.length === clamped) return prev;
      if (prev.length > clamped) return prev.slice(0, clamped);
      return [...prev, ...Array(clamped - prev.length).fill("")];
    });
  }

  function setPersonName(index: number, value: string) {
    setNames((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function handleSubmit() {
    if (isSaving) return;
    setError("");
    setSuccess("");

    const submittedNames = names.slice(0, partySize).map((name) => name.trim());
    if (submittedNames.some((name) => !name)) {
      setError(
        "Please enter first and last name for each person in your party.",
      );
      return;
    }
    if (!token.trim()) {
      setError("Missing registration token.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/fot-reg/register/not-attending", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          totalInParty: partySize,
          names: submittedNames,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to save registration.");
      }
      setSuccess("Registration saved successfully.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save registration.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const isSaved = Boolean(success);

  return (
    <main className={`${forms.page} ${forms.pageWarn} ${forms.pageNarrow}`}>
      <h1 className={forms.h1}>Welcome {firstName || "Member"}</h1>
      <h2 style={{ margin: "0 0 14px", fontSize: 24, lineHeight: 1.25 }}>
        You are registering to not attend any of the {currentYear} Feast of
        Tabernacles sites
      </h2>

      {isSaved ? (
        <>
          <p className={forms.actionsMsg} style={{ margin: "0 0 16px" }}>
            Registration saved successfully.
            <br />
            You can now close this window, or click the button below to return
            to the FoT sites page.
          </p>
          <div
            className={forms.actions}
            style={{
              marginTop: 0,
              paddingTop: 14,
              borderTop: "1px solid #d1d5db",
            }}
          >
            <Link
              href={backHref}
              className={`${forms.linkButton} ${forms.linkButtonLight}`}
            >
              Go back to FoT sites
            </Link>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 16, lineHeight: 1.45 }}>
            <p style={{ margin: 0 }}>
              <strong>Instructions:</strong> Select the number of people in your
              party that will not be attending the Feast and enter each name in
              the field provided.
            </p>
          </div>

          <div style={{ borderTop: "1px solid #d1d5db", paddingTop: 14 }}>
            <div
              className={forms.row}
              style={{
                marginBottom: 10,
                gridTemplateColumns: "minmax(0, 1fr) auto",
                alignItems: "start",
              }}
            >
              <label className={forms.label} htmlFor="party-size-not-attending">
                Number of people in your party not attending the {currentYear}{" "}
                Feast of Tabernacles at any of the sites this year
              </label>
              <select
                id="party-size-not-attending"
                className={forms.selectContact}
                value={partySize}
                onChange={(e) =>
                  handlePartySizeChange(Number(e.target.value) || 1)
                }
                style={{ maxWidth: 92 }}
              >
                {Array.from({ length: maxPartySize }, (_, i) => i + 1).map(
                  (n) => (
                    <option key={`party-not-attending-${n}`} value={n}>
                      {n}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
              {names.slice(0, partySize).map((_, index) => (
                <div
                  key={`person-not-attending-${index}`}
                  className={forms.row}
                  style={{
                    gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 1.2fr)",
                  }}
                >
                  <label
                    className={forms.label}
                    htmlFor={`person-not-attending-name-${index}`}
                  >
                    {partySize === 1
                      ? "First and last name of individual:"
                      : `First and last name of individual ${index + 1}:`}
                  </label>
                  <input
                    id={`person-not-attending-name-${index}`}
                    className={forms.field}
                    value={names[index] ?? ""}
                    onChange={(e) => setPersonName(index, e.target.value)}
                    placeholder="First and last name"
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>
          </div>

          <div
            className={forms.actions}
            style={{
              marginTop: 16,
              paddingTop: 14,
              borderTop: "1px solid #d1d5db",
            }}
          >
            <button
              type="button"
              className={forms.button}
              onClick={handleSubmit}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Complete Registration"}
            </button>
            <Link
              href={backHref}
              className={`${forms.linkButton} ${forms.linkButtonLight}`}
            >
              Cancel Registration
            </Link>
          </div>
          {error ? <p className={forms.error}>{error}</p> : null}
        </>
      )}
    </main>
  );
}
