"use client";

import { useEffect, useMemo, useState } from "react";
import { ContributionPage } from "@/components/contributions/ContributionPage";
import {
  type ContributionDraftInput,
  type ContributionRecord,
  CONTRIBUTION_FUND_TYPE_NAMES,
  CONTRIBUTION_TYPE_NAMES,
} from "@/lib/contributions";
import { getContributionLookupsCached } from "@/lib/contributions-client-cache";
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

type DonorDetail = {
  id: number;
  fname: string | null;
  lname: string | null;
  address: string | null;
  address2: string | null;
  city: string | null;
  statecode: string | null;
  zip: string | null;
  countrycode: string | null;
  homephone: string | null;
  cellphone: string | null;
  email: string | null;
  baptized: boolean | null;
  baptizeddate: string | null;
  statusid: number | null;
  tithestatusid: number | null;
  householdid: number | null;
  spouseid: number | null;
  datecreated: string;
  dateupdated: string | null;
  statusName?: string;
  titheStatusName?: string;
  countryName?: string;
};

type HouseholdMemberSummary = {
  id: number;
  name: string;
  email: string | null;
  cellphone: string | null;
  homephone: string | null;
};

type DonorPayload = {
  donorLabel: string;
  representative: DonorDetail;
  householdMembers: HouseholdMemberSummary[];
  contributions: ContributionRecord[];
};

