"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/supabase/client";
import { BackLink } from "@/components/BackLink";
import forms from "@/styles/forms.module.css";

type DetailRow = {
  regId: string;
  contactName: string;
  totalInParty: number;
  namesInParty: string;
  stayingAt: string;
  daysAtFeast: string;
  locationId: string | number;
  locationName: string;
};

type LocationOption = {
  id: string;
  name: string;
};

export default function FotRegEditPage() {
  const params = useSearchParams();
  const router = useRouter();
  const locationId = (params.get("locationId") ?? "").trim();
  const regId = (params.get("regId") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [row, setRow] = useState<DetailRow | null>(null);

  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);
  const [locationIdSelected, setLocationIdSelected] = useState(locationId);
  const [locationName, setLocationName] = useState("");

  const maxPartySize = 9;
  const [partySize, setPartySize] = useState(1);
  const [names, setNames] = useState<string[]>([""]);
  const [stayingAt, setStayingAt] = useState("");
  const [daysMode, setDaysMode] = useState<"all8" | "other">("all8");
  const [otherDays, setOtherDays] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadLocations() {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch("/api/fot-reg/locations", { headers });
        const payload = (await res.json().catch(() => ({}))) as {
          locations?: LocationOption[];
        };
        if (!cancelled && res.ok) {
          const cleaned = (payload.locations ?? [])
            .filter((opt) => opt.id && opt.name)
            .sort((a, b) => a.name.localeCompare(b.name));
          setLocationOptions(cleaned);
        }
      } catch (err) {
        console.error("Failed to load FoT locations", err);
      }
    }
    void loadLocations();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!locationId || !regId) {
        setError("Missing location or registration id.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const headers = await getAuthHeaders();
        const query = new URLSearchParams({ locationId });
        const res = await fetch(`/api/fot-reg/details?${query.toString()}`, { headers });
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          rows?: DetailRow[];
          locationName?: string;
        };
        if (!res.ok) {
          setError(payload.error ?? "Failed to load registration.");
          return;
        }
        const match = (payload.rows ?? []).find((r) => String(r.regId) === regId);
        if (!match) {
          setError("Registration not found for this location.");
          return;
        }
        if (!cancelled) {
          setRow(match);
          setLocationIdSelected(String(match.locationId ?? locationId));
          setLocationName(match.locationName || payload.locationName || "");
          const initialPartySize = Math.min(
            maxPartySize,
            Math.max(1, Number(match.totalInParty ?? 1)),
          );
          setPartySize(initialPartySize);
          const parsedNames = (match.namesInParty || "")
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean);
          setNames((prev) => {
            const base = parsedNames.length ? parsedNames : prev;
            if (base.length >= initialPartySize) return base.slice(0, initialPartySize);
            return [...base, ...Array(initialPartySize - base.length).fill("")];
          });
          setStayingAt(match.stayingAt || "");
          const entireFeast = (match.daysAtFeast ?? "").toLowerCase() === "entire feast";
          setDaysMode(entireFeast ? "all8" : "other");
          setOtherDays(entireFeast ? "" : match.daysAtFeast || "");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [locationId, regId]);

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

  async function handleSave() {
    if (!row || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const trimmedNames = names.slice(0, partySize).map((name) => name.trim());
    if (trimmedNames.some((name) => !name)) {
      setError("Please enter first and last name for each person in the party.");
      setSaving(false);
      return;
    }
    if (daysMode === "other" && !otherDays.trim()) {
      setError("Please specify the dates attending or select all eight days.");
      setSaving(false);
      return;
    }
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/fot-reg/details", {
        method: "PUT",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          regId,
          locationId: locationIdSelected || locationId,
          totalInParty: partySize,
          namesInParty: trimmedNames.join(", "),
          stayingAt,
          allEightDays: daysMode === "all8",
          daysAtFeast: daysMode === "all8" ? "" : otherDays,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Failed to save changes.");
        return;
      }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const headingText = row
    ? `Edit registration – ${row.contactName}`
    : "Edit registration";

  const formDisabled = saving || saved;

  return (
    <main className={`${forms.page} ${forms.pageNarrow}`}>
      <h1 className={forms.h1}>{headingText}</h1>
      <div className={forms.backRow}>
        <BackLink fallbackHref="/fot-reg" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          &lt;- Back to FoT locations
        </BackLink>
      </div>

      {error ? <p className={forms.error}>{error}</p> : null}
      {saved ? (
        <p className={forms.success} style={{ marginTop: 6, color: "#15803d" }}>
          Changes saved.
        </p>
      ) : null}
      {loading ? <p>Loading registration...</p> : null}

      {!loading && row ? (
        <>
          <div style={{ marginBottom: 16, lineHeight: 1.45 }}>
            <p style={{ margin: 0 }}>
              <strong>Contact:</strong> {row.contactName || "Unknown contact"}
            </p>
          </div>

          <div style={{ borderTop: "1px solid #d1d5db", paddingTop: 14 }}>
            <div
              className={forms.row}
              style={{ marginBottom: 10, gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 1fr)" }}
            >
              <label className={forms.label} htmlFor="location-name">
                Location name
              </label>
              <select
                id="location-name"
                className={forms.selectContact}
                value={locationIdSelected || ""}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setLocationIdSelected(nextId);
                  const match = locationOptions.find((opt) => String(opt.id) === nextId);
                  setLocationName(match?.name ?? locationName);
                }}
                disabled={formDisabled || !locationOptions.length}
              >
                <option value="" disabled>
                  {locationOptions.length ? "Select a location" : "Loading locations..."}
                </option>
                {locationOptions.map((opt) => (
                  <option key={opt.id} value={String(opt.id)}>{opt.name}</option>
                ))}
              </select>
            </div>

            <div
              className={forms.row}
              style={{ marginBottom: 10, gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start" }}
            >
              <label className={forms.label} htmlFor="party-size">
                Number of people in party
              </label>
              <select
                id="party-size"
                className={forms.selectContact}
                value={partySize}
                onChange={(e) => handlePartySizeChange(Number(e.target.value) || 1)}
                disabled={formDisabled}
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
                    disabled={formDisabled}
                  />
                </div>
              ))}
            </div>

            <div
              className={forms.row}
              style={{ marginBottom: 12, gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 1fr)" }}
            >
              <label className={forms.label} htmlFor="staying-at">
                Hotel you are staying at (if different from meeting location)
              </label>
              <input
                id="staying-at"
                className={forms.field}
                value={stayingAt}
                onChange={(e) => setStayingAt(e.target.value)}
                autoComplete="off"
                disabled={formDisabled}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Number of days attending services at this site
              </div>
              <label className={forms.checkControl} style={{ marginBottom: 8 }}>
                <input
                  type="radio"
                  name="days-mode"
                  checked={daysMode === "all8"}
                  onChange={() => setDaysMode("all8")}
                  disabled={formDisabled}
                />
                All 8 days
              </label>
              <label className={forms.checkControl}>
                <input
                  type="radio"
                  name="days-mode"
                  checked={daysMode === "other"}
                  onChange={() => setDaysMode("other")}
                  disabled={formDisabled}
                />
                Other (specify dates below)
              </label>
            </div>

            <div
              className={forms.row}
              style={{ marginBottom: 12, gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 1fr)" }}
            >
              <label className={forms.label} htmlFor="other-days">
                Dates attending (if not all 8 days)
              </label>
              <input
                id="other-days"
                className={forms.field}
                value={otherDays}
                onChange={(e) => setOtherDays(e.target.value)}
                disabled={formDisabled || daysMode !== "other"}
                placeholder="e.g. Sept 26-29 and Oct 2-3"
                autoComplete="off"
              />
            </div>
          </div>

          <div className={forms.actions} style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #d1d5db" }}>
            <button
              type="button"
              className={forms.button}
              onClick={handleSave}
              disabled={saving || !row}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}
