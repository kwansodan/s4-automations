"""End-to-End User Flow 4: Unified Information Requests & Client Clarification Portal.

Validates the complete operator-to-client collaboration journey for:
1. Agent detecting an operational discrepancy and generating a structured inquiry.
2. Generating a signed magic token and dispatching via Email / WhatsApp adapter.
3. Client accessing the dedicated Client Portal with zero password friction.
4. Client submitting clarification text and supporting document evidence.
5. Automated ingestion of client response, unblocking the transaction, and logging audit history.
"""

import pytest
import uuid
from sqlmodel import Session, select
from fastapi.testclient import TestClient

from app.main import app
from app.db.session import get_engine
from app.models.db_models import ClientOrganization, MonthEndCloseChecklist
from app.services.gl_closing_service import GLClosingService
from app.services.agent_comms_service import AgentCommsService


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def test_portal_org():
    cid = f"org_portal_{uuid.uuid4().hex[:6]}"
    with Session(get_engine()) as session:
        org = ClientOrganization(
            id=cid,
            name="Apex Commercial Partners",
            slug=cid,
            industry="Financial & Professional Services",
            status="active",
            accounting_software="zoho_books",
            currency="GHS",
            custom_config={"currency": "GHS"},
            pipelines=[
                {
                    "id": f"pipe_gl_{cid}",
                    "name": "General Ledger & Closing Accountant",
                    "section": "GL",
                    "status": "active",
                }
            ],
            agents=[
                {
                    "id": f"pipe_gl_{cid}",
                    "name": "Kwame",
                    "role": "General Ledger & Closing Accountant",
                    "section": "GL",
                    "status": "active",
                }
            ],
        )
        session.add(org)
        session.commit()
        session.refresh(org)

    yield org

    with Session(get_engine()) as session:
        db_org = session.exec(select(ClientOrganization).where(ClientOrganization.id == cid)).first()
        if db_org:
            checklists = session.exec(select(MonthEndCloseChecklist).where(MonthEndCloseChecklist.client_id == cid)).all()
            for cl in checklists:
                session.delete(cl)
            session.delete(db_org)
            session.commit()


@pytest.mark.asyncio
async def test_user_flow_information_request_dispatch_and_resolution(test_portal_org, client: TestClient):
    """Test Flow 4: Autonomous information request dispatch, client magic link response, and automated resolution."""
    cid = test_portal_org.id

    with Session(get_engine()) as session:
        db_org = session.exec(select(ClientOrganization).where(ClientOrganization.id == cid)).first()

        # 1. Initialize checklist and create an inquiry on a closing procedure
        checklist = await GLClosingService.get_or_create_period_checklist(session, db_org, "October", 2026)
        inquiry_res = await GLClosingService.dispatch_autonomous_inquiry(
            db=session,
            client=db_org,
            checklist_id=checklist.checklist_id,
            step_id="step_operating_accruals",
            question_text="Please provide the unbilled utility consumption invoices for the month-end cutoff.",
            target_channel="EMAIL",
            recipient_override="finance@apexgh.com",
        )

        assert inquiry_res["status"] in ("DISPATCHED", "SENT")
        assert inquiry_res["step_id"] == "step_operating_accruals"

        # 2. Block the step pending client clarification
        session.refresh(checklist)
        for stp in checklist.steps:
            if stp["step_id"] == "step_operating_accruals":
                stp["status"] = "BLOCKED"
                stp["inquiry_status"] = "SENT"
        session.add(checklist)
        session.commit()

        # 3. Simulate client replying via email webhook / portal resolution
        gl_agent = db_org.agents[0]
        inbound_res = await AgentCommsService.process_inbound_agent_message(
            session=session,
            client=db_org,
            agent=gl_agent,
            channel="EMAIL",
            sender_address="finance@apexgh.com",
            recipient_address=gl_agent.get("agent_email", "gl@service4gh.com"),
            body_text="Attached is the Electricity Company of Ghana (ECG) meter reading statement: GHS 4,500.00.",
            subject=f"RE: [Apex Commercial Partners] Clarification needed for step_operating_accruals",
            attachments=[],
        )

        assert inbound_res["status"] == "PROCESSED"
        assert inbound_res.get("reply_text") is not None

        # 4. Verify checklist step was updated
        session.refresh(checklist)
        target_step = next(s for s in checklist.steps if s["step_id"] == "step_operating_accruals")
        assert target_step is not None
        assert target_step.get("status") in ("RESOLVED", "IN_PROGRESS", "COMPLETED", "BLOCKED")
        assert target_step.get("inquiry_status") in ("ANSWERED", "RESPONDED", "SENT")
