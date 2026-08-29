"""Audit Logging Service for S4 Automations."""

from typing import Dict, Any, Optional, List
from datetime import datetime
from sqlmodel import Session, select, desc

from app.db.session import engine
from app.models.db_models import AuditLog
from app.utils.logging import get_logger

logger = get_logger("audit_service")


class AuditService:
    """Records and queries immutable audit events across all client automations."""

    @classmethod
    def log(
        cls,
        client_id: str,
        action: str,
        actor_email: str = "system",
        details: Optional[Dict[str, Any]] = None,
        source_type: Optional[str] = "system",
        source_identifier: Optional[str] = None,
    ) -> AuditLog:
        """Persists an immutable audit log entry."""
        entry = AuditLog(
            client_id=client_id,
            action=action,
            actor_email=actor_email,
            details=details or {},
            source_type=source_type,
            source_identifier=source_identifier,
            created_at=datetime.utcnow(),
        )
        try:
            with Session(engine) as session:
                session.add(entry)
                session.commit()
                session.refresh(entry)
                logger.info(f"📝 [AUDIT] Client: {client_id} | Action: {action} | Actor: {actor_email}")
                return entry
        except Exception as e:
            logger.error(f"Failed to record audit log entry: {e}")
            return entry

    @classmethod
    def get_logs(
        cls,
        client_id: Optional[str] = None,
        action: Optional[str] = None,
        limit: int = 100,
    ) -> List[AuditLog]:
        """Queries historical audit logs."""
        try:
            with Session(engine) as session:
                statement = select(AuditLog).order_by(desc(AuditLog.created_at)).limit(limit)
                if client_id:
                    statement = statement.where(AuditLog.client_id == client_id)
                if action:
                    statement = statement.where(AuditLog.action == action)
                return list(session.exec(statement).all())
        except Exception as e:
            logger.error(f"Failed querying audit logs: {e}")
            return []
