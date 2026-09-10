export interface ClientContact {
  id: number;
  client_id: string;
  client_name?: string;
  organization_id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'CFO' | 'Financial_Controller' | 'Managing_Director' | 'Operations_Lead' | 'Internal_Accountant' | string;
  portal_status: 'ACTIVE' | 'INVITED' | 'INACTIVE';
  magic_token?: string;
  magic_url?: string;
  invite_sent_at?: string;
  last_active_at?: string;
  notification_channel: 'email' | 'whatsapp' | 'both';
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface FirmTeamMember {
  id: number;
  organization_id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'PARTNER' | 'SENIOR_ACCOUNTANT' | 'STAFF_ACCOUNTANT' | 'AUDITOR' | string;
  status: 'ACTIVE' | 'INVITED' | 'INACTIVE';
  assigned_client_ids: string[];
  permissions: {
    can_query_clients?: boolean;
    can_categorize?: boolean;
    can_sync_accounting?: boolean;
    can_manage_clients?: boolean;
    [key: string]: boolean | undefined;
  };
  invite_sent_at?: string;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ContactStats {
  total_client_contacts: number;
  active_portal_contacts: number;
  pending_invites: number;
  total_firm_members: number;
}

export interface InviteClientContactPayload {
  client_id: string;
  name: string;
  email: string;
  phone?: string;
  role?: string;
  notification_channel?: 'email' | 'whatsapp' | 'both';
  notes?: string;
  send_invitation?: boolean;
}

export interface InviteTeamMemberPayload {
  name: string;
  email: string;
  phone?: string;
  role: string;
  assigned_client_ids: string[];
  permissions?: Record<string, boolean>;
  send_invitation?: boolean;
}
