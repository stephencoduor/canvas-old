# Test plan

## Automated

`npm run check` runs the TypeScript check, the vitest suite (all of `src/core`: client, dates, bulk plans and writes, SIS rules, link classification, the auditor against a fake Canvas, snippets, rubric reducer, feature resolution) and the build.

## Manual, against a real Canvas (Phase 0 exit check)

Use a Canvas Free-for-Teacher course or a local Canvas from the private `stephencoduor/canvas` repo. Build, load `dist/` unpacked, and work in a **test course**.

### Dates and Modules
1. Course with 3 modules containing an assignment, a graded classic quiz, a practice quiz, a graded discussion, an ungraded discussion with availability dates, and a New Quiz. Give one assignment a section override.
2. Open Toolkit → table lists every item under its module, module unlock rows first, overrides badge on the overridden assignment.
3. Select module 2, shift **-7 days**, preview → every date moves back a week, override row shown. Apply → reload Canvas pages and confirm.
4. Shift **+7** with **Move to Monday** on an item due Friday-to-Saturday → lands on Monday.
5. Weekly pattern Tue→Mon on a Tuesday item; **Set time** 23:59.
6. **Undo** → dates return exactly, including the override.
7. Shift across 1 November (DST end, US zones) → due time stays 11:59 pm.
8. Make unlock later than due → preview warns.
9. Sync to SIS (needs an account with SIS enabled): an item without a due date is blocked with a reason; others turn on and the SIS icon shows on the Assignments page.

### Course Copy Auditor
1. Copy a course that has: a page linking to a source-course page and file, a link to the source course home, an unpublished file linked from a page, a deleted file link, a Google Assignments LTI item, an unpublished item in a published module, and last term's dates.
2. Run the audit in the copy → each appears in its category; Google item has instructions; notes mention New Quizzes banks.
3. Fix selected → page body now links to the copy's page and file; run again → those findings are gone.
4. Download CSV → opens in a spreadsheet.

### SpeedGrader Pro
1. Open SpeedGrader for an assignment with a rubric → **SpeedGrader Pro** button.
2. Comments: pick "Great work" → preview fills the student's first name and score → Post → comment appears after changing student and back.
3. Anonymous-grading assignment → name variables reported as not filled in; posting works.
4. Rubric: press 1, ↓, 2, Alt+F, Alt+S → saved; reload shows the scores.
5. Notes: type a note, change student and back → note persists; different course → separate notes.
6. Turn on keyboard flow in options → grade box gets focus on each student; Alt+Enter saves and advances.

### Platform
- Student account in the same course: no button appears.
- Options: turn the auditor off → tab disappears after reload.
- Add a vanity domain → Chrome prompts; toolkit appears there after reload.
- Managed policy (Chrome `chrome://policy` with a test policy) → locked switches show "Set by your institution".

Record results per Canvas release; Instructure ships every three weeks and SpeedGrader changes most often.
