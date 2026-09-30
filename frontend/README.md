# TRCMS — Frontend

The React + TypeScript (Vite) user interface for the **Tulsa Robotics Center Management
System**. This is the web app that TRC members, mentors, and admins use; it talks to the
**[trcms-backend](https://github.com/tulsaroboticscenter/trcms-backend)** PHP API.

## Tech stack

- **React 18** + **TypeScript**
- **Vite** (dev server + build)
- ESLint for linting

## Quick start

```bash
npm install      # install dependencies
npm run dev      # start the dev server (http://localhost:5173)
```

You'll also need the backend API running locally — see the setup guide below.

## Common commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the hot-reloading dev server |
| `npm run lint` | Run ESLint |
| `npm run build` | Type-check + production build (must pass before a PR) |

## Contributing

New contributor? Start here:

- **[Contributing guide](https://github.com/tulsaroboticscenter/trcms-backend/blob/master/CONTRIBUTING.md)** — the rules and the fork → PR workflow
- **[Development setup](https://github.com/tulsaroboticscenter/trcms-backend/blob/master/DEVELOPMENT.md)** — getting the app running locally on Windows, Mac, or Linux

The short version: **never push to `master`** (it's the live app), work on a branch in your
own fork, open a pull request, and a mentor will review it. Use **fake test data only** —
never real member information.
