export type ClientStatus = 'live' | 'dev' | 'pending';

export interface BlueprintStep {
  title: string;
  desc: string;
  status: 'active' | 'in_progress' | 'queued';
}

export interface ClientProfile {
  id: string;
  name: string;
  industry: string;
  icon: string;
  status: ClientStatus;
  statusText: string;
  desc: string;
  folderId?: string;
  zohoOrg?: string;
  workflowsCount: number;
  projectedMonthlyVolume: string;
  activeIntegrations: string[];
  blueprints: BlueprintStep[];
}
