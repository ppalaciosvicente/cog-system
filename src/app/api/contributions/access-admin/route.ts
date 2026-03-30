import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { requireRole } from "@/lib/authz";
import {
  CONTRIBUTION_ADMIN_ROLE,
  CONTRIBUTION_USER_ROLE,
  getContributionDonorStatusIds,
} from "@/lib/contributions";
import { createServiceRoleClient } from "@/lib/supabase/service";

type CountryRow = {
  code: string | null;
  name: string | null;
};

type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
};

type AccountRow = {
  id: number;
  memberid: number | null;
  isactive: boolean | null;
};

type AccountRoleRow = {
  accountid: number | null;
  roleid: number | null;
};

type RoleRow = {
  id: number;
  rolename: string | null;
};

type RegionRow = {
  accountid: number | null;
  countrycode: string | null;
};

type UpdatePayload = {
  memberId?: number;
  roleName?: string | null;
  countryCodes?: string[] | null;
  action?: "resend";
};

type EligibleMember = {
  id: number;
  name: string;
};

function resolveAppOrigin(request: NextRequest) {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (configured) return configured;
  const host = request.headers.get("x-forwarded-host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

async function findAuthUserIdByEmail(
  supabase: ReturnType<typeof createServiceRoleClient>,
  email: string,
) {
  const target = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;

  while (page <= 50) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) return { id: null as string | null, error };

    const users = data?.users ?? [];
    const match = users.find(
      (u) =>
        String(u.email ?? "")
          .trim()
          .toLowerCase() === target,
    );
    if (match?.id) return { id: match.id, error: null };

    const reachedEnd = users.length < perPage;
    if (reachedEnd) break;
    page += 1;
  }

  return { id: null as string | null, error: null };
}

async function ensureActiveAccountForMember(
  supabase: ReturnType<typeof createServiceRoleClient>,
  request: NextRequest,
  memberId: number,
  sendEmail: boolean = true,
) {
  const appOrigin = resolveAppOrigin(request);

  const { data: member, error: memberErr } = await supabase
    .from("emcmember")
    .select("id,email")
    .eq("id", memberId)
    .maybeSingle();

  if (memberErr) {
    return { accountId: null as number | null, error: memberErr.message };
  }
  const memberEmail = String(member?.email ?? "")
    .trim()
    .toLowerCase();
  if (!memberEmail) {
    return {
      accountId: null as number | null,
      error: "Selected member does not have an email address.",
    };
  }

  let accountId: number | null = null;
  let authUserId: string | null = null;

  const { data: existingAccount, error: existingErr } = await supabase
    .from("emcaccounts")
    .select("id, isactive, authuserid")
    .eq("memberid", memberId)
    .maybeSingle();

  if (existingErr) {
    return { accountId: null as number | null, error: existingErr.message };
  }

  if (existingAccount?.id) {
    accountId = existingAccount.id as number;
    authUserId = String(existingAccount.authuserid ?? "").trim() || null;
    if (authUserId) {
      const { data: linkedAuthData } =
        await supabase.auth.admin.getUserById(authUserId);
      const linkedAuthEmail = String(linkedAuthData?.user?.email ?? "")
        .trim()
        .toLowerCase();
      if (!linkedAuthEmail || linkedAuthEmail !== memberEmail) {
        authUserId = null;
      }
    }
    if (!existingAccount.isactive) {
      const { error: reactivateErr } = await supabase
        .from("emcaccounts")
        .update({ isactive: true })
        .eq("id", accountId);
      if (reactivateErr) {
        return {
          accountId: null as number | null,
          error: reactivateErr.message,
        };
      }
    }
  }

  if (!authUserId) {
    const existingAuth = await findAuthUserIdByEmail(supabase, memberEmail);
    if (existingAuth.error) {
      return {
        accountId: null as number | null,
        error: existingAuth.error.message,
      };
    }

    if (existingAuth.id) {
      authUserId = existingAuth.id;
      if (sendEmail) {
        const redirectTo = `${appOrigin}/auth/callback?next=/reset-password`;
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
          memberEmail,
          {
            redirectTo,
          },
        );
        if (resetErr) {
          return { accountId: null as number | null, error: resetErr.message };
        }
      }
    } else {
      const redirectTo = `${appOrigin}/auth/callback?next=/reset-password`;
      const { data: inviteData, error: inviteErr } =
        await supabase.auth.admin.inviteUserByEmail(memberEmail, {
          redirectTo,
        });
      if (inviteErr || !inviteData.user?.id) {
        return {
          accountId: null as number | null,
          error:
            inviteErr?.message ??
            "Failed to create auth user from member email.",
        };
      }
      authUserId = inviteData.user.id;
      // invite already sends email; no extra mail needed
      sendEmail = false;
    }
  }

  if (!accountId) {
    const { data: created, error: createErr } = await supabase
      .from("emcaccounts")
      .insert({ memberid: memberId, authuserid: authUserId, isactive: true })
      .select("id")
      .single();

    if (createErr || !created?.id) {
      return {
        accountId: null as number | null,
        error: createErr?.message ?? "Failed to create account.",
      };
    }
    accountId = created.id as number;
  } else {
    const { error: accountUpdateErr } = await supabase
      .from("emcaccounts")
      .update({ authuserid: authUserId, isactive: true })
      .eq("id", accountId);
    if (accountUpdateErr) {
      return {
        accountId: null as number | null,
        error: accountUpdateErr.message,
      };
    }
  }

  return { accountId, error: null as string | null };
}

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

