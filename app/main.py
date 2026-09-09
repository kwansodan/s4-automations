"""FastAPI Application Entrypoint for S4 Automations Engine."""

import os
from typing import Dict, Any, List, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import inngest.fast_api

from app.config import settings
from app.inngest_client import inngest_client
from app.workflows.daily_billing_pipeline import anr_daily_billing_pipeline
from app.workflows.zoho_invoice_generator import anr_generate_zoho_invoices
from app.workflows.client_strategy_pipeline import client_strategy_pipeline
from app.workflows.ap_billing_pipeline import inngest_ap_pipeline_fn
from app.workflows.bank_statement_pipeline import inngest_bank_statement_fn
from app.api.v1 import api_v1_router, api_legacy_router
from app.utils.logging import get_logger

logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("⚡ Initializing S4 Multi-Client Accounting Automation Engine...")
    logger.info(f"Environment: {settings.ENVIRONMENT} | Mock Mode: {settings.MOCK_MODE}")
    logger.info(f"Target Gemini Vision Model: {settings.GEMINI_MODEL}")
    
    # Initialize SQLModel PostgreSQL/SQLite tables & seed default clients
    try:
        from app.db.session import init_db
        init_db()
    except Exception as e:
        logger.error(f"Database initialization notice: {e}")

    yield
    logger.info("Shutting down S4 Accounting Engine...")


