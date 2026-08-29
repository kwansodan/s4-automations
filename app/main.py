"""FastAPI Application Entrypoint for S4 Automations Engine."""

import os
from contextlib import asynccontextmanager
from typing import Dict, Any
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import inngest.fast_api

from app.config import settings
from app.inngest_client import inngest_client
from app.workflows.daily_billing_pipeline import anr_daily_billing_pipeline
from app.workflows.zoho_invoice_generator import anr_generate_zoho_invoices
from app.workflows.client_strategy_pipeline import client_strategy_pipeline
from app.api.v1 import api_v1_router
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

# Mount durable Inngest functions
inngest.fast_api.serve(
    app,
    inngest_client,
    [anr_daily_billing_pipeline, anr_generate_zoho_invoices, client_strategy_pipeline],
    enable_unauthed_sync=True,
)

# Mount modular API v1 routers (/api/*)
app.include_router(api_v1_router)


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
    # Check for production bundle index.html first
    prod_index = os.path.join(dist_dir, "index.html")
    dev_index = os.path.join(frontend_dir, "index.html")
    
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
