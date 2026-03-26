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
  {
    href: "/contributions/access",
    label: "Access Configuration",
    description: "Manage who can enter contributions and which regions they can access.",
    adminOnly: true,
  },
];

export default function ContributionsDashboardPage() {
  return (
    <ContributionPage
      title="Contributions"
      showBackLink={false}
      showRoleSummary
    >
      {(access) => (
        <div className={forms.actions} style={{ marginTop: 8 }}>
          {DASHBOARD_LINKS.filter((item) => !item.adminOnly || access.isAdmin).map((item) => (
            <Link key={item.href} href={item.href} className={forms.button}>
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </ContributionPage>
  );
}
