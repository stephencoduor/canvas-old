# Institution deployment

## Force-install

**Google Admin (Chromebooks and managed Chrome):** Devices → Chrome → Apps & extensions → Users & browsers → add by extension ID → Installation policy **Force install**. Paste a policy JSON (below) under **Policy for extensions**.

**Microsoft Intune / Group Policy (Windows Chrome):** `ExtensionInstallForcelist` with `<extension-id>;https://clients2.google.com/service/update2/crx`, and the policy JSON under `3rdparty → extensions → <extension-id> → policy`.

**Edge:** the same build publishes to Edge Add-ons; use `ExtensionInstallForcelist` for Edge.

## Policy settings

Schema: [`static/managed_schema.json`](../static/managed_schema.json).

```json
{
  "canvasDomains": { "Value": ["canvas.school.edu"] },
  "features": { "Value": { "auditor": true, "keyboardFlow": false } },
  "snippetLibrary": {
    "Value": [
      { "title": "Academic integrity", "body": "Please review the academic integrity policy in the syllabus.", "folder": "Department", "tags": ["policy"] }
    ]
  }
}
```

- `canvasDomains`: school-owned Canvas addresses. Chrome still needs host permission for them: list the same origins in the `ExtensionSettings` policy's `runtime_allowed_hosts`, or let users accept the prompt from the options page.
- `features`: `true` forces a module on, `false` forces it off; omitted modules follow the user.
- `snippetLibrary`: shown to every instructor as read-only **Department** comments.
- `licenseKey`, `backendUrl`: reserved for the institution tier (phase 4).

## What IT reviewers usually ask

| Question | Answer |
|---|---|
| Does it store credentials or tokens? | No. It uses the instructor's existing Canvas session in the tab. |
| Does student data leave the browser? | No. There is no backend. |
| Permissions | `storage`, `scripting`, `https://*.instructure.com/*`, optional user-granted school domains. |
| Remote code | None. Everything is bundled in the package. |
| Who sees it | Only users with a teacher, TA, designer or admin role in the course. |
