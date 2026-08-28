# ANR Commercial Laundry Billing & OCR Ingestion Engine

An automated, durable backend service built with **Python 3.11+**, **FastAPI**, **Inngest Python SDK**, **Google Drive & Sheets API (Service Account)**, **Google Gemini 3.6 Flash Developer API**, and **Zoho Books API**.

The service automates daily OCR ingestion of physical handwritten control slips (laundry pickup and delivery notes) from hotel clients, reconciles linen counts and losses, updates a two-tier Google Sheet review workbook (`Daily_Slip_Details` + `Monthly_Summary`), archives processed files, and allows downstream 1-click drafting of customer invoices in Zoho Books.

---

## Architecture Overview

```
Google Drive (Control Sheets / Month / Client)
                    │
                    ▼  (Cron: 0 23 * * * or manual dispatch)
┌─────────────────────────────────────────────────────────────┐
│                 Inngest Durable Orchestration               │
│                                                             │
│  Step 1: Preflight & Discovery (Zoho Catalog, Sheets Init)  │
│  Step 2: Resilient Client Fan-out Loop                      │
│  Step 3: Gemini 3.6 Flash Vision OCR Extraction             │
│  Step 4: Subledger (Tab 1) & Monthly Rollup (Tab 2) Sync    │
│  Step 5: File Archival to client/Processed/                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
Google Sheets Two-Tier Review Workbook: ANR_Billing_Review_<Month>_<YYYY>
├─ Tab 1: Daily_Slip_Details (Every line item + View Scan hyperlink)
└─ Tab 2: Monthly_Summary (15-col SKU rollup + Reviewed/Approved checkboxes)
                           │
                           ▼  (UI Click or Webhook: anr/invoices.generate)
┌─────────────────────────────────────────────────────────────┐
│           1-Click Zoho Books Invoicing Function             │
│                                                             │
│  - Filters rows where Approved? == True & Status == PENDING │
│  - Groups items by Client / Zoho Contact ID                 │
│  - Generates Draft Invoices in Zoho Books API               │
│  - Updates Sheet Status to INVOICED + Invoice ID & URL      │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Features

- **Gemini 3.6 Flash Structured Extraction:** Extracts handwritten dates, linen names (e.g. `B/Sheet Dbl`, `F/Towel`), pickup/delivery quantities, and computes loss discrepancy (`pickup - delivery`) with strict Pydantic JSON schema enforcement.
- **Semantic SKU Reconciliation:** Automatic fuzzy matching between handwritten notes and the live Zoho Books Item Catalog.
- **Two-Tier Google Sheet Review System:**
  - **Tab 1 (`Daily_Slip_Details`):** Raw audit trail with direct clickable `=HYPERLINK("<drive_file_url>", "View Scan ↗")` formulas.
  - **Tab 2 (`Monthly_Summary`):** 15-column consolidated SKU rollup with interactive boolean checkboxes (`Reviewed?`, `Approved?`) and confidence color coding (`LOW` = light orange, `MEDIUM` = light yellow, `HIGH` = light green).
- **Safe 1-Click Invoicing:** Never bills unreviewed slips. Downstream Inngest function generates Draft Invoices in Zoho Books only for approved items.
- **Durable & Resilient Execution:** Powered by Inngest for automatic retries, step isolation, and client fan-out.
- **Integrated Interactive Dashboard:** Built-in web UI on `/` to trigger workflows, check catalog status, and monitor live execution.

---

## Environment Variables (`.env`)

| Variable | Description |
|---|---|
| `INNGEST_EVENT_KEY` | Inngest Event Key |
| `INNGEST_SIGNING_KEY` | Inngest Signing Key |
| `GEMINI_API_KEY` | Google Gemini Developer API Key |
| `GEMINI_MODEL` | Gemini Model (Default: `gemini-3.6-flash`) |
| `ZOHO_CLIENT_ID` | Zoho OAuth2 Client ID |
| `ZOHO_CLIENT_SECRET` | Zoho OAuth2 Client Secret |
| `ZOHO_REFRESH_TOKEN` | Zoho OAuth2 Refresh Token |
| `ZOHO_ORG_ID` | Zoho Books Organization ID |
| `ZOHO_ACCOUNTS_URL` | Zoho Accounts domain (default: `https://accounts.zoho.com`) |
| `ZOHO_BOOKS_API_URL` | Zoho Books API domain (default: `https://www.zohoapis.com/books/v3`) |
| `CONTROL_SHEETS_FOLDER_ID` | Google Drive Root Folder ID for "control sheets" |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | Base64-encoded Service Account JSON key |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | (Alternative) Path to `service_account.json` file |
| `NOTIFICATION_EMAIL` | Notification recipient email (`cdanso@service4gh.com`) |
| `MOCK_MODE` | Set `true` to test end-to-end without live credentials |

---

## Quick Start & Local Development

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Configure Environment
```bash
cp .env.example .env
# Fill in your credentials or keep MOCK_MODE=true for testing
```

### 3. Run FastAPI Application
```bash
uvicorn app.main:app --reload --port 8000
```
- Web Dashboard: `http://localhost:8000/`
- Interactive OpenAPI Docs: `http://localhost:8000/docs`
- Inngest Endpoint: `http://localhost:8000/api/inngest`

### 4. Run Inngest Dev Server (Optional Local Orchestration)
```bash
npx inngest-cli@latest dev -u http://localhost:8000/api/inngest
```
Open Inngest Dev Server UI at `http://localhost:8288`.

---

## Running the Test Suite

Execute the automated test suite with pytest:
```bash
pytest -v
```

All unit, integration, and workflow tests run with complete mocks enabled by default.

---

## Deployment

### Render Deployment (`render.yaml`)
1. Connect repository to [Render](https://render.com).
2. Render detects `render.yaml` and deploys the FastAPI web service automatically.
3. Configure environment variables in the Render Dashboard.

### Docker Deployment
```bash
docker-compose up --build
```
This runs the FastAPI application on port 8000 and the Inngest Dev Server on port 8288.
