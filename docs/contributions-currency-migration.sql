-- Contribution app currency migration.
-- Safe to run on existing environments (idempotent).

create table if not exists contribcurrency (
  code text primary key,
  name text not null,
  symbol text not null,
  datecreated timestamptz not null default timezone('utc', now()),
  dateupdated timestamptz not null default timezone('utc', now())
);

insert into contribcurrency (code, name, symbol)
select seed.code, seed.name, seed.symbol
from (
  values
    ('USD', 'US Dollar', '$'),
    ('CAD', 'Canadian Dollar', '$'),
    ('EUR', 'Euro', '€'),
    ('GBP', 'Pound Sterling', '£')
) as seed(code, name, symbol)
where not exists (
  select 1
  from contribcurrency existing
  where upper(existing.code) = seed.code
);

create table if not exists contribcountrycurrency (
  countrycode text not null references emccountry(code) on delete cascade,
  currencycode text not null references contribcurrency(code),
  datecreated timestamptz not null default timezone('utc', now()),
  dateupdated timestamptz not null default timezone('utc', now()),
  primary key (countrycode)
);

-- Baseline defaults; add/update rows here as needed per country.
insert into contribcountrycurrency (countrycode, currencycode)
select seed.countrycode, seed.currencycode
from (
  values
    ('US', 'USD'),
    ('CA', 'CAD')
) as seed(countrycode, currencycode)
join emccountry countries
  on upper(countries.code) = seed.countrycode
where not exists (
  select 1
  from contribcountrycurrency existing
  where upper(existing.countrycode) = seed.countrycode
);

alter table contribcontribution
  add column if not exists currencycode text;

-- Backfill existing contributions from country mapping; fallback to USD.
update contribcontribution c
set currencycode = coalesce(cc.currencycode, 'USD')
from emcmember m
left join contribcountrycurrency cc
  on upper(cc.countrycode) = upper(m.countrycode)
where c.currencycode is null
  and m.id = c.memberid;

-- Safety fallback for any rows not matched above.
update contribcontribution
set currencycode = 'USD'
where currencycode is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'contribcontribution_currencycode_fkey'
  ) then
    alter table contribcontribution
      add constraint contribcontribution_currencycode_fkey
      foreign key (currencycode) references contribcurrency(code);
  end if;
end $$;

alter table contribcontribution
  alter column currencycode set default 'USD',
  alter column currencycode set not null;

create index if not exists idx_contribcontribution_currencycode
  on contribcontribution (currencycode);
