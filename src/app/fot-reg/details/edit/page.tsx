"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function FotRegEditPage() {
  const params = useSearchParams();
  const router = useRouter();
  const locationId = (params.get("locationId") ?? "").trim();
  const regId = (params.get("regId") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [row, setRow] = useState<DetailRow | null>(null);

  const [locationName, setLocationName] = useState("");
  const [totalInParty, setTotalInParty] = useState(0);
  const [namesInParty, setNamesInParty] = useState("");
  const [stayingAt, setStayingAt] = useState("");
  const [allEightDays, setAllEightDays] = useState(false);
  const [daysAtFeast, setDaysAtFeast] = useState("");

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
          setLocationName(match.locationName || payload.locationName || "");
          setTotalInParty(Number(match.totalInParty ?? 0));
          setNamesInParty(match.namesInParty || "");
          setStayingAt(match.stayingAt || "");
          const entireFeast = (match.daysAtFeast ?? "").toLowerCase() === "entire feast";
          setAllEightDays(entireFeast);
          setDaysAtFeast(entireFeast ? "" : match.daysAtFeast || "");
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

  async function handleSave() {
    if (!row || saving) return;
    setSaving(true);
    setError(null);
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
          locationId,
          locationName,
          totalInParty,
          namesInParty,
          stayingAt,
          allEightDays,
          daysAtFeast: allEightDays ? "" : daysAtFeast,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Failed to save changes.");
        return;
      }
      router.replace(`/fot-reg/details?locationId=${encodeURIComponent(locationId)}`);
    } finally {
      setSaving(false);
    }
  }

  const headingText = row
    ? `Edit registration – ${row.contactName}`
    : "Edit registration";

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>{headingText}</h1>
      <div className={forms.backRow}>
        <BackLink
          fallbackHref={`/fot-reg/details?locationId=${encodeURIComponent(locationId)}`}
          className={`${forms.linkButton} ${forms.linkButtonLight}`}
        >
          &lt;- Back to FoT details
        </BackLink>
      </div>

      {error ? <p className={forms.error}>{error}</p> : null}
      {loading ? <p>Loading registration...</p> : null}
      {!loading && row ? (
        <div className={forms.formGrid} style={{ marginTop: 12 }}>
          <div className={forms.col}>
            <div className={forms.row}>
              <div className={forms.label}>Contact name:</div>
              <div className={forms.control}>{row.contactName}</div>
            </div>
            <div className={forms.row}>
              <div className={forms.label}>Location name:</div>
              <div className={forms.control}>
                <input
                  className={forms.field}
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
            <div className={forms.row}>
              <div className={forms.label}>Total in party:</div>
              <div className={forms.control}>
                <input
                  type="number"
                  min={0}
                  className={forms.field}
                  value={Number.isFinite(totalInParty) ? totalInParty : 0}
                  onChange={(e) => setTotalInParty(Number(e.target.value))}
                  disabled={saving}
                />
              </div>
            </div>
            <div className={forms.row}>
              <div className={forms.label}>Names in party:</div>
              <div className={forms.control}>
                <textarea
                  className={`${forms.field} ${forms.textarea}`}
                  rows={3}
                  placeholder="Comma-separated names"
                  value={namesInParty}
                  onChange={(e) => setNamesInParty(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          <div className={forms.col}>
            <div className={forms.row}>
              <div className={forms.label}>Staying at:</div>
              <div className={forms.control}>
                <input
                  className={forms.field}
                  value={stayingAt}
                  onChange={(e) => setStayingAt(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
            <div className={forms.row} style={{ alignItems: "center" }}>
              <div className={forms.label}>Entire feast:</div>
              <div className={forms.control} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={allEightDays}
                  onChange={(e) => setAllEightDays(e.target.checked)}
                  disabled={saving}
                />
                <span style={{ fontSize: 14, color: "#4b5563" }}>Select if attending all eight days</span>
              </div>
            </div>
            <div className={forms.row}>
              <div className={forms.label}>Days at feast:</div>
              <div className={forms.control}>
                <input
                  className={forms.field}
                  value={daysAtFeast}
                  onChange={(e) => setDaysAtFeast(e.target.value)}
                  disabled={saving || allEightDays}
                  placeholder={allEightDays ? "All eight days selected" : "Example: 1-4, 7-8"}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className={forms.actions} style={{ marginTop: 18 }}>
        <button
          type="button"
          className={forms.button}
          onClick={handleSave}
          disabled={saving || !row}
          style={{ opacity: saving ? 0.7 : 1 }}
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        <Link
          href={`/fot-reg/details?locationId=${encodeURIComponent(locationId)}`}
          className={`${forms.linkButton} ${forms.linkButtonLight}`}
          style={{ marginLeft: 10, textDecoration: "none" }}
        >
          Cancel
        </Link>
      </div>
    </main>
  );
}
