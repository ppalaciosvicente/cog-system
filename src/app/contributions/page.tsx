"use client";

import Link from "next/link";
import { ContributionPage } from "@/components/contributions/ContributionPage";
import forms from "@/styles/forms.module.css";

const DASHBOARD_LINKS = [
  {
    href: "/contributions/enter",
    label: "Enter Contributions",
    description: "Batch entry screen for recently received contributions.",
  },
  {
    href: "/contributions/donors",
    label: "View Donors",
    description: "Member detail view with contribution history below it.",
  },
  {
    href: "/contributions/view",
    label: "View Contributions & Download Reports",
    description: "Filter contributions, export CSV/PDF, or download reports.",
  },
];

export default function ContributionsDashboardPage() {
  return (
    <ContributionPage
      title="Contributions Dashboard"
      showBackLink={false}
      showRoleSummary
    >
      {(access) => (
        <>
          <div className={forms.actions} style={{ marginTop: 8 }}>
            {DASHBOARD_LINKS.map((item) => (
              <Link key={item.href} href={item.href} className={forms.button}>
                {item.label}
              </Link>
            ))}
          </div>

          {access.isAdmin ? (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ margin: "0 0 10px" }}>Administration</h3>
              <div className={forms.actions} style={{ marginTop: 0 }}>
                <Link href="/contributions/access" className={forms.button}>
                  Access Configuration
                </Link>
              </div>
            </div>
          ) : null}
        </>
      )}
    </ContributionPage>
  );
}
