import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { normalizeRoleRow, type RoleRow } from "@/types/roles";

function createUserClient(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set() {
          // no-op for route handler; we only need read access
        },
        remove() {
          // no-op for route handler; we only need read access
        },
      },
    },
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Missing Supabase server configuration" },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(req.url);
    const path = (searchParams.get("path") || "").trim();
    if (!path) {
      return NextResponse.json({ error: "Missing path" }, { status: 400 });
    }
    if (path.startsWith("/") || path.includes("..")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    // 1) Check the user is logged in and has access to EMC
    const supabaseUser = createUserClient(req);
    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: account, error: accErr } = await supabaseUser
      .from("emcaccounts")
      .select("id, isactive")
      .eq("authuserid", user.id)
      .single();

    if (accErr || !account || !account.isactive) {
      return NextResponse.json(
        { error: "No active EMC account" },
        { status: 403 },
      );
    }

    const { data: roleRows, error: roleErr } = await supabaseUser
      .from("emcaccountroles")
      .select("emcroles(rolename)")
      .eq("accountid", account.id);

    if (roleErr) {
      return NextResponse.json(
        { error: "Failed to load roles" },
        { status: 403 },
      );
    }

    const roles = (roleRows ?? [])
      .map((r: RoleRow) => normalizeRoleRow(r)?.rolename)
      .filter(Boolean) as string[];

    const allowed =
      roles.includes("emc_admin") ||
      roles.includes("emc_superuser") ||
      roles.includes("emc_user");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 2) Generate a signed URL using service role (bucket is private)
    const supabaseAdmin = createServiceRoleClient();
    const { data, error } = await supabaseAdmin.storage
      .from("emc-downloads")
      .createSignedUrl(path, 60); // valid for 60 seconds

    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to sign URL" },
        { status: 500 },
      );
    }

    // 3) Stream file through this route to force download in browsers
    const signedRes = await fetch(data.signedUrl);
    if (!signedRes.ok || !signedRes.body) {
      return NextResponse.json(
        { error: "Failed to fetch signed file" },
        { status: 502 },
      );
    }

    const filename = path.split("/").pop() || "download";
    const headers = new Headers(signedRes.headers);
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);

    return new Response(signedRes.body, {
      status: 200,
      headers,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Unexpected error";
    console.error("documents/download error", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
