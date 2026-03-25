import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type CookieOptions = {
  domain?: string;
  path?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  sameSite?: "strict" | "lax" | "none" | boolean;
  secure?: boolean;
};

function normalizeOptions(options?: Partial<CookieOptions>) {
  if (!options) return {};
  const normalized: CookieOptions = {};
  if (options.domain) normalized.domain = options.domain;
  if (options.path) normalized.path = options.path;
  if (options.maxAge !== undefined) normalized.maxAge = options.maxAge;
  if (options.expires) normalized.expires = options.expires;
  if (options.httpOnly !== undefined) normalized.httpOnly = options.httpOnly;
  if (options.sameSite !== undefined) normalized.sameSite = options.sameSite;
  if (options.secure !== undefined) normalized.secure = options.secure;
  return normalized;
}

export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll().map((entry) => ({
            name: entry.name,
            value: entry.value,
          }));
        },
        setAll(values) {
          values.forEach(({ name, value, options }) => {
            try {
              cookieStore.set({
                name,
                value,
                ...normalizeOptions(options),
              });
            } catch {
              // Ignore write failures when cookies cannot be set.
            }
          });
        },
      },
    },
  );
}
