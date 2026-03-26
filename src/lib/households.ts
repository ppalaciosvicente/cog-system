export type HouseholdMember = {
  id: number;
  fname: string | null;
  lname: string | null;
  householdid: number | null;
  spouseid: number | null;
};

export type HouseholdOption = {
  value: number;
  label: string;
  memberIds: number[];
};

function displayName(member: Pick<HouseholdMember, "fname" | "lname">) {
  return [member.lname, member.fname].filter(Boolean).join(", ");
}

export function buildHouseholdOptions<T extends HouseholdMember>(members: T[]): HouseholdOption[] {
  const grouped = new Map<number, T[]>();
  members.forEach((member) => {
    const key = member.householdid ?? member.id;
    const rows = grouped.get(key) ?? [];
    rows.push(member);
    grouped.set(key, rows);
  });

  const list: HouseholdOption[] = [];
  grouped.forEach((membersInHousehold) => {
    const rows = [...membersInHousehold].sort((a, b) =>
      displayName(a).localeCompare(displayName(b)),
    );
    let representative = rows[0];
    const names = rows.map((member) => displayName(member)).filter(Boolean);
    let label = names[0] ?? `#${representative.id}`;

    if (rows.length === 2) {
      const [a, b] = rows;
      const reciprocal = a.spouseid === b.id && b.spouseid === a.id;
      if (reciprocal) {
        const [firstMember, secondMember] = [a, b].sort((x, y) => x.id - y.id);
        representative = firstMember;
        const aLast = String(a.lname ?? "").trim();
        const bLast = String(b.lname ?? "").trim();
        const firstName = String(firstMember.fname ?? "").trim();
        const secondName = String(secondMember.fname ?? "").trim();
        if (aLast && bLast && firstName && secondName && aLast.localeCompare(bLast) === 0) {
          label = `${aLast}, ${firstName} & ${secondName}`;
        } else {
          label = `${displayName(firstMember)} & ${displayName(secondMember)}`;
        }
      } else {
        label = `${displayName(a)} (+1 household member)`;
      }
    } else if (rows.length > 2) {
      label = `${displayName(representative)} (+${rows.length - 1} household members)`;
    }

    list.push({
      value: representative.id,
      label,
      memberIds: rows.map((member) => member.id),
    });
  });

  list.sort((a, b) => a.label.localeCompare(b.label));
  return list;
}
