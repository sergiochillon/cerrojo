# cerrojo

[Español](README.md)

Checks whether users of an AI-built app (Lovable, Bolt, Cursor…) on Supabase can see or
change each other's data. It does not check whether RLS is "enabled": it signs in with two
test accounts and compares what each one receives. It produces a report with a fix for each
finding.

> **Status: first version, not yet validated against a real Supabase project.** It works end
> to end against the bundled demo app and has 107 automated tests, but so far it has only
> talked to a local emulation of the Supabase API, and it has not been used with any client.
> Read [docs/LIMITACIONES.md](docs/LIMITACIONES.md) (Spanish) before trusting a result.

## The problem

In these apps the browser talks straight to the database. The only thing separating one
user's data from another's is Row Level Security. The usual flaw is not missing RLS, but RLS
enabled with a policy that lets any signed-in user through:

```sql
alter table clients enable row level security;                              -- "RLS enabled" ✓
create policy "..." on clients for all using (auth.uid() is not null);     -- …for everyone
```

Every dashboard shows the table as protected, and a scan from outside sees nothing. Anyone who
signs up can read and modify everyone's rows.

## What it does

| Command | Checks |
|---|---|
| `cerrojo web <url>` | What the deployed app exposes without a session: tables readable with the public key, secrets in the JavaScript, listable buckets. |
| `cerrojo aislamiento` | Whether one signed-in account receives another account's rows. |
| `cerrojo repo <dir>` | SQL migrations (missing RLS, open or session-only policies, open `WITH CHECK`, user-editable metadata, editable privilege columns, views and functions that bypass RLS) and code (secrets, unauthenticated Edge Functions). No network. |
| `cerrojo informe` | Merges results and manual review into a printable HTML report (`--idioma en` for English). |

When something cannot be checked, it says so: a rejected key, a server error or a table with
no test data is reported as a warning and the report is marked inconclusive, never "protected".

## Try it in a minute, without touching any real system

Requires Node.js 20.6+.

```bash
npm install
npm run demo
```

This starts a deliberately vulnerable demo app on your machine, audits it and writes
`salida/demo-report.html`. A generated copy is at [docs/sample-report.html](docs/sample-report.html).

## Safeguards

- No request is made without `--autorizo` (a declaration that you own the app or hold written
  authorisation). Only use it on your own apps or with the owner's permission.
- Only the public key is accepted; secret keys are refused.
- It only reads. The one write test is restricted to a local, disposable database.
- It refuses to connect to localhost or private/internal addresses, including after redirects.
  `--permitir-local` allows **any** service on your own machine, not just the demo.
- The isolation test downloads full rows (up to 1,000 per account and table) to compare them
  in memory; values are never stored. Use dummy data or a local replica.
- No runtime dependencies.

Command names, options and most documentation are in Spanish. `node bin/cerrojo.js ayuda`
lists every option.

## Licence

MIT. See [LICENSE](LICENSE).
