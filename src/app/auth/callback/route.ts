import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/reset-password";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const errUrl = new URL("/reset-password", url.origin);
      errUrl.searchParams.set("error", error.message);
      return NextResponse.redirect(errUrl);
    }
  }

  const redirectUrl = new URL(next, url.origin);
  return NextResponse.redirect(redirectUrl);
}
