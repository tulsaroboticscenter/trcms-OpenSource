# Setting Up TRCMS for Local Development

This guide gets the Tulsa Robotics Center Management System running on **your own
computer** — Windows, macOS, or Linux — with **fake test data** (never real member
information). No special accounts or paid tools are required; everything here is free
and open-source.

> New contributor? Read **[CONTRIBUTING.md](CONTRIBUTING.md)** first for the rules and
> the pull-request workflow. This file is just the environment setup.

---

## What you need to install

| Tool | Version | What it's for |
| --- | --- | --- |
| **Git** | any recent | version control |
| **PHP** | 8.3 or newer | the backend API |
| **Composer** | latest | PHP package manager |
| **MySQL** *or* **MariaDB** | MySQL 8+ / MariaDB 10.6+ | the database |
| **Node.js** | 20 or newer (includes `npm`) | the frontend |

Use any code editor you like (VS Code, JetBrains, Vim — your choice).

### Installing the tools per platform

- **Windows** — install from each project's site, or use a package manager:
  `winget install Git.Git PHP.PHP Node.OpenJS.NodeJS Oracle.MySQL` (Composer from getcomposer.org).
- **macOS** — with [Homebrew](https://brew.sh): `brew install git php composer mysql node`
- **Linux (Debian/Ubuntu)** — `sudo apt install git php-cli php-mysql composer mysql-server nodejs npm`
  (or use your distro's equivalents / NodeSource for a current Node).

Verify everything:
```bash
git --version && php --version && composer --version && mysql --version && node --version
```

---

## The two repositories

- **trcms-backend** — the PHP API and the database (this repo).
- **trcms-frontend** — the React/TypeScript user interface.

Clone whichever you're working on (most beginner tasks are frontend). They sit in
sibling folders:

```bash
git clone https://github.com/<your-username>/trcms-backend.git
git clone https://github.com/<your-username>/trcms-frontend.git
```

---

## Backend setup (the API + database)

From inside `trcms-backend`:

### 1. Install PHP dependencies
```bash
composer install
```

### 2. Create your `.env`
```bash
cp .env.example .env        # Windows PowerShell: copy .env.example .env
```
Open `.env` and set `DATABASE_URL` to your local database (see the next step). Leave
`ENVIRONMENT=development`. Set `SECRET_KEY` to any random string.

### 3. Create a local database and load the schema
Create an empty database, then import the structure (no data):
```bash
# create the database (use your MySQL/MariaDB client or the CLI)
mysql -u root -e "CREATE DATABASE trcms_dev CHARACTER SET utf8mb4;"

# load the table structure
mysql -u root trcms_dev < deploy/schema.sql
```
Point `DATABASE_URL` in `.env` at it, e.g. `mysql://root:@localhost:3306/trcms_dev`
(add your password after the colon if your MySQL root has one).

### 4. Load fake test data
```bash
php deploy/seed_dev.php
```
This creates a few fake youth, a team, some inventory, and a **test login**:

```
username: devadmin     password: password123
```

The seed **refuses to run** unless `ENVIRONMENT=development` and the database is fresh,
so it can never touch real data.

### 5. Run the backend
```bash
php -S localhost:8090 -t public public/index.php
```
Leave this running. The API is now at `http://localhost:8090`.

---

## Frontend setup (the UI)

From inside `trcms-frontend`:

### 1. Install dependencies
```bash
npm install
```

### 2. Run the dev server
```bash
npm run dev
```
Open the URL it prints (usually `http://localhost:5173`). Log in with the seeded
`devadmin` / `password123` account. 🎉

> If the UI can't reach the API, make sure the backend (port 8090) is running and your
> `ALLOWED_ORIGINS` in the backend `.env` includes the Vite URL.

---

## Before you open a pull request

```bash
# frontend
npm run lint
npm run build      # tsc + vite build — must pass
```
A change that doesn't build can't be merged. See **[CONTRIBUTING.md](CONTRIBUTING.md)**
for the full PR workflow and the "definition of done."

---

## Troubleshooting

- **`DATABASE_URL is not set`** — you skipped `.env`, or it's in the wrong folder (it
  goes in the backend root, next to `composer.json`).
- **`Access denied for user`** — your `DATABASE_URL` username/password don't match your
  local MySQL. Adjust them.
- **`seed_dev.php` refuses to run** — check `ENVIRONMENT=development` in `.env`, and that
  the database is fresh (it won't run if `members` already has rows).
- **Schema import errors on MariaDB** — `deploy/schema.sql` is normalized for MySQL 8 and
  MariaDB 10.6+. On much older engines, upgrade your database server.
- **Never** put real member data in your dev database. If you need more sample data, add
  it to `deploy/seed_dev.php` (fake only) so everyone benefits.
