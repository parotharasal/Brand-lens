# Brand-lens
AI content checker for enterprises to control fake claims from content by transcirpting the content and cross checking it with rule book provides by company

## Supabase setup

1. Revoke any Supabase secret key that has been shared, then create a replacement secret key.
2. For a new Supabase project, run `backend/supabase_schema.sql` in the Supabase SQL Editor. If your project already has the older Brand Lens tables (`brand_rules.rule_name` and `submissions.content`), run `backend/supabase_legacy_migration.sql` instead to add the fields this app expects while preserving the existing tables and rows.
3. Copy `backend/.env.example` to `backend/.env`, fill in the new Supabase URL and secret key, and add your OpenAI API key. Keep `backend/.env` private and never commit real credentials.
4. Install the backend requirements and restart the API. The first request to `/api/rules` seeds the default rulebook if the table is empty.

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
