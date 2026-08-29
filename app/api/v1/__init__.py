"""API v1 master router aggregating all sub-routers."""

from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.pipeline import router as pipeline_router
from app.api.v1.invoices import router as invoices_router
from app.api.v1.sheets import router as sheets_router
from app.api.v1.catalog import router as catalog_router
from app.api.v1.config import router as config_router
from app.api.v1.clients import router as clients_router
from app.api.v1.audit import router as audit_router

api_v1_router = APIRouter(prefix="/api")

api_v1_router.include_router(auth_router)
api_v1_router.include_router(pipeline_router)
api_v1_router.include_router(invoices_router)
api_v1_router.include_router(sheets_router)
api_v1_router.include_router(catalog_router)
api_v1_router.include_router(config_router)
api_v1_router.include_router(clients_router)
api_v1_router.include_router(audit_router)
