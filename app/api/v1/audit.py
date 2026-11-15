"""Audit Log Query API Router."""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.api.deps import (
    get_accessible_client_ids,
    require_authenticated_user,
    verify_client_access,
)
from app.db.session import get_db_session
from app.services.audit_service import AuditService

router = APIRouter(prefix="/audit", tags=["Audit Trail"])


@router.get("", summary="Query Historical Compliance Audit Logs")
async def get_audit_logs(
    client_id: Optional[str] = Query(default=None, description="Filter by client ID, e.g. anr_group, polaris"),
    organization_id: Optional[str] = Query(default=None, description="Filter by organization ID"),
    action: Optional[str] = Query(default=None, description="Filter by action, e.g. PIPELINE_TRIGGERED, ROW_APPROVED"),
    limit: int = Query(default=50, ge=1, le=500, description="Max number of logs to return"),
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
    db: Session = Depends(get_db_session),
) -> List[Dict[str, Any]]:
    """Returns immutable historical audit trail strictly scoped to caller's organization or client."""
    if client_id:
        verify_client_access(db, current_user, client_id, allow_missing_for_platform_admin=True)
        allowed_clients = None
    else:
        allowed_clients = get_accessible_client_ids(db, current_user, organization_id)

    logs = AuditService.get_logs(
        client_id=client_id,
        action=action,
        limit=limit,
        allowed_client_ids=allowed_clients,
    )
    return [l.model_dump() for l in logs]

