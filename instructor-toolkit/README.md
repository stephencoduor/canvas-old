# Instructor Toolkit for Canvas

A Chrome (Manifest V3) extension for Canvas LMS instructors. One extension, three modules, each with its own on/off switch:

| Module | What it does | Where it appears |
|---|---|---|
| **Dates and Modules** | One table of every dated item in a course (assignments, classic and New Quizzes, graded and ungraded discussions, module unlock dates) in module order. Shift dates forward **or backward**, move weekend dates, set a time of day, change a weekly pattern (Tue/Thu to Mon/Wed), set or clear dates, including section and student overrides. Every change is previewed first and can be undone. Bulk **Sync to SIS** on or off, with the SIS rules checked first. | "Toolkit" button on any course page |
| **Course Copy Auditor** | Scans pages, assignments, discussions, announcements, the syllabus, classic quiz questions, New Quizzes items and modules for links to the old course, missing or unpublished files, missing pages, Google and Microsoft items that break after a copy, last term's dates and unpublished items in published modules. Merges Canvas's own link validator. Rewrites old-course links to the matching item in this course, in one write per page. CSV export. | "Toolkit" button, "Course copy audit" tab |
| **SpeedGrader Pro** | Searchable comment library with folders, tags and variables (`{first_name}`, `{score}`, `{percent}` …), posted through the API. Rubric hotkeys (1-9, Alt+F full marks, Alt+H half, Alt+S save). Private per-student notes. Optional keyboard flow (focus the grade box, Alt+Enter to save and go to the next student). | "SpeedGrader Pro" button in SpeedGrader |

The working name follows the plan's default (a neutral brand that avoids leading with Instructure's trademark). Renaming is a change to `static/manifest.json` and the headings in `src/content/main.tsx` and `src/options/main.tsx`.

## Security model

- **No API tokens, ever.** The extension calls Canvas from the page, with the teacher's existing session. Writes send the CSRF token from Canvas's `_csrf_token` cookie, read fresh on every request.
- **Student data stays in the browser.** Nothing is sent anywhere except the teacher's own Canvas. Snippets sync through Chrome sync storage; undo history and private notes stay in local storage on this computer.
- **Students never see it.** The toolkit only mounts for teachers, TAs, designers and admins (checked through the course enrollments and permissions API).
- **Minimal permissions.** `storage` and `scripting`, host access to `*.instructure.com`, and optional, user-granted access to a school's own Canvas address.

See [PRIVACY.md](PRIVACY.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

```bash
npm install
npm run check     # typecheck + unit tests + build
npm run watch     # rebuild on change
npm run zip       # dist/ packed as instructor-toolkit-<version>.zip for the Web Store
```

Load it in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → choose `dist/`.

Open a Canvas course where you are a teacher. A **Toolkit** button appears bottom-right. In SpeedGrader the button reads **SpeedGrader Pro**.

If your Canvas is not on `*.instructure.com`, open the extension's options (toolbar icon), add your Canvas address under **Canvas addresses** and accept Chrome's permission prompt.

## Layout

```
static/                  manifest, managed-policy schema, options page shell, icons
src/core/                plain TypeScript, no browser APIs, unit tested
  canvasClient.ts        session fetch, CSRF, pagination, sequential writes, throttling backoff, Progress polling
  dates.ts               time-zone and DST-safe date arithmetic
  courseModel.ts         loads every dated item into one table
  bulkDates.ts           plan, validate, apply and undo date changes
  sis.ts                 Sync to SIS rules and writes (GraphQL with REST fallback)
  audit/                 link extraction and classification, auditor, fixes, CSV
  snippets.ts, rubric.ts SpeedGrader Pro logic
  features.ts            feature switches (defaults < user < institution policy)
src/shared/storage.ts    chrome.storage wrappers (sync, local, managed)
src/content/             React panels rendered in a Shadow DOM on Canvas pages
src/background/          service worker: vanity-domain registration, options page
src/options/             options page
tests/                   vitest unit tests for src/core
docs/                    architecture, institution deployment, manual test plan
```

## Institution deployment

IT can force-install the extension and push settings (allowed Canvas domains, which modules are on, a shared comment library) through Google Admin or Intune. See [docs/INSTITUTION_DEPLOYMENT.md](docs/INSTITUTION_DEPLOYMENT.md).

## Status

Version 0.1.0 covers phases 1 to 3 of the plan's feature set without licensing or a backend. It has unit tests for all core logic but has **not yet been run against a live Canvas instance**; the manual test plan in [docs/TESTING.md](docs/TESTING.md) is the Phase 0 exit check. See [CHANGELOG.md](CHANGELOG.md).
