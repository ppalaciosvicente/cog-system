"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchCountryAndUSStateLookups } from "@/lib/lookups";
import type { Option } from "@/lib/lookups";
import { BackLink } from "@/components/BackLink";
import { CountryStatePicker } from "@/components/CountryStatePicker";

import forms from "@/styles/forms.module.css";

type NewMember = {
  fname: string;
  lname: string;
  address: string;
  address2: string;
  city: string;
  statecode: string;
  zip: string;
  countrycode: string;
  homephone: string;
  cellphone: string;
  email: string;
  baptized: boolean;
  baptizeddate: string; // ISO
  tithestatusid: number | null;
  comments: string;
  eldercomments: string;
  statusid: number | null;
  congregationid: number | null;
};

type TitheStatus = { id: number; name: string };
type Status = { id: number; name: string };
type Congregation = { id: number; name: string };

function toISODate(d: string) {
  return d ? new Date(d).toISOString() : "";
}

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

function TextRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <input
        className={forms.field}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Row>
  );
}

function DateRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <input
        className={forms.field}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Row>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label}>
      <div className={forms.checkControl}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{checked ? "Yes" : "No"}</span>
      </div>
    </Row>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label}>
      <select
        className={forms.field}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Select —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

function TextAreaRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <textarea
        className={`${forms.field} ${forms.textarea}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Row>
  );
}

export default function NewMemberPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [titheStatuses, setTitheStatuses] = useState<TitheStatus[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [congregations, setCongregations] = useState<Congregation[]>([]);

  const [countryOptions, setCountryOptions] = useState<Option[]>([]);
  const [usStateOptions, setUsStateOptions] = useState<Option[]>([]);
  const [canadaStateOptions, setCanadaStateOptions] = useState<Option[]>([]);
  const [australiaStateOptions, setAustraliaStateOptions] = useState<Option[]>([]);
  const [countryNameByCode, setCountryNameByCode] = useState<
    Record<string, string>
  >({});
  const [usStateNameByCode, setUsStateNameByCode] = useState<
    Record<string, string>
  >({});
  const [canadaStateNameByCode, setCanadaStateNameByCode] = useState<
    Record<string, string>
  >({});
  const [australiaStateNameByCode, setAustraliaStateNameByCode] = useState<
    Record<string, string>
  >({});

  const [form, setForm] = useState<NewMember>({
    fname: "",
    lname: "",
    address: "",
    address2: "",
    city: "",
    statecode: "",
    zip: "",
    countrycode: "US",
    homephone: "",
    cellphone: "",
    email: "",
    baptized: false,
    baptizeddate: "",
    tithestatusid: null,
    comments: "",
    eldercomments: "",
    statusid: null,
    congregationid: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const [
          { data: tData, error: tErr },
          { data: sData, error: sErr },
          { data: cData, error: cErr },
        ] =
          await Promise.all([
            supabase.from("emctithestatus").select("id,name").order("name"),
            supabase.from("emcstatus").select("id,name").order("name"),
            supabase.from("emccongregation").select("id,name").order("name"),
          ]);

        if (tErr) throw tErr;
        if (sErr) throw sErr;
        if (cErr) throw cErr;

        const lookups = await fetchCountryAndUSStateLookups();

        if (!cancelled) {
          setTitheStatuses((tData ?? []) as TitheStatus[]);
          setStatuses((sData ?? []) as Status[]);
          setCongregations(
            ((cData ?? []) as { id: number; name: string | null }[]).map((row) => ({
              id: row.id,
              name: (row.name ?? "").trim(),
            })),
          );

          setCountryOptions(lookups.countryOptions);
          setUsStateOptions(lookups.usStateOptions);
          setCanadaStateOptions(lookups.canadaStateOptions);
          setAustraliaStateOptions(lookups.australiaStateOptions);

          setCountryNameByCode(lookups.countryNameByCode);
          setUsStateNameByCode(lookups.usStateNameByCode);
          setCanadaStateNameByCode(lookups.canadaStateNameByCode ?? {});
          setAustraliaStateNameByCode(lookups.australiaStateNameByCode ?? {});
        }
      } catch (e: unknown) {
        if (!cancelled) {
          const message =
            e instanceof Error ? e.message : typeof e === "string" ? e : "Failed to load lookups.";
          setErr(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function setField<K extends keyof NewMember>(key: K, value: NewMember[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setCountry(code: string) {
    const cc = code.trim().toUpperCase();
    setForm((prev) => ({
      ...prev,
      countrycode: cc,
      statecode: cc === "US" || cc === "CA" || cc === "AU" ? prev.statecode : "",
    }));
  }

  function setState(codeOrNull: string | null) {
    setForm((prev) => ({
      ...prev,
      statecode: codeOrNull ? codeOrNull.trim().toUpperCase() : "",
    }));
  }

  async function save() {
    setErr(null);
    setSaving(true);

    try {
      const fname = form.fname.trim();
      const lname = form.lname.trim();

      if (!lname || !fname) {
        setErr("Please enter at least First Name and Last Name.");
        return;
      }

      if (!form.tithestatusid) {
        setErr("Tithing Status is required.");
        return;
      }

      if (!form.statusid) {
        setErr("Fellowship Status is required.");
        return;
      }

      const cc = form.countrycode.trim().toUpperCase();
      if (!cc || cc.length !== 2) {
        setErr("Country is required.");
        return;
      }

      const sc = form.statecode.trim().toUpperCase();
      if ((cc === "US" || cc === "CA" || cc === "AU") && !sc) {
        setErr(
          cc === "CA"
            ? "Province is required when Country is Canada."
            : cc === "AU"
              ? "State is required when Country is Australia."
              : "State is required when Country is US.",
        );
        return;
      }

      const payload = {
        fname: fname || null,
        lname: lname || null,
        address: form.address.trim() || null,
        address2: form.address2.trim() || null,
        city: form.city.trim() || null,
        zip: form.zip.trim() || null,
        countrycode: cc,
        statecode: cc === "US" || cc === "CA" || cc === "AU" ? sc : null,
        homephone: form.homephone.trim() || null,
        cellphone: form.cellphone.trim() || null,
        email: form.email.trim() || null,
        baptized: form.baptized,
        baptizeddate: form.baptizeddate ? form.baptizeddate : null,
        tithestatusid: form.tithestatusid,
        comments: form.comments.trim() || null,
        eldercomments: form.eldercomments.trim() || null,
        statusid: form.statusid,
        congregationid: form.congregationid,
        datecreated: new Date().toISOString(),
        dateupdated: null,
      };

      const { data, error } = await supabase
        .from("emcmember")
        .insert(payload)
        .select("id")
        .single();

      if (error) {
        setErr(error.message);
        return;
      }

      const newId = data?.id;
      router.push(`/members?selected=${newId}`);
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : typeof e === "string" ? e : "Save failed.";
      setErr(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className={`${forms.page} ${forms.pageNarrow} ${forms.compactPage}`}>
        Loading…
      </main>
    );
  }

  return (
    <main className={`${forms.page} ${forms.pageNarrow} ${forms.compactPage}`}>
      <h1 className={forms.h1}>Add New Contact</h1>

      <div className={forms.backRow}>
        <BackLink fallbackHref="/members" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          ← Back to Members
        </BackLink>
      </div>

      {err && <p className={forms.error}>{err}</p>}

      <div className={forms.formGrid}>
        <div className={`${forms.col} ${forms.colTight}`}>
          <TextRow
            label="First Name"
            value={form.fname}
            onChange={(v) => setField("fname", v)}
          />
          <TextRow
            label="Last Name"
            value={form.lname}
            onChange={(v) => setField("lname", v)}
          />
          <TextRow
            label="Address"
            value={form.address}
            onChange={(v) => setField("address", v)}
          />
          <TextRow
            label="Address 2"
            value={form.address2}
            onChange={(v) => setField("address2", v)}
          />
          <TextRow
            label="City"
            value={form.city}
            onChange={(v) => setField("city", v)}
          />
          <TextRow
            label="Zip"
            value={form.zip}
            onChange={(v) => setField("zip", v)}
          />

          <CountryStatePicker
            editMode={true}
            countrycode={form.countrycode}
            statecode={form.statecode}
            countryOptions={countryOptions}
            usStateOptions={usStateOptions}
            canadaStateOptions={canadaStateOptions}
            australiaStateOptions={australiaStateOptions}
            countryNameByCode={countryNameByCode}
            usStateNameByCode={usStateNameByCode}
            canadaStateNameByCode={canadaStateNameByCode}
            australiaStateNameByCode={australiaStateNameByCode}
            onChangeCountry={setCountry}
            onChangeState={setState}
          />
        </div>

        <div className={forms.col}>
          <TextRow
            label="Home Phone"
            value={form.homephone}
            onChange={(v) => setField("homephone", v)}
          />
          <TextRow
            label="Cell Phone"
            value={form.cellphone}
            onChange={(v) => setField("cellphone", v)}
          />
          <TextRow
            label="E-Mail"
            value={form.email}
            onChange={(v) => setField("email", v)}
          />

          <CheckRow
            label="Baptized"
            checked={form.baptized}
            onChange={(v) => setField("baptized", v)}
          />

          <DateRow
            label="Baptized Date"
            value={form.baptizeddate ? form.baptizeddate.slice(0, 10) : ""}
            onChange={(v) => setField("baptizeddate", v ? toISODate(v) : "")}
          />

          <SelectRow
            label="Fellowship Status"
            value={form.statusid?.toString() ?? ""}
            options={statuses.map((s) => ({
              value: String(s.id),
              label: s.name,
            }))}
            onChange={(v) => setField("statusid", v ? Number(v) : null)}
            disabled={statuses.length === 0}
          />

          <SelectRow
            label="Tithing Status"
            value={form.tithestatusid?.toString() ?? ""}
            options={titheStatuses.map((s) => ({
              value: String(s.id),
              label: s.name,
            }))}
            onChange={(v) => setField("tithestatusid", v ? Number(v) : null)}
            disabled={titheStatuses.length === 0}
          />

          <TextAreaRow
            label="Comments"
            value={form.comments}
            onChange={(v) => setField("comments", v)}
          />

          <div style={{ border: "1px solid #000", padding: 8 }}>
            <TextAreaRow
              label="Elder Comments"
              value={form.eldercomments}
              onChange={(v) => setField("eldercomments", v)}
            />

            <SelectRow
              label="Congregation"
              value={form.congregationid?.toString() ?? ""}
              options={congregations.map((row) => ({
                value: String(row.id),
                label: row.name,
              }))}
              onChange={(v) => setField("congregationid", v ? Number(v) : null)}
            />
          </div>
        </div>
      </div>

      <div className={forms.actions}>
        <button
          type="button"
          className={forms.button}
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save New Contact"}
        </button>
      </div>
    </main>
  );
}
