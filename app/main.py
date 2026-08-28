"""FastAPI application entrypoint for ANR Laundry Billing & Ingestion Service."""

from contextlib import asynccontextmanager
from typing import Dict, Any, Optional, List
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import inngest.fast_api

from app.config import settings
from app.inngest_client import inngest_client
from app.workflows.daily_billing_pipeline import anr_daily_billing_pipeline
from app.workflows.zoho_invoice_generator import anr_generate_zoho_invoices
from app.models.inngest_events import PipelineTriggerEvent, InvoiceGenerateEvent
from app.services.zoho_service import ZohoBooksService
from app.utils.logging import get_logger

logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing ANR Commercial Laundry Billing Engine...")
    logger.info(f"Environment: {settings.ENVIRONMENT} | Mock Mode: {settings.MOCK_MODE}")
    logger.info(f"Target Gemini Model: {settings.GEMINI_MODEL}")
    yield
    logger.info("Shutting down ANR Commercial Laundry Billing Engine...")


app = FastAPI(
    title="ANR Commercial Laundry Billing & OCR Ingestion Engine",
    description="Automated daily OCR ingestion of physical handwritten control slips, reconciliation, Google Sheets review sync, and Zoho Books invoicing.",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for internal dashboards
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount durable Inngest functions
inngest.fast_api.serve(
    app,
    inngest_client,
    [anr_daily_billing_pipeline, anr_generate_zoho_invoices],
)


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


@app.post("/api/pipeline/trigger", tags=["Pipeline"])
async def trigger_pipeline(payload: Optional[PipelineTriggerEvent] = None) -> Dict[str, Any]:
    """
    Manually triggers the daily billing & OCR ingestion pipeline via Inngest event dispatch.
    """
    event_data = payload.model_dump() if payload else {}
    logger.info(f"Received manual trigger for daily billing pipeline: {event_data}")
    
    try:
        import inngest
        await inngest_client.send(
            inngest.Event(
                name="anr/pipeline.trigger",
                data=event_data,
            )
        )
        return {
            "status": "QUEUED",
            "message": "Pipeline run successfully dispatched to Inngest workflow.",
            "event": "anr/pipeline.trigger",
            "data": event_data,
        }
    except Exception as e:
        logger.error(f"Failed to dispatch Inngest event: {e}")
        # In mock or local fallback when Inngest dev server is not running:
        return {
            "status": "TRIGGERED_LOCAL",
            "message": f"Inngest dispatch noted ({e}). You can run through Inngest Dev Server or mock suite.",
            "data": event_data,
        }


@app.post("/api/invoices/generate", tags=["Invoicing"])
async def trigger_invoice_generation(payload: Optional[InvoiceGenerateEvent] = None) -> Dict[str, Any]:
    """
    Triggers Zoho Draft Invoice creation for all approved rows in the review sheet.
    """
    event_data = payload.model_dump() if payload else {}
    logger.info(f"Received trigger for invoice generation: {event_data}")

    try:
        import inngest
        await inngest_client.send(
            inngest.Event(
                name="anr/invoices.generate",
                data=event_data,
            )
        )
        return {
            "status": "QUEUED",
            "message": "Invoice generation task successfully dispatched to Inngest.",
            "event": "anr/invoices.generate",
            "data": event_data,
        }
    except Exception as e:
        logger.error(f"Failed to dispatch Inngest invoice event: {e}")
        return {
            "status": "TRIGGERED_LOCAL",
            "message": f"Invoice generation noted ({e}).",
            "data": event_data,
        }


@app.get("/api/catalog", tags=["Zoho Books"])
async def get_zoho_catalog() -> Dict[str, Any]:
    """Returns active Zoho contacts and item catalog for reconciliation."""
    zoho = ZohoBooksService()
    try:
        contacts = await zoho.fetch_active_contacts()
        items = await zoho.fetch_item_catalog()
        return {
            "contacts_count": len(contacts),
            "items_count": len(items),
            "contacts": [c.model_dump() for c in contacts],
            "items": [i.model_dump() for i in items],
        }
    except Exception as e:
        logger.error(f"Failed to fetch catalog: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/", response_class=HTMLResponse, tags=["Dashboard"])
async def dashboard_ui() -> HTMLResponse:
    """Rich interactive web UI for monitoring and triggering billing automation."""
    html_content = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ANR Laundry Billing & OCR Ingestion Engine</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
            :root {
                --primary: #0284c7;
                --primary-dark: #0369a1;
                --primary-light: #e0f2fe;
                --accent: #10b981;
                --accent-warm: #f59e0b;
                --bg-dark: #0b0f19;
                --card-bg: #111827;
                --card-border: #1f2937;
                --text-main: #f3f4f6;
                --text-muted: #9ca3af;
                --highlight: #38bdf8;
            }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
                font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
                background-color: var(--bg-dark);
                color: var(--text-main);
                min-height: 100vh;
                padding: 2.5rem 1.5rem;
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            .container {
                max-width: 1100px;
                width: 100%;
            }
            header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 2rem;
                padding-bottom: 1.5rem;
                border-bottom: 1px solid var(--card-border);
            }
            .brand {
                display: flex;
                align-items: center;
                gap: 1rem;
            }
            .logo-icon {
                width: 48px;
                height: 48px;
                background: linear-gradient(135deg, #0284c7, #38bdf8);
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.5rem;
                box-shadow: 0 0 20px rgba(56, 189, 248, 0.3);
            }
            h1 { font-size: 1.6rem; font-weight: 700; color: #fff; }
            .subtitle { font-size: 0.9rem; color: var(--text-muted); }
            .badge {
                padding: 0.35rem 0.8rem;
                border-radius: 9999px;
                font-size: 0.75rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                background: rgba(16, 185, 129, 0.15);
                color: #34d399;
                border: 1px solid rgba(16, 185, 129, 0.3);
            }
            .grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
                gap: 1.5rem;
                margin-bottom: 2rem;
            }
            .card {
                background-color: var(--card-bg);
                border: 1px solid var(--card-border);
                border-radius: 16px;
                padding: 1.75rem;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
                transition: transform 0.2s, border-color 0.2s;
            }
            .card:hover {
                border-color: #374151;
            }
            .card-title {
                font-size: 1.15rem;
                font-weight: 700;
                margin-bottom: 0.75rem;
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }
            .card-desc {
                color: var(--text-muted);
                font-size: 0.88rem;
                line-height: 1.5;
                margin-bottom: 1.5rem;
            }
            .btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
                width: 100%;
                padding: 0.85rem 1.25rem;
                border-radius: 10px;
                font-size: 0.95rem;
                font-weight: 600;
                cursor: pointer;
                border: none;
                transition: all 0.2s ease;
            }
            .btn-primary {
                background: linear-gradient(135deg, #0284c7, #0369a1);
                color: #fff;
                box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);
            }
            .btn-primary:hover {
                background: linear-gradient(135deg, #0369a1, #075985);
                transform: translateY(-1px);
            }
            .btn-accent {
                background: linear-gradient(135deg, #059669, #047857);
                color: #fff;
                box-shadow: 0 4px 14px rgba(5, 150, 105, 0.4);
            }
            .btn-accent:hover {
                background: linear-gradient(135deg, #047857, #065f46);
                transform: translateY(-1px);
            }
            .stats-list {
                list-style: none;
                margin-top: 1rem;
            }
            .stats-item {
                display: flex;
                justify-content: space-between;
                padding: 0.6rem 0;
                border-bottom: 1px solid #1f2937;
                font-size: 0.85rem;
            }
            .stats-item:last-child { border-bottom: none; }
            .stats-label { color: var(--text-muted); }
            .stats-val { font-weight: 600; color: #fff; }
            .console-box {
                background: #000;
                border: 1px solid var(--card-border);
                border-radius: 12px;
                padding: 1.25rem;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.85rem;
                color: #38bdf8;
                max-height: 220px;
                overflow-y: auto;
                white-space: pre-wrap;
                margin-top: 1rem;
            }
            .footer-links {
                margin-top: 2rem;
                text-align: center;
                font-size: 0.85rem;
                color: var(--text-muted);
            }
            .footer-links a {
                color: var(--highlight);
                text-decoration: none;
                margin: 0 0.75rem;
            }
            .footer-links a:hover { text-decoration: underline; }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <div class="brand">
                    <div class="logo-icon">🧺</div>
                    <div>
                        <h1>ANR Laundry Billing Engine</h1>
                        <p class="subtitle">Handwritten OCR Vision &bull; Google Sheets Review &bull; Zoho Books Sync</p>
                    </div>
                </div>
                <div>
                    <span class="badge">● Engine Online</span>
                </div>
            </header>

            <div class="grid">
                <!-- Card 1: Pipeline Trigger -->
                <div class="card">
                    <div class="card-title"><span>⚡</span> Daily OCR Ingestion Pipeline</div>
                    <p class="card-desc">
                        Scans Google Drive client folders, performs Gemini 3.6 Flash vision extraction on handwritten slips, updates Tab 1 (Details) and Tab 2 (Monthly Summary), and archives processed files.
                    </p>
                    <button class="btn btn-primary" onclick="triggerPipeline()">
                        <span>🚀</span> Run OCR Ingestion Now
                    </button>
                    <ul class="stats-list">
                        <li class="stats-item"><span class="stats-label">Trigger Schedule</span><span class="stats-val">Daily @ 11:00 PM GMT</span></li>
                        <li class="stats-item"><span class="stats-label">Vision Model</span><span class="stats-val">Gemini 3.6 Flash</span></li>
                        <li class="stats-item"><span class="stats-label">Client Scope</span><span class="stats-val">Luxwood, The Lennox, Bantree, etc.</span></li>
                    </ul>
                </div>

                <!-- Card 2: 1-Click Zoho Invoicing -->
                <div class="card">
                    <div class="card-title"><span>📑</span> 1-Click Zoho Invoicing</div>
                    <p class="card-desc">
                        Reads reviewed and approved rows (<code>Approved? = True</code>) from Google Sheets Tab 2, generates draft invoices in Zoho Books, and updates status to <code>INVOICED</code>.
                    </p>
                    <button class="btn btn-accent" onclick="triggerInvoicing()">
                        <span>💳</span> Generate Draft Invoices
                    </button>
                    <ul class="stats-list">
                        <li class="stats-item"><span class="stats-label">Target System</span><span class="stats-val">Zoho Books API v3</span></li>
                        <li class="stats-item"><span class="stats-label">Invoice Mode</span><span class="stats-val">Draft (Safe Review)</span></li>
                        <li class="stats-item"><span class="stats-label">Linen Loss Notes</span><span class="stats-val">Automatic Discrepancy Calc</span></li>
                    </ul>
                </div>
            </div>

            <!-- Operational Console -->
            <div class="card" style="margin-bottom: 1.5rem;">
                <div class="card-title"><span>🖥️</span> Live Pipeline Console</div>
                <div id="console" class="console-box">ANR Ingestion Engine ready. Click an action above or trigger via Inngest.</div>
            </div>

            <div class="footer-links">
                <a href="/docs" target="_blank">OpenAPI Docs</a> &bull;
                <a href="/health" target="_blank">Health Endpoint</a> &bull;
                <a href="/api/catalog" target="_blank">Zoho Catalog Cache</a> &bull;
                <a href="/api/inngest" target="_blank">Inngest Endpoint</a>
            </div>
        </div>

        <script>
            function log(msg) {
                const c = document.getElementById('console');
                const time = new Date().toLocaleTimeString();
                c.textContent = `[${time}] ${msg}\n` + c.textContent;
            }

            async function triggerPipeline() {
                log("Dispatching OCR Ingestion Pipeline run...");
                try {
                    const res = await fetch('/api/pipeline/trigger', { method: 'POST' });
                    const data = await res.json();
                    log("Pipeline Response: " + JSON.stringify(data, null, 2));
                } catch (e) {
                    log("Error: " + e.message);
                }
            }

            async function triggerInvoicing() {
                log("Dispatching Zoho Draft Invoicing task...");
                try {
                    const res = await fetch('/api/invoices/generate', { method: 'POST' });
                    const data = await res.json();
                    log("Invoicing Response: " + JSON.stringify(data, null, 2));
                } catch (e) {
                    log("Error: " + e.message);
                }
            }
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)
