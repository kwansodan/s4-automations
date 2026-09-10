"""Comprehensive Automated Tests for Contact & Team Management."""

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_get_contact_stats():
    """Test retrieving top-level contact and team metrics."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/v1/contacts/stats?organization_id=s4_advisory")
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "total_client_contacts" in data
        assert "active_portal_contacts" in data
        assert "pending_invites" in data
        assert "total_firm_members" in data
        assert data["total_client_contacts"] >= 1
        assert data["total_firm_members"] >= 1


@pytest.mark.asyncio
async def test_list_client_contacts():
    """Test listing client contacts with optional filtering."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/v1/contacts/client-contacts?organization_id=s4_advisory")
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert isinstance(data["contacts"], list)
        assert len(data["contacts"]) >= 1

        first_contact = data["contacts"][0]
        assert "name" in first_contact
        assert "email" in first_contact
        assert "role" in first_contact
        assert "magic_url" in first_contact
        assert "portal_status" in first_contact


@pytest.mark.asyncio
async def test_invite_client_contact_and_magic_link():
    """Test inviting a client contact for information requests."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        payload = {
            "client_id": "anr_group",
            "name": "Esi Mansah",
            "email": "esi.mansah@anrgroup.com",
            "phone": "+233 24 555 1234",
            "role": "Financial_Controller",
            "notification_channel": "both",
            "notes": "Handles AP statements and fuel allocations",
            "send_invitation": True,
        }
        res = await ac.post("/api/v1/contacts/client-contacts?organization_id=s4_advisory", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["contact"]["name"] == "Esi Mansah"
        assert data["contact"]["email"] == "esi.mansah@anrgroup.com"
        assert data["contact"]["role"] == "Financial_Controller"
        assert "magic_url" in data
        assert "portal_magic=" in data["magic_url"]

        contact_id = data["contact"]["id"]

        # Resend invite test
        resend_res = await ac.post(f"/api/v1/contacts/client-contacts/{contact_id}/resend-invite")
        assert resend_res.status_code == 200
        resend_data = resend_res.json()
        assert resend_data["success"] is True

        # Update contact test
        update_res = await ac.put(
            f"/api/v1/contacts/client-contacts/{contact_id}",
            json={"phone": "+233 24 555 9999", "notes": "Updated operational contact notes"},
        )
        assert update_res.status_code == 200
        assert update_res.json()["contact"]["phone"] == "+233 24 555 9999"

        # Delete contact test
        del_res = await ac.delete(f"/api/v1/contacts/client-contacts/{contact_id}")
        assert del_res.status_code == 200
        assert del_res.json()["success"] is True


@pytest.mark.asyncio
async def test_firm_team_members_lifecycle():
    """Test inviting, updating, and removing an accounting firm team member."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # List firm members
        list_res = await ac.get("/api/v1/contacts/team-members?organization_id=s4_advisory")
        assert list_res.status_code == 200
        list_data = list_res.json()
        assert list_data["success"] is True
        assert len(list_data["team_members"]) >= 1

        # Invite new team member
        payload = {
            "name": "Kwabena Ofori",
            "email": "kofori@service4gh.com",
            "phone": "+233 24 777 8888",
            "role": "SENIOR_ACCOUNTANT",
            "assigned_client_ids": ["anr_group"],
            "permissions": {
                "can_query_clients": True,
                "can_categorize": True,
                "can_sync_accounting": True,
                "can_manage_clients": False,
            },
            "send_invitation": True,
        }
        invite_res = await ac.post("/api/v1/contacts/team-members?organization_id=s4_advisory", json=payload)
        assert invite_res.status_code == 200
        invite_data = invite_res.json()
        assert invite_data["success"] is True
        assert invite_data["team_member"]["name"] == "Kwabena Ofori"
        assert invite_data["team_member"]["assigned_client_ids"] == ["anr_group"]

        member_id = invite_data["team_member"]["id"]

        # Resend invite
        resend_res = await ac.post(f"/api/v1/contacts/team-members/{member_id}/resend-invite")
        assert resend_res.status_code == 200

        # Update member
        update_res = await ac.put(
            f"/api/v1/contacts/team-members/{member_id}",
            json={"role": "PARTNER", "assigned_client_ids": ["*"]},
        )
        assert update_res.status_code == 200
        assert update_res.json()["team_member"]["role"] == "PARTNER"
        assert update_res.json()["team_member"]["assigned_client_ids"] == ["*"]

        # Delete member
        del_res = await ac.delete(f"/api/v1/contacts/team-members/{member_id}")
        assert del_res.status_code == 200
        assert del_res.json()["success"] is True
