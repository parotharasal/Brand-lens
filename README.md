# Brand-lens
AI content checker for enterprises to control fake claims from content by transcirpting the content and cross checking it with rule book provides by company

## Supabase setup

1. Revoke any Supabase secret key that has been shared, then create a replacement secret key.
2. For a new Supabase project, run `backend/supabase_schema.sql` in the Supabase SQL Editor. If your project already has the older Brand Lens tables (`brand_rules.rule_name` and `submissions.content`), run `backend/supabase_legacy_migration.sql` instead to add the fields this app expects while preserving the existing tables and rows.
3. Copy `backend/.env.example` to `backend/.env` and configure the Supabase credentials. `OPENAI_API_KEY` remains for the image/video analysis paths. Keep `backend/.env` private and never commit real credentials.
4. Install the backend requirements and start the API. The first request to `/api/rules` seeds the default rulebook if the table is empty.

## Written content submissions

Written content is saved directly by the backend to `public.submissions` with a pending review status. It is not sent to n8n or another analysis service. Image and video submissions continue to use the existing analyzer and are also saved to `public.submissions`. No Supabase key is sent to the browser.

If written-content inserts fail with an invalid URL error, disable or delete the Supabase Database Webhook for `public.submissions` that calls n8n. Find it in **Supabase Dashboard → Database → Webhooks**. That outgoing webhook can roll back the insert; disabling it leaves submissions saved only in the table.

The API stores submission text and analysis results, not uploaded image or video files. For image and video submissions, it stores the accompanying context and extracted OCR/transcript text. Each record includes `rules_snapshot` so Python can later retrieve the exact rulebook used during analysis. For example, from the `backend` directory:

```python
from main import get_supabase

rows = (
	get_supabase()
	.table("submissions")
	.select("content_text,rules_snapshot,violations,created_at")
	.execute()
	.data
)
```

The Supabase secret key is used only by the backend. The current prototype has no user authentication, so do not expose the API publicly or store real employee content until authentication and authorization are added.

## Run locally

From the repository root, start the backend and frontend in separate PowerShell terminals:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --app-dir backend
```

```powershell
npm run dev
```

Open the Vite URL shown in the frontend terminal and submit written content in the employee portal. Confirm the pending submission appears in the company portal and in `public.submissions`.
