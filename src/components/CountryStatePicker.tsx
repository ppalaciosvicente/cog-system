"use client";

import type { Option } from "@/lib/lookups";
import forms from "@/styles/forms.module.css";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={forms.row}>
      <div className={forms.label}>{label}:</div>
      <div className={forms.control}>{children}</div>
    </div>
  );
}

function DisplayRow({ label, value }: { label: string; value: string }) {
  return (
    <Row label={label}>
      <div
        style={{
          border: "1px solid #ddd",
          padding: "6px 8px",
          borderRadius: 4,
          minHeight: 18,
          background: "#f7f7f7",
        }}
      >
        {value || "\u00A0"}
      </div>
    </Row>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <select
        className={forms.field}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value || "(blank)"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function CountryStatePicker({
  editMode,
  rowGap = 0,
  countrycode,
  statecode,
  countryOptions,
  usStateOptions,
  canadaStateOptions,
  australiaStateOptions,
  countryNameByCode,
  usStateNameByCode,
  canadaStateNameByCode,
  australiaStateNameByCode,
  onChangeCountry,
  onChangeState,
}: {
  editMode: boolean;
  rowGap?: number;
  countrycode: string | null;
  statecode: string | null;

  countryOptions: Option[];
  usStateOptions: Option[];
  canadaStateOptions: Option[];
  australiaStateOptions: Option[];

  countryNameByCode: Record<string, string>;
  usStateNameByCode: Record<string, string>;
  canadaStateNameByCode: Record<string, string>;
  australiaStateNameByCode: Record<string, string>;

  onChangeCountry: (code: string) => void;
  onChangeState: (codeOrNull: string | null) => void;
}) {
  const cc = (countrycode ?? "").trim().toUpperCase();
  const sc = (statecode ?? "").trim().toUpperCase();
  const isUS = cc === "US";
  const isCA = cc === "CA";
  const isAU = cc === "AU";

  if (!editMode) {
    const stateLabel = isUS
      ? (usStateNameByCode[sc] ?? sc)
      : isCA
        ? (canadaStateNameByCode[sc] ?? sc)
        : isAU
          ? (australiaStateNameByCode[sc] ?? sc)
        : sc;
    return (
      <div style={{ display: "grid", gap: rowGap }}>
        <DisplayRow
          label="Country"
          value={cc ? (countryNameByCode[cc] ?? cc) : ""}
        />
        <DisplayRow label="State" value={sc ? stateLabel : ""} />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: rowGap }}>
      <SelectRow
        label="Country"
        value={cc}
        options={countryOptions}
        onChange={(v) => {
          const next = v.trim().toUpperCase();
          onChangeCountry(next);
        }}
      />

      {isUS ? (
        <SelectRow
          label="State"
          value={sc}
          options={[
            { value: "", label: "Choose a state…" },
            ...(Array.isArray(usStateOptions) ? usStateOptions : []),
          ]}
          onChange={(v) => onChangeState(v ? v.trim().toUpperCase() : null)}
        />
      ) : isCA ? (
        <SelectRow
          label="Province"
          value={sc}
          options={[
            { value: "", label: "Choose a province…" },
            ...(Array.isArray(canadaStateOptions) ? canadaStateOptions : []),
          ]}
          onChange={(v) => onChangeState(v ? v.trim().toUpperCase() : null)}
        />
      ) : isAU ? (
        <SelectRow
          label="State"
          value={sc}
          options={[
            { value: "", label: "Choose a state…" },
            ...(Array.isArray(australiaStateOptions) ? australiaStateOptions : []),
          ]}
          onChange={(v) => onChangeState(v ? v.trim().toUpperCase() : null)}
        />
      ) : (
        <DisplayRow label="State" value="" />
      )}
    </div>
  );
}