async function sendSmtpEmail(to: string, subject: string, html: string) {
  const smtpHost = String(process.env.SMTP_HOST ?? "").trim();
  const smtpPort = Number(process.env.SMTP_PORT ?? 465);
  const smtpUser = String(process.env.SMTP_USER ?? "").trim();
  const smtpPass = String(process.env.SMTP_PASS ?? "").trim();
  const smtpSecure =
    String(process.env.SMTP_SECURE ?? "true").toLowerCase() !== "false";
  const fromEmail = String(process.env.FOT_EMAIL_FROM ?? "").trim();

  if (
    !smtpHost ||
    !smtpUser ||
    !smtpPass ||
    !fromEmail ||
    !Number.isFinite(smtpPort)
  ) {
    throw new Error("SMTP configuration missing");
  }

  const fromAddress = fromEmail.includes("<")
    ? fromEmail.slice(fromEmail.indexOf("<") + 1, fromEmail.indexOf(">")).trim()
    : fromEmail;

  const socket = smtpSecure
    ? tls.connect({ host: smtpHost, port: smtpPort, servername: smtpHost })
    : net.connect({ host: smtpHost, port: smtpPort });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", (err) => reject(err));
  });

  const state = { buffer: "" } as { buffer: string };
  const readResponse = (expected: string[]) =>
    new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        state.buffer += chunk.toString("utf8");
        if (!state.buffer.includes("\r\n")) return;
        const lines = state.buffer.split("\r\n");
        state.buffer = lines.pop() ?? "";
        const complete = lines.filter(Boolean);
        if (!complete.length) return;
        const last = complete[complete.length - 1];
        const code = last.slice(0, 3);
        const done = last.length >= 4 && last[3] === " ";
        if (!done) return;
        socket.off("data", onData);
        socket.off("error", onErr);
        if (!expected.includes(code)) {
          reject(new Error(`SMTP unexpected response ${code}`));
        } else {
          resolve();
        }
      };
      const onErr = (err: Error) => {
        socket.off("data", onData);
        socket.off("error", onErr);
        reject(err);
      };
      socket.on("data", onData);
      socket.on("error", onErr);
    });

  const send = (cmd: string, expected: string[]) => {
    socket.write(`${cmd}\r\n`);
    return readResponse(expected);
  };

  try {
    await readResponse(["220"]);
    await send("EHLO emc.local", ["250"]);
    await send("AUTH LOGIN", ["334"]);
    await send(Buffer.from(smtpUser).toString("base64"), ["334"]);
    await send(Buffer.from(smtpPass).toString("base64"), ["235"]);
    await send(`MAIL FROM:<${fromAddress}>`, ["250"]);
    await send(`RCPT TO:<${to}>`, ["250", "251"]);
    await send("DATA", ["354"]);

    const data = [
      `From: ${fromEmail}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      `Message-ID: <${randomUUID()}@emc.local>`,
      "",
      html,
      ".",
      "",
    ].join("\r\n");

    socket.write(data);
    await readResponse(["250"]);
    await send("QUIT", ["221"]);
  } finally {
    socket.destroy();
  }
}

function normalizeRoleName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function displayName(member: MemberRow) {
  const ln = String(member.lname ?? "").trim();
  const fn = String(member.fname ?? "").trim();
  if (!ln && !fn) return `#${member.id}`;
  if (!ln) return fn;
  if (!fn) return ln;
  return `${ln}, ${fn}`;
}

function highestContributionRole(roleNames: string[]) {
  if (roleNames.includes(CONTRIBUTION_ADMIN_ROLE))
    return CONTRIBUTION_ADMIN_ROLE;
  if (roleNames.includes(CONTRIBUTION_USER_ROLE)) return CONTRIBUTION_USER_ROLE;
  return null;
}

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole([CONTRIBUTION_ADMIN_ROLE], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  const [
    { data: roleData, error: roleErr },
    { data: countryData, error: countryErr },
    { data: accountData, error: accountErr },
  ] = await Promise.all([
    supabase
      .from("emcroles")
      .select("id,rolename")
      .in("rolename", [CONTRIBUTION_ADMIN_ROLE, CONTRIBUTION_USER_ROLE]),
    supabase
      .from("emccountry")
      .select("code,name")
      .order("name", { ascending: true }),
    supabase
      .from("emcaccounts")
      .select("id,memberid,isactive")
      .eq("isactive", true),
  ]);

  if (roleErr)
    return NextResponse.json({ error: roleErr.message }, { status: 500 });
  if (countryErr)
    return NextResponse.json({ error: countryErr.message }, { status: 500 });
  if (accountErr)
    return NextResponse.json({ error: accountErr.message }, { status: 500 });

  const roleIdByName = new Map<string, number>();
  ((roleData ?? []) as RoleRow[]).forEach((row) => {
    const name = normalizeRoleName(row.rolename);
    if (!name || !Number.isFinite(row.id) || row.id <= 0) return;
    roleIdByName.set(name, row.id);
  });

  const contribRoleIds = [CONTRIBUTION_ADMIN_ROLE, CONTRIBUTION_USER_ROLE]
    .map((roleName) => roleIdByName.get(roleName))
    .filter(
      (id): id is number =>
        typeof id === "number" && Number.isFinite(id) && id > 0,
    );

  const accounts = ((accountData ?? []) as AccountRow[]).filter(
    (row) =>
      Number.isFinite(row.id) &&
      row.id > 0 &&
      Number.isFinite(row.memberid) &&
      (row.memberid ?? 0) > 0,
  );
  const accountIds = accounts.map((row) => row.id);
  const memberIds = accounts.map((row) => Number(row.memberid));
  const activeMemberIdSet = new Set(memberIds);

  const [
    { data: memberData, error: memberErr },
    { data: accountRoleData, error: accountRoleErr },
    { data: regionData, error: regionErr },
  ] = await Promise.all([
    memberIds.length
      ? supabase
          .from("emcmember")
          .select("id,fname,lname")
          .in("id", memberIds)
          .order("lname", { ascending: true })
          .order("fname", { ascending: true })
      : Promise.resolve({ data: [] as MemberRow[], error: null }),
    accountIds.length && contribRoleIds.length
      ? supabase
          .from("emcaccountroles")
          .select("accountid,roleid")
          .in("accountid", accountIds)
          .in("roleid", contribRoleIds)
      : Promise.resolve({ data: [] as AccountRoleRow[], error: null }),
    accountIds.length
      ? supabase
          .from("contribaccountregion")
          .select("accountid,countrycode")
          .in("accountid", accountIds)
      : Promise.resolve({ data: [] as RegionRow[], error: null }),
  ]);

  if (memberErr)
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  if (accountRoleErr)
    return NextResponse.json(
      { error: accountRoleErr.message },
      { status: 500 },
    );
  if (regionErr)
    return NextResponse.json({ error: regionErr.message }, { status: 500 });

  const accountIdByMemberId = new Map<number, number>();
  accounts.forEach((row) => {
    const memberId = Number(row.memberid);
    if (!accountIdByMemberId.has(memberId)) {
      accountIdByMemberId.set(memberId, row.id);
    }
  });

  const roleNameByRoleId = new Map<number, string>();
  roleIdByName.forEach((roleId, roleName) => {
    roleNameByRoleId.set(roleId, roleName);
  });

  const roleNamesByAccountId = new Map<number, string[]>();
  ((accountRoleData ?? []) as AccountRoleRow[]).forEach((row) => {
    const accountId = Number(row.accountid);
    const roleId = Number(row.roleid);
    if (!Number.isFinite(accountId) || accountId <= 0) return;
    const roleName = roleNameByRoleId.get(roleId);
    if (!roleName) return;
    const current = roleNamesByAccountId.get(accountId) ?? [];
    current.push(roleName);
    roleNamesByAccountId.set(accountId, current);
  });

  const countryCodesByAccountId = new Map<number, string[]>();
  ((regionData ?? []) as RegionRow[]).forEach((row) => {
    const accountId = Number(row.accountid);
    if (!Number.isFinite(accountId) || accountId <= 0) return;
    const code = normalizeCode(row.countrycode);
    if (!code) return;
    const current = countryCodesByAccountId.get(accountId) ?? [];
    if (!current.includes(code)) current.push(code);
    countryCodesByAccountId.set(accountId, current);
  });

  const membersById = new Map<number, MemberRow>();
  ((memberData ?? []) as MemberRow[]).forEach((row) => {
    membersById.set(row.id, row);
  });

  const rows = Array.from(accountIdByMemberId.entries())
    .map(([memberId, accountId]) => {
      const member = membersById.get(memberId);
      if (!member) return null;
      return {
        memberId,
        accountId,
        memberName: displayName(member),
        roleName: highestContributionRole(
          roleNamesByAccountId.get(accountId) ?? [],
        ),
        countryCodes: (countryCodesByAccountId.get(accountId) ?? []).sort(
          (a, b) => a.localeCompare(b),
        ),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.memberName.localeCompare(b.memberName));

  // Eligible members: baptized + in-fellowship statuses, excluding those who already have a contrib role
  const eligibleMembers: EligibleMember[] = [];
  try {
    const donorStatusIds = await getContributionDonorStatusIds(supabase);
    const { data: eligibleData, error: eligibleErr } = await supabase
      .from("emcmember")
      .select("id,fname,lname,statusid,baptized,email")
      .in("statusid", donorStatusIds)
      .eq("baptized", true);
    if (eligibleErr) {
      throw new Error(eligibleErr.message);
    }
    const memberIdsWithRole = new Set(
      rows.filter((r) => r.roleName).map((r) => r.memberId),
    );
    for (const row of (eligibleData ?? []) as MemberRow[]) {
      const email = String((row as any).email ?? "").trim();
      if (!email) continue;
      if (memberIdsWithRole.has(row.id)) continue;
      eligibleMembers.push({ id: row.id, name: displayName(row) });
    }
    eligibleMembers.sort((a, b) => a.name.localeCompare(b.name));
  } catch (eligibleError) {
    // Non-fatal; leave list empty if lookup fails
  }

  const countryOptions = ((countryData ?? []) as CountryRow[])
    .map((row) => {
      const code = normalizeCode(row.code);
      const name = String(row.name ?? "").trim();
      if (!code || !name) return null;
      return { code, name };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return NextResponse.json({ rows, countryOptions, eligibleMembers });
}

export async function PUT(request: NextRequest) {
  const roleCheck = await requireRole([CONTRIBUTION_ADMIN_ROLE], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload =
    (await request.json().catch(() => ({}) as UpdatePayload)) ?? {};
  const memberId = Number(payload.memberId);
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }

  const roleName = normalizeRoleName(payload.roleName);
  if (
    roleName &&
    roleName !== CONTRIBUTION_ADMIN_ROLE &&
    roleName !== CONTRIBUTION_USER_ROLE
  ) {
    return NextResponse.json(
      { error: "Invalid contributions role." },
      { status: 400 },
    );
  }

  const countryCodes = Array.from(
    new Set(
      (payload.countryCodes ?? [])
        .map((code: unknown) => normalizeCode(String(code)))
        .filter(Boolean),
    ),
  );
  if (roleName === CONTRIBUTION_USER_ROLE && countryCodes.length === 0) {
    return NextResponse.json(
      { error: "At least one country is required for contrib_user." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const ensured = await ensureActiveAccountForMember(
    supabase,
    request,
    memberId,
  );
  if (ensured.error || !ensured.accountId) {
    return NextResponse.json(
      { error: ensured.error ?? "No active account found for this member." },
      { status: 400 },
    );
  }
  const accountId = ensured.accountId;

  const { data: roleData, error: roleErr } = await supabase
    .from("emcroles")
    .select("id,rolename")
    .in("rolename", [CONTRIBUTION_ADMIN_ROLE, CONTRIBUTION_USER_ROLE]);
  if (roleErr)
    return NextResponse.json({ error: roleErr.message }, { status: 500 });

  const roleIdByName = new Map<string, number>();
  ((roleData ?? []) as RoleRow[]).forEach((row) => {
    const normalized = normalizeRoleName(row.rolename);
    if (!normalized || !Number.isFinite(row.id) || row.id <= 0) return;
    roleIdByName.set(normalized, row.id);
  });
  const managedRoleIds = [CONTRIBUTION_ADMIN_ROLE, CONTRIBUTION_USER_ROLE]
    .map((name) => roleIdByName.get(name))
    .filter(
      (id): id is number =>
        typeof id === "number" && Number.isFinite(id) && id > 0,
    );

  const { error: deleteRoleErr } = await supabase
    .from("emcaccountroles")
    .delete()
    .eq("accountid", accountId)
    .in("roleid", managedRoleIds);
  if (deleteRoleErr) {
    return NextResponse.json({ error: deleteRoleErr.message }, { status: 500 });
  }

  if (roleName) {
    const roleId = roleIdByName.get(roleName);
    if (!roleId) {
      return NextResponse.json(
        { error: `Role ${roleName} was not found.` },
        { status: 500 },
      );
    }
    const { error: insertRoleErr } = await supabase
      .from("emcaccountroles")
      .insert({ accountid: accountId, roleid: roleId });
    if (insertRoleErr) {
      return NextResponse.json(
        { error: insertRoleErr.message },
        { status: 500 },
      );
    }
  }

  const { error: deleteScopeErr } = await supabase
    .from("contribaccountregion")
    .delete()
    .eq("accountid", accountId);
  if (deleteScopeErr) {
    return NextResponse.json(
      { error: deleteScopeErr.message },
      { status: 500 },
    );
  }

  if (roleName === CONTRIBUTION_USER_ROLE && countryCodes.length > 0) {
    const nowIso = new Date().toISOString();
    const scopeRows = countryCodes.map((code) => ({
      accountid: accountId,
      countrycode: code,
      datecreated: nowIso,
      dateupdated: nowIso,
    }));
    const { error: insertScopeErr } = await supabase
      .from("contribaccountregion")
      .insert(scopeRows);
    if (insertScopeErr) {
      return NextResponse.json(
        { error: insertScopeErr.message },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole([CONTRIBUTION_ADMIN_ROLE], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload =
    (await request.json().catch(() => ({}) as UpdatePayload)) ?? {};
  const memberId = Number(payload.memberId);
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const ensured = await ensureActiveAccountForMember(
    supabase,
    request,
    memberId,
    false,
  );
  if (ensured.error || !ensured.accountId) {
    return NextResponse.json(
      { error: ensured.error ?? "No active account found for this member." },
      { status: 400 },
    );
  }

  const { data: memberRow, error: memberErr } = await supabase
    .from("emcmember")
    .select("email")
    .eq("id", memberId)
    .maybeSingle();
  const memberEmail = String(memberRow?.email ?? "")
    .trim()
    .toLowerCase();
  if (memberErr || !memberEmail) {
    return NextResponse.json(
      { error: "Member email not found." },
      { status: 400 },
    );
  }

  const redirectTo = `${resolveAppOrigin(request)}/auth/callback?next=/reset-password`;

  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: memberEmail,
    options: { redirectTo },
  });
  const actionLink = (linkData as any)?.properties?.action_link ?? (linkData as any)?.action_link;
  if (linkErr || !actionLink) {
    return NextResponse.json(
      { error: linkErr?.message ?? "Failed to generate link." },
      { status: 500 },
    );
  }

  const subject = "COG PKG - Access to Contributions System";
  const html = `<!doctype html><html><body><p>Hello,</p><p>Use this link to access the Contributions System:</p><p><a href="${actionLink}">${actionLink}</a></p><p>If you did not request this, you can ignore this email.</p></body></html>`;

  try {
    await sendSmtpEmail(memberEmail, subject, html);
  } catch (mailErr) {
    return NextResponse.json(
      {
        error:
          mailErr instanceof Error ? mailErr.message : "Email send failed.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    accountId: ensured.accountId,
    sent: true,
    mode: "smtp",
  });
}
