"""
Real-time pipeline telemetry and execution progress tracker for ANR Laundry Billing.
Provides live stage updates, percent completion, stats counters, and streaming logs.
"""

from datetime import datetime
import time
from typing import Dict, Any, List, Optional
import threading


class PipelineProgressTracker:
    def __init__(self):
        self._lock = threading.Lock()
        self.is_running: bool = False
        self.status: str = "IDLE"  # "IDLE", "RUNNING", "COMPLETED", "ERROR"
        self.task_name: str = "Idle"
        self.month: str = "August"
        self.year: int = 2026
        self.current_step: str = "System ready."
        self.stage_index: int = 0
        self.total_stages: int = 5
        self.percent: int = 0
        self.stats: Dict[str, Any] = {
            "clients_total": 0,
            "clients_done": 0,
            "slips_processed": 0,
            "items_extracted": 0,
            "loss_discrepancies": 0,
        }
        self.logs: List[Dict[str, Any]] = []
        self.start_timestamp: float = 0.0
        self.started_at: Optional[str] = None
        self.completed_at: Optional[str] = None
        self.elapsed_seconds: float = 0.0
        self.error_message: Optional[str] = None
        self.last_result: Optional[Dict[str, Any]] = None

    def start_pipeline(self, task_name: str, month: str, year: int, total_stages: int = 5):
        with self._lock:
            self.is_running = True
            self.status = "RUNNING"
            self.task_name = task_name
            self.month = month
            self.year = year
            self.current_step = f"Starting {task_name} for {month} {year}..."
            self.stage_index = 1
            self.total_stages = total_stages
            self.percent = 5
            self.stats = {
                "clients_total": 0,
                "clients_done": 0,
                "slips_processed": 0,
                "items_extracted": 0,
                "loss_discrepancies": 0,
            }
            self.start_timestamp = time.time()
            self.started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            self.completed_at = None
            self.elapsed_seconds = 0.0
            self.error_message = None
            self.last_result = None
            self.logs = []
            
        self.add_log("info", f"🚀 Started {task_name} for {month} {year}.")

    def update_progress(
        self,
        percent: int,
        stage_index: Optional[int] = None,
        current_step: Optional[str] = None,
        stats_update: Optional[Dict[str, Any]] = None,
    ):
        with self._lock:
            self.percent = min(max(percent, 0), 100)
            if stage_index is not None:
                self.stage_index = stage_index
            if current_step is not None:
                self.current_step = current_step
            if stats_update:
                self.stats.update(stats_update)
            if self.start_timestamp > 0:
                self.elapsed_seconds = round(time.time() - self.start_timestamp, 1)

    def add_log(self, level: str, message: str):
        entry = {
            "time": datetime.now().strftime("%H:%M:%S"),
            "level": level,  # "info", "success", "warning", "error"
            "message": message,
        }
        with self._lock:
            self.logs.append(entry)
            if len(self.logs) > 300:
                self.logs.pop(0)

    def complete_pipeline(self, summary: Optional[Dict[str, Any]] = None):
        with self._lock:
            self.is_running = False
            self.status = "COMPLETED"
            self.percent = 100
            self.stage_index = self.total_stages
            self.current_step = "Pipeline completed successfully."
            self.completed_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if self.start_timestamp > 0:
                self.elapsed_seconds = round(time.time() - self.start_timestamp, 1)
            self.last_result = summary

        slips = self.stats.get("slips_processed", 0)
        items = self.stats.get("items_extracted", 0)
        self.add_log(
            "success",
            f"✅ Completed in {self.elapsed_seconds}s. Processed {slips} slips ({items} line items extracted).",
        )

    def fail_pipeline(self, error_msg: str):
        with self._lock:
            self.is_running = False
            self.status = "ERROR"
            self.current_step = f"Failed: {error_msg}"
            self.error_message = error_msg
            self.completed_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if self.start_timestamp > 0:
                self.elapsed_seconds = round(time.time() - self.start_timestamp, 1)

        self.add_log("error", f"❌ Pipeline failed: {error_msg}")

    def get_state(self) -> Dict[str, Any]:
        with self._lock:
            if self.is_running and self.start_timestamp > 0:
                self.elapsed_seconds = round(time.time() - self.start_timestamp, 1)
            return {
                "is_running": self.is_running,
                "status": self.status,
                "task_name": self.task_name,
                "month": self.month,
                "year": self.year,
                "current_step": self.current_step,
                "stage_index": self.stage_index,
                "total_stages": self.total_stages,
                "percent": self.percent,
                "stats": dict(self.stats),
                "started_at": self.started_at,
                "completed_at": self.completed_at,
                "elapsed_seconds": self.elapsed_seconds,
                "error_message": self.error_message,
                "recent_logs": list(self.logs[-50:]),
                "last_result": self.last_result,
            }


# Process-wide tracker instance
pipeline_tracker = PipelineProgressTracker()
