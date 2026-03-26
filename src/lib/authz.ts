import type { NextRequest } from "next/server";
import { createServiceRoleClient } from "./supabase/service";
import type { RoleRow } from "../types/roles";
import { normalizeRoleRow } from "../types/roles";

function parseCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.slice(name.length + 1));
}

const ACCESS_TOKEN_COOKIE = "sb-access-token";

function parseAuthorizationHeader(header: string | null) {
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
}

function resolveAccessToken(request: NextRequest) {
  const bearerToken = parseAuthorizationHeader(request.headers.get("authorization"));
  if (bearerToken) return bearerToken;
  const byCookie = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (byCookie) return byCookie;
  return parseCookieValue(request.headers.get("cookie"), ACCESS_TOKEN_COOKIE);
}

function roleKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export async function requireRole(allowedRoleNames: string[], request: NextRequest) {
  const accessToken = resolveAccessToken(request);
  if (!accessToken) return { ok: false as const };

  const supabase = createServiceRoleClient();
  const { data, error: userErr } = await supabase.auth.getUser(accessToken);
  const user = data?.user ?? null;
  if (userErr || !user) return { ok: false as const };

  const { data: account, error: accErr } = await supabase
    .from("emcaccounts")
    .select("id, isactive, memberid")
    .eq("authuserid", user.id)
    .single();

  if (accErr || !account || !account.isactive) {
    return { ok: false as const };
  }

  const { data: roles, error: roleErr } = await supabase
    .from("emcaccountroles")
    .select("emcroles(rolename)")
    .eq("accountid", account.id);

  if (roleErr) return { ok: false as const };

  const roleNames =
    roles
      ?.map((r: RoleRow) => normalizeRoleRow(r)?.rolename)
      .filter((name): name is string => Boolean(name)) ?? [];

  const allowedKeys = new Set(allowedRoleNames.map((name) => roleKey(name)).filter(Boolean));
  const allowed = roleNames.some((r: string) => allowedKeys.has(roleKey(r)));
  if (!allowed) return { ok: false as const };

  return {
    ok: true as const,
    roleNames,
    accountId: account.id,
    memberId: account.memberid ?? null,
    userId: user.id,
  };
}