type EditDraft = {
  id: number;
  memberId: string;
  amount: string;
  fundType: string;
  currencyCode: string;
  checkNo: string;
  contributionType: string;
  dateDeposited: string;
  comments: string;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function dateDaysAgoString(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function toEditDraft(row: ContributionRecord): EditDraft {
  return {
    id: row.id,
    memberId: String(row.memberId),
    amount: String(row.amount),
    fundType: row.fundType,
    currencyCode: row.currencyCode,
    checkNo: row.checkNo ?? "",
    contributionType: row.contributionType,
    dateDeposited: row.dateDeposited,
    comments: row.comments ?? "",
  };
}

export default function ContributionDonorsPage() {
  const [donorQuery, setDonorQuery] = useState("");
  const [searchResults, setSearchResults] = useState<HouseholdOption[]>([]);
  const [editHouseholdOptions, setEditHouseholdOptions] = useState<HouseholdOption[]>([]);
  const [fundTypeOptions, setFundTypeOptions] = useState<string[]>([
    ...CONTRIBUTION_FUND_TYPE_NAMES,
  ]);
  const [contributionTypeOptions, setContributionTypeOptions] = useState<string[]>([
    ...CONTRIBUTION_TYPE_NAMES,
  ]);
  const [currencyOptions, setCurrencyOptions] = useState<CurrencyOption[]>(DEFAULT_CURRENCY_OPTIONS);
  const [lookupsLoaded, setLookupsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loadingEditOptions, setLoadingEditOptions] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DonorPayload | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState(todayDateString());
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const filteredContributions = useMemo(() => {
    return detail?.contributions ?? [];
  }, [detail]);

  function isCashFundType(value: string) {
    return value.trim().toLowerCase() === "cash";
  }

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function searchDonors() {
      const query = donorQuery.trim();
      if (selectedId || query.length < 2) {
        setSearchResults([]);
        setLoadingOptions(false);
        return;
      }

      setLoadingOptions(true);
      setError(null);
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
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load donors.");
        }

        if (!cancelled) {
          const households = payload.households ?? [];
          setSearchResults(households);
          if (households.length === 1) {
            handleSelectDonor(households[0]);
          }
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load donors.");
        }
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    }

    const timeoutId = window.setTimeout(() => {
      void searchDonors();
    }, 250);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [donorQuery, selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadDonor() {
      if (!selectedId) {
        setDetail(null);
        return;
      }

      setLoadingDetail(true);
      setError(null);
      setEditDraft(null);
      try {
        const headers = await getAuthHeaders();
        const params = new URLSearchParams({ memberId: selectedId });
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);
        const response = await fetch(`/api/contributions/donor?${params.toString()}`, {
          credentials: "include",
          headers,
          signal: controller.signal,
        });
        const payload = (await response.json()) as DonorPayload & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load donor.");
        }

        if (!cancelled) {
          setDetail(payload);
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load donor.");
          setDetail(null);
        }
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    }

    void loadDonor();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedId]);

  async function ensureLookupsLoaded() {
    if (lookupsLoaded) return;

    try {
      const payload = await getContributionLookupsCached();
      if (Array.isArray(payload.fundTypes) && payload.fundTypes.length > 0) {
        setFundTypeOptions(payload.fundTypes);
      }
      if (Array.isArray(payload.contributionTypes) && payload.contributionTypes.length > 0) {
        setContributionTypeOptions(payload.contributionTypes);
      }
      if (Array.isArray(payload.currencies) && payload.currencies.length > 0) {
        setCurrencyOptions(payload.currencies);
      }
      setLookupsLoaded(true);
    } catch {
      // Keep static fallback options.
    }
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
      return { ...current, [field]: value };
    });
  }

  function buildEditPayload(draft: EditDraft): ContributionDraftInput {
    const memberId = Number(draft.memberId);
    const amount = Number(draft.amount);

    if (!Number.isInteger(memberId) || memberId <= 0) {
      throw new Error("Select a donor.");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
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
      memberId,
      amount,
      fundType: draft.fundType.trim(),
      currencyCode: draft.currencyCode.trim().toUpperCase(),
      checkNo: draft.checkNo.trim() || null,
      contributionType: draft.contributionType.trim(),
      dateDeposited: draft.dateDeposited.trim(),
      comments: draft.comments.trim() || null,
    };
  }

  async function ensureEditHouseholdOptions() {
    if (editHouseholdOptions.length > 0 || loadingEditOptions) {
      return;
    }

    setLoadingEditOptions(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/contributions/donor-options", {
        credentials: "include",
        headers,
      });
      const payload = (await response.json()) as {
        households?: HouseholdOption[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load donors.");
      }

      setEditHouseholdOptions(payload.households ?? []);
    } catch (loadError) {
      setEditError(loadError instanceof Error ? loadError.message : "Failed to load donors.");
    } finally {
      setLoadingEditOptions(false);
    }
  }

  async function reloadSelectedDonor() {
    if (!selectedId) return;

    setLoadingDetail(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ memberId: selectedId });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const response = await fetch(`/api/contributions/donor?${params.toString()}`, {
        credentials: "include",
        headers,
      });
      const payload = (await response.json()) as DonorPayload & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load donor.");
      }
      setDetail(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load donor.");
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleSaveEdit() {
    if (!editDraft) return;
    setEditError(null);

    let payload: ContributionDraftInput;
    try {
      payload = buildEditPayload(editDraft);
    } catch (validationError) {
      setEditError(
        validationError instanceof Error ? validationError.message : "Failed to validate contribution.",
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
      await reloadSelectedDonor();
    } catch (saveError) {
      setEditError(saveError instanceof Error ? saveError.message : "Failed to update contribution.");
    } finally {
      setEditSaving(false);
    }
  }

  async function downloadTaxReceipt() {
    if (!selectedId || !detail) return;
    const contributions = detail.contributions.filter((row) => row.taxDeductible);
    if (!contributions.length) return;
    const effectiveStart =
      startDate ||
      contributions[contributions.length - 1]?.dateDeposited ||
      contributions[contributions.length - 1]?.dateEntered.slice(0, 10) ||
      todayDateString();
    const effectiveEnd = endDate || todayDateString();

    setError(null);
    setDownloadingReceipt(true);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        memberId: selectedId,
        startDate: effectiveStart,
        endDate: effectiveEnd,
      });
      params.set("deductibleOnly", "true");
      const response = await fetch(`/api/contributions/reports/quarterly?${params.toString()}`, {
        credentials: "include",
        headers,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to generate tax receipt.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const contentDisposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = contentDisposition.match(/filename=\"([^\"]+)\"/);
      link.href = url;
      link.download =
        filenameMatch?.[1] ??
        `tax-receipt-${selectedId}-${effectiveStart}-to-${effectiveEnd}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Failed to generate tax receipt.",
      );
    } finally {
      setDownloadingReceipt(false);
    }
  }

  function downloadAllPdf() {
    if (!filteredContributions.length) return;
    const currencySymbol = (code: string) => {
      const map: Record<string, string> = {
        USD: "$",
        CAD: "C$",
        EUR: "EUR",
        GBP: "£",
        AUD: "A$",
        NZD: "NZ$",
      };
      return map[code] ?? code;
    };
    const wrapLine = (text: string, max: number) => {
      if (text.length <= max) return [text];
      const trimmed = text.slice(0, max + 1);
      const lastSpace = trimmed.lastIndexOf(" ");
      if (lastSpace === -1) return [text.slice(0, max), text.slice(max).trimStart()];
      return [text.slice(0, lastSpace), text.slice(lastSpace + 1).trimStart()];
    };

    const lines: Parameters<typeof buildSimplePdf>[0] = [
      { text: "Contributions", size: 18, bold: true, x: 30, y: 760 },
      { text: `Donor: ${detail?.donorLabel ?? ""}`, size: 12, x: 30, y: 742 },
      { text: `From ${startDate || "earliest"} to ${endDate || todayDateString()}`, size: 12, x: 30, y: 726 },
      { text: "Member", bold: true, size: 11, x: 30, y: 704 },
      { text: "Amount", bold: true, size: 11, x: 190, y: 704 },
      { text: "Fund", bold: true, size: 11, x: 255, y: 704 },
      { text: "Type", bold: true, size: 11, x: 360, y: 704 },
      { text: "Date Dep.", bold: true, size: 11, x: 470, y: 704 },
      { text: "Date Ent.", bold: true, size: 11, x: 540, y: 704 },
    ];

    let y = 688;
    for (const row of filteredContributions) {
      const memberLines = wrapLine(row.memberName, 18);
      const fundLines = wrapLine(row.fundType, 14);
      const checkLines = row.checkNo ? [`(${row.checkNo})`] : [];
      const fundBlockLines = fundLines.length + checkLines.length;
      const maxLines = Math.max(memberLines.length, fundBlockLines || 1);

      memberLines.forEach((text, idx) => {
        lines.push({ text, size: 10, x: 30, y: y - idx * 11 });
      });
      const amountText = `${currencySymbol(row.currencyCode)} ${formatAmount(row.amount)}`;
      lines.push({ text: amountText, size: 10, x: 190, y });
      fundLines.forEach((text, idx) => {
        lines.push({ text, size: 10, x: 255, y: y - idx * 11 });
      });
      checkLines.forEach((text, idx) => {
        lines.push({ text, size: 10, x: 255, y: y - (fundLines.length + idx) * 11 });
      });
      lines.push({ text: row.contributionType, size: 10, x: 360, y });
      lines.push({ text: row.dateDeposited, size: 10, x: 470, y });
      lines.push({ text: formatDate(row.dateEntered), size: 10, x: 540, y });

      y -= maxLines * 11 + 2;
      if (y < 80) break;
    }

    const totalAmount = filteredContributions.reduce((sum, r) => sum + r.amount, 0);
    lines.push({ text: "Grand Total", size: 11, bold: true, x: 30, y: y - 12 });
    lines.push({
      text: `${currencySymbol(filteredContributions[0].currencyCode)} ${formatAmount(totalAmount)}`,
      size: 11,
      bold: true,
      x: 190,
      y: y - 12,
    });

    const footerY = 32;
    const todayLong = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date());
    lines.push({ text: todayLong, size: 10, x: 30, y: footerY, italic: true });
    lines.push({ text: "Page 1 of 1", size: 10, x: 520, y: footerY, align: "right", italic: true });

    const pdfBuffer = buildSimplePdf(lines);
    const blob = new Blob([pdfBuffer], { type: "application/pdf" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `contributions-${startDate || "all"}-to-${endDate || "all"}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
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

      setDetail((current) =>
        current
          ? {
              ...current,
              contributions: current.contributions.filter((item) => item.id !== row.id),
            }
          : current,
      );
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete contribution.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleSelectDonor(option: HouseholdOption) {
    setSelectedId(String(option.value));
    setDonorQuery(option.label);
    setSearchResults([]);
    setStartDate("");
    setEndDate(todayDateString());
    setShowDetails(false);
  }

  return (
    <ContributionPage
      title="View Donors"
      description="Select a donor to review member details and contribution history."
      pageClassName={detail?.representative.statusid === 7 ? forms.pageWarn : undefined}
    >
      {() => (
        <>
          <section className={forms.sectionCard}>
            <div className={forms.row}>
              <label className={forms.label} htmlFor="contrib-donor-member">
                Donor
              </label>
              <div className={forms.control}>
                <div className={forms.autocompleteWrap}>
                  <input
                    id="contrib-donor-member"
                    className={forms.field}
                    type="search"
                    value={donorQuery}
                    placeholder="Type last name or first name"
                    onChange={(event) => {
                      setDonorQuery(event.target.value);
                      setSelectedId("");
                      setDetail(null);
                      setEditDraft(null);
                    }}
                  />
                  {!loadingOptions && !selectedId && searchResults.length > 0 ? (
                    <div className={forms.autocompleteMenu} role="listbox" aria-label="Matching donors">
                      {searchResults.map((household) => (
                        <button
                          key={household.value}
                          type="button"
                          className={forms.autocompleteOption}
                          onClick={() => handleSelectDonor(household)}
                        >
                          {household.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            {donorQuery.trim().length < 2 ? (
              <p style={{ marginTop: 12 }}>Type at least 2 letters to search for a donor.</p>
            ) : null}
            {loadingOptions ? <p style={{ marginTop: 12 }}>Searching donors...</p> : null}
            {!loadingOptions &&
            !selectedId &&
            donorQuery.trim().length >= 2 &&
            searchResults.length === 0 ? (
              <p style={{ marginTop: 12 }}>No matching donors found.</p>
            ) : null}
            {error ? <p className={forms.error}>{error}</p> : null}
          </section>

          {loadingDetail ? <p style={{ marginTop: 16 }}>Loading donor details...</p> : null}

          {detail ? (
            <>
              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className={forms.button}
                  onClick={() => setShowDetails((prev) => !prev)}
                >
                  {showDetails ? "Hide Donor Details" : "View Donor Details"}
                </button>
              </div>
              {showDetails ? (
                <>
              <section className={forms.sectionCard} style={{ marginTop: 16 }}>
                <h2 style={{ marginTop: 0 }}>{detail.donorLabel}</h2>
                <div className={forms.formGrid}>
                  <div className={forms.col}>
                    <div className={forms.row}>
                      <div className={forms.label}>Primary Member</div>
                      <div className={forms.control}>
                        {detail.representative.lname}, {detail.representative.fname}
                      </div>
                    </div>
                    <div className={forms.row}>
                      <div className={forms.label}>Email</div>
                      <div className={forms.control}>{detail.representative.email ?? ""}</div>
                    </div>
                    <div className={forms.row}>
                      <div className={forms.label}>Cell Phone</div>
                      <div className={forms.control}>{detail.representative.cellphone ?? ""}</div>
                    </div>
                    <div className={forms.row}>
                      <div className={forms.label}>Home Phone</div>
                      <div className={forms.control}>{detail.representative.homephone ?? ""}</div>
                    </div>
                    <div className={forms.row}>
                      <div className={forms.label}>Baptized</div>
                      <div className={forms.control}>
                        {detail.representative.baptized ? "Yes" : "No"}
                      </div>
                    </div>
                    <div className={forms.row}>
                      <div className={forms.label}>Baptized Date</div>
                      <div className={forms.control}>
                        {formatDate(detail.representative.baptizeddate)}
                      </div>
                    </div>
                  </div>
                  <div className={forms.col}>
                    <div className={forms.row}>
                      <div className={forms.label}>Address</div>
                      <div className={forms.control}>
                        {[detail.representative.address, detail.representative.address2]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    </div>
                    <div className={forms.row}>
                      <div className={forms.label}>City</div>
                      <div className={forms.control}>
                        {[detail.representative.city, detail.representative.statecode, detail.representative.zip]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    </div>
                    <div className={forms.row}>
                      <div className={forms.label}>Country</div>
                      <div className={forms.control}>
                        {detail.representative.countryName ??
                          detail.representative.countrycode ??
                          ""}
                      </div>
                    </div>
                    <div className={forms.row}>
                      <div className={forms.label}>Fellowship Status</div>
                      <div className={forms.control}>
                        {detail.representative.statusName ?? ""}
                      </div>
                    </div>
                    <div className={forms.row}>
                      <div className={forms.label}>Tithing Status</div>
                      <div className={forms.control}>
                        {detail.representative.titheStatusName ?? ""}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {detail.representative.householdid != null && detail.householdMembers.length > 1 ? (
                <section className={forms.sectionCard} style={{ marginTop: 16 }}>
                  <h2 style={{ marginTop: 0 }}>Household Members</h2>
                  <div className={forms.tableWrap}>
                    <table className={forms.table}>
                      <thead>
                        <tr>
                          <th className={forms.th}>Name</th>
                          <th className={forms.th}>Email</th>
                          <th className={forms.th}>Cell Phone</th>
                          <th className={forms.th}>Home Phone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.householdMembers.map((member) => (
                          <tr key={member.id}>
                            <td className={forms.td}>{member.name}</td>
                            <td className={forms.td}>{member.email ?? ""}</td>
                            <td className={forms.td}>{member.cellphone ?? ""}</td>
                            <td className={forms.td}>{member.homephone ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
                </>
              ) : null}

              <section className={forms.sectionCard} style={{ marginTop: 16 }}>
                <h2 style={{ marginTop: 0 }}>Contributions</h2>
                <div className={forms.tableWrap} style={{ padding: 12, marginBottom: 12, borderRadius: 12 }}>
                  <div className={forms.actionsRow} style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
                    <div className={forms.row} style={{ margin: 0, gridTemplateColumns: "100px 1fr" }}>
                      <label className={forms.label} htmlFor="donor-start-date">
                        Start Date
                      </label>
                      <div className={forms.control}>
                        <input
                          id="donor-start-date"
                          type="date"
                          className={forms.field}
                          value={startDate}
                          onChange={(event) => setStartDate(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className={forms.row} style={{ margin: 0, gridTemplateColumns: "100px 1fr" }}>
                      <label className={forms.label} htmlFor="donor-end-date">
                        End Date
                      </label>
                      <div className={forms.control}>
                        <input
                          id="donor-end-date"
                          type="date"
                          className={forms.field}
                          value={endDate}
                          onChange={(event) => setEndDate(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className={forms.actions} style={{ margin: 0, flexWrap: "wrap", gap: 8 }}>
                      <button
                        type="button"
                        className={`${forms.button} ${forms.actionsRowPrimaryButton}`}
                        onClick={() => void reloadSelectedDonor()}
                        disabled={loadingDetail}
                      >
                        {loadingDetail ? "Loading..." : "Apply Dates"}
                      </button>
                    </div>
                  </div>
                </div>
                {filteredContributions.length ? (
                  (() => {
                    const countryCode = (detail?.representative.countrycode ?? "").trim().toUpperCase();
                    const canDownloadTaxReceipts = ["US", "CA", "NL", "NLD"].includes(countryCode);
                    return (
                  <div className={forms.actions} style={{ marginTop: 12, marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={`${forms.button} ${forms.actionsRowPrimaryButton}`}
                      onClick={() => {
                        downloadAllPdf();
                      }}
                      disabled={downloadingReceipt}
                    >
                      {downloadingReceipt ? "Downloading..." : "Download All"}
                    </button>
                    {canDownloadTaxReceipts ? (
                      <button
                        type="button"
                        className={`${forms.button} ${forms.actionsRowPrimaryButton}`}
                        onClick={() => void downloadTaxReceipt()}
                        disabled={downloadingReceipt}
                      >
                        {downloadingReceipt ? "Downloading..." : "Download Tax Receipts"}
                      </button>
                    ) : null}
                  </div>
                    );
                  })()
                ) : null}
                <div className={forms.tableWrap}>
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
                        <th className={forms.th}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredContributions.length === 0 ? (
                        <tr>
                          <td className={forms.td} colSpan={10}>
                            No contributions found for this donor.
                          </td>
                        </tr>
                      ) : (
                        filteredContributions.map((row) => (
                          <tr key={row.id}>
                            <td className={forms.td}>{row.memberName}</td>
                            <td className={forms.td}>{formatAmount(row.amount)}</td>
                            <td className={forms.td}>{row.fundType}</td>
                            <td className={forms.td}>{row.currencyCode}</td>
                            <td className={forms.td}>{row.checkNo ?? ""}</td>
                            <td className={forms.td}>{row.contributionType}</td>
                            <td className={forms.td}>{row.dateDeposited}</td>
                            <td className={forms.td}>{formatDate(row.dateEntered)}</td>
                            <td className={forms.td}>{row.comments ?? ""}</td>
                            <td className={forms.td}>
                              <div className={forms.tableActions}>
                                <button
                                  type="button"
                                  className={`${forms.button} ${forms.linkButtonLight} ${forms.linkButtonCompactTouch}`}
                                  onClick={() => {
                                    setEditError(null);
                                    setEditDraft(toEditDraft(row));
                                    void ensureEditHouseholdOptions();
                                    void ensureLookupsLoaded();
                                  }}
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

              {editDraft ? (
                <div className={forms.modalBackdrop} role="dialog" aria-modal="true">
                  <div className={forms.modalCard}>
                    <h2 className={forms.modalTitle}>Edit Contribution</h2>
                    <p className={forms.modalText}>Update the saved contribution and save your changes.</p>
                    {editError ? <p className={forms.error}>{editError}</p> : null}
                    <div className={forms.col}>
                      <div className={forms.row}>
                        <label className={forms.label} htmlFor="donor-edit-member">
                          Donor
                        </label>
                        <div className={forms.control}>
                          <select
                            id="donor-edit-member"
                            className={forms.field}
                            value={editDraft.memberId}
                            onChange={(event) => updateEditField("memberId", event.target.value)}
                            disabled={loadingEditOptions}
                          >
                            <option value="">Select donor</option>
                            {editHouseholdOptions.map((household) => (
                              <option key={household.value} value={String(household.value)}>
                                {household.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {loadingEditOptions ? <p style={{ marginTop: 12 }}>Loading donors...</p> : null}
                      <div className={forms.row}>
                        <label className={forms.label} htmlFor="donor-edit-amount">
                          Amount
                        </label>
                        <div className={forms.control}>
                          <input
                            id="donor-edit-amount"
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
                        <label className={forms.label} htmlFor="donor-edit-fund-type">
                          Fund Type
                        </label>
                        <div className={forms.control}>
                          <select
                            id="donor-edit-fund-type"
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
                        <label className={forms.label} htmlFor="donor-edit-check-no">
                          Check No.
                        </label>
                        <div className={forms.control}>
                          <input
                            id="donor-edit-check-no"
                            className={forms.field}
                            value={editDraft.checkNo}
                            disabled={isCashFundType(editDraft.fundType)}
                            onChange={(event) => updateEditField("checkNo", event.target.value)}
                          />
                        </div>
                      </div>
                      <div className={forms.row}>
                        <label className={forms.label} htmlFor="donor-edit-currency">
                          Currency
                        </label>
                        <div className={forms.control}>
                          <select
                            id="donor-edit-currency"
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
                        <label className={forms.label} htmlFor="donor-edit-contribution-type">
                          Contribution Type
                        </label>
                        <div className={forms.control}>
                          <select
                            id="donor-edit-contribution-type"
                            className={forms.field}
                            value={editDraft.contributionType}
                            onChange={(event) =>
                              updateEditField("contributionType", event.target.value)
                            }
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
                        <label className={forms.label} htmlFor="donor-edit-date-deposited">
                          Date Deposited
                        </label>
                        <div className={forms.control}>
                          <input
                            id="donor-edit-date-deposited"
                            type="date"
                            className={forms.field}
                            value={editDraft.dateDeposited}
                            onChange={(event) => updateEditField("dateDeposited", event.target.value)}
                          />
                        </div>
                      </div>
                      <div className={forms.row}>
                        <label className={forms.label} htmlFor="donor-edit-comments">
                          Comments
                        </label>
                        <div className={forms.control}>
                          <input
                            id="donor-edit-comments"
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
          ) : null}
        </>
      )}
    </ContributionPage>
  );
}
