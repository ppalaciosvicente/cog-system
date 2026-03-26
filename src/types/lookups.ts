export type CountryRow = {
  code?: string | null;
  name?: string | null;
};

export type StateRow = {
  code?: string | null;
  name?: string | null;
  countrycode?: string | null;
};
