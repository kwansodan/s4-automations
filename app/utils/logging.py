"""Structured logging setup for ANR billing pipeline with in-memory buffer for frontend inspection."""

import logging
import sys
import threading
import traceback
from collections import deque
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from app.config import settings


class InMemoryLogBufferHandler(logging.Handler):
    """Thread-safe in-memory ring buffer holding recent structured logs for frontend debugging."""

    def __init__(self, capacity: int = 500):
        super().__init__()
        self.capacity = capacity
        self.buffer = deque(maxlen=capacity)
        self.errors = deque(maxlen=100)
        self.issues = deque(maxlen=200)  # Contains both WARNING and ERROR/CRITICAL
        self._seq = 0
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord):
        try:
            msg = self.format(record)
            tb = None
            if record.exc_info:
                tb = "".join(traceback.format_exception(*record.exc_info))

            with self._lock:
                self._seq += 1
                seq_num = self._seq

            entry: Dict[str, Any] = {
                "id": f"log_{int(record.created * 1000)}_{seq_num}",
                "seq": seq_num,
                "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
                "time_display": datetime.fromtimestamp(record.created).strftime("%H:%M:%S"),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
                "formatted": msg,
                "traceback": tb,
                "path": f"{record.pathname}:{record.lineno}",
                "func": record.funcName,
            }

            with self._lock:
                self.buffer.append(entry)
                if record.levelno >= logging.WARNING:
                    self.issues.append(entry)
                if record.levelno >= logging.ERROR:
                    self.errors.append(entry)
        except Exception:
            self.handleError(record)

    def get_logs(
        self,
        level: Optional[str] = None,
        limit: int = 100,
        search: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        with self._lock:
            records = list(self.buffer)

        if level and level.upper() != "ALL":
            records = [r for r in records if r["level"].upper() == level.upper()]

        if search:
            q = search.lower()
            records = [
                r for r in records
                if q in r["message"].lower() or q in r["logger"].lower() or (r["traceback"] and q in r["traceback"].lower())
            ]

        # Return latest first
        records.reverse()
        return records[:limit]

    def get_errors(self, limit: int = 50, since_seq: int = 0) -> List[Dict[str, Any]]:
        with self._lock:
            records = [r for r in self.errors if r.get("seq", 0) > since_seq]
        records.reverse()
        return records[:limit]

    def get_issues(self, limit: int = 50, since_seq: int = 0) -> List[Dict[str, Any]]:
        with self._lock:
            records = [r for r in self.issues if r.get("seq", 0) > since_seq]
        records.reverse()
        return records[:limit]

    def clear(self):
        with self._lock:
            self.buffer.clear()
            self.errors.clear()
            self.issues.clear()


# Global in-memory log buffer instance
log_buffer = InMemoryLogBufferHandler(capacity=500)
log_formatter = logging.Formatter(
    fmt="%(asctime)s [%(levelname)s] [%(name)s]: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log_buffer.setFormatter(log_formatter)

# Redirect standard library warnings to logging
logging.captureWarnings(True)

# Attach log_buffer to the root logger and core framework loggers so all server output is captured
_root_logger = logging.getLogger()
if log_buffer not in _root_logger.handlers:
    _root_logger.addHandler(log_buffer)

for _sys_logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi", "googleapiclient", "py.warnings"):
    _sys_l = logging.getLogger(_sys_logger_name)
    if log_buffer not in _sys_l.handlers:
        _sys_l.addHandler(log_buffer)


def get_logger(name: str) -> logging.Logger:
    """Configures and returns a structured logger attached to stdout and the in-memory buffer."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(log_formatter)
        logger.addHandler(handler)
        if log_buffer not in logger.handlers:
            logger.addHandler(log_buffer)

    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    logger.setLevel(log_level)
    return logger


def get_recent_server_logs(level: Optional[str] = None, limit: int = 100, search: Optional[str] = None) -> List[Dict[str, Any]]:
    """Returns recent log entries from the in-memory buffer."""
    return log_buffer.get_logs(level=level, limit=limit, search=search)


def get_recent_server_errors(limit: int = 50, since_seq: int = 0) -> List[Dict[str, Any]]:
    """Returns recent error entries with full tracebacks."""
    return log_buffer.get_errors(limit=limit, since_seq=since_seq)


def get_recent_server_issues(limit: int = 50, since_seq: int = 0) -> List[Dict[str, Any]]:
    """Returns recent warning and error entries."""
    return log_buffer.get_issues(limit=limit, since_seq=since_seq)

