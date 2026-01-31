import { createClient } from "./supabase/server";

export async function requireRole(allowedRoleNames: string[]) {
  const supabase = createClient();

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return { ok: false as const };

  const { data: account, error: accErr } = await supabase
    .from("emcAccounts")
    .select("id, isactive")
    .eq("authuserid", user.id)
    .single();

  if (accErr || !account || !account.isactive) return { ok: false as const };

  const { data: roles, error: roleErr } = await supabase
    .from("emcAccountRoles")
    .select("emcRoles(rolename)")
    .eq("accountid", account.id);

  if (roleErr) return { ok: false as const };

  const roleNames =
    roles?.map((r: any) => r.emcRoles?.rolename).filter(Boolean) ?? [];

  const allowed = roleNames.some((r: string) => allowedRoleNames.includes(r));
  if (!allowed) return { ok: false as const };

  return { ok: true as const, roleNames };
}

