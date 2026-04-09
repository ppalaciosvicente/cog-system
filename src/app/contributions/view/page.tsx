"use client";

import { useEffect, useMemo, useState } from "react";
import { ContributionPage } from "@/components/contributions/ContributionPage";
import {
  type ContributionDraftInput,
  type ContributionRecord,
  CONTRIBUTION_FUND_TYPE_NAMES,
  CONTRIBUTION_TYPE_NAMES,
} from "@/lib/contributions";
import {
  getContributionLookupsCached,
  getContributionMemberOptionsCached,
} from "@/lib/contributions-client-cache";
import { buildSimplePdf } from "@/lib/simple-pdf";
import { getAuthHeaders } from "@/lib/supabase/client";
import forms from "@/styles/forms.module.css";

type HouseholdOption = {
  value: number;
  label: string;
  memberIds: number[];
};

type CurrencyOption = {
  code: string;
  name: string;
  symbol: string;
};

const DEFAULT_CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "Pound Sterling", symbol: "£" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$" },
];

type EditDraft = {
  id: number;
  memberId: string;
  memberLabel: string;
  amount: string;
  fundType: string;
  currencyCode: string;
  checkNo: string;
  contributionType: string;
  dateDeposited: string;
  comments: string;
};

type Mode = "view" | "grandTotal" | "totalPerDonor" | "taxReceipts";
type SortKey = "memberName" | "contributionType" | "dateDeposited" | "dateEntered";
type SortDirection = "asc" | "desc";

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function dateDaysAgoString(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatAmount(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toEditDraft(row: ContributionRecord): EditDraft {
  return {
    id: row.id,
    memberId: String(row.memberId),
    memberLabel: row.memberName,
    amount: String(row.amount),
    fundType: row.fundType,
    currencyCode: row.currencyCode,
    checkNo: row.checkNo ?? "",
    contributionType: row.contributionType,
    dateDeposited: row.dateDeposited,
    comments: row.comments ?? "",
  };
}

function sortIndicator(active: boolean, direction: SortDirection) {
  if (!active) return "↕";
  return direction === "asc" ? "▲" : "▼";
}

export default function ViewContributionsPage() {
  const [startDate, setStartDate] = useState(dateDaysAgoString(30));
  const [endDate, setEndDate] = useState(todayDateString());
  const [fundType, setFundType] = useState("");
  const [contributionType, setContributionType] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [fundTypeOptions, setFundTypeOptions] = useState<string[]>([
    ...CONTRIBUTION_FUND_TYPE_NAMES,
  ]);
  const [contributionTypeOptions, setContributionTypeOptions] = useState<string[]>([
    ...CONTRIBUTION_TYPE_NAMES,
  ]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [countryNameByCode, setCountryNameByCode] = useState<Record<string, string>>({});
  const [currencyOptions, setCurrencyOptions] = useState<CurrencyOption[]>(DEFAULT_CURRENCY_OPTIONS);
  const [householdDefaultCurrencyByRepresentative, setHouseholdDefaultCurrencyByRepresentative] =
    useState<Record<string, string>>({});
  const [rows, setRows] = useState<ContributionRecord[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportDownloading, setReportDownloading] = useState<Mode | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("dateDeposited");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [exportError, setExportError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");

  function isCashFundType(value: string) {
    return value.trim().toLowerCase() === "cash";
  }

  useEffect(() => {
    let cancelled = false;

    async function loadMemberOptions() {
      try {
        const payload = await getContributionMemberOptionsCached();

        if (!cancelled) {
          setHouseholdDefaultCurrencyByRepresentative(
            payload.householdDefaultCurrencyByRepresentative ?? {},
          );
        }
      } catch (loadError) {
        // Non-blocking for filters; ignore.
      }
    }

    loadMemberOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLookups() {
      try {
        const payload = await getContributionLookupsCached();

        if (cancelled) return;
        if (Array.isArray(payload.fundTypes) && payload.fundTypes.length > 0) {
          setFundTypeOptions(payload.fundTypes);
        }
        if (Array.isArray(payload.contributionTypes) && payload.contributionTypes.length > 0) {
          setContributionTypeOptions(payload.contributionTypes);
        }
        if (Array.isArray(payload.currencies) && payload.currencies.length > 0) {
          setCurrencyOptions(payload.currencies);
        }
        if (Array.isArray(payload.countries) && payload.countries.length > 0) {
          setCountryOptions(payload.countries.map((row) => row.code));
        }
        if (payload.countryNameByCode) {
          setCountryNameByCode(payload.countryNameByCode);
        }
      } catch {
        // Keep static fallback options.
      }
    }

    void loadLookups();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadContributions(filters?: {
    startDate?: string;
    endDate?: string;
    fundType?: string;
    contributionType?: string;
    countryCode?: string;
  }) {
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setReportMessage(null);

    try {
      const headers = await getAuthHeaders();
      const activeStartDate = filters?.startDate ?? startDate;
      const activeEndDate = filters?.endDate ?? endDate;
      const activeFundType = filters?.fundType ?? fundType;
      const activeContributionType = filters?.contributionType ?? contributionType;
      const activeCountryCode = filters?.countryCode ?? countryCode;
      const params = new URLSearchParams({
        startDate: activeStartDate,
        endDate: activeEndDate,
      });
      if (activeFundType) params.set("fundType", activeFundType);
      if (activeContributionType) params.set("contributionType", activeContributionType);
      if (activeCountryCode) params.set("country", activeCountryCode);

      const response = await fetch(`/api/contributions?${params.toString()}`, {
        credentials: "include",
        headers,
      });
      const payload = (await response.json()) as {
        rows?: ContributionRecord[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load contributions.");
      }

      setRows(payload.rows ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load contributions.",
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function downloadReport(kind: Mode) {
    const friendlyName =
      kind === "grandTotal"
        ? "Grand Total"
        : kind === "totalPerDonor"
          ? "Total per Donor"
          : "Tax Receipts";
    setReportDownloading(kind);
    setReportError(null);
    setReportMessage(null);

    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ startDate, endDate });
      if (countryCode) params.append("country", countryCode);
      if (kind === "taxReceipts") params.append("deductibleOnly", "true");
      if (kind !== "taxReceipts" && fundType) params.append("fundType", fundType);
      if (kind !== "taxReceipts" && contributionType) {
        params.append("contributionType", contributionType);
      }

      const endpoint =
        kind === "grandTotal"
          ? "/api/contributions/reports/grand-total"
          : kind === "totalPerDonor"
            ? "/api/contributions/reports/total-per-donor"
            : "/api/contributions/reports/quarterly";

      const response = await fetch(`${endpoint}?${params.toString()}`, {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Failed to generate ${friendlyName} report.`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const contentDisposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
      link.href = url;
      link.download =
        filenameMatch?.[1] ??
        `${friendlyName.toLowerCase().replace(/ /g, "-")}-${startDate || "all"}-to-${endDate || "all"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setReportMessage(`${friendlyName} report downloaded.`);
    } catch (downloadError) {
      setReportError(
        downloadError instanceof Error
          ? downloadError.message
          : `Failed to generate ${friendlyName} report.`,
      );
    } finally {
      setReportDownloading(null);
    }
  }

  function downloadPdf() {
    setExportError(null);
    if (!rows.length) {
      setExportError("No results to download.");
      return;
    }
    const wrapLine = (text: string, max: number) => {
      if (text.length <= max) return [text];
      const trimmed = text.slice(0, max + 1);
      const lastSpace = trimmed.lastIndexOf(" ");
      if (lastSpace === -1) return [text.slice(0, max), text.slice(max).trimStart()];
      return [text.slice(0, lastSpace), text.slice(lastSpace + 1).trimStart()];
    };
    const filterParts: string[] = [];
    if (fundType) filterParts.push(`Fund: ${fundType}`);
    if (contributionType) filterParts.push(`Type: ${contributionType}`);
    if (countryCode) {
      const countryLabel = countryNameByCode[countryCode] ?? countryCode;
      filterParts.push(`Country: ${countryLabel}`);
    }

    const filterLines = filterParts;
    const lines: Parameters<typeof buildSimplePdf>[0] = [];
    let headerY = 760;
    lines.push({ text: "Contributions", size: 18, bold: true, x: 30, y: headerY });
    headerY -= 18;
    lines.push({ text: `From ${startDate} to ${endDate}`, size: 12, x: 30, y: headerY });
    headerY -= 16;
    filterLines.forEach((text) => {
      lines.push({ text, size: 11, x: 30, y: headerY });
      headerY -= 14;
    });
    headerY -= 22; // larger gap before table
    lines.push({ text: "Member", bold: true, size: 11, x: 30, y: headerY });
    lines.push({ text: "Country", bold: true, size: 11, x: 155, y: headerY });
    lines.push({ text: "Amount", bold: true, size: 11, x: 205, y: headerY });
    lines.push({ text: "Fund", bold: true, size: 11, x: 270, y: headerY });
    lines.push({ text: "Contrib. Type", bold: true, size: 11, x: 355, y: headerY });
    lines.push({ text: "Date Dep.", bold: true, size: 11, x: 445, y: headerY });
    lines.push({ text: "Date Ent.", bold: true, size: 11, x: 525, y: headerY });

    let y = headerY - 16;
    for (const row of rows) {
      const memberLines = wrapLine(row.memberName, 16);
      memberLines.forEach((text, index) => {
        lines.push({ text, size: 10, x: 30, y: y - index * 11 });
      });

      lines.push({ text: row.memberCountryCode ?? "", size: 10, x: 155, y });

      const amountText = `${row.currencyCode} ${formatAmount(row.amount)}`;
      lines.push({ text: amountText, size: 10, x: 205, y });

      const fundBase = row.fundType;
      const fundLines = row.checkNo
        ? [fundBase, `(#${row.checkNo})`]
        : wrapLine(fundBase, 14);
      fundLines.forEach((text, index) => {
        lines.push({ text, size: 10, x: 270, y: y - index * 11 });
      });

      lines.push({ text: row.contributionType, size: 10, x: 355, y });
      lines.push({ text: row.dateDeposited, size: 10, x: 445, y });
      lines.push({ text: row.dateEntered.slice(0, 10), size: 10, x: 525, y });

      const maxLines = Math.max(memberLines.length, fundLines.length, 1);
      y -= maxLines * 11 + 1;
      if (y < 80) break;
    }

    const totalsByCurrency = rows.reduce<Record<string, number>>((acc, row) => {
      const current = acc[row.currencyCode] ?? 0;
      acc[row.currencyCode] = current + row.amount;
      return acc;
    }, {});
    const totalStartY = y - 12;
    lines.push({ text: "Grand Total", size: 11, bold: true, x: 30, y: totalStartY });
    Object.entries(totalsByCurrency).forEach(([code, amount], index) => {
      lines.push({
        text: `${code} ${formatAmount(amount)}`,
        size: 11,
        bold: true,
        x: 205,
        y: totalStartY - index * 12,
      });
    });

    const footerY = 32;
    const todayLong = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date());
    lines.push({ text: todayLong, size: 10, x: 30, y: footerY, bold: false, italic: true });
    lines.push({ text: "Page 1 of 1", size: 10, x: 520, y: footerY, align: "right", bold: false, italic: true });

    const pdfBuffer = buildSimplePdf(lines);
    const blob = new Blob([pdfBuffer], { type: "application/pdf" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `contributions-${startDate}-to-${endDate}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  function updateEditField(field: keyof EditDraft, value: string) {
    setEditDraft((current) => {
      if (!current) return current;
      if (field === "fundType") {
        return {
          ...current,
          fundType: value,
          checkNo: isCashFundType(value) ? "" : current.checkNo,
        };
      }
      if (field === "memberId") {
        const defaultCurrencyCode = value
          ? (householdDefaultCurrencyByRepresentative[value] ?? current.currencyCode ?? "USD")
          : current.currencyCode;
        return {
          ...current,
          memberId: value,
          currencyCode: defaultCurrencyCode,
        };
      }
      return { ...current, [field]: value };
    });
  }

  function buildEditPayload(draft: EditDraft): ContributionDraftInput {
    const parsedMemberId = Number(draft.memberId);
    const parsedAmount = Number(draft.amount);

    if (!Number.isInteger(parsedMemberId) || parsedMemberId <= 0) {
      throw new Error("Select a member.");
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      throw new Error("Amount must be greater than zero.");
    }
    if (!draft.fundType.trim()) {
      throw new Error("Select a fund type.");
    }
    if (!draft.currencyCode.trim()) {
      throw new Error("Select a currency.");
    }
    if (!draft.contributionType.trim()) {
      throw new Error("Select a contribution type.");
    }
    if (!draft.dateDeposited.trim()) {
      throw new Error("Select the date deposited.");
    }

    return {
      memberId: parsedMemberId,
      amount: parsedAmount,
      fundType: draft.fundType.trim(),
      currencyCode: draft.currencyCode.trim().toUpperCase(),
      checkNo: draft.checkNo.trim() || null,
      contributionType: draft.contributionType.trim(),
      dateDeposited: draft.dateDeposited.trim(),
      comments: draft.comments.trim() || null,
    };
  }

  async function handleSaveEdit() {
    if (!editDraft) return;
    setEditError(null);

    let payload: ContributionDraftInput;
    try {
      payload = buildEditPayload(editDraft);
    } catch (validationError) {
      setEditError(
        validationError instanceof Error ? validationError.message : "Failed to validate row.",
      );
      return;
    }

    setEditSaving(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/contributions/${editDraft.id}`, {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to update contribution.");
      }

      setEditDraft(null);
      await loadContributions();
    } catch (saveError) {
      setEditError(saveError instanceof Error ? saveError.message : "Failed to update contribution.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(row: ContributionRecord) {
    const ok = window.confirm(`Delete contribution for ${row.memberName} on ${row.dateDeposited}?`);
    if (!ok) return;

    setDeletingId(row.id);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/contributions/${row.id}`, {
        method: "DELETE",
        credentials: "include",
        headers,
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to delete contribution.");
      }

      setRows((current) => current.filter((item) => item.id !== row.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete contribution.");
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSort(nextKey: SortKey) {
    setSortKey((currentKey) => {
      if (currentKey === nextKey) {
        setSortDirection((currentDirection) =>
          currentDirection === "asc" ? "desc" : "asc",
        );
        return currentKey;
      }

      setSortDirection(nextKey === "memberName" || nextKey === "contributionType" ? "asc" : "desc");
      return nextKey;
    });
  }

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      let comparison = 0;

      if (sortKey === "memberName") {
        comparison = a.memberName.localeCompare(b.memberName);
      } else if (sortKey === "contributionType") {
        comparison = a.contributionType.localeCompare(b.contributionType);
      } else if (sortKey === "dateDeposited") {
        comparison = a.dateDeposited.localeCompare(b.dateDeposited);
      } else if (sortKey === "dateEntered") {
        comparison = a.dateEntered.localeCompare(b.dateEntered);
      }

      if (comparison !== 0) {
        return sortDirection === "asc" ? comparison : -comparison;
      }

      return b.id - a.id;
    });
    return list;
  }, [rows, sortDirection, sortKey]);

  const hasRows = useMemo(() => rows.length > 0, [rows.length]);
  const isViewMode = mode === "view";
  const showFundFilters = mode !== "taxReceipts";
  const showContributionTypeFilter = mode !== "taxReceipts";
  const isTaxReceipts = mode === "taxReceipts";
  const requireCountry = mode === "taxReceipts";

  return (
    <ContributionPage
      title="View Contributions & Download Reports"
      description="Search saved contributions by date deposited and optional filters, or download contribution reports."
    >
      {() => (
        <>
          <section className={forms.sectionCard}>
            <div style={{ margin: "16px 0" }}>
              <p style={{ margin: "0 0 12px", fontWeight: 700 }}>What would you like to do?</p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "8px 12px",
                }}
              >
                {(["view", "grandTotal", "totalPerDonor", "taxReceipts"] as Mode[]).map((value) => {
                  const label =
                    value === "view"
                      ? "View Contributions"
                      : value === "grandTotal"
                        ? "Grand Total Report"
                        : value === "totalPerDonor"
                          ? "Total per Donor Report"
                          : "Tax Receipts";
                  return (
                    <label key={value} className={forms.checkControl} style={{ alignItems: "flex-start" }}>
                      <input
                        type="radio"
                        name="contrib-mode"
                        checked={mode === value}
                        onChange={() => {
                          setMode(value);
                          setReportError(null);
                          setReportMessage(null);
                          if (value !== "view") {
                            setHasSearched(false);
                          }
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className={forms.formGrid}>
              <div className={forms.col}>
                <div className={forms.row}>
                  <label className={forms.label} htmlFor="contrib-start-date">
                    Start Date Deposited
                  </label>
                  <div className={forms.control}>
                    <input
                      id="contrib-start-date"
                      type="date"
                      className={forms.field}
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                    />
                  </div>
                </div>
                <div className={forms.row}>
                  <label className={forms.label} htmlFor="contrib-end-date">
                    End Date Deposited
                  </label>
                  <div className={forms.control}>
                    <input
                      id="contrib-end-date"
                      type="date"
                      className={forms.field}
                      value={endDate}
                      onChange={(event) => setEndDate(event.target.value)}
                    />
                  </div>
                </div>
                <div className={forms.row}>
                  <label className={forms.label} htmlFor="contrib-filter-country">
                    Country
                  </label>
                  <div className={forms.control}>
                    <select
                      id="contrib-filter-country"
                      className={forms.field}
                      value={countryCode}
                      onChange={(event) => setCountryCode(event.target.value)}
                    >
                      <option value="">Any country</option>
                      {(isTaxReceipts
                        ? countryOptions.filter((code) => ["US", "CA", "NL"].includes(code))
                        : countryOptions
                      ).map((code) => {
                        const name = countryNameByCode[code] ?? code;
                        return (
                          <option key={code} value={code}>
                            {name}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              </div>
              <div className={forms.col}>
                {showFundFilters ? (
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="contrib-filter-fund-type">
                      Fund Type
                    </label>
                    <div className={forms.control}>
                      <select
                        id="contrib-filter-fund-type"
                        className={forms.field}
                        value={fundType}
                        onChange={(event) => setFundType(event.target.value)}
                      >
                        <option value="">Any fund type</option>
                        {fundTypeOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}
                {showContributionTypeFilter ? (
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="contrib-filter-type">
                      Contribution Type
                    </label>
                    <div className={forms.control}>
                      <select
                        id="contrib-filter-type"
                        className={forms.field}
                        value={contributionType}
                        onChange={(event) => setContributionType(event.target.value)}
                      >
                        <option value="">Any type</option>
                        {contributionTypeOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className={forms.actions} style={{ marginTop: 16 }}>
              {isViewMode ? (
                <button type="button" className={forms.button} onClick={() => void loadContributions()}>
                  View Contributions
                </button>
              ) : (
                <button
                  type="button"
                  className={forms.button}
                  onClick={() => {
                    if (requireCountry && !countryCode) {
                      setReportError("Select a country for Tax Receipts.");
                      return;
                    }
                    void downloadReport(mode);
                  }}
                  disabled={reportDownloading !== null}
                >
                  {reportDownloading
                    ? "Generating..."
                    : mode === "grandTotal"
                      ? "Download Grand Total"
                      : mode === "totalPerDonor"
                        ? "Download Total per Donor"
                        : "Download Tax Receipts"}
                </button>
              )}
            </div>
            {error ? <p className={forms.error}>{error}</p> : null}
            {reportError ? <p className={forms.error}>{reportError}</p> : null}
            {reportMessage ? <p className={forms.actionsMsg}>{reportMessage}</p> : null}
          </section>

          {isViewMode && hasSearched ? (
            <section className={forms.sectionCard} style={{ marginTop: 16 }}>
              <div className={forms.actionsRow} style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>Results</h2>
                <div className={forms.tableActions}>
                  <button
                    type="button"
                    className={`${forms.button} ${forms.actionsRowPrimaryButton}`}
                    onClick={() => void downloadPdf()}
                  >
                    Download PDF
                  </button>
                </div>
              </div>
              {exportError ? <p className={forms.error}>{exportError}</p> : null}
              <div className={forms.tableWrap}>
                <table className={forms.table}>
                  <thead>
                    <tr>
                      <th className={forms.th}>
                        <button
                          type="button"
                          onClick={() => toggleSort("memberName")}
                          style={{ border: 0, background: "transparent", padding: 0, font: "inherit", fontWeight: 600, cursor: "pointer", color: "inherit" }}
                        >
                          Member {sortIndicator(sortKey === "memberName", sortDirection)}
                        </button>
                      </th>
                      <th className={forms.th}>Country</th>
                      <th className={forms.th}>Amount</th>
                      <th className={forms.th}>Fund Type</th>
                      <th className={forms.th}>Currency</th>
                      <th className={forms.th}>Check No.</th>
                      <th className={forms.th}>
                        <button
                          type="button"
                          onClick={() => toggleSort("contributionType")}
                          style={{ border: 0, background: "transparent", padding: 0, font: "inherit", fontWeight: 600, cursor: "pointer", color: "inherit" }}
                        >
                          Contribution Type {sortIndicator(sortKey === "contributionType", sortDirection)}
                        </button>
                      </th>
                      <th className={forms.th}>
                        <button
                          type="button"
                          onClick={() => toggleSort("dateDeposited")}
                          style={{ border: 0, background: "transparent", padding: 0, font: "inherit", fontWeight: 600, cursor: "pointer", color: "inherit" }}
                        >
                          Date Deposited {sortIndicator(sortKey === "dateDeposited", sortDirection)}
                        </button>
                      </th>
                      <th className={forms.th}>
                        <button
                          type="button"
                          onClick={() => toggleSort("dateEntered")}
                          style={{ border: 0, background: "transparent", padding: 0, font: "inherit", fontWeight: 600, cursor: "pointer", color: "inherit" }}
                        >
                          Date Entered {sortIndicator(sortKey === "dateEntered", sortDirection)}
                        </button>
                      </th>
                      <th className={forms.th}>Comments</th>
                      <th className={forms.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!hasRows ? (
                      <tr>
                        <td className={forms.td} colSpan={11}>
                          {loading
                            ? "Loading contributions..."
                            : "No contributions found for the selected filters."}
                        </td>
                      </tr>
                    ) : (
                      sortedRows.map((row) => (
                        <tr key={row.id}>
                          <td className={forms.td}>{row.memberName}</td>
                          <td className={forms.td}>
                            {row.memberCountryCode
                              ? countryNameByCode[row.memberCountryCode] ?? row.memberCountryCode
                              : ""}
                          </td>
                          <td className={forms.td}>{formatAmount(row.amount)}</td>
                          <td className={forms.td}>{row.fundType}</td>
                          <td className={forms.td}>{row.currencyCode}</td>
                          <td className={forms.td}>{row.checkNo ?? ""}</td>
                          <td className={forms.td}>{row.contributionType}</td>
                          <td className={forms.td}>{row.dateDeposited}</td>
                          <td className={forms.td}>{row.dateEntered.slice(0, 10)}</td>
                          <td className={forms.td}>{row.comments ?? ""}</td>
                          <td className={forms.td}>
                            <div className={forms.tableActions}>
                              <button
                                type="button"
                                className={`${forms.button} ${forms.linkButtonLight} ${forms.linkButtonCompactTouch}`}
                                onClick={() => setEditDraft(toEditDraft(row))}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className={`${forms.button} ${forms.buttonDanger} ${forms.linkButtonCompactTouch}`}
                                onClick={() => void handleDelete(row)}
                                disabled={deletingId === row.id}
                              >
                                {deletingId === row.id ? "Deleting..." : "Delete"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {editDraft ? (
            <div className={forms.modalBackdrop} role="dialog" aria-modal="true">
            <div className={forms.modalCard}>
              <h2 className={forms.modalTitle}>Edit Contribution</h2>
              <p className={forms.modalText}>Update the saved contribution and save your changes.</p>
              <p
                style={{
                  marginTop: -4,
                  marginBottom: 10,
                  fontSize: 13,
                  color: "#6b7280",
                  fontStyle: "italic",
                }}
              >
                Member changes aren&apos;t editable here. Delete and re-enter if the member was incorrect.
              </p>
              {editError ? <p className={forms.error}>{editError}</p> : null}
              <div className={forms.col}>
                <div className={forms.row}>
                  <label className={forms.label} htmlFor="edit-contribution-member">
                    Member
                  </label>
                  <div className={forms.control}>{editDraft.memberLabel}</div>
                </div>
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="edit-contribution-amount">
                      Amount
                    </label>
                    <div className={forms.control}>
                      <input
                        id="edit-contribution-amount"
                        className={forms.field}
                        type="number"
                        min="0"
                        step="0.01"
                        value={editDraft.amount}
                        onChange={(event) => updateEditField("amount", event.target.value)}
                      />
                    </div>
                  </div>
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="edit-contribution-fund-type">
                      Fund Type
                    </label>
                    <div className={forms.control}>
                      <select
                        id="edit-contribution-fund-type"
                        className={forms.field}
                        value={editDraft.fundType}
                        onChange={(event) => updateEditField("fundType", event.target.value)}
                      >
                        <option value="">Select fund type</option>
                        {fundTypeOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="edit-contribution-check-no">
                      Check No.
                    </label>
                    <div className={forms.control}>
                      <input
                        id="edit-contribution-check-no"
                        className={forms.field}
                        value={editDraft.checkNo}
                        disabled={isCashFundType(editDraft.fundType)}
                        onChange={(event) => updateEditField("checkNo", event.target.value)}
                      />
                    </div>
                  </div>
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="edit-contribution-currency">
                      Currency
                    </label>
                    <div className={forms.control}>
                      <select
                        id="edit-contribution-currency"
                        className={forms.field}
                        value={editDraft.currencyCode}
                        onChange={(event) => updateEditField("currencyCode", event.target.value)}
                      >
                        <option value="">Select currency</option>
                        {currencyOptions.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code} ({currency.symbol})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="edit-contribution-type">
                      Contribution Type
                    </label>
                    <div className={forms.control}>
                      <select
                        id="edit-contribution-type"
                        className={forms.field}
                        value={editDraft.contributionType}
                        onChange={(event) => updateEditField("contributionType", event.target.value)}
                      >
                        <option value="">Select contribution type</option>
                        {contributionTypeOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="edit-contribution-date-deposited">
                      Date Deposited
                    </label>
                    <div className={forms.control}>
                      <input
                        id="edit-contribution-date-deposited"
                        type="date"
                        className={forms.field}
                        value={editDraft.dateDeposited}
                        onChange={(event) => updateEditField("dateDeposited", event.target.value)}
                      />
                    </div>
                  </div>
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="edit-contribution-comments">
                      Comments
                    </label>
                    <div className={forms.control}>
                      <input
                        id="edit-contribution-comments"
                        className={forms.field}
                        value={editDraft.comments}
                        onChange={(event) => updateEditField("comments", event.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className={forms.modalActions} style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className={`${forms.button} ${forms.linkButtonLight} ${forms.linkButtonCompactTouch}`}
                    onClick={() => setEditDraft(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={forms.button}
                    onClick={() => void handleSaveEdit()}
                    disabled={editSaving}
                  >
                    {editSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </ContributionPage>
  );
}
