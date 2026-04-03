import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";

export type AppAccess = {
  canAccessEmc: boolean;
  canAccessContributions: boolean;
};

export type CurrentAppAccess =
  | {
      ok: true;
      accountId: number;
      roleNames: string[];
      roleLabel: string;
      roleSummary: string;
      appAccess: AppAccess;
    }
  | {
      ok: false;
      error: string;
      unauthenticated?: boolean;
    };

function normalizeRoleName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function getAppAccess(roleNames: string[]): AppAccess {
  const normalized = roleNames.map(normalizeRoleName);

  return {
    canAccessEmc: normalized.some((role) =>
      ["emc_admin", "emc_superuser", "emc_user"].includes(role),
    ),
    canAccessContributions: normalized.some((role) =>
      ["contrib_admin", "contrib_user"].includes(role),
    ),
  };
}

export function getRoleLabel(roleNames: string[]) {
  return roleNames.includes("emc_admin")
    ? "emc_admin"
    : roleNames.includes("emc_superuser")
      ? "emc_superuser"
      : roleNames.includes("emc_user")
        ? "emc_user"
        : roleNames.includes("contrib_admin")
          ? "contrib_admin"
          : roleNames.includes("contrib_user")
            ? "contrib_user"
            : (roleNames[0] ?? "unknown");
}

export async function loadCurrentAppAccess(
  supabase: SupabaseClient,
): Promise<CurrentAppAccess> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return {
      ok: false,
      error: "Unauthenticated",
      unauthenticated: true,
    };
  }

  const { data: account, error: accErr } = await supabase
    .from("emcaccounts")
    .select("id, isactive")
    .eq("authuserid", user.id)
    .single();

  if (accErr || !account || !account.isactive) {
    return {
      ok: false,
      error: "No active EMC account linked to this login.",
    };
  }

  const { data: roleRows, error: roleErr } = await supabase
    .from("emcaccountroles")
    .select("emcroles(rolename)")
    .eq("accountid", account.id);

  if (roleErr) {
    return {
      ok: false,
      error: `Failed to load roles: ${roleErr.message}`,
    };
  }

  const roleNames = (roleRows ?? [])
    .map((row: RoleRow) => normalizeRoleRow(row)?.rolename)
    .filter(Boolean) as string[];

  const appAccess = getAppAccess(roleNames);
  if (!appAccess.canAccessEmc && !appAccess.canAccessContributions) {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore sign-out errors; we'll still block access
    }
    return {
      ok: false,
      error: "You are logged in, but you do not have access to any app area.",
      unauthenticated: true,
    };
  }

  return {
    ok: true,
    accountId: account.id,
    roleNames,
    roleLabel: getRoleLabel(roleNames),
    roleSummary: roleNames.join(", "),
    appAccess,
  };
}
