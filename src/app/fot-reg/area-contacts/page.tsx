"use client";

import { useEffect, useMemo, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";
import { BackLink } from "@/components/BackLink";
import forms from "@/styles/forms.module.css";

type DetailRow = {
  contactName: string;
  locationName: string;
  totalInParty: number;
  namesInParty: string;
  stayingAt: string;
  daysAtFeast: string;
  dateRegistered: string;
};

type SortField = "contactName" | "locationName" | "dateRegistered";
type SortDirection = "asc" | "desc";

function formatRegisteredDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

export default function FotAreaContactsPage() {
  const currentYear = new Date().getFullYear();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [sortField, setSortField] = useState<SortField>("contactName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const sortedRows = useMemo(() => {
    const mult = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const primary = a[sortField].localeCompare(b[sortField]);
      if (primary !== 0) return primary * mult;
      return a.dateRegistered.localeCompare(b.dateRegistered) * mult;
    });
  }, [rows, sortDirection, sortField]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  }

  function sortArrow(field: SortField) {
    if (sortField !== field) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch("/api/fot-reg/area-contacts", {
          method: "GET",
          headers,
        });
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          rows?: DetailRow[];
        };
        if (!res.ok) {
          setError(payload.error ?? "Failed to load area contacts.");
          return;
        }
        if (!cancelled) {
          setRows(payload.rows ?? []);
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

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>FoT {currentYear} - Contacts in your area</h1>
      <div className={forms.backRow}>
        <BackLink
          fallbackHref="/fot-reg"
          className={`${forms.linkButton} ${forms.linkButtonLight}`}
        >
          &lt;- Back to general FoT listing
        </BackLink>
      </div>

      {error ? <p className={forms.error}>{error}</p> : null}
      {loading ? <p>Loading contacts...</p> : null}
      {!loading && !error ? (
        rows.length ? (
          <div className={forms.tableWrap}>
            <table className={forms.table}>
              <thead>
                <tr>
                  <th className={forms.th}>
                    <button
                      type="button"
                      onClick={() => toggleSort("contactName")}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontWeight: 600 }}
                    >
                      Contact name {sortArrow("contactName")}
                    </button>
                  </th>
                  <th className={forms.th}>
                    <button
                      type="button"
                      onClick={() => toggleSort("locationName")}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontWeight: 600 }}
                    >
                      Location {sortArrow("locationName")}
                    </button>
                  </th>
                  <th className={forms.th}>Total in party</th>
                  <th className={forms.th}>Names in party</th>
                  <th className={forms.th}>Staying at</th>
                  <th className={forms.th}>Days at feast</th>
                  <th className={forms.th}>
                    <button
                      type="button"
                      onClick={() => toggleSort("dateRegistered")}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontWeight: 600 }}
                    >
                      Date registered {sortArrow("dateRegistered")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, index) => (
                  <tr key={`${row.contactName}-${row.dateRegistered}-${index}`}>
                    <td className={forms.td}>{row.contactName}</td>
                    <td className={forms.td}>{row.locationName}</td>
                    <td className={forms.td}>{row.totalInParty}</td>
                    <td className={forms.td}>{row.namesInParty}</td>
                    <td className={forms.td}>{row.stayingAt}</td>
                    <td className={forms.td}>{row.daysAtFeast}</td>
                    <td className={forms.td}>{formatRegisteredDate(row.dateRegistered)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No registrations found for members in your area.</p>
        )
      ) : null}
    </main>
  );
}
