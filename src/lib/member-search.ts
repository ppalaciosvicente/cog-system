export function normalizeSearchTerm(value: string) {
  return value.trim().toLowerCase();
}

export function personNameStartsWithSearch(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  searchTerm: string,
) {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return false;

  return (
    String(firstName ?? "").trim().toLowerCase().startsWith(term) ||
    String(lastName ?? "").trim().toLowerCase().startsWith(term)
  );
}

export function displayNameStartsWithSearch(displayName: string, searchTerm: string) {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return false;

  const [lastNamePart, firstNamePart = ""] = displayName.split(",", 2);
  const firstNameTokens = firstNamePart
    .split(/[&\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  return (
    lastNamePart.trim().toLowerCase().startsWith(term) ||
    firstNameTokens.some((part) => part.startsWith(term))
  );
}
