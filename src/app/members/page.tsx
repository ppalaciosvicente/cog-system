"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  email: string | null;
  countrycode: string | null;
  statecode: string | null;
  datecreated: string;
  dateupdated: string | null;
};

export default function MembersPage() {
  const supabase = createClient();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      setLoading(true);
      setErr(null);

      // Require login (Auth)
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      // Fetch members (RLS will enforce permissions)
      const { data, error } = await supabase
        .from("emcmember")
        .select(
          "id,fname,lname,email,countrycode,statecode,datecreated,dateupdated",
        )
        .order("lname", { ascending: true })
        .limit(200);

      if (error) {
        setErr(error.message);
        setLoading(false);
        return;
      }

      setRows((data ?? []) as MemberRow[]);
      setLoading(false);
    }

    run();
  }, [router, supabase]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Members</h1>

      <div style={{ margin: "12px 0" }}>
        <a href="/">← Back</a>
      </div>

      {loading && <p>Loading…</p>}
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      {!loading && !err && (
        <table
          cellPadding={8}
          style={{ borderCollapse: "collapse", width: "100%" }}
        >
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>State</th>
              <th>Country</th>
              <th>Created</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td>{m.id}</td>
                <td>{(m.lname ?? "") + ", " + (m.fname ?? "")}</td>
                <td>{m.email ?? ""}</td>
                <td>{m.statecode ?? ""}</td>
                <td>{m.countrycode ?? ""}</td>
                <td>
                  {m.datecreated
                    ? new Date(m.datecreated).toLocaleString()
                    : ""}
                </td>
                <td>
                  {m.dateupdated
                    ? new Date(m.dateupdated).toLocaleString()
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
