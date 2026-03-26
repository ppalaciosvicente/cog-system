-- Tax Receipts language mapping by country.
-- This only affects the Tax Receipts report.
-- Safe to run multiple times.

create table if not exists contribcountrylocale (
  countrycode text primary key references emccountry(code) on delete cascade,
  locale text not null,
  datecreated timestamptz not null default timezone('utc', now()),
  dateupdated timestamptz not null default timezone('utc', now())
);

insert into contribcountrylocale (countrycode, locale)
select seed.countrycode, seed.locale
from (
  values
    ('US', 'en-US'),
    ('CA', 'en-CA'),
    ('NL', 'nl-NL')
) as seed(countrycode, locale)
join emccountry countries
  on upper(countries.code) = seed.countrycode
where not exists (
  select 1
  from contribcountrylocale existing
  where upper(existing.countrycode) = seed.countrycode
);
