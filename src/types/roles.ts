export type RoleName = "emc_admin" | "emc_superuser" | "emc_user" | string;

export type RoleEntry = { rolename?: string | null };

export type RoleRow = {
  emcroles?: RoleEntry | RoleEntry[] | null;
  emcRoles?: RoleEntry | RoleEntry[] | null;
};

function normalizeEntry(entry?: RoleEntry | RoleEntry[] | null) {
  if (!entry) return null;
  return Array.isArray(entry) ? entry[0] ?? null : entry;
}

export function normalizeRoleRow(row?: RoleRow) {
  return normalizeEntry(row?.emcroles) ?? normalizeEntry(row?.emcRoles);
}
