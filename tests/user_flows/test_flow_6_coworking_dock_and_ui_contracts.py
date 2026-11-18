"""End-to-End User Flow 6: Co-Working Dock, Header Ticker & Team Room Experience.

Validates the complete operator interaction and UI contract journey for:
1. Multi-agent telemetry streaming with agent identities (Kwame, Ama, Kofi, Akosua).
2. Non-intrusive 3-tier presentation:
   - Tier 1: In-Header Interactive Ticker (0% screen footprint)
   - Tier 2: Collapsible Agent Co-Working Dock (Card mode vs Minimized 32px pill vs Dismissed background)
   - Tier 3: Opt-in Agent Team Room Modal with instant "Run in Background" button
3. Zero-space navigation activity beads on sidebar items.
4. Sequential polling guard (1.2s cadence, no request stacking).
"""

import re
from pathlib import Path
from fastapi.testclient import TestClient

from app.main import app
from app.utils.progress_tracker import pipeline_tracker

FRONTEND_ROOT = Path(__file__).resolve().parent.parent.parent / "frontend"


def test_user_flow_co_working_telemetry_streaming():
    """Test Flow 6A: Backend pipeline_tracker correctly captures and streams collaborative agent presence."""
    pipeline_tracker.start_pipeline(
        task_name="Month-End Close Execution",
        month="October",
        year=2026,
        total_stages=5,
        client_id="org_test_coworking",
        client_name="Test Enterprise Ghana",
        agent_id="gl_accountant",
        agent_name="Kwame",
        agent_role="General Ledger & Closing Accountant",
        section="GL",
        collaborating_agents=["Ama (Reporting)", "Kofi (Bank Recon)", "Akosua (AR/Billing)"],
    )

    state = pipeline_tracker.get_state()
    assert state["is_running"] is True
    assert state["agent_name"] == "Kwame"
    assert state["agent_role"] == "General Ledger & Closing Accountant"
    assert state["section"] == "GL"
    assert len(state["collaborating_agents"]) == 3
    assert "Ama (Reporting)" in state["collaborating_agents"]

    # Stream intermediate steps
    pipeline_tracker.update_step(
        current_step="Executing prepayment amortization schedules...",
        percent=45,
        stage_index=3,
    )
    pipeline_tracker.add_log("info", "Kwame (GL Agent): Reconciled Account 1400 prepayments.")

    updated_state = pipeline_tracker.get_state()
    assert updated_state["percent"] == 45
    assert updated_state["stage_index"] == 3
    assert "prepayment" in updated_state["current_step"].lower()
    assert len(updated_state["recent_logs"]) >= 1

    # Complete pipeline
    pipeline_tracker.complete_pipeline({"status": "SUCCESS", "verified": True})
    completed_state = pipeline_tracker.get_state()
    assert completed_state["is_running"] is False
    assert completed_state["percent"] == 100
    assert completed_state["status"] == "COMPLETED"


def test_user_flow_co_working_dock_and_modal_contracts():
    """Test Flow 6B: Frontend contract verification for non-blocking Co-Working Dock and Team Room."""
    app_tsx = FRONTEND_ROOT / "src" / "App.tsx"
    assert app_tsx.exists(), "frontend/src/App.tsx must exist"
    app_code = app_tsx.read_text(encoding="utf-8")

    # Contract: Floating widget must be conditioned on running pipeline and closed modal
    assert "pipelineProgress?.is_running && !isInvoiceModalOpen &&" in app_code
    assert "<PipelineFloatingWidget />" in app_code
    assert "<AgentTeamRoomModal />" in app_code

    # Contract: Dock must support Minimized Pill mode and Background Dismiss
    dock_file = FRONTEND_ROOT / "src" / "components" / "common" / "AgentCoWorkingDock.tsx"
    assert dock_file.exists(), "AgentCoWorkingDock.tsx must exist"
    dock_code = dock_file.read_text(encoding="utf-8")

    assert "isDockMinimized" in dock_code
    assert "isDockDismissed" in dock_code
    assert "setIsDockMinimized" in dock_code
    assert "setIsDockDismissed" in dock_code
    assert "handleOpenTeamRoom" in dock_code

    # Contract: Team Room Modal must feature "Run in Background" button
    modal_file = FRONTEND_ROOT / "src" / "components" / "modals" / "AgentTeamRoomModal.tsx"
    assert modal_file.exists(), "AgentTeamRoomModal.tsx must exist"
    modal_code = modal_file.read_text(encoding="utf-8")

    assert "Run in Background" in modal_code
    assert "handleRunInBackground" in modal_code
    assert "Live Operational Thought Stream" in modal_code

    # Contract: Header must feature interactive Tier 1 live ticker
    header_file = FRONTEND_ROOT / "src" / "components" / "layout" / "Header.tsx"
    assert header_file.exists(), "Header.tsx must exist"
    header_code = header_file.read_text(encoding="utf-8")

    assert "pipelineProgress?.is_running" in header_code
    assert "setIsTeamModalOpen(true)" in header_code

    # Contract: Sidebar must feature activity beads
    sidebar_file = FRONTEND_ROOT / "src" / "components" / "layout" / "Sidebar.tsx"
    assert sidebar_file.exists(), "Sidebar.tsx must exist"
    sidebar_code = sidebar_file.read_text(encoding="utf-8")

    assert "isSectionActive" in sidebar_code
    assert "Active" in sidebar_code


def test_user_flow_sequential_polling_guard_contract():
    """Test Flow 6C: Sequential polling contract prevents request stacking at 1.2s cadence."""
    context_file = FRONTEND_ROOT / "src" / "context" / "AutomationContext.tsx"
    assert context_file.exists(), "AutomationContext.tsx must exist"
    context_code = context_file.read_text(encoding="utf-8")

    assert "1200" in context_code, "Sequential poll timer must be set to 1.2s"
    assert "isRequestInFlight" in context_code, "In-flight request guard must prevent request stacking"
    assert "startAgentTask" in context_code, "startAgentTask optimistic trigger must exist in context"
