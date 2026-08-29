"""Audit Log Query API Router."""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Query

from app.services.audit_service import AuditService

router = APIRouter(prefix="/audit", tags=["Audit Trail"])


@router.get("", summary="Query Historical Compliance Audit Logs")
async def get_audit_logs(
    client_id: Optional[str] = Query(default=None, description="Filter by client ID, e.g. anr_group, polaris"),
    action: Optional[str] = Query(default=None, description="Filter by action, e.g. PIPELINE_TRIGGERED, ROW_APPROVED"),
    limit: int = Query(default=50, ge=1, le=500, description="Max number of logs to return"),
) -> List[Dict[str, Any]]:
    """Returns immutable historical audit trail of all OCR extractions, approvals, and invoice generations."""
    logs = AuditService.get_logs(client_id=client_id, action=action, limit=limit)
    return [l.model_dump() for l in logs]
