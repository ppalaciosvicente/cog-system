"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  dateRegistered: string;
};

type SortField = "contactName" | "dateRegistered";
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

function FotRegistrationDetailsInner() {
  const params = useSearchParams();
  const locationId = (params.get("locationId") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [locationName, setLocationName] = useState("");
  const [totalAttendance, setTotalAttendance] = useState(0);
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deletingRegId, setDeletingRegId] = useState<string | null>(null);
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
      if (!locationId) {
        setError("Missing location id.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setSuccessMessage(null);
      try {
        const headers = await getAuthHeaders();
        const query = new URLSearchParams({ locationId });
        const res = await fetch(`/api/fot-reg/details?${query.toString()}`, {
          method: "GET",
          headers,
        });
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          locationName?: string;
          totalAttendance?: number;
          rows?: DetailRow[];
          canDelete?: boolean;
        };
        if (!res.ok) {
          setError(payload.error ?? "Failed to load details.");
          return;
        }
        if (!cancelled) {
          setLocationName(payload.locationName ?? locationId);
          setTotalAttendance(Number(payload.totalAttendance ?? 0));
          setRows(payload.rows ?? []);
          setIsAdmin(Boolean(payload.canDelete));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  async function handleDelete(row: DetailRow) {
    if (!isAdmin || !row.regId || deletingRegId) return;
    const ok = window.confirm(`Delete registration for ${row.contactName}?`);
    if (!ok) return;

    setDeletingRegId(row.regId);
    setError(null);
    setSuccessMessage(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/fot-reg/details", {
        method: "DELETE",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ regId: row.regId }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Failed to delete registration.");
        return;
      }

      setRows((prev) => prev.filter((item) => item.regId !== row.regId));
      setTotalAttendance((prev) => Math.max(0, prev - Number(row.totalInParty || 0)));
      setSuccessMessage("Registration deleted.");
    } finally {
      setDeletingRegId(null);
    }
  }

  const titleLocation = useMemo(() => {
    if (locationName) return locationName;
    if (locationId) return locationId;
    return "Unknown";
  }, [locationId, locationName]);

  const headingText = loading
    ? "Loading FoT registrations…"
    : `Members registered for ${titleLocation}: ${totalAttendance}`;

  return (
    <main className={forms.page}>
      <h1 className={forms.h1}>{headingText}</h1>
      <div className={forms.backRow}>
        <BackLink
          fallbackHref="/fot-reg"
          className={`${forms.linkButton} ${forms.linkButtonLight}`}
        >
          &lt;- Back to general FoT listing
        </BackLink>
      </div>

      {error ? <p className={forms.error}>{error}</p> : null}
      {successMessage ? <p className={forms.success}>{successMessage}</p> : null}
      {loading ? <p>Loading registrations...</p> : null}
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
                  {isAdmin ? <th className={forms.th}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, index) => (
                  <tr key={`${row.contactName}-${row.dateRegistered}-${index}`}>
                    <td className={forms.td}>{row.contactName}</td>
                    <td className={forms.td}>{row.totalInParty}</td>
                    <td className={forms.td}>{row.namesInParty}</td>
                    <td className={forms.td}>{row.stayingAt}</td>
                    <td className={forms.td}>{row.daysAtFeast}</td>
                    <td className={forms.td}>{formatRegisteredDate(row.dateRegistered)}</td>
                    {isAdmin ? (
                      <td className={forms.td}>
                        <button
                          type="button"
                          className={`${forms.button} ${forms.buttonDanger} ${forms.linkButtonCompactTouch}`}
                          onClick={() => void handleDelete(row)}
                          disabled={Boolean(deletingRegId)}
                        >
                          {deletingRegId === row.regId ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No registrations found for this location.</p>
        )
      ) : null}
    </main>
  );
}

export default function FotRegistrationDetailsPage() {
  return (
    <Suspense fallback={<p>Loading registration details...</p>}>
      <FotRegistrationDetailsInner />
    </Suspense>
  );
}
