"""Contact & Team Management REST Endpoints.

Allows accounting firms to:
1. Invite client contacts for information request purposes (bank clarification, invoice upload) with 1-click magic links.
2. Invite firm team members to participate in client management with role-based scoping and permissions.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Query, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select, or_

from app.db.session import get_db_session, get_engine
from app.models.db_models import ClientContact, FirmTeamMember, ClientOrganization, Organization
from app.services.mailjet_service import MailjetService
from app.services.audit_service import AuditService
from app.api.v1.bank_portal import generate_magic_link_token
from app.config import settings
from app.utils.logging import get_logger

logger = get_logger("api.contacts")
router = APIRouter(prefix="/contacts", tags=["Contact & Team Management"])


# -------------------------------------------------------------------------
# Request / Response Schemas
# -------------------------------------------------------------------------

class ClientContactCreateRequest(BaseModel):
    client_id: str = Field(description="Target client organization slug, e.g. anr_group")
    name: str = Field(description="Full name, e.g. Kwame Mensah")
    email: str = Field(description="Email address")
    phone: Optional[str] = Field(default=None, description="Phone or WhatsApp number")
    role: str = Field(default="CFO", description="CFO, Financial_Controller, Managing_Director, Operations_Lead, Internal_Accountant")
    notification_channel: str = Field(default="both", description="email, whatsapp, both")
    notes: Optional[str] = None
    send_invitation: bool = Field(default=True, description="Whether to dispatch invitation email immediately")


class ClientContactUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    portal_status: Optional[str] = None
    notification_channel: Optional[str] = None
    notes: Optional[str] = None


class FirmTeamMemberCreateRequest(BaseModel):
    name: str = Field(description="Staff full name, e.g. Abena Boateng")
    email: str = Field(description="Staff corporate email")
    phone: Optional[str] = None
    role: str = Field(default="SENIOR_ACCOUNTANT", description="PARTNER, SENIOR_ACCOUNTANT, STAFF_ACCOUNTANT, AUDITOR")
    assigned_client_ids: List[str] = Field(default_factory=lambda: ["*"], description="List of client IDs managed or ['*'] for all")
    permissions: Optional[Dict[str, bool]] = None
    send_invitation: bool = Field(default=True, description="Whether to dispatch welcome email")


class FirmTeamMemberUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    assigned_client_ids: Optional[List[str]] = None
    permissions: Optional[Dict[str, bool]] = None


# -------------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------------

def _sync_client_team_members(session: Session, client_id: str):
    """Synchronizes ClientContact records back into ClientOrganization.team_members JSON for legacy compatibility."""
    client = session.exec(select(ClientOrganization).where(ClientOrganization.id == client_id)).first()
    if not client:
        return
    contacts = session.exec(select(ClientContact).where(ClientContact.client_id == client_id)).all()
    client.team_members = [
        {
            "id": f"cnt_{c.id}",
            "name": c.name,
            "email": c.email,
            "phone": c.phone or "",
            "role": c.role,
            "portal_status": c.portal_status,
            "notifications": {
                "executive_digest": True,
                "critical_anomalies": True,
                "staged_approvals": True,
                "channel": c.notification_channel,
            },
        }
        for c in contacts
    ]
    session.add(client)


async def _dispatch_client_portal_invite(
    contact: ClientContact,
    client_name: str,
    magic_url: str,
    firm_name: str = "S4 Accounting & Advisory Partners",
) -> bool:
    """Sends a branded invitation email to a client stakeholder for information requests."""
    subject = f"📨 [Portal Invite] Access the {client_name} Accounting & Information Requests Portal"
    html_content = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f8fafc; padding: 28px; border-radius: 16px; max-width: 600px; margin: 0 auto; border: 1px solid #1e293b;">
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; background: rgba(56, 189, 248, 0.15); border: 1px solid #38bdf8; padding: 8px 16px; border-radius: 9999px; font-size: 12px; font-weight: bold; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em;">
                Information Requests Portal
            </div>
            <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin: 16px 0 6px 0;">
                Welcome, {contact.name}
            </h1>
            <p style="color: #94a3b8; font-size: 14px; margin: 0;">
                Your accounting team at <strong>{firm_name}</strong> has invited you to the client portal for <strong>{client_name}</strong>.
            </p>
        </div>

        <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid #334155; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
            <h3 style="color: #38bdf8; font-size: 13px; font-weight: 700; text-transform: uppercase; margin-top: 0; margin-bottom: 8px;">
                Your Role: {contact.role.replace('_', ' ')}
            </h3>
            <p style="color: #cbd5e1; font-size: 13px; line-height: 1.6; margin: 0;">
                Use the portal to answer accountant clarification queries on bank feeds, upload missing invoices or receipts, and keep <strong>{client_name}</strong>'s books accurate and up to date.
            </p>
        </div>

        <div style="text-align: center; margin: 28px 0;">
            <a href="{magic_url}" style="background: linear-gradient(135deg, #0284c7, #4f46e5); color: #ffffff; padding: 14px 32px; border-radius: 10px; font-weight: 700; text-decoration: none; display: inline-block; font-size: 14px; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);">
                Open Client Portal (1-Click Access) →
            </a>
        </div>

        <p style="color: #64748b; font-size: 12px; line-height: 1.5; text-align: center; margin: 0;">
            This magic link provides direct, passwordless access for 72 hours. Alternatively, you can log in at any time with an email OTP code.
        </p>
        <div style="border-top: 1px solid #1e293b; margin-top: 24px; padding-top: 16px; text-align: center; color: #475569; font-size: 11px;">
            S4 Automations • Chartered Accounting &amp; Workflow Intelligence
        </div>
    </div>
    """
    return await MailjetService.send_email(
        to_email=contact.email,
        subject=subject,
        html_content=html_content,
        text_content=f"Welcome {contact.name}! Open your {client_name} portal: {magic_url}",
        recipient_name=contact.name,
    )


