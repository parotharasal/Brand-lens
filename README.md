# Brand-lens
AI content checker for enterprises to control fake claims from content by transcirpting the content and cross checking it with rule book provides by company

## Supabase setup

1. Revoke any Supabase secret key that has been shared, then create a replacement secret key.
2. For a new Supabase project, run `backend/supabase_schema.sql` in the Supabase SQL Editor. If your project already has the older Brand Lens tables (`brand_rules.rule_name` and `submissions.content`), run `backend/supabase_legacy_migration.sql` instead to add the fields this app expects while preserving the existing tables and rows.
3. Copy `backend/.env.example` to `backend/.env`, fill in the new Supabase URL and secret key, and add your OpenAI API key. Keep `backend/.env` private and never commit real credentials.
4. Install the backend requirements and start the API. The first request to `/api/rules` seeds the default rulebook if the table is empty.

## n8n text analysis

Text submissions are inserted into Supabase with `analysis_status = 'pending'`. The database webhook starts the imported workflow in `backend/n8n_brand_lens_workflow.json`. It analyzes the saved `rules_snapshot` with OpenAI, then writes the structured result and `analysis_status` back to the same submission. Image and video submissions continue to use the existing backend analyzer.

1. If this project already uses the older Brand Lens schema, rerun `backend/supabase_legacy_migration.sql` in the Supabase SQL Editor to add `analysis_status` and enable Supabase Realtime for the company portal.
2. In n8n, import `backend/n8n_brand_lens_workflow.json`. Create and select an **HTTP Header Auth** credential for the OpenAI request, using header name `Authorization` and a bearer token made from your OpenAI API key. Create and select a **Supabase** credential on the result node using your project URL and a Supabase secret key. Keep both credentials in n8n; do not add them to the workflow file or frontend.
3. Configure the webhook node with an **HTTP Header Auth** credential using a new random secret. In Supabase Dashboard, create a Database Webhook for `public.submissions`, event **INSERT**, pointing to the workflow's **production** webhook URL. Add the same authorization header there. Activate the n8n workflow.
4. Submit text in the employee portal. The result page waits for n8n to save the outcome. The company portal receives rule, submission, and ticket changes through a backend-mediated Supabase Realtime connection; no Supabase key is sent to the browser.

The Supabase secret key grants privileged database access. Limit access to the n8n workspace and keep the OpenAI and webhook credentials private. If the workflow fails, n8n writes a failed analysis result when OpenAI returns an error response; inspect n8n Executions for credential, webhook, or node configuration failures.

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
