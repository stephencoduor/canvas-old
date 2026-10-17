# Architecture

```
Canvas page (teacher logged in)
  │  URL gives the course id; the course API confirms the user is staff
  ▼
Content script (React in a Shadow DOM)
  │  Dates panel · Audit panel · SpeedGrader panel
  ▼
Core library (src/core, plain TypeScript, unit tested in Node)
  │  CanvasClient: same-origin fetch, Link pagination, X-CSRF-Token, sequential writes,
  │                backoff on 403 "Rate Limit Exceeded" and 5xx, Progress polling
  │  courseModel → bulkDates (plan · validate · apply · undo) · sis
  │  audit/links → audit/auditor (scan · native validator · fixes · CSV)
  │  snippets · rubric · features
  ▼
chrome.storage  sync: settings, snippets │ local: undo, notes │ managed: institution policy
Background service worker: registers the content script on granted school domains
```

## Decisions

**Session, not tokens.** All API calls run in the page with `credentials: 'same-origin'`. GET needs nothing extra; PUT, POST and DELETE send `X-CSRF-Token` from the `_csrf_token` cookie. The background worker never calls Canvas, because cookie behaviour from a service worker is not reliable across Canvas deployments.

**Rate limits.** Canvas meters each session (a 700-unit bucket refilling at about 10 units a second, plus a cost per in-flight request). Reads run in parallel only where the UI needs it; writes go through one queue, pause when `X-Rate-Limit-Remaining` drops under 150, and retry throttled requests with exponential backoff.

**Dates.** Canvas returns UTC. Every operation runs in the teacher's Canvas time zone (from `/api/v1/users/self/profile`, falling back to the browser) so "move a week" keeps 11:59 pm across a DST change and "Monday" means the teacher's Monday.

**Write paths per item.**

| Item | Read | Write |
|---|---|---|
| Assignments, graded quizzes and discussions, New Quizzes | `assignments?include[]=all_dates` | `PUT assignments/bulk_update` (Progress job; per-item errors read from its results) |
| Ungraded classic quizzes | `quizzes`, `quizzes/:id/date_details` | `PUT quizzes/:id/date_details` |
| Ungraded discussions | `discussion_topics`, `discussion_topics/:id/date_details` | `PUT discussion_topics/:id/date_details` |
| Module unlock dates | `modules` | `PUT modules/:id` |
| Sync to SIS | `post_to_sis` on assignments | GraphQL `updateAssignment(postToSis)`, REST `post_to_sis` fallback (undocumented) |

The Learning Object Dates API replaces the override list when one is sent, so the toolkit always sends every known override, changed or not. When Canvas omits `all_dates` (assignments with many overrides), only the base dates are offered and the table says so.

**Undo.** Before any apply, the current dates of every affected item (base and overrides) are written to `chrome.storage.local`. Restore plans a change back to exactly those values and runs it through the same apply path.

**Auditor.** Content is scanned through documented list endpoints. Links are classified without a DOM parser (pure functions in `audit/links.ts`). Canvas's own validator (`/courses/:id/link_validation`, undocumented) runs optionally and its results are merged; if it fails the report says so and the toolkit's own scan still stands. Fixes are proposed only on an exact name match (file display name, page slug, assignment, quiz or discussion title), re-read the content right before writing, and apply every fix for one item in a single write. Google and Microsoft LTI items are listed with instructions; they cannot be re-linked from outside because their state lives at the vendor.

Honest limits shown in the report: New Quizzes item banks are not readable by any outside tool; classic quiz questions and New Quizzes items placed in quizzes are.

**SpeedGrader Pro.** Built API-first so it survives Instructure's SpeedGrader rewrites: comments post through `PUT .../submissions/:user_id` (or `anonymous_submissions/:anonymous_id`), rubric scores through `rubric_assessment` on the same endpoint. The only DOM coupling is the optional keyboard flow, isolated in `keyboardFlow.ts` with fallback selectors. SpeedGrader changes student with `history.pushState`, so the panel polls the URL.

**Feature switches.** `defaults < chrome.storage.sync (user) < chrome.storage.managed (institution)`. A managed value is shown as locked in the options page.

**Shadow DOM.** All UI renders in an open shadow root, so Canvas styles cannot break the panels and the panels cannot restyle Canvas.

## Adapters for undocumented behaviour

| Behaviour | Where | Fallback |
|---|---|---|
| `link_validation` endpoint | `auditor.ts › nativeValidator` | Toolkit scan only, with a note |
| REST `post_to_sis` | `sis.ts › setPostToSis` | GraphQL is tried first |
| SpeedGrader DOM (grade box, next button) | `keyboardFlow.ts` | Flow does nothing; panels unaffected |