async def _dispatch_firm_team_invite(
    member: FirmTeamMember,
    firm_name: str = "S4 Accounting & Advisory Partners",
) -> bool:
    """Sends a welcome email to a new accounting firm staff member."""
    subject = f"🤝 Welcome to {firm_name} Client Management Team"
    portal_url = "http://localhost:5173"
    html_content = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f8fafc; padding: 28px; border-radius: 16px; max-width: 600px; margin: 0 auto; border: 1px solid #1e293b;">
        <h1 style="color: #ffffff; font-size: 20px; font-weight: 800; margin-top: 0;">
            Welcome to the Practice, {member.name}
        </h1>
        <p style="color: #94a3b8; font-size: 14px;">
            You have been invited to join the accounting and client management team at <strong>{firm_name}</strong> as a <strong>{member.role.replace('_', ' ')}</strong>.
        </p>
        <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid #334155; border-radius: 12px; padding: 16px; margin: 20px 0;">
            <p style="color: #38bdf8; font-size: 12px; font-weight: bold; margin: 0 0 6px 0; text-transform: uppercase;">
                Your Assigned Client Scope:
            </p>
            <p style="color: #ffffff; font-size: 14px; font-family: monospace; margin: 0;">
                {', '.join(member.assigned_client_ids) if member.assigned_client_ids != ['*'] else 'All Firm Clients (Global)'}
            </p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
            <a href="{portal_url}" style="background: #0284c7; color: #ffffff; padding: 12px 28px; border-radius: 8px; font-weight: 700; text-decoration: none; display: inline-block;">
                Launch Management Console →
            </a>
        </div>
    </div>
    """
    return await MailjetService.send_email(
        to_email=member.email,
        subject=subject,
        html_content=html_content,
        text_content=f"Welcome {member.name}! Access {firm_name} portal at {portal_url}",
        recipient_name=member.name,
    )


# -------------------------------------------------------------------------
# Summary Metrics Endpoint
# -------------------------------------------------------------------------

@router.get("/stats", summary="Get Contact & Team Management Summary Statistics")
async def get_contact_stats(
    organization_id: str = Query("s4_advisory", description="Accounting firm slug ID"),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Returns top-level metric counters for client contacts and firm team members."""
    client_contacts = db.exec(select(ClientContact).where(ClientContact.organization_id == organization_id)).all()
    firm_members = db.exec(select(FirmTeamMember).where(FirmTeamMember.organization_id == organization_id)).all()

    total_client_contacts = len(client_contacts)
    active_portal_contacts = sum(1 for c in client_contacts if c.portal_status == "ACTIVE")
    pending_invites = sum(1 for c in client_contacts if c.portal_status == "INVITED") + sum(1 for m in firm_members if m.status == "INVITED")
    total_firm_members = len(firm_members)

    return {
        "success": True,
        "total_client_contacts": total_client_contacts,
        "active_portal_contacts": active_portal_contacts,
        "pending_invites": pending_invites,
        "total_firm_members": total_firm_members,
    }


# -------------------------------------------------------------------------
# Client Contacts (Information Request Stakeholders) Endpoints
# -------------------------------------------------------------------------

