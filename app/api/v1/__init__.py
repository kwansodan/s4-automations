"""API v1 master router aggregating all sub-routers with role-based guardrails."""

from fastapi import APIRouter, Depends

from app.api.deps import require_admin_user
from app.api.v1.auth import router as auth_router
from app.api.v1.pipeline import router as pipeline_router
from app.api.v1.invoices import router as invoices_router
from app.api.v1.sheets import router as sheets_router
from app.api.v1.catalog import router as catalog_router
from app.api.v1.config import router as config_router
from app.api.v1.clients import router as clients_router
from app.api.v1.audit import router as audit_router
from app.api.v1.bank_portal import router as bank_portal_router
from app.api.v1.oauth import router as oauth_router
from app.api.v1.system import router as system_router
from app.api.v1.social import router as social_router
from app.api.v1.marketing import router as marketing_router
from app.api.v1.contacts import router as contacts_router
from app.api.v1.billing import router as billing_router

api_sub_router = APIRouter()

# 1. Public & Hybrid Routers (Enforce dependencies internally per endpoint)
api_sub_router.include_router(auth_router)
api_sub_router.include_router(bank_portal_router)
api_sub_router.include_router(oauth_router)

# 2. Strict Admin-Only Routers (All endpoints globally guarded by require_admin_user)
admin_deps = [Depends(require_admin_user)]

api_sub_router.include_router(pipeline_router, dependencies=admin_deps)
api_sub_router.include_router(invoices_router, dependencies=admin_deps)
api_sub_router.include_router(sheets_router, dependencies=admin_deps)
api_sub_router.include_router(catalog_router, dependencies=admin_deps)
api_sub_router.include_router(config_router, dependencies=admin_deps)
api_sub_router.include_router(clients_router, dependencies=admin_deps)
api_sub_router.include_router(audit_router, dependencies=admin_deps)
api_sub_router.include_router(system_router, dependencies=admin_deps)
api_sub_router.include_router(social_router, dependencies=admin_deps)
api_sub_router.include_router(marketing_router, dependencies=admin_deps)
api_sub_router.include_router(contacts_router, dependencies=admin_deps)
api_sub_router.include_router(billing_router, dependencies=admin_deps)

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(api_sub_router)

api_legacy_router = APIRouter(prefix="/api")
api_legacy_router.include_router(api_sub_router)
