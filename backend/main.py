import base64
import asyncio
import json
import logging
import os
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from imageio_ffmpeg import get_ffmpeg_exe
from openai import APIConnectionError, APIError, OpenAI, RateLimitError
from PIL import Image as PILImage, UnidentifiedImageError
from pydantic import BaseModel, Field, ValidationError
import pytesseract
from pytesseract import TesseractNotFoundError
from realtime.types import RealtimePostgresChangesListenEvent, RealtimeSubscribeStates
from supabase import Client, create_async_client, create_client


load_dotenv(Path(__file__).with_name(".env"))
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("brand_lens")

app = FastAPI(title="Brand Lens API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_VIDEO_BYTES = 100 * 1024 * 1024
MAX_VIDEO_ANALYSIS_SECONDS = 120
MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}
IMAGE_FORMATS = {
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".png": "PNG",
    ".webp": "WEBP",
}


class BrandRule(BaseModel):
    category: str
    title: str
    description: str


DEFAULT_RULES = [
    BrandRule(
        category="Claims & promises",
        title="No unsupported guarantees",
        description="Do not promise guaranteed outcomes or 100% success without approved evidence.",
    ),
    BrandRule(
        category="Tone of voice",
        title="Confident, clear and helpful",
        description="Avoid aggressive, insulting or exaggerated wording.",
    ),
    BrandRule(
        category="Visual identity",
        title="Use approved brand assets",
        description="Use current logo, colours and approved product imagery.",
    ),
    BrandRule(
        category="Legal & compliance",
        title="Mandatory disclaimer",
        description="Include the approved disclaimer wherever required.",
    ),
]


class AnalysisRequest(BaseModel):
    content: str = Field(min_length=1, max_length=40000)
    employee_name: str = "Employee"
    filename: str = "Written content"
    rules: list[BrandRule] | None = None


class TicketRequest(BaseModel):
    submission_id: UUID
    title: str = Field(min_length=1, max_length=200)
    filename: str = Field(min_length=1, max_length=255)
    priority: str = Field(pattern="^(High|Medium|Low)$")
    note: str = Field(min_length=1, max_length=5000)


class TicketStatusUpdate(BaseModel):
    status: str = Field(pattern="^(Open|Resolved)$")


class Violation(BaseModel):
    severity: str
    title: str
    evidence: str
    recommendations: list[str]


class AnalysisResult(BaseModel):
    compliance_score: int | None
    publishing_status: str
    violations: list[Violation]
    recommendations: list[str]


RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "compliance_score": {"type": ["integer", "null"]},
        "publishing_status": {
            "type": "string",
            "enum": [
                "Ready to publish",
                "Changes required",
                "Escalation recommended",
                "Needs human review",
            ],
        },
        "violations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "severity": {
                        "type": "string",
                        "enum": ["High", "Medium", "Low"],
                    },
                    "title": {"type": "string"},
                    "evidence": {"type": "string"},
                    "recommendations": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": [
                    "severity",
                    "title",
                    "evidence",
                    "recommendations",
                ],
                "additionalProperties": False,
            },
        },
        "recommendations": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": [
        "compliance_score",
        "publishing_status",
        "violations",
        "recommendations",
    ],
    "additionalProperties": False,
}

_supabase_client: Client | None = None


def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise HTTPException(
            status_code=503,
            detail="Supabase is not configured. Add SUPABASE_URL and SUPABASE_KEY to backend/.env and restart the backend.",
        )
    try:
        _supabase_client = create_client(url, key)
    except Exception as error:
        logger.exception("Could not initialize Supabase")
        raise HTTPException(status_code=503, detail="Could not initialize Supabase. Check backend/.env.") from error
    return _supabase_client


def fetch_rules() -> list[BrandRule]:
    try:
        client = get_supabase()
        rows = client.table("brand_rules").select("category,title,description").order("created_at").execute().data
        if not rows:
            rows = client.table("brand_rules").insert(
                [rule.model_dump() for rule in DEFAULT_RULES]
            ).execute().data
        return [BrandRule.model_validate(row) for row in rows]
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Could not load brand rules from Supabase")
        raise HTTPException(status_code=503, detail="Could not load the Supabase rulebook. Check the database schema and credentials.") from error


