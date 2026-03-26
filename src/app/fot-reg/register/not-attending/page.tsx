import { createServiceRoleClient } from "@/lib/supabase/service";
import { resolveFotTokenHash } from "@/lib/fot/tokens";
import forms from "@/styles/forms.module.css";

import NotAttendingRegistrationForm from "./NotAttendingRegistrationForm";

type PageSearchParams = Promise<{
  t?: string;
}>;

type MemberEligibilityRow = {
  id: number;
  fname: string | null;
  statusid: number | null;
  baptized: boolean | null;
};

function toText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
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

export default async function NotAttendingStepPage({ searchParams }: { searchParams: PageSearchParams }) {
  const params = await searchParams;
  const token = toText(params.t);

  const { memberId, firstName, error } = await resolveMemberFromToken(token);

  if (error || !memberId) {
    return (
      <main className={`${forms.page} ${forms.pageWarn}`}>
        <h1 className={forms.h1}>FoT Registration</h1>
        <p className={forms.error}>{error || "Unable to open this registration page."}</p>
      </main>
    );
  }

  return (
    <NotAttendingRegistrationForm
      firstName={firstName || "Member"}
      token={token}
    />
  );
}
