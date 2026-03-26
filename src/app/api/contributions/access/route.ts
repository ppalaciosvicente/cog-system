import { NextRequest, NextResponse } from "next/server";
import { getContributionAccess } from "@/lib/contributions";
import { getContributionScopeSummary } from "@/lib/contribution-scope";

export async function GET(request: NextRequest) {
  const access = await getContributionAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const scope = await getContributionScopeSummary(access);
  return NextResponse.json({
    ...access,
    scopeCountries: scope.countryNames,
    scopeLabel: scope.label,
  });
}
