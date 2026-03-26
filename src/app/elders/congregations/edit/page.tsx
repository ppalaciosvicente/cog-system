"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackLink } from "@/components/BackLink";
import forms from "@/styles/forms.module.css";
import type { RoleName, RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";

type CongregationForm = {
  name: string;
  comments: string;
};

type CongregationRecord = {
  id: number;
  name: string | null;
  comments: string | null;
};

function CongregationEditForm() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();

  const selected = params.get("selected");
  const selectedId = selected ? Number(selected) : null;
  const isEdit = selectedId != null && Number.isFinite(selectedId) && selectedId > 0;

  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [form, setForm] = useState<CongregationForm>({
    name: "",
    comments: "",
  });

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setPageLoading(true);
      setError(null);
      setSaveMsg(null);

      try {
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();

        if (userErr || !user) {
          router.replace("/login");
          return;
        }

        const { data: account, error: accErr } = await supabase
          .from("emcaccounts")
          .select("id, isactive")
          .eq("authuserid", user.id)
          .single();

        if (accErr || !account || !account.isactive) {
          setError("No active EMC account linked to this login.");
          return;
        }

        const { data: roleRows, error: roleErr } = await supabase
          .from("emcaccountroles")
          .select("emcroles(rolename)")
          .eq("accountid", account.id);

        if (roleErr) {
          setError(`Failed to load roles: ${roleErr.message}`);
          return;
        }

        const roles = (roleRows ?? [])
          .map((r: RoleRow) => normalizeRoleRow(r)?.rolename)
          .filter(Boolean) as RoleName[];

        const admin = roles.includes("emc_admin");
        if (!admin) {
          setError("Only admins can add/edit congregations.");
          return;
        }

        if (isEdit && selectedId) {
          const { data, error: loadErr } = await supabase
            .from("emccongregation")
            .select("id,name,comments")
            .eq("id", selectedId)
            .single();

          if (loadErr) {
            setError(`Failed to load congregation: ${loadErr.message}`);
            return;
          }

          if (!cancelled && data) {
            const record = data as CongregationRecord;
            setForm({
              name: String(record.name ?? ""),
              comments: String(record.comments ?? ""),
            });
          }
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [isEdit, router, selectedId, supabase]);

  async function handleSave() {
    setError(null);
    setSaveMsg(null);

    const name = form.name.trim();
    if (!name) {
      setError("Congregation name is required.");
      return;
    }

    setSaving(true);
    try {
      const { data } = await supabase.auth.getSession();
      const session = data?.session ?? null;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const response = await fetch("/api/elders/congregations", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          id: isEdit && selectedId ? selectedId : undefined,
          name,
          comments: form.comments.trim(),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = payload?.error ?? "Failed to save congregation.";
        setError(isEdit ? `Failed to update congregation: ${message}` : `Failed to add congregation: ${message}`);
        return;
      }

      setSaveMsg(isEdit ? "Congregation updated." : "Congregation added.");
      router.push("/elders/congregations");
    } finally {
      setSaving(false);
    }
  }

  if (pageLoading) {
    return <main className={forms.page}>Loading…</main>;
  }

  const content = (
    <main className={forms.page}>
      <h1 className={forms.h1}>{isEdit ? "Edit Congregation" : "Add Congregation"}</h1>
      <div className={forms.backRow}>
        <BackLink fallbackHref="/elders/congregations" className={`${forms.linkButton} ${forms.linkButtonLight}`}>
          &lt;- Back to Congregations
        </BackLink>
      </div>

      {error && <p className={forms.error}>{error}</p>}
      {saveMsg && <p>{saveMsg}</p>}

      <div style={{ maxWidth: 760 }}>
        <div className={forms.row}>
          <label className={forms.label} htmlFor="congregation-name">
            Congregation name
          </label>
          <div className={forms.control}>
            <input
              id="congregation-name"
              className={forms.field}
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              disabled={saving}
            />
          </div>
        </div>

        <div className={forms.row} style={{ marginTop: 10 }}>
          <label className={forms.label} htmlFor="congregation-comments">
            Comments
          </label>
          <div className={forms.control}>
            <textarea
              id="congregation-comments"
              className={`${forms.field} ${forms.textarea}`}
              value={form.comments}
              onChange={(e) => setForm((prev) => ({ ...prev, comments: e.target.value }))}
              disabled={saving}
            />
          </div>
        </div>

        <div className={forms.actions}>
          <button className={forms.button} onClick={handleSave} disabled={saving}>
            {isEdit ? "Save changes" : "Add congregation"}
          </button>
        </div>
      </div>
    </main>
  );

  return content;
}

export default function CongregationEditPage() {
  return (
    <Suspense fallback={<main className={forms.page}>Loading…</main>}>
      <CongregationEditForm />
    </Suspense>
  );
}