def persist_submission(
    result: AnalysisResult,
    filename: str,
    employee_name: str,
    content_type: str,
    content_text: str,
    rules: list[BrandRule],
) -> str:
    payload = {
        "filename": filename,
        "content_type": content_type,
        "employee_name": employee_name,
        "content_text": content_text,
        "rules_snapshot": [rule.model_dump() for rule in rules],
        "analysis_status": "completed",
        "compliance_score": result.compliance_score,
        "publishing_status": result.publishing_status,
        "violations": [violation.model_dump() for violation in result.violations],
        "recommendations": result.recommendations,
    }
    try:
        rows = get_supabase().table("submissions").insert(payload).execute().data
        return rows[0]["id"]
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Could not save submission to Supabase")
        raise HTTPException(status_code=503, detail="Analysis completed, but the submission could not be saved to Supabase.") from error


def save_analysis(
    result: AnalysisResult,
    filename: str,
    employee_name: str,
    content_type: str,
    content_text: str,
    rules: list[BrandRule],
) -> dict:
    response = response_payload(result, filename, employee_name)
    response["submission_id"] = persist_submission(
        result, filename, employee_name, content_type, content_text, rules
    )
    return response


def require_openai_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OpenAI is not configured. Add OPENAI_API_KEY to backend/.env and restart the backend.",
        )
    return OpenAI(api_key=api_key)


def selected_rules(rules: list[BrandRule] | None) -> list[BrandRule]:
    return rules if rules else DEFAULT_RULES


def normalize_rules(rules_json: str) -> list[BrandRule] | None:
    if not rules_json:
        return None
    if len(rules_json) > 20000:
        raise HTTPException(status_code=400, detail="The supplied brand rules are too large.")
    try:
        decoded = json.loads(rules_json)
        if not isinstance(decoded, list):
            raise ValueError("Brand rules must be a JSON list.")
        return [BrandRule.model_validate(rule) for rule in decoded]
    except (json.JSONDecodeError, ValidationError, ValueError) as error:
        raise HTTPException(status_code=400, detail="Brand rules are invalid JSON.") from error


def openai_http_error(error: Exception) -> HTTPException:
    if isinstance(error, RateLimitError):
        logger.warning("OpenAI rate limit reached: %s", error)
        return HTTPException(
            status_code=429,
            detail="OpenAI rate limit reached. Please wait briefly and try again.",
            headers={"Retry-After": "10"},
        )
    if isinstance(error, APIConnectionError):
        logger.exception("Could not connect to OpenAI")
        return HTTPException(
            status_code=502,
            detail="Could not connect to OpenAI. Check the backend network connection and try again.",
        )
    if isinstance(error, APIError):
        logger.exception("OpenAI API request failed")
        return HTTPException(
            status_code=502,
            detail="OpenAI could not complete the analysis. Please try again.",
        )
    raise error


def analyze_submission(
    client: OpenAI,
    text: str,
    rules: list[BrandRule],
    images: list[bytes] | None = None,
) -> AnalysisResult:
    rule_text = "\n".join(
        f"- [{rule.category}] {rule.title}: {rule.description}" for rule in rules
    )
    prompt = (
        "Assess this submission only against the supplied company brand rules. "
        "Cite observable text or visual/audio evidence for every violation. "
        "Do not infer facts that the submission does not support. "
        "If evidence is insufficient to make a reliable assessment, set "
        "compliance_score to null and publishing_status to 'Needs human review'. "
        "Otherwise provide a 0-100 compliance score justified by the analysis. "
        "Use 'Ready to publish' only when no violations are found; use "
        "'Escalation recommended' for a high-severity violation; otherwise use "
        "'Changes required' when violations are present. Do not invent evidence.\n\n"
        f"Company brand rules:\n{rule_text}\n\n"
        f"Submission text, OCR text, caption, or transcript:\n{text or '[No text supplied; assess the attached visual evidence.]'}"
    )
    content = [{"type": "input_text", "text": prompt}]
    for image in images or []:
        encoded = base64.b64encode(image).decode("ascii")
        content.append(
            {
                "type": "input_image",
                "image_url": f"data:image/jpeg;base64,{encoded}",
                "detail": "high",
            }
        )

    try:
        response = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            input=[{"role": "user", "content": content}],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "brand_lens_compliance_analysis",
                    "strict": True,
                    "schema": RESULT_SCHEMA,
                }
            },
        )
    except (RateLimitError, APIConnectionError, APIError) as error:
        raise openai_http_error(error) from error

    try:
        return AnalysisResult.model_validate_json(response.output_text)
    except (ValidationError, ValueError) as error:
        logger.exception("OpenAI returned an invalid structured analysis")
        raise HTTPException(
            status_code=502,
            detail="OpenAI returned an invalid analysis response. Please try again.",
        ) from error