app = FastAPI(
    title="S4 Automations - Multi-Client Accounting & Ingestion Engine",
    description="Automated daily OCR vision ingestion of physical handwritten control slips, Google Sheets review sync, and Zoho Books invoicing.",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for internal dashboards & client portals (dynamic origin reflection with credentials)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.middleware("http")
async def ensure_json_content_type(request: Request, call_next):
    """Automatically promotes requests with stringified JSON bodies to application/json if omitted."""
    ct = request.headers.get("content-type", "").lower()
    if request.method in ("POST", "PUT", "PATCH") and ("json" not in ct) and ("multipart" not in ct) and ("form" not in ct):
        try:
            body = await request.body()
            stripped = body.strip()
            if (stripped.startswith(b"{") and stripped.endswith(b"}")) or (stripped.startswith(b"[") and stripped.endswith(b"]")):
                new_headers = []
                for name, value in request.scope.get("headers", []):
                    if name.lower() != b"content-type":
                        new_headers.append((name, value))
                new_headers.append((b"content-type", b"application/json"))
                request.scope["headers"] = new_headers
        except Exception:
            pass
    return await call_next(request)


# Mount durable Inngest functions
inngest.fast_api.serve(
    app,
    inngest_client,
    [
        anr_daily_billing_pipeline,
        anr_generate_zoho_invoices,
        client_strategy_pipeline,
        inngest_ap_pipeline_fn,
        inngest_bank_statement_fn,
    ],
    enable_unauthed_sync=True,
)


# Mount modular API v1 routers (/api/* and /api/v1/*)
app.include_router(api_legacy_router)
app.include_router(api_v1_router)


# -------------------------------------------------------------------------
# Global Exception Handlers for Frontend In-App Debugging
# -------------------------------------------------------------------------

import traceback


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Formats Pydantic 422 validation errors with exact field names and locations."""
    formatted_errors = []
    for err in exc.errors():
        loc = " -> ".join(str(l) for l in err.get("loc", []))
        msg = err.get("msg", "Validation error")
        formatted_errors.append(f"[{loc}]: {msg}")

    summary_msg = "; ".join(formatted_errors)
    logger.warning(f"422 Validation Error on {request.method} {request.url.path}: {summary_msg}")

    # Safely convert errors to prevent "TypeError: Object of type bytes is not JSON serializable"
    safe_errors = []
    for err in exc.errors():
        err_dict = dict(err)
        if "input" in err_dict and isinstance(err_dict["input"], (bytes, bytearray)):
            try:
                err_dict["input"] = err_dict["input"].decode("utf-8", errors="replace")
            except Exception:
                err_dict["input"] = str(err_dict["input"])
        safe_errors.append(err_dict)

    from fastapi.encoders import jsonable_encoder

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=jsonable_encoder({
            "error": True,
            "error_type": "RequestValidationError",
            "message": f"Validation failed: {summary_msg}",
            "detail": safe_errors,
            "formatted_errors": formatted_errors,
            "path": request.url.path,
            "method": request.method,
        }),
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Formats standard HTTPExceptions consistently for frontend consumption."""
    detail_str = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    logger.warning(f"HTTP {exc.status_code} on {request.method} {request.url.path}: {detail_str}")

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": True,
            "error_type": "HTTPException",
            "status_code": exc.status_code,
            "message": detail_str,
            "detail": exc.detail,
            "path": request.url.path,
            "method": request.method,
        },
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    Catches all unhandled 500 server errors, logs with stack trace,
    and returns rich JSON payload so the frontend Debug Drawer can display
    the exact failing line and traceback without opening the terminal.
    """
    tb_str = traceback.format_exc()
    error_type = type(exc).__name__
    error_msg = str(exc) or error_type

    logger.error(f"🚨 Unhandled 500 Exception on {request.method} {request.url.path} [{error_type}]: {error_msg}\n{tb_str}")

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": True,
            "error_type": error_type,
            "message": f"{error_type}: {error_msg}",
            "detail": error_msg,
            "traceback": tb_str,
            "path": request.url.path,
            "method": request.method,
        },
    )


# -------------------------------------------------------------------------
# Health Check Endpoint
# -------------------------------------------------------------------------

@app.get("/health", tags=["Health"])
async def health_check() -> Dict[str, Any]:
    """Returns application health and configuration state."""
    return {
        "status": "healthy",
        "service": "anr-commercial-laundry-billing",
        "version": "1.0.0",
        "environment": settings.ENVIRONMENT,
        "mock_mode": settings.MOCK_MODE,
        "gemini_model": settings.GEMINI_MODEL,
        "integrations": {
            "inngest": bool(settings.INNGEST_EVENT_KEY and settings.INNGEST_SIGNING_KEY),
            "gemini": bool(settings.GEMINI_API_KEY or settings.MOCK_MODE),
            "zoho_books": bool(settings.ZOHO_REFRESH_TOKEN and settings.ZOHO_ORG_ID or settings.MOCK_MODE),
            "google_drive_sheets": bool(
                settings.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
                or settings.GOOGLE_SERVICE_ACCOUNT_FILE
                or settings.MOCK_MODE
            ),
        },
    }


# -------------------------------------------------------------------------
# Static Frontend Serving (Multi-Stage Production Bundle & Dev Fallback)
# -------------------------------------------------------------------------

frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
dist_dir = os.path.join(frontend_dir, "dist")
dist_assets_dir = os.path.join(dist_dir, "assets")
src_dir = os.path.join(frontend_dir, "src")
public_dir = os.path.join(frontend_dir, "public")

# If production bundle exists (e.g. from Docker Multi-Stage build or npm run build), serve it
if os.path.exists(dist_dir) and os.path.exists(dist_assets_dir):
    app.mount("/assets", StaticFiles(directory=dist_assets_dir), name="assets")
    if os.path.exists(public_dir):
        app.mount("/public", StaticFiles(directory=public_dir), name="public")
    if os.path.exists(src_dir):
        app.mount("/src", StaticFiles(directory=src_dir), name="src")
    logger.info("Serving optimized production Vite bundle from frontend/dist")
elif os.path.exists(frontend_dir):
    # Development fallback
    if os.path.exists(src_dir):
        app.mount("/src", StaticFiles(directory=src_dir), name="src")
    if os.path.exists(public_dir):
        app.mount("/public", StaticFiles(directory=public_dir), name="public")
    logger.info("Serving development raw ES modules from frontend/src")


@app.get("/favicon.svg", include_in_schema=False)
async def favicon():
    for f_path in [
        os.path.join(dist_dir, "favicon.svg"),
        os.path.join(public_dir, "favicon.svg"),
    ]:
        if os.path.exists(f_path):
            return FileResponse(f_path)
    return HTMLResponse("")


@app.get("/", response_class=HTMLResponse, tags=["Dashboard"])
async def dashboard_ui() -> Any:
    """Serves the frontend control dashboard."""
    # In development mode or when testing without rebuild, prioritize dev_index
    prod_index = os.path.join(dist_dir, "index.html")
    dev_index = os.path.join(frontend_dir, "index.html")
    
    if (settings.ENVIRONMENT == "development" or os.environ.get("VITE_DEV")) and os.path.exists(dev_index):
        target_index = dev_index
    else:
        target_index = prod_index if os.path.exists(prod_index) else dev_index
    if os.path.exists(target_index):
        with open(target_index, "r", encoding="utf-8") as f:
            return HTMLResponse(
                content=f.read(),
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            )
    return HTMLResponse("<h1>S4 Automations API</h1><p>Visit /docs for API schema.</p>")
