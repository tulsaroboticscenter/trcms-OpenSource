# Database migrations

Every database schema change (new table, column, index, or a data seed that the code
depends on) goes here as a **forward-only** SQL file. This is how we track and apply DB
changes reliably across dev and production.

## Rules
1. **One change = one file**, named `NNNN_short_description.sql` (zero-padded, increasing).
   Next number = highest existing + 1.
2. Put **only forward SQL** in the file (the `ALTER`, `CREATE`, `INSERT`…). Do **not** add
   the `schema_migrations` bookkeeping — the runner handles that.
3. **Never edit or delete a migration once it's been applied anywhere.** If you need to
   change it, write a new migration.
4. Keep statements separated by `;` on their own line (the runner splits on that).

## Applying them
From the project root (uses the DB in your `.env`):

```
php deploy/migrate.php --status   # what's applied vs pending
php deploy/migrate.php            # apply pending migrations here (dev)
php deploy/migrate.php --print    # print pending SQL to paste into phpMyAdmin (prod)
```

## Production (no shell)
1. On your dev machine: `php deploy/migrate.php --print`
2. Copy the output into **phpMyAdmin → SQL** on the production `trc_ms` database and run it.
   The output includes the `INSERT INTO schema_migrations …` lines, so production records
   exactly what it has applied.

The `schema_migrations` table is created automatically the first time the runner touches a
database.