def response_payload(
    result: AnalysisResult,
    filename: str,
    employee_name: str,
) -> dict:
    violations = [violation.model_dump() for violation in result.violations]
    issues = [
        [
            violation.severity,
            violation.title,
            violation.evidence,
            " ".join(violation.recommendations),
        ]
        for violation in result.violations
    ]
    return {
        "success": True,
        "compliance_score": result.compliance_score,
        "publishing_status": result.publishing_status,
        "violations": violations,
        "severity": [violation["severity"] for violation in violations],
        "evidence": [violation["evidence"] for violation in violations],
        "recommendations": result.recommendations,
        "score": result.compliance_score,
        "out": result.publishing_status,
        "issues": issues,
        "file": filename,
        "employee": employee_name,
    }


def read_upload(file: UploadFile, max_bytes: int) -> tuple[bytes, str]:
    suffix = Path(file.filename or "").suffix.lower()
    data = file.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail="The uploaded file exceeds the size limit.")
    return data, suffix


def extract_video_frames(video_path: str) -> list[bytes]:
    try:
        result = subprocess.run(
            [
                get_ffmpeg_exe(),
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                video_path,
                "-t",
                str(MAX_VIDEO_ANALYSIS_SECONDS),
                "-vf",
                "fps=1/10,scale=768:-2",
                "-frames:v",
                "12",
                "-f",
                "image2pipe",
                "-vcodec",
                "mjpeg",
                "pipe:1",
            ],
            capture_output=True,
            timeout=60,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise HTTPException(
            status_code=422,
            detail="Video frame extraction timed out. Try a shorter video.",
        ) from error
    except (OSError, RuntimeError) as error:
        logger.exception("Could not start FFmpeg")
        raise HTTPException(
            status_code=503,
            detail="Video processing is unavailable. Reinstall the backend dependencies.",
        ) from error

    frames = []
    for section in result.stdout.split(b"\xff\xd8")[1:]:
        frame = b"\xff\xd8" + section.split(b"\xff\xd9", 1)[0] + b"\xff\xd9"
        if frame.endswith(b"\xff\xd9"):
            frames.append(frame)
    if result.returncode != 0 or not frames:
        raise HTTPException(
            status_code=400,
            detail="The uploaded video is invalid, corrupted, or contains no readable frames.",
        )
    return frames


def extract_video_audio(video_path: str) -> bytes | None:
    try:
        result = subprocess.run(
            [
                get_ffmpeg_exe(),
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                video_path,
                "-t",
                str(MAX_VIDEO_ANALYSIS_SECONDS),
                "-map",
                "0:a:0",
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "mp3",
                "pipe:1",
            ],
            capture_output=True,
            timeout=60,
            check=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning("Audio extraction timed out; continuing with video frames only")
        return None
    except (OSError, RuntimeError):
        logger.warning("Audio extraction is unavailable; continuing with video frames only")
        return None
    if result.returncode != 0 or not result.stdout:
        return None
    if len(result.stdout) > MAX_TRANSCRIPTION_BYTES:
        logger.warning("Extracted audio is too large to transcribe; continuing with frames only")
        return None
    return result.stdout


def transcribe_audio(client: OpenAI, audio: bytes) -> str:
    try:
        transcription = client.audio.transcriptions.create(
            model=os.getenv("OPENAI_TRANSCRIPTION_MODEL", "whisper-1"),
            file=("video-audio.mp3", BytesIO(audio), "audio/mpeg"),
        )
        return transcription.text
    except (RateLimitError, APIConnectionError, APIError) as error:
        raise openai_http_error(error) from error


@app.get("/")
def home():
    return {"message": "Brand Lens API is running", "status": "online"}


@app.get("/api/events")
async def stream_database_events():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise HTTPException(
            status_code=503,
            detail="Supabase is not configured. Add SUPABASE_URL and SUPABASE_KEY to backend/.env and restart the backend.",
        )

    try:
        client = await create_async_client(url, key)
        channel = client.channel("brand-lens-company-portal")
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[str] = asyncio.Queue()
        ready = loop.create_future()

        def subscription_status(status, error):
            if ready.done():
                return
            if status == RealtimeSubscribeStates.SUBSCRIBED:
                ready.set_result(None)
            elif status in {
                RealtimeSubscribeStates.TIMED_OUT,
                RealtimeSubscribeStates.CHANNEL_ERROR,
                RealtimeSubscribeStates.CLOSED,
            }:
                ready.set_exception(error or RuntimeError(f"Supabase Realtime subscription {status.value}."))

        for table in ("brand_rules", "submissions", "tickets"):
            def on_change(_payload, changed_table=table):
                loop.call_soon_threadsafe(queue.put_nowait, changed_table)

            channel.on_postgres_changes(
                RealtimePostgresChangesListenEvent.All,
                on_change,
                schema="public",
                table=table,
            )

        await channel.subscribe(subscription_status)
        await asyncio.wait_for(ready, timeout=15)
    except Exception as error:
        if "client" in locals():
            try:
                await client.realtime.close()
            except Exception:
                logger.exception("Could not close the failed Supabase Realtime connection")
        logger.exception("Could not subscribe to Supabase Realtime")
        raise HTTPException(
            status_code=503,
            detail="Could not connect to Supabase Realtime. Run the realtime setup SQL and check the Supabase connection.",
        ) from error

    async def events():
        try:
            yield "event: connected\ndata: {}\n\n"
            while True:
                try:
                    table = await asyncio.wait_for(queue.get(), timeout=20)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                else:
                    yield f"event: change\ndata: {json.dumps({'table': table})}\n\n"
        finally:
            await client.remove_channel(channel)
            await client.realtime.close()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/rules")
def list_rules():
    fetch_rules()
    try:
        return get_supabase().table("brand_rules").select("*").order("created_at").execute().data
    except Exception as error:
        logger.exception("Could not list brand rules")
        raise HTTPException(status_code=503, detail="Could not load brand rules.") from error


@app.post("/api/rules")
def create_rule(rule: BrandRule):
    try:
        rows = get_supabase().table("brand_rules").insert(rule.model_dump()).execute().data
        return rows[0]
    except Exception as error:
        logger.exception("Could not create brand rule")
        raise HTTPException(status_code=503, detail="Could not save the brand rule.") from error


@app.put("/api/rules/{rule_id}")
def update_rule(rule_id: UUID, rule: BrandRule):
    try:
        rows = get_supabase().table("brand_rules").update(rule.model_dump()).eq("id", str(rule_id)).execute().data
        if not rows:
            raise HTTPException(status_code=404, detail="Brand rule not found.")
        return rows[0]
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Could not update brand rule")
        raise HTTPException(status_code=503, detail="Could not update the brand rule.") from error


@app.delete("/api/rules/{rule_id}")
def delete_rule(rule_id: UUID):
    try:
        rows = get_supabase().table("brand_rules").delete().eq("id", str(rule_id)).execute().data
        if not rows:
            raise HTTPException(status_code=404, detail="Brand rule not found.")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Could not delete brand rule")
        raise HTTPException(status_code=503, detail="Could not delete the brand rule.") from error


@app.get("/api/submissions")
def list_submissions():
    try:
        return get_supabase().table("submissions").select("*").order("created_at", desc=True).execute().data
    except Exception as error:
        logger.exception("Could not list submissions")
        raise HTTPException(status_code=503, detail="Could not load submission history.") from error


@app.get("/api/submissions/{submission_id}")
def get_submission(submission_id: UUID):
    try:
        rows = get_supabase().table("submissions").select("*").eq("id", str(submission_id)).limit(1).execute().data
        if not rows:
            raise HTTPException(status_code=404, detail="Submission not found.")
        return rows[0]
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Could not load submission")
        raise HTTPException(status_code=503, detail="Could not load the submission.") from error


@app.get("/api/tickets")
def list_tickets():
    try:
        return get_supabase().table("tickets").select("*").order("created_at", desc=True).execute().data
    except Exception as error:
        logger.exception("Could not list tickets")
        raise HTTPException(status_code=503, detail="Could not load tickets.") from error


@app.post("/api/tickets")
def create_ticket(ticket: TicketRequest):
    payload = ticket.model_dump(mode="json")
    try:
        rows = get_supabase().table("tickets").insert(payload).execute().data
        return rows[0]
    except Exception as error:
        logger.exception("Could not create ticket")
        raise HTTPException(status_code=503, detail="Could not save the ticket.") from error


@app.patch("/api/tickets/{ticket_id}")
def update_ticket(ticket_id: UUID, update: TicketStatusUpdate):
    try:
        rows = get_supabase().table("tickets").update(update.model_dump()).eq("id", str(ticket_id)).execute().data
        if not rows:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        return rows[0]
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Could not update ticket")
        raise HTTPException(status_code=503, detail="Could not update the ticket.") from error


@app.post("/api/analyze")
def analyze_content(data: AnalysisRequest):
    rules = fetch_rules()
    payload = {
        "filename": data.filename,
        "content_type": "text",
        "employee_name": data.employee_name,
        "content_text": data.content,
        "rules_snapshot": [rule.model_dump() for rule in rules],
        "analysis_status": "pending",
        "publishing_status": "Analysis pending",
        "compliance_score": None,
        "violations": [],
        "recommendations": [],
    }
    try:
        rows = get_supabase().table("submissions").insert(payload).execute().data
        if not rows:
            raise RuntimeError("Supabase did not return the inserted submission.")
        row = rows[0]
        return {
            "success": True,
            "submission_id": row["id"],
            "analysis_status": row["analysis_status"],
            "file": row["filename"],
            "employee": row["employee_name"],
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Could not queue text submission for n8n analysis")
        raise HTTPException(
            status_code=503,
            detail="Could not queue the text submission in Supabase.",
        ) from error


@app.post("/api/analyze/image")
def analyze_image(
    file: UploadFile = File(...),
    employee_name: str = Form("Employee"),
    context: str = Form("", max_length=10000),
    rules_json: str = Form(""),
):
    client = require_openai_client()
    data, suffix = read_upload(file, MAX_IMAGE_BYTES)
    expected_format = IMAGE_FORMATS.get(suffix)
    if expected_format is None:
        raise HTTPException(status_code=415, detail="Use a JPG, JPEG, PNG, or WEBP image.")

    try:
        with PILImage.open(BytesIO(data)) as image:
            if image.format != expected_format:
                raise HTTPException(status_code=415, detail="The file extension does not match its image format.")
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="The image dimensions exceed the supported limit.")
            image.verify()
        with PILImage.open(BytesIO(data)) as image:
            try:
                ocr_text = pytesseract.image_to_string(image, timeout=20).strip()
            except (TesseractNotFoundError, RuntimeError) as error:
                logger.warning("Tesseract OCR is unavailable; using OpenAI vision: %s", error)
                ocr_text = ""
    except UnidentifiedImageError as error:
        raise HTTPException(status_code=400, detail="The uploaded image could not be decoded.") from error
    except OSError as error:
        raise HTTPException(status_code=400, detail="The uploaded image is invalid or corrupted.") from error

    analysis_text = (
        f"Employee-provided context:\n{context}\n\nOCR-extracted text:\n{ocr_text}"
        if ocr_text
        else f"Employee-provided context:\n{context}\n\nOCR did not extract text; inspect the image directly."
    )
    rules = fetch_rules()
    result = analyze_submission(
        client,
        analysis_text,
        rules,
        images=[data],
    )
    return save_analysis(result, file.filename or "Uploaded image", employee_name, "image", analysis_text, rules)


@app.post("/api/analyze/video")
def analyze_video(
    file: UploadFile = File(...),
    employee_name: str = Form("Employee"),
    context: str = Form("", max_length=10000),
    rules_json: str = Form(""),
):
    client = require_openai_client()
    data, suffix = read_upload(file, MAX_VIDEO_BYTES)
    if suffix not in VIDEO_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Use an MP4, MOV, or WEBM video.")

    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
            temp_file.write(data)
            temp_path = temp_file.name
        frames = extract_video_frames(temp_path)
        audio = extract_video_audio(temp_path)
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                logger.warning("Could not remove temporary video file: %s", temp_path)

    transcript = transcribe_audio(client, audio) if audio else ""
    analysis_text = (
        "Analyze sampled frames from the first two minutes of the video. "
        "The audio transcript may be partial.\n\n"
        f"Employee-provided context:\n{context}\n\n"
        f"Audio transcript:\n{transcript or '[No audio track or transcription available.]'}"
    )
    rules = fetch_rules()
    result = analyze_submission(
        client,
        analysis_text,
        rules,
        images=frames,
    )
    return save_analysis(result, file.filename or "Uploaded video", employee_name, "video", analysis_text, rules)
