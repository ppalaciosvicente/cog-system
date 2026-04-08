"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/supabase/client";
import { BackLink } from "@/components/BackLink";
import forms from "@/styles/forms.module.css";

type LocationAttendanceRow = {
  locationId: string;
  locationName: string;
  attendance: number;
};

export default function FotRegistrationPage() {
  const currentYear = new Date().getFullYear();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LocationAttendanceRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const headers = await getAuthHeaders();
        const res = await fetch("/api/fot-reg/summary", {
          method: "GET",
          headers,
        });
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          rows?: LocationAttendanceRow[];
          isAdmin?: boolean;
        };
        if (!res.ok) {
          setError(payload.error ?? "Failed to load FoT registration summary.");
          return;
        }

        if (!cancelled) {
          const incoming = payload.rows ?? [];

          const mergedByName = new Map<string, LocationAttendanceRow>();
          incoming.forEach((row) => {
            const normName = String(row.locationName ?? "")
              .normalize("NFKD")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
            const normId = String(row.locationId ?? "").trim();
            const key = normName || normId;
            if (!key) return;

            const attendance = Number(row.attendance ?? 0);
            const existing = mergedByName.get(key);
            if (existing) {
              mergedByName.set(key, {
                locationId: existing.locationId || normId || row.locationId || key,
                locationName: existing.locationName || row.locationName || "",
                attendance: existing.attendance + attendance,
              });
            } else {
              mergedByName.set(key, {
                locationId: normId || row.locationId || key,
                locationName: row.locationName || "",
                attendance,
              });
            }
          });

          setRows(Array.from(mergedByName.values()));
          setIsAdmin(Boolean(payload.isAdmin));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasRows = useMemo(() => rows.length > 0, [rows]);

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>{currentYear} Feast of Tabernacles Registration</h1>
      <div className={forms.backRow}>
        <BackLink fallbackHref="/" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          &lt;- Back to Dashboard
        </BackLink>
      </div>
      {error ? <p className={forms.error}>{error}</p> : null}
      {loading ? <p>Loading locations...</p> : null}
      {!loading && !error ? (
        hasRows ? (
          <div className={forms.tableWrap}>
            <table className={forms.table}>
              <thead>
                <tr>
                  <th className={forms.th}>Location</th>
                  <th className={forms.th}>Attendance</th>
                  <th className={forms.th}>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.locationId}>
                    <td className={forms.td}>{row.locationName}</td>
                    <td className={forms.td}>{row.attendance}</td>
                    <td className={forms.td}>
                      <Link
                        href={`/fot-reg/details?locationId=${encodeURIComponent(row.locationId)}`}
                        className={`${forms.linkButton} ${forms.linkButtonLight} ${forms.linkButtonCompactTouch}`}
                      >
                        View details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No locations currently have attendance greater than zero.</p>
        )
      ) : null}
      <div className={forms.actions} style={{ marginTop: 16 }}>
        <Link
          href="/fot-reg/area-contacts"
          className={`${forms.linkButton} ${forms.linkButtonLight}`}
        >
          View Contacts in your area
        </Link>
      </div>
      {isAdmin ? (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ margin: "0 0 10px" }}>Administration</h3>
        </div>
      ) : null}
      {isAdmin ? (
        <div className={forms.actions} style={{ marginTop: 0, flexDirection: "column", alignItems: "flex-start" }}>
          <Link
            href="/fot-reg/resend-invitations"
            className={`${forms.linkButton} ${forms.linkButtonLight}`}
          >
            Resend specific FoT invitations
          </Link>
        </div>
      ) : null}
      {isAdmin ? (
        <div className={forms.actions} style={{ marginTop: 12 }}>
          <Link href="/fot-reg/send-yearly" className={`${forms.linkButton} ${forms.linkButtonDanger}`}>
            Send yearly FoT invitations
          </Link>
        </div>
      ) : null}
    </main>
  );
}
