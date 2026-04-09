"use client";

import { useEffect, useRef, useState } from "react";
import { ContributionPage } from "@/components/contributions/ContributionPage";
import {
  type ContributionDraftInput,
  CONTRIBUTION_FUND_TYPE_NAMES,
  CONTRIBUTION_TYPE_NAMES,
} from "@/lib/contributions";
import { getContributionLookupsCached } from "@/lib/contributions-client-cache";
import { getAuthHeaders } from "@/lib/supabase/client";
import forms from "@/styles/forms.module.css";

type HouseholdOption = {
  value: number;
  label: string;
  memberIds: number[];
  defaultCurrencyCode: string;
};

type CurrencyOption = {
  code: string;
  name: string;
  symbol: string;
};

type DailyEntryRow = {
  id: number;
  memberId: number;
  donorLabel: string;
  amount: number;
  fundType: string;
  contributionType: string;
  currencyCode: string;
  checkNo: string;
  dateDeposited: string;
  dateEntered: string;
  comments: string;
  formattedAmount: string;
};

type DailyEntryTotal = {
  currencyCode: string;
  totalAmount: number;
  formattedAmount: string;
};

type EditDraft = {
  id: number;
  memberId: number;
  donorLabel: string;
  amount: string;
  fundType: string;
  contributionType: string;
  currencyCode: string;
  checkNo: string;
  dateDeposited: string;
  comments: string;
};

const DEFAULT_CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "Pound Sterling", symbol: "£" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$" },
];

type DraftRow = {
  id: number;
  memberQuery: string;
  memberId: string;
  amount: string;
  fundType: string;
  currencyCode: string;
  checkNo: string;
  contributionType: string;
  dateDeposited: string;
  dateEntered: string;
  comments: string;
};

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_CONTRIBUTION_TYPE = "Tithe/Offering";

