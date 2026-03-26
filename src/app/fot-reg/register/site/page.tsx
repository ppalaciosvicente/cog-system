import { createServiceRoleClient } from "@/lib/supabase/service";
import { resolveFotTokenHash } from "@/lib/fot/tokens";
import forms from "@/styles/forms.module.css";

import SiteRegistrationForm from "./SiteRegistrationForm";

type PageSearchParams = Promise<{
  siteId?: string;
  t?: string;
}>;

type MemberEligibilityRow = {
  id: number;
  fname: string | null;
  statusid: number | null;
  baptized: boolean | null;
};

type LocationRow = {
  id: number | string;
  name: string | null;
};

function toText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseLocationId(value: string) {
  const v = value.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

async function resolveMemberFromToken(rawToken: string) {
  const token = rawToken.trim();
  if (!token) return { memberId: null as number | null, firstName: "", error: "Missing token." };

  const supabase = createServiceRoleClient();
  const tokenHash = resolveFotTokenHash(token);
  const { data: tokenRows, error: tokenErr } = await supabase
    .from("fotregtoken")
    .select("memberid,isactive")
    .eq("tokenhash", tokenHash)
    .eq("isactive", true)
    .limit(1);
  if (tokenErr) {
    return { memberId: null as number | null, firstName: "", error: `Failed to validate token: ${tokenErr.message}` };
  }

  const memberId = Number(
    (tokenRows?.[0] as { memberid?: number | string | null } | undefined)?.memberid ?? 0,
  );
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return { memberId: null as number | null, firstName: "", error: "Invalid or inactive token." };
  }

  const { data: memberRows, error: memberErr } = await supabase
    .from("emcmember")
    .select("id,fname,statusid,baptized")
    .eq("id", memberId)
    .limit(1);
  if (memberErr) {
    return { memberId: null as number | null, firstName: "", error: `Failed to validate member: ${memberErr.message}` };
  }

  const member = ((memberRows ?? []) as MemberEligibilityRow[])[0];
  if (!member || member.statusid !== 1 || member.baptized !== true) {
    return { memberId: null as number | null, firstName: "", error: "This registration link is no longer valid." };
  }

  return {
    memberId,
    firstName: toText(member.fname),
    error: "",
  };
}

async function resolveSiteName(siteIdRaw: string) {
  const parsed = parseLocationId(siteIdRaw);
  if (!parsed) {
    return { siteId: "", siteName: "Unknown location", error: "Missing location." };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("fotlocation")
    .select("id,name")
    .eq("id", parsed)
    .limit(1);

  if (error) {
    return { siteId: "", siteName: siteIdRaw || "Unknown location", error: `Failed to load location: ${error.message}` };
  }

  const row = ((data ?? []) as LocationRow[])[0] ?? null;
  const resolvedId = toText(row?.id);
  return { siteId: resolvedId, siteName: toText(row?.name) || siteIdRaw || "Unknown location", error: "" };
}

export default async function SiteStepPage({ searchParams }: { searchParams: PageSearchParams }) {
  const params = await searchParams;
  const siteId = toText(params.siteId);
  const token = toText(params.t);

  const [{ memberId, firstName, error: memberError }, { siteId: resolvedSiteId, siteName, error: siteError }] = await Promise.all([
    resolveMemberFromToken(token),
    resolveSiteName(siteId),
  ]);

  const error = [memberError, siteError].filter(Boolean).join(" ");

  if (error || !memberId) {
    return (
      <main className={`${forms.page} ${forms.pageWarn}`}>
        <h1 className={forms.h1}>FoT Registration</h1>
        <p className={forms.error}>{error || "Unable to open this registration page."}</p>
      </main>
    );
  }

  return (
    <SiteRegistrationForm
      firstName={firstName || "Member"}
      siteName={siteName}
      siteId={resolvedSiteId || siteId}
      token={token}
    />
  );
}
