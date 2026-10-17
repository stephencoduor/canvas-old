# Privacy policy: Instructor Toolkit for Canvas

_Draft for the Chrome Web Store listing. Last updated 2026-10-17._

## What the extension does with data

The extension helps Canvas LMS instructors edit dates, audit course content and grade in SpeedGrader. To do that it reads and changes course content in the instructor's own Canvas account, using the instructor's existing Canvas login in the same browser tab.

## What is collected

Nothing is collected by the developer. The extension has no server, no analytics and no tracking.

| Data | Where it goes | Why |
|---|---|---|
| Course content, dates, student names, scores and rubric results | Read from and written to the instructor's own Canvas only. Held in memory while a panel is open. | To show and change what the instructor asked for |
| Comment snippets the instructor writes | `chrome.storage.sync` (the instructor's own Google account sync) | So snippets are available on the instructor's other computers |
| Undo history (previous dates) and private student notes | `chrome.storage.local` on this computer only | Undo and notes; never synced |
| Settings (feature switches, extra Canvas addresses) | `chrome.storage.sync` | Preferences |

The extension never stores Canvas passwords or API tokens, and never sends student data to anyone other than the instructor's own Canvas.

## Chrome Web Store Limited Use

The use of information received from Canvas complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide the features the instructor uses, is not transferred to third parties, is not used for advertising, and is not used to determine credit-worthiness or for lending.

## Institutions

When an institution manages the extension through enterprise policy, it may push settings (allowed Canvas addresses, which features are on, a shared comment library). Those settings come from the institution, are read-only to the instructor, and contain no student data.

## Contact

Questions: the contact address on the Chrome Web Store listing.