@router.get("/client-contacts", summary="List Client Contacts for Information Requests")
async def list_client_contacts(
    client_id: Optional[str] = Query(None, description="Filter by client organization slug"),
    organization_id: str = Query("s4_advisory", description="Managing accounting firm ID"),
    status: Optional[str] = Query("ALL", description="ALL, ACTIVE, INVITED, INACTIVE"),
    search: Optional[str] = Query(None, description="Search name, email, or role"),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Lists client contacts with enriched client organization names and active magic link URLs."""
    query = select(ClientContact).where(ClientContact.organization_id == organization_id)
    if client_id and client_id != "ALL":
        query = query.where(ClientContact.client_id == client_id)
    if status and status != "ALL":
        query = query.where(ClientContact.portal_status == status)

    contacts = db.exec(query.order_by(ClientContact.created_at.desc())).all()

    # Pre-fetch client organizations to display client names
    clients = db.exec(select(ClientOrganization)).all()
    client_name_map = {c.id: c.name for c in clients}

    results = []
    search_clean = search.strip().lower() if search else None

    for c in contacts:
        c_client_name = client_name_map.get(c.client_id, c.client_id)
        if search_clean:
            match_name = search_clean in c.name.lower()
            match_email = search_clean in c.email.lower()
            match_role = search_clean in c.role.lower()
            match_client = search_clean in c_client_name.lower()
            if not (match_name or match_email or match_role or match_client):
                continue

        # Ensure magic link token
        magic_tok = c.magic_token or generate_magic_link_token(c.client_id, c_client_name, None)
        magic_url = f"http://localhost:5173/?portal_magic={magic_tok}"

        item = c.model_dump()
        item["client_name"] = c_client_name
        item["magic_url"] = magic_url
        results.append(item)

    return {
        "success": True,
        "count": len(results),
        "contacts": results,
    }


@router.post("/client-contacts", summary="Invite Client Contact for Information Requests")
async def invite_client_contact(
    payload: ClientContactCreateRequest,
    organization_id: str = Query("s4_advisory", description="Managing accounting firm ID"),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Invites a client contact to the Information Requests Portal.
    Generates a 72-hour 1-click magic link, saves the contact, and sends an invitation email.
    """
    client = db.exec(select(ClientOrganization).where(ClientOrganization.id == payload.client_id)).first()
    if not client:
        raise HTTPException(status_code=404, detail=f"Client organization '{payload.client_id}' not found.")

    firm_org = db.exec(select(Organization).where(Organization.id == organization_id)).first()
    firm_name = firm_org.name if firm_org else "S4 Accounting & Advisory Partners"

    # Check if contact email already exists for this client
    existing = db.exec(
        select(ClientContact).where(
            ClientContact.client_id == payload.client_id,
            ClientContact.email == payload.email.strip().lower(),
        )
    ).first()

    magic_token = generate_magic_link_token(client.id, client.name, None)
    magic_url = f"http://localhost:5173/?portal_magic={magic_token}"

    if existing:
        existing.name = payload.name.strip()
        existing.phone = payload.phone.strip() if payload.phone else existing.phone
        existing.role = payload.role
        existing.notification_channel = payload.notification_channel
        existing.notes = payload.notes or existing.notes
        existing.magic_token = magic_token
        existing.portal_status = "INVITED"
        existing.invite_sent_at = datetime.now(timezone.utc)
        existing.updated_at = datetime.now(timezone.utc)
        db.add(existing)
        target_contact = existing
    else:
        target_contact = ClientContact(
            client_id=client.id,
            organization_id=organization_id,
            name=payload.name.strip(),
            email=payload.email.strip().lower(),
            phone=payload.phone.strip() if payload.phone else None,
            role=payload.role,
            portal_status="INVITED",
            magic_token=magic_token,
            invite_sent_at=datetime.now(timezone.utc),
            notification_channel=payload.notification_channel,
            notes=payload.notes,
        )
        db.add(target_contact)

    db.commit()
    db.refresh(target_contact)

    # Synchronize to client.team_members JSON
    _sync_client_team_members(db, client.id)
    db.commit()

    # Dispatch branded invite email if requested
    email_sent = False
    if payload.send_invitation:
        try:
            email_sent = await _dispatch_client_portal_invite(
                contact=target_contact,
                client_name=client.name,
                magic_url=magic_url,
                firm_name=firm_name,
            )
        except Exception as e:
            logger.warning(f"Could not dispatch portal invite email: {e}")

    AuditService.log(
        client_id=client.id,
        action="CLIENT_CONTACT_INVITED",
        details={
            "contact_id": target_contact.id,
            "name": target_contact.name,
            "email": target_contact.email,
            "role": target_contact.role,
            "email_sent": email_sent,
        },
    )

    return {
        "success": True,
        "contact": target_contact.model_dump(),
        "client_name": client.name,
        "magic_url": magic_url,
        "email_sent": email_sent,
        "message": f"Successfully invited {target_contact.name} ({target_contact.role}) to {client.name} portal.",
    }


@router.post("/client-contacts/{contact_id}/resend-invite", summary="Resend Portal Invite Email to Client Contact")
async def resend_client_contact_invite(
    contact_id: int,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Generates a fresh 72-hour magic link and dispatches an invitation email."""
    contact = db.exec(select(ClientContact).where(ClientContact.id == contact_id)).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Client contact not found.")

    client = db.exec(select(ClientOrganization).where(ClientOrganization.id == contact.client_id)).first()
    client_name = client.name if client else contact.client_id

    magic_token = generate_magic_link_token(contact.client_id, client_name, None)
    magic_url = f"http://localhost:5173/?portal_magic={magic_token}"

    contact.magic_token = magic_token
    contact.invite_sent_at = datetime.now(timezone.utc)
    contact.portal_status = "INVITED"
    contact.updated_at = datetime.now(timezone.utc)
    db.add(contact)
    db.commit()
    db.refresh(contact)

    email_sent = await _dispatch_client_portal_invite(
        contact=contact,
        client_name=client_name,
        magic_url=magic_url,
    )

    return {
        "success": True,
        "contact": contact.model_dump(),
        "magic_url": magic_url,
        "email_sent": email_sent,
        "message": f"Resent invitation to {contact.email}.",
    }


@router.put("/client-contacts/{contact_id}", summary="Update Client Contact Details")
async def update_client_contact(
    contact_id: int,
    payload: ClientContactUpdateRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Updates contact properties and synchronizes client profile."""
    contact = db.exec(select(ClientContact).where(ClientContact.id == contact_id)).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Client contact not found.")

    if payload.name is not None:
        contact.name = payload.name.strip()
    if payload.email is not None:
        contact.email = payload.email.strip().lower()
    if payload.phone is not None:
        contact.phone = payload.phone.strip()
    if payload.role is not None:
        contact.role = payload.role
    if payload.portal_status is not None:
        contact.portal_status = payload.portal_status
    if payload.notification_channel is not None:
        contact.notification_channel = payload.notification_channel
    if payload.notes is not None:
        contact.notes = payload.notes

    contact.updated_at = datetime.now(timezone.utc)
    db.add(contact)
    db.commit()
    db.refresh(contact)

    _sync_client_team_members(db, contact.client_id)
    db.commit()

    return {
        "success": True,
        "contact": contact.model_dump(),
        "message": f"Updated contact {contact.name}.",
    }


@router.delete("/client-contacts/{contact_id}", summary="Delete or Revoke Client Contact")
async def delete_client_contact(
    contact_id: int,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Revokes client contact portal access and removes contact record."""
    contact = db.exec(select(ClientContact).where(ClientContact.id == contact_id)).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Client contact not found.")

    client_id = contact.client_id
    db.delete(contact)
    db.commit()

    _sync_client_team_members(db, client_id)
    db.commit()

    return {
        "success": True,
        "message": f"Removed contact {contact.name} from client {client_id}.",
    }


# -------------------------------------------------------------------------
# Firm Team Members (Client Management Practice) Endpoints
# -------------------------------------------------------------------------

@router.get("/team-members", summary="List Accounting Firm Team Members")
async def list_firm_team_members(
    organization_id: str = Query("s4_advisory", description="Accounting firm slug ID"),
    search: Optional[str] = Query(None, description="Search staff name, email, or role"),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Lists accounting firm team members participating in client management."""
    query = select(FirmTeamMember).where(FirmTeamMember.organization_id == organization_id)
    members = db.exec(query.order_by(FirmTeamMember.created_at.asc())).all()

    search_clean = search.strip().lower() if search else None
    results = []
    for m in members:
        if search_clean:
            match_name = search_clean in m.name.lower()
            match_email = search_clean in m.email.lower()
            match_role = search_clean in m.role.lower()
            if not (match_name or match_email or match_role):
                continue
        results.append(m.model_dump())

    return {
        "success": True,
        "count": len(results),
        "team_members": results,
    }


@router.post("/team-members", summary="Invite Firm Team Member to Manage Clients")
async def invite_firm_team_member(
    payload: FirmTeamMemberCreateRequest,
    organization_id: str = Query("s4_advisory", description="Accounting firm slug ID"),
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Invites an internal staff member to participate in client management."""
    existing = db.exec(
        select(FirmTeamMember).where(
            FirmTeamMember.organization_id == organization_id,
            FirmTeamMember.email == payload.email.strip().lower(),
        )
    ).first()

    default_perms = {
        "can_query_clients": True,
        "can_categorize": True,
        "can_sync_accounting": payload.role in ["PARTNER", "SENIOR_ACCOUNTANT"],
        "can_manage_clients": payload.role == "PARTNER",
    }
    merged_perms = {**default_perms, **(payload.permissions or {})}

    if existing:
        existing.name = payload.name.strip()
        existing.phone = payload.phone.strip() if payload.phone else existing.phone
        existing.role = payload.role
        existing.assigned_client_ids = payload.assigned_client_ids
        existing.permissions = merged_perms
        existing.status = "INVITED"
        existing.invite_sent_at = datetime.now(timezone.utc)
        existing.updated_at = datetime.now(timezone.utc)
        db.add(existing)
        target_member = existing
    else:
        target_member = FirmTeamMember(
            organization_id=organization_id,
            name=payload.name.strip(),
            email=payload.email.strip().lower(),
            phone=payload.phone.strip() if payload.phone else None,
            role=payload.role,
            status="INVITED",
            assigned_client_ids=payload.assigned_client_ids,
            permissions=merged_perms,
            invite_sent_at=datetime.now(timezone.utc),
        )
        db.add(target_member)

    db.commit()
    db.refresh(target_member)

    # Send welcome email if requested
    email_sent = False
    if payload.send_invitation:
        try:
            email_sent = await _dispatch_firm_team_invite(target_member)
        except Exception as e:
            logger.warning(f"Could not dispatch firm team invite email: {e}")

    return {
        "success": True,
        "team_member": target_member.model_dump(),
        "email_sent": email_sent,
        "message": f"Invited {target_member.name} ({target_member.role}) to firm management team.",
    }


@router.post("/team-members/{member_id}/resend-invite", summary="Resend Welcome Email to Firm Team Member")
async def resend_firm_team_member_invite(
    member_id: int,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Resends a welcome email to a firm team member."""
    member = db.exec(select(FirmTeamMember).where(FirmTeamMember.id == member_id)).first()
    if not member:
        raise HTTPException(status_code=404, detail="Firm team member not found.")

    member.invite_sent_at = datetime.now(timezone.utc)
    member.updated_at = datetime.now(timezone.utc)
    db.add(member)
    db.commit()
    db.refresh(member)

    email_sent = await _dispatch_firm_team_invite(member)
    return {
        "success": True,
        "team_member": member.model_dump(),
        "email_sent": email_sent,
        "message": f"Resent welcome invite to {member.email}.",
    }


@router.put("/team-members/{member_id}", summary="Update Firm Team Member Scope & Permissions")
async def update_firm_team_member(
    member_id: int,
    payload: FirmTeamMemberUpdateRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Updates role, assigned clients, and feature permissions for a staff member."""
    member = db.exec(select(FirmTeamMember).where(FirmTeamMember.id == member_id)).first()
    if not member:
        raise HTTPException(status_code=404, detail="Firm team member not found.")

    if payload.name is not None:
        member.name = payload.name.strip()
    if payload.email is not None:
        member.email = payload.email.strip().lower()
    if payload.phone is not None:
        member.phone = payload.phone.strip()
    if payload.role is not None:
        member.role = payload.role
    if payload.status is not None:
        member.status = payload.status
    if payload.assigned_client_ids is not None:
        member.assigned_client_ids = payload.assigned_client_ids
    if payload.permissions is not None:
        member.permissions = payload.permissions

    member.updated_at = datetime.now(timezone.utc)
    db.add(member)
    db.commit()
    db.refresh(member)

    return {
        "success": True,
        "team_member": member.model_dump(),
        "message": f"Updated team member {member.name}.",
    }


@router.delete("/team-members/{member_id}", summary="Remove Firm Team Member")
async def delete_firm_team_member(
    member_id: int,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Removes a team member from the accounting practice."""
    member = db.exec(select(FirmTeamMember).where(FirmTeamMember.id == member_id)).first()
    if not member:
        raise HTTPException(status_code=404, detail="Firm team member not found.")

    db.delete(member)
    db.commit()

    return {
        "success": True,
        "message": f"Removed team member {member.name}.",
    }
