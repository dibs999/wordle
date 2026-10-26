-- Tabelle für die Spielerprofile von Wordle Deutsch.
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 20),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Jeder Name nur einmal (Groß-/Kleinschreibung egal).
create unique index if not exists profiles_name_unique on public.profiles (lower(btrim(name)));

alter table public.profiles enable row level security;

-- Ohne Anmeldung: Jeder mit dem Link darf Profile sehen, anlegen und Spielstände speichern.
-- Löschen ist absichtlich nicht erlaubt (nur über das Supabase-Dashboard).
drop policy if exists "Profile lesen" on public.profiles;
create policy "Profile lesen" on public.profiles
  for select to anon using (true);

drop policy if exists "Profile anlegen" on public.profiles;
create policy "Profile anlegen" on public.profiles
  for insert to anon with check (true);

drop policy if exists "Spielstand speichern" on public.profiles;
create policy "Spielstand speichern" on public.profiles
  for update to anon using (true) with check (true);

-- Der Name soll beim Speichern des Spielstands nicht verändert werden können.
revoke update on public.profiles from anon;
grant update (data, updated_at) on public.profiles to anon;
grant select, insert on public.profiles to anon;
