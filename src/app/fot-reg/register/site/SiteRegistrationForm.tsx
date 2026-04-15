"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import forms from "@/styles/forms.module.css";
import styles from "./page.module.css";

type SiteRegistrationFormProps = {
  firstName: string;
  siteName: string;
  siteId: string;
  token: string;
};

export default function SiteRegistrationForm({
  firstName,
  siteName,
  siteId,
  token,
}: SiteRegistrationFormProps) {
  const currentYear = new Date().getFullYear();
  const maxPartySize = 9;
  const [partySize, setPartySize] = useState(1);
  const [names, setNames] = useState<string[]>([""]);
  const [hotel, setHotel] = useState("");
  const [daysMode, setDaysMode] = useState<"all8" | "other">("all8");
  const [otherDays, setOtherDays] = useState("");
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
      setError("Please enter first and last name for each person in your party.");
      return;
    }
    if (!siteId.trim()) {
      setError("Missing site id for this registration.");
      return;
    }
    if (!token.trim()) {
      setError("Missing registration token.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/fot-reg/register/site", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          siteId: siteId.trim(),
          totalInParty: partySize,
          names: submittedNames,
          accommodation: hotel.trim(),
          allEightDays: daysMode === "all8",
          days: otherDays.trim(),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to save registration.");
      }
      setSuccess("Registration saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save registration.");
    } finally {
      setIsSaving(false);
    }
  }

  const isSaved = Boolean(success);

  return (
    <main className={`${forms.page} ${forms.pageNarrow}`} style={{ overflowX: "hidden" }}>
      <h1 className={forms.h1}>Welcome {firstName || "Member"}</h1>
      <h2 style={{ margin: "0 0 14px", fontSize: 24, lineHeight: 1.25 }}>
        You are registering to attend the {currentYear} Feast of Tabernacles in {siteName}
      </h2>

      {isSaved ? (
        <>
          <p className={forms.actionsMsg} style={{ margin: "0 0 8px" }}>
            Registration saved successfully.
          </p>
          <p style={{ margin: "0 0 16px", color: "#111827" }}>
            You can now close this window, or click the button below to return to the FoT sites page.
          </p>
          <div className={forms.actions} style={{ marginTop: 0, paddingTop: 14, borderTop: "1px solid #d1d5db" }}>
            <Link href={backHref} className={`${forms.linkButton} ${forms.linkButtonLight}`}>
              Go back to FoT sites
            </Link>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 16, lineHeight: 1.45 }}>
            <p style={{ margin: 0 }}>
              <strong>Instructions:</strong> Select the number of people that will be attending the Feast with
              you and enter each name in the field provided. If you are staying at a hotel different than where
              services will be held, please specify the name of that hotel. If you are not planning on staying
              for the full 8 days of the Feast of Tabernacles and the Last Great Day, specify the date(s) that
              you will be attending the site you are registering for.
            </p>
            <p style={{ margin: "12px 0 0" }}>
              <strong>
                You are responsible for making your own reservations with the hotel you choose to stay at.
                Contact the hotel to make your hotel reservations.
              </strong>
            </p>
          </div>

          <div style={{ borderTop: "1px solid #d1d5db", paddingTop: 14 }} className={styles.formStack}>
            <div
              className={forms.row}
              style={{ marginBottom: 10, gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start" }}
            >
              <label className={forms.label} htmlFor="party-size">
                Number of people in your party attending services
              </label>
              <select
                id="party-size"
                className={forms.selectContact}
                value={partySize}
                onChange={(e) => handlePartySizeChange(Number(e.target.value) || 1)}
                style={{ maxWidth: 92 }}
              >
                {Array.from({ length: maxPartySize }, (_, i) => i + 1).map((n) => (
                  <option key={`party-${n}`} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
              {names.slice(0, partySize).map((_, index) => (
                <div
                  key={`person-${index}`}
                  className={forms.row}
                  style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 1.2fr)" }}
                >
                  <label className={forms.label} htmlFor={`person-name-${index}`}>
                    {partySize === 1
                      ? "First and last name of individual:"
                      : `First and last name of individual ${index + 1}:`}
                  </label>
                  <input
                    id={`person-name-${index}`}
                    className={forms.field}
                    value={names[index] ?? ""}
                    onChange={(e) => setPersonName(index, e.target.value)}
                    placeholder="First and last name"
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>

            <div
              className={forms.row}
              style={{ marginBottom: 12, gridTemplateColumns: "minmax(0, 1.3fr) minmax(320px, 1fr)" }}
            >
              <label className={forms.label} htmlFor="hotel-name">
                Hotel you are staying at (if different from meeting location)
              </label>
              <input
                id="hotel-name"
                className={forms.field}
                value={hotel}
                onChange={(e) => setHotel(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Number of days you will be attending services at this site
              </div>
              <label className={forms.checkControl} style={{ marginBottom: 8 }}>
                <input
                  type="radio"
                  name="days-mode"
                  checked={daysMode === "all8"}
                  onChange={() => setDaysMode("all8")}
                />
                All 8 days (Sept 26 - Oct 3)
              </label>
              <label className={forms.checkControl}>
                <input
                  type="radio"
                  name="days-mode"
                  checked={daysMode === "other"}
                  onChange={() => setDaysMode("other")}
                />
                Other (Specify dates below)
              </label>
            </div>

            <div
              className={forms.row}
              style={{ marginBottom: 12, gridTemplateColumns: "minmax(0, 1.3fr) minmax(320px, 1fr)" }}
            >
              <label className={forms.label} htmlFor="other-days">
                Dates attending (if not all 8 days)
              </label>
              <input
                id="other-days"
                className={forms.field}
                value={otherDays}
                onChange={(e) => setOtherDays(e.target.value)}
                disabled={daysMode !== "other"}
                placeholder="e.g. Sept 26-29 and Oct 2-3"
                autoComplete="off"
              />
            </div>
          </div>

          <div className={forms.actions} style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #d1d5db" }}>
            <button type="button" className={forms.button} onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? "Saving..." : "Complete Registration"}
            </button>
            <Link href={backHref} className={`${forms.linkButton} ${forms.linkButtonLight}`}>
              Cancel Registration
            </Link>
          </div>
          {error ? <p className={forms.error}>{error}</p> : null}
        </>
      )}
    </main>
  );
}