export default function EnterContributionsPage() {
  const rowIdCounterRef = useRef(0);
  const nextRowId = () => {
    rowIdCounterRef.current += 1;
    return rowIdCounterRef.current;
  };
  const EMPTY_ROW = (): DraftRow => ({
    id: nextRowId(),
    memberQuery: "",
    memberId: "",
    amount: "",
    fundType: "",
    currencyCode: "",
    checkNo: "",
    contributionType: DEFAULT_CONTRIBUTION_TYPE,
    dateDeposited: "",
    dateEntered: todayDateString(),
    comments: "",
  });
  const [fundTypeOptions, setFundTypeOptions] = useState<string[]>([
    ...CONTRIBUTION_FUND_TYPE_NAMES,
  ]);
  const [contributionTypeOptions, setContributionTypeOptions] = useState<string[]>([
    ...CONTRIBUTION_TYPE_NAMES,
  ]);
  const [currencyOptions, setCurrencyOptions] = useState<CurrencyOption[]>(DEFAULT_CURRENCY_OPTIONS);
  const [searchResultsByRowId, setSearchResultsByRowId] = useState<Record<number, HouseholdOption[]>>({});
  const [searchLoadingByRowId, setSearchLoadingByRowId] = useState<Record<number, boolean>>({});
  const [memberWarning, setMemberWarning] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW()]);
  const [lastDateDeposited, setLastDateDeposited] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [dailyEntryRows, setDailyEntryRows] = useState<DailyEntryRow[]>([]);
  const [dailyEntryTotals, setDailyEntryTotals] = useState<DailyEntryTotal[]>([]);
  const [dailyEntryCount, setDailyEntryCount] = useState(0);
  const [loadingDailyEntries, setLoadingDailyEntries] = useState(true);
  const [refreshingDailyEntries, setRefreshingDailyEntries] = useState(false);
  const [dailyEntryError, setDailyEntryError] = useState<string | null>(null);
  const [downloadingDailyReport, setDownloadingDailyReport] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const searchTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const searchControllersRef = useRef<Map<number, AbortController>>(new Map());
  const dailyEntryRequestIdRef = useRef(0);

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
      } catch {
        // Keep static fallback options.
      }
    }

    void loadLookups();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      searchTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      searchControllersRef.current.forEach((controller) => controller.abort());
      searchTimeoutsRef.current.clear();
      searchControllersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    void loadDailyEntries();
  }, []);

  useEffect(() => {
    const activeRowIds = new Set(rows.map((row) => row.id));

    searchTimeoutsRef.current.forEach((timeoutId, rowId) => {
      if (!activeRowIds.has(rowId)) {
        clearTimeout(timeoutId);
        searchTimeoutsRef.current.delete(rowId);
      }
    });

    searchControllersRef.current.forEach((controller, rowId) => {
      if (!activeRowIds.has(rowId)) {
        controller.abort();
        searchControllersRef.current.delete(rowId);
      }
    });

    setSearchResultsByRowId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([rowId]) => activeRowIds.has(Number(rowId))),
      ),
    );
    setSearchLoadingByRowId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([rowId]) => activeRowIds.has(Number(rowId))),
      ),
    );
  }, [rows]);

  function isCheckFundType(value: string) {
    return value.trim().toLowerCase() === "check";
  }

  function isValidDateInput(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  }

  function updateRow(rowId: number, field: keyof DraftRow, value: string) {
    if (field === "dateDeposited") {
      const nextDate = value;
      setRows((current) => {
        const targetIndex = current.findIndex((row) => row.id === rowId);
        if (targetIndex === -1) return current;

        const canPropagate = isValidDateInput(nextDate);
        return current.map((row, index) => {
          if (row.id === rowId) {
            return { ...row, dateDeposited: nextDate };
          }
          if (canPropagate && index > targetIndex && !row.dateDeposited.trim()) {
            return { ...row, dateDeposited: nextDate };
          }
          return row;
        });
      });
      if (isValidDateInput(nextDate)) {
        setLastDateDeposited(nextDate);
      }
      return;
    }

    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;

        if (field === "fundType") {
          const nextFundType = value;
          return {
            ...row,
            fundType: nextFundType,
            checkNo: isCheckFundType(nextFundType) ? row.checkNo : "",
          };
        }

        return { ...row, [field]: value };
      }),
    );
  }

  function clearRowSearch(rowId: number) {
    const timeoutId = searchTimeoutsRef.current.get(rowId);
    if (timeoutId != null) {
      clearTimeout(timeoutId);
      searchTimeoutsRef.current.delete(rowId);
    }

    const controller = searchControllersRef.current.get(rowId);
    if (controller) {
      controller.abort();
      searchControllersRef.current.delete(rowId);
    }

    setSearchResultsByRowId((current) => ({ ...current, [rowId]: [] }));
    setSearchLoadingByRowId((current) => ({ ...current, [rowId]: false }));
  }

  function handleMemberQueryChange(rowId: number, value: string) {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              memberQuery: value,
              memberId: "",
              currencyCode: "",
            }
          : row,
      ),
    );

    clearRowSearch(rowId);
    setMemberError(null);

    const query = value.trim();
    if (query.length < 2) {
      return;
    }

    setSearchLoadingByRowId((current) => ({ ...current, [rowId]: true }));

    const timeoutId = setTimeout(async () => {
      searchTimeoutsRef.current.delete(rowId);
      const controller = new AbortController();
      searchControllersRef.current.set(rowId, controller);

      try {
        const headers = await getAuthHeaders();
        const response = await fetch(
          `/api/contributions/donor-options?q=${encodeURIComponent(query)}&limit=25`,
          {
            credentials: "include",
            headers,
            signal: controller.signal,
          },
        );
        const payload = (await response.json()) as {
          households?: HouseholdOption[];
          warning?: string | null;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load donors.");
        }

        setSearchResultsByRowId((current) => ({ ...current, [rowId]: payload.households ?? [] }));
        setMemberWarning(payload.warning ?? null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchResultsByRowId((current) => ({ ...current, [rowId]: [] }));
        setMemberError(error instanceof Error ? error.message : "Failed to load donors.");
      } finally {
        if (searchControllersRef.current.get(rowId) === controller) {
          searchControllersRef.current.delete(rowId);
        }
        setSearchLoadingByRowId((current) => ({ ...current, [rowId]: false }));
      }
    }, 250);

    searchTimeoutsRef.current.set(rowId, timeoutId);
  }

  function handleSelectDonor(rowId: number, option: HouseholdOption) {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              memberId: String(option.value),
              memberQuery: option.label,
              currencyCode: option.defaultCurrencyCode || row.currencyCode || "USD",
            }
          : row,
      ),
    );
    clearRowSearch(rowId);
  }

  function addRow() {
    setRows((current) => {
      const next = EMPTY_ROW();
      const date = lastDateDeposited.trim();
      if (isValidDateInput(date)) next.dateDeposited = date;
      return [...current, next];
    });
  }

  function removeRow(rowId: number) {
    clearRowSearch(rowId);
    setRows((current) => (current.length === 1 ? current : current.filter((row) => row.id !== rowId)));
  }

  function buildPayloadRows(): ContributionDraftInput[] {
    const nonEmptyRows = rows.filter((row) => {
      const contributionType = row.contributionType.trim();
      return [
        row.memberQuery,
        row.memberId,
        row.amount,
        row.fundType,
        row.checkNo,
        row.dateDeposited,
        row.comments,
        row.currencyCode,
      ].some((value) => String(value ?? "").trim() !== "")
        || (contributionType !== "" && contributionType !== DEFAULT_CONTRIBUTION_TYPE)
        || (row.dateEntered.trim() !== "" && row.dateEntered !== todayDateString());
    });

    if (!nonEmptyRows.length) {
      throw new Error("Enter at least one contribution row before saving.");
    }

    return nonEmptyRows.map((row, index) => {
      const rowNumber = index + 1;
      const memberId = Number(row.memberId);
      const amount = Number(row.amount);
      const fundType = row.fundType.trim();
      const currencyCode = row.currencyCode.trim().toUpperCase();
      const checkNo = isCheckFundType(fundType) ? row.checkNo.trim() || null : null;
      const contributionType = row.contributionType.trim();
      const dateDeposited = row.dateDeposited.trim();
      const dateEntered = row.dateEntered.trim();

      if (!Number.isInteger(memberId) || memberId <= 0) {
        throw new Error(`Row ${rowNumber}: select a member.`);
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`Row ${rowNumber}: enter an amount greater than zero.`);
      }
      if (!fundType) {
        throw new Error(`Row ${rowNumber}: select a fund type.`);
      }
      if (!contributionType) {
        throw new Error(`Row ${rowNumber}: select a contribution type.`);
      }
      if (!currencyCode) {
        throw new Error(`Row ${rowNumber}: select a currency.`);
      }
      if (!dateDeposited) {
        throw new Error(`Row ${rowNumber}: select the date deposited.`);
      }
      if (!dateEntered) {
        throw new Error(`Row ${rowNumber}: select the date entered.`);
      }

      return {
        memberId,
        amount,
        fundType,
        currencyCode,
        checkNo,
        contributionType,
        dateDeposited,
        dateEntered,
        comments: row.comments.trim() || null,
      };
    });
  }

  async function handleSave() {
    setSaveError(null);
    setSaveSuccess(null);

    let payloadRows: ContributionDraftInput[];
    try {
      payloadRows = buildPayloadRows();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to validate contribution rows.");
      return;
    }

    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/contributions", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ rows: payloadRows }),
      });
      const payload = (await response.json()) as { ok?: boolean; inserted?: number; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save contributions.");
      }

      setRows([EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW()]);
      setSaveSuccess(
        `${payload.inserted ?? payloadRows.length} contribution${(payload.inserted ?? payloadRows.length) === 1 ? "" : "s"} saved.`,
      );
      void loadDailyEntries({ refresh: true });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save contributions.");
    } finally {
      setSaving(false);
    }
  }

  async function loadDailyEntries(options?: { refresh?: boolean }) {
    const requestId = dailyEntryRequestIdRef.current + 1;
    dailyEntryRequestIdRef.current = requestId;
    const isRefresh = Boolean(options?.refresh);
    setDailyEntryError(null);

    if (isRefresh) {
      setRefreshingDailyEntries(true);
    } else {
      setLoadingDailyEntries(true);
    }

    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ dateEntered: todayDateString() });
      const response = await fetch(`/api/contributions/daily-entry?${params.toString()}`, {
        credentials: "include",
        headers,
      });
      const payload = (await response.json()) as {
        rows?: DailyEntryRow[];
        totalsByCurrency?: DailyEntryTotal[];
        contributionCount?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load today's entered contributions.");
      }

      if (dailyEntryRequestIdRef.current === requestId) {
        setDailyEntryRows(payload.rows ?? []);
        setDailyEntryTotals(payload.totalsByCurrency ?? []);
        setDailyEntryCount(payload.contributionCount ?? 0);
      }
    } catch (error) {
      if (dailyEntryRequestIdRef.current === requestId) {
        setDailyEntryError(
          error instanceof Error ? error.message : "Failed to load today's entered contributions.",
        );
        setDailyEntryRows([]);
        setDailyEntryTotals([]);
        setDailyEntryCount(0);
      }
    } finally {
      if (dailyEntryRequestIdRef.current === requestId) {
        setRefreshingDailyEntries(false);
        setLoadingDailyEntries(false);
      }
    }
  }

  async function downloadDailyEntryReport() {
    setDownloadingDailyReport(true);
    setDailyEntryError(null);

    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ dateEntered: todayDateString() });
      const response = await fetch(`/api/contributions/reports/daily-entry?${params.toString()}`, {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to generate Daily Entry Report.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const contentDisposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
      link.href = url;
      link.download = filenameMatch?.[1] ?? `daily-entry-report-${todayDateString()}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setDailyEntryError(
        error instanceof Error ? error.message : "Failed to generate Daily Entry Report.",
      );
    } finally {
      setDownloadingDailyReport(false);
    }
  }

  async function handleDeleteDailyEntry(id: number, donorLabel: string) {
    const confirmed = window.confirm(`Delete contribution for ${donorLabel}?`);
    if (!confirmed) return;

    setDeletingId(id);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/contributions/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers,
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete contribution.");
      }
      await loadDailyEntries({ refresh: true });
    } catch (error) {
      setDailyEntryError(
        error instanceof Error ? error.message : "Failed to delete contribution.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  function handleEditRow(row: DailyEntryRow) {
    setEditError(null);
    setEditDraft({
      id: row.id,
      memberId: row.memberId,
      donorLabel: row.donorLabel,
      amount: row.amount.toFixed(2),
      fundType: row.fundType,
      contributionType: row.contributionType,
      currencyCode: row.currencyCode,
      checkNo: row.checkNo,
      dateDeposited: row.dateDeposited,
      comments: row.comments,
    });
  }

  function updateEditField(field: keyof EditDraft, value: string) {
    setEditDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function buildEditPayload(draft: EditDraft): ContributionDraftInput {
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount greater than zero.");
    if (!draft.fundType.trim()) throw new Error("Select a fund type.");
    if (!draft.currencyCode.trim()) throw new Error("Select a currency.");
    if (!draft.contributionType.trim()) throw new Error("Select a contribution type.");
    if (!draft.dateDeposited.trim()) throw new Error("Select the date deposited.");

    return {
      memberId: draft.memberId,
      amount,
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
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Failed to validate contribution.");
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
      await loadDailyEntries({ refresh: true });
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Failed to update contribution.");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <ContributionPage
      title="Enter Contributions"
      description="Enter one or more recently received contributions and save them in a single batch."
    >
      {() => (
        <>
          <section className={forms.sectionCard}>
            <div className={forms.actionsRow}>
              <button type="button" onClick={addRow}>
                Add Row
              </button>
              <button
                type="button"
                className={forms.actionsRowPrimaryButton}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Contributions"}
              </button>
              {saveSuccess ? <span className={forms.actionsMsg}>{saveSuccess}</span> : null}
            </div>
            {memberWarning ? (
              <p style={{ marginTop: 12, color: "#92400e" }}>{memberWarning}</p>
            ) : null}
            {memberError ? <p className={forms.error}>{memberError}</p> : null}
            {saveError ? <p className={forms.error}>{saveError}</p> : null}

            <p
              style={{
                marginTop: 16,
                marginBottom: 8,
                fontStyle: "italic",
                fontSize: 13,
                color: "#6b7280",
              }}
            >
              Tip: scroll horizontally to see all columns →
            </p>
            <div className={forms.tableWrap} style={{ marginTop: 12 }}>
              <table className={forms.table}>
                <thead>
                  <tr>
                    <th className={forms.th}>Member</th>
                    <th className={forms.th}>Amount</th>
                    <th className={forms.th}>Fund Type</th>
                    <th className={forms.th}>Currency</th>
                    <th className={forms.th}>Check No.</th>
                    <th className={forms.th}>Contribution Type</th>
                    <th className={forms.th}>Date Deposited</th>
                    <th className={forms.th}>Date Entered</th>
                    <th className={forms.th}>Comments</th>
                    <th className={forms.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className={forms.td} style={{ minWidth: 240 }}>
                        <div className={forms.autocompleteWrap}>
                          <input
                            className={forms.field}
                            type="search"
                            value={row.memberQuery}
                            placeholder="Type last name or first name"
                            onChange={(event) =>
                              handleMemberQueryChange(row.id, event.target.value)
                            }
                          />
                          {searchLoadingByRowId[row.id] ? (
                            <div className={forms.autocompleteMenu}>
                              <div className={forms.autocompleteOption}>Searching donors...</div>
                            </div>
                          ) : null}
                          {!searchLoadingByRowId[row.id] &&
                          !row.memberId &&
                          row.memberQuery.trim().length >= 2 ? (
                            <div
                              className={forms.autocompleteMenu}
                              role="listbox"
                              aria-label="Matching donors"
                            >
                              {(searchResultsByRowId[row.id] ?? []).length > 0 ? (
                                (searchResultsByRowId[row.id] ?? []).map((household) => (
                                  <button
                                    key={household.value}
                                    type="button"
                                    className={forms.autocompleteOption}
                                    onClick={() => handleSelectDonor(row.id, household)}
                                  >
                                    {household.label}
                                  </button>
                                ))
                              ) : (
                                <div className={forms.autocompleteOption}>No matching donors found.</div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className={forms.td} style={{ minWidth: 110 }}>
                        <input
                          className={forms.field}
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.amount}
                          onChange={(event) => updateRow(row.id, "amount", event.target.value)}
                        />
                      </td>
                      <td className={forms.td} style={{ minWidth: 150 }}>
                        <select
                          className={forms.field}
                          value={row.fundType}
                          onChange={(event) => updateRow(row.id, "fundType", event.target.value)}
                        >
                          <option value="">Select fund type</option>
                          {fundTypeOptions.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={forms.td} style={{ minWidth: 150 }}>
                        <select
                          className={forms.field}
                          value={row.currencyCode}
                          onChange={(event) => updateRow(row.id, "currencyCode", event.target.value)}
                        >
                          <option value="">Select currency</option>
                          {currencyOptions.map((currency) => (
                            <option key={currency.code} value={currency.code}>
                              {currency.code} ({currency.symbol})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={forms.td} style={{ minWidth: 120 }}>
                        <input
                          className={forms.field}
                          value={row.checkNo}
                          disabled={!isCheckFundType(row.fundType)}
                          onChange={(event) => updateRow(row.id, "checkNo", event.target.value)}
                        />
                      </td>
                      <td className={forms.td} style={{ minWidth: 180 }}>
                        <select
                          className={forms.field}
                          value={row.contributionType}
                          onChange={(event) =>
                            updateRow(row.id, "contributionType", event.target.value)
                          }
                        >
                          <option value="">Select contribution type</option>
                          {contributionTypeOptions.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={forms.td} style={{ minWidth: 160 }}>
                        <input
                          className={forms.field}
                          type="date"
                          value={row.dateDeposited}
                          onChange={(event) =>
                            updateRow(row.id, "dateDeposited", event.target.value)
                          }
                        />
                      </td>
                      <td className={forms.td} style={{ minWidth: 160 }}>
                        <input
                          className={forms.field}
                          type="date"
                          value={row.dateEntered}
                          onChange={(event) =>
                            updateRow(row.id, "dateEntered", event.target.value)
                          }
                        />
                      </td>
                      <td className={forms.td} style={{ minWidth: 220 }}>
                        <input
                          className={forms.field}
                          value={row.comments}
                          onChange={(event) => updateRow(row.id, "comments", event.target.value)}
                        />
                      </td>
                      <td className={forms.td}>
                        <button
                          type="button"
                          className={`${forms.button} ${forms.buttonDanger} ${forms.linkButtonCompactTouch}`}
                          onClick={() => removeRow(row.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={forms.sectionCard} style={{ marginTop: 16 }}>
            <div className={forms.actionsRow}>
              <h2 style={{ margin: 0 }}>Today&apos;s Entered Contributions</h2>
              <button
                type="button"
                className={forms.actionsRowPrimaryButton}
                onClick={() => void downloadDailyEntryReport()}
                disabled={
                  downloadingDailyReport ||
                  loadingDailyEntries ||
                  refreshingDailyEntries ||
                  dailyEntryRows.length === 0
                }
              >
                {downloadingDailyReport ? "Generating..." : "Daily Entry Report"}
              </button>
            </div>
            <p style={{ marginTop: 12 }}>
              Contributions you entered today: {dailyEntryCount}
            </p>
            {dailyEntryError ? <p className={forms.error}>{dailyEntryError}</p> : null}
            {loadingDailyEntries ? (
              <p style={{ marginTop: 12 }}>Loading today&apos;s entries...</p>
            ) : null}
            {!loadingDailyEntries && refreshingDailyEntries ? (
              <p style={{ marginTop: 12 }}>Refreshing today&apos;s entries...</p>
            ) : null}
            {!loadingDailyEntries && dailyEntryRows.length === 0 ? (
              <p style={{ marginTop: 12 }}>No contributions have been entered by you today.</p>
            ) : null}
            {!loadingDailyEntries && dailyEntryRows.length > 0 ? (
              <>
                <p
                  style={{
                    marginTop: 16,
                    marginBottom: 8,
                    fontStyle: "italic",
                    fontSize: 13,
                    color: "#6b7280",
                  }}
                >
                  Tip: scroll horizontally to see all columns →
                </p>
                <div className={forms.tableWrap} style={{ marginTop: 12 }}>
                  <table className={forms.table}>
                    <thead>
                      <tr>
                        <th className={forms.th}>Donor</th>
                        <th className={forms.th}>Amount</th>
                        <th className={forms.th}>Fund Type</th>
                        <th className={forms.th}>Currency</th>
                        <th className={forms.th}>Check No.</th>
                        <th className={forms.th}>Contribution Type</th>
                        <th className={forms.th}>Date Deposited</th>
                        <th className={forms.th}>Date Entered</th>
                        <th className={forms.th}>Comments</th>
                        <th className={forms.th}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyEntryRows.map((row) => (
                        <tr key={row.id}>
                          <td className={forms.td}>{row.donorLabel}</td>
                          <td className={forms.td}>{row.formattedAmount}</td>
                          <td className={forms.td}>{row.fundType}</td>
                          <td className={forms.td}>{row.currencyCode}</td>
                          <td className={forms.td}>{row.checkNo}</td>
                          <td className={forms.td}>{row.contributionType}</td>
                          <td className={forms.td}>{row.dateDeposited}</td>
                          <td className={forms.td}>{row.dateEntered.slice(0, 10)}</td>
                          <td className={forms.td}>{row.comments}</td>
                          <td className={forms.td}>
                            <div className={forms.tableActions}>
                              <button
                                type="button"
                                className={`${forms.button} ${forms.linkButtonLight} ${forms.linkButtonCompactTouch}`}
                                onClick={() => handleEditRow(row)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className={`${forms.button} ${forms.buttonDanger} ${forms.linkButtonCompactTouch}`}
                                onClick={() => void handleDeleteDailyEntry(row.id, row.donorLabel)}
                                disabled={deletingId === row.id}
                              >
                                {deletingId === row.id ? "Deleting..." : "Delete"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 12, fontWeight: 700 }}>
                  {dailyEntryTotals.length <= 1
                    ? `Grand Total: ${dailyEntryTotals[0]?.formattedAmount ?? "$0.00"}`
                    : dailyEntryTotals
                        .map((total) => `${total.currencyCode}: ${total.formattedAmount}`)
                        .join(" | ")}
                </div>
              </>
            ) : null}
          </section>

          {editDraft ? (
            <div className={forms.modalBackdrop} role="dialog" aria-modal="true">
              <div className={forms.modalCard}>
                <h2 className={forms.modalTitle}>Edit Contribution</h2>
                <p className={forms.modalText}>Update the saved contribution and save your changes.</p>
                {editError ? <p className={forms.error}>{editError}</p> : null}
                <div className={forms.col}>
                  <div className={forms.row}>
                    <label className={forms.label}>Member</label>
                    <div className={forms.control}>{editDraft.donorLabel}</div>
                  </div>
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="edit-amount">
                      Amount
                    </label>
                    <div className={forms.control}>
                      <input
                        id="edit-amount"
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
                    <label className={forms.label} htmlFor="edit-fundtype">
                      Fund Type
                    </label>
                    <div className={forms.control}>
                      <select
                        id="edit-fundtype"
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
                    <label className={forms.label} htmlFor="edit-currency">
                      Currency
                    </label>
                    <div className={forms.control}>
                      <select
                        id="edit-currency"
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
                    <label className={forms.label} htmlFor="edit-date-deposited">
                      Date Deposited
                    </label>
                    <div className={forms.control}>
                      <input
                        id="edit-date-deposited"
                        className={forms.field}
                        type="date"
                        value={editDraft.dateDeposited}
                        onChange={(event) => updateEditField("dateDeposited", event.target.value)}
                      />
                    </div>
                  </div>
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="edit-check">
                      Check No.
                    </label>
                    <div className={forms.control}>
                      <input
                        id="edit-check"
                        className={forms.field}
                        value={editDraft.checkNo}
                        onChange={(event) => updateEditField("checkNo", event.target.value)}
                      />
                    </div>
                  </div>
                  <div className={forms.row}>
                    <label className={forms.label} htmlFor="edit-comments">
                      Comments
                    </label>
                    <div className={forms.control}>
                      <input
                        id="edit-comments"
                        className={forms.field}
                        value={editDraft.comments}
                        onChange={(event) => updateEditField("comments", event.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className={forms.actionsRow} style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className={`${forms.button} ${forms.linkButtonLight}`}
                    onClick={() => setEditDraft(null)}
                    disabled={editSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={forms.actionsRowPrimaryButton}
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
