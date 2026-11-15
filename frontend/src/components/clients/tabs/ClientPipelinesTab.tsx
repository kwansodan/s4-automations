import React, { useState, useEffect, useCallback } from 'react';
import { useClient } from '../../../context/ClientContext';
import { useAutomation } from '../../../context/AutomationContext';
import { useErrors } from '../../../context/ErrorContext';
import {
  triggerClientAgent,
  fetchClientKnowledge,
  saveClientKnowledgeEntry,
  teachClientKnowledge,
  toggleClientKnowledgeEntry,
  deleteClientKnowledgeEntry,
  fetchAgentMessages,
  sendAgentMessage,
  fetchTenantWhatsAppConfig,
  saveTenantWhatsAppConfig,
  executeAgentGoal,
  fetchAgentRuns,
  updateAgentAutonomyPolicy,
  triggerAgentHeartbeat,
} from '../../../lib/api';
import type {
  IngestionPipeline,
  PipelineRunSummary,
  AccountingSection,
  ClientKnowledgeEntry,
  ClientKnowledgeSummary,
  AgentMessageItem,
  TenantWhatsAppConfig,
  AgentAutonomyLevel,
  AgentExecutionRun,
} from '../../../types/client';
import { PipelineSetupWizardModal } from '../../modals/PipelineSetupWizardModal';
import { StreamExecutionResultModal } from '../../modals/StreamExecutionResultModal';
import {
  Bot,
  Plus,
  PlayCircle,
  RefreshCw,
  Edit3,
  Trash2,
  Clock,
  Zap,
  Mail,
  Landmark,
  MessageSquare,
  Brain,
  Copy,
  Check,
  Send,
  Phone,
  Sparkles,
  Search,
  ShieldCheck,
  Globe,
  ExternalLink,
  CheckCircle2,
  ToggleLeft,
  ToggleRight,
  SlidersHorizontal,
  Activity,
  ChevronDown,
  ChevronUp,
  Terminal,
  Shield,
  Scale,
  BarChart3,
} from 'lucide-react';

type AgentHubSubView = 'agents' | 'comms' | 'runs' | 'knowledge';

const KNOWLEDGE_CATEGORIES = [
  { id: 'ALL', label: 'All Categories' },
  { id: 'ENTITY_ALIAS', label: 'Customer / Vendor Alias' },
  { id: 'SKU_PRICING_RULE', label: 'SKU & Pricing Rule' },
  { id: 'COA_MAPPING_RULE', label: 'Account Mapping Rule' },
  { id: 'TAX_AND_COMPLIANCE', label: 'Tax & Compliance' },
  { id: 'WORKFLOW_SOP', label: 'Workflow SOP' },
  { id: 'DOMAIN_FACT', label: 'Client Domain Fact' },
];

function formatDefaultAgentEmail(clientId: string, agent: IngestionPipeline): string {
  if (agent.agent_email) return agent.agent_email;
  const cleanClient = (clientId || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cleanSection = (agent.section || 'ar').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const rawSlug = (agent.name || agent.id || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return `${cleanClient}.${cleanSection}-${rawSlug || 'agent'}@agents.s4automations.com`;
}

function formatDefaultRoutingTag(clientId: string, agent: IngestionPipeline): string {
  if (agent.whatsapp_routing_tag) return agent.whatsapp_routing_tag;
  const cleanClient = (clientId || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const cleanSection = (agent.section || 'ar').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `@${cleanClient}-${cleanSection}`;
}

export const ClientPipelinesTab: React.FC = () => {
  const { currentClient, deletePipeline, savePipeline, updatePipelineLastRun, refreshClients } = useClient();
  const { selectedMonth, selectedYear, addLog } = useAutomation();
  const { reportError, syncServerIssuesNow } = useErrors();

  const [subView, setSubView] = useState<AgentHubSubView>('agents');
  const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<IngestionPipeline | null>(null);
  const [modalDefaultSection, setModalDefaultSection] = useState<AccountingSection>('AR');
  const [triggeringPipeId, setTriggeringPipeId] = useState<string | null>(null);
  const [activeRunSummary, setActiveRunSummary] = useState<PipelineRunSummary | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const agents = currentClient.agents || currentClient.pipelines || [];

  // ---------------------------------------------------------------------------
  // Agent Communications & Multi-Tenant WhatsApp State
  // ---------------------------------------------------------------------------
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => agents[0]?.id || '');
  const [channelFilter, setChannelFilter] = useState<'ALL' | 'EMAIL' | 'WHATSAPP' | 'IN_APP'>('ALL');
  const [messages, setMessages] = useState<AgentMessageItem[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [composeChannel, setComposeChannel] = useState<'IN_APP' | 'EMAIL' | 'WHATSAPP'>('IN_APP');
  const [composeSender, setComposeSender] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const [waConfig, setWaConfig] = useState<TenantWhatsAppConfig | null>(null);
  const [waMode, setWaMode] = useState<'platform_shared' | 'dedicated_meta' | 'dedicated_twilio'>('platform_shared');
  const [waPhone, setWaPhone] = useState('');
  const [waPhoneId, setWaPhoneId] = useState('');
  const [waWabaId, setWaWabaId] = useState('');
  const [waAccessToken, setWaAccessToken] = useState('');
  const [waVerifyToken, setWaVerifyToken] = useState('');
  const [twilioSid, setTwilioSid] = useState('');
  const [twilioToken, setTwilioToken] = useState('');
  const [isSavingWaConfig, setIsSavingWaConfig] = useState(false);
  const [showWaSetupModal, setShowWaSetupModal] = useState(false);

  // ---------------------------------------------------------------------------
  // Client Knowledge Base Studio State
  // ---------------------------------------------------------------------------
  const [knowledgeEntries, setKnowledgeEntries] = useState<ClientKnowledgeEntry[]>([]);
  const [knowledgeSummary, setKnowledgeSummary] = useState<ClientKnowledgeSummary | null>(null);
  const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false);
  const [knowledgeCategoryFilter, setKnowledgeCategoryFilter] = useState<string>('ALL');
  const [knowledgeSearch, setKnowledgeSearch] = useState<string>('');
  const [teachText, setTeachText] = useState<string>('');
  const [teachAgentScope, setTeachAgentScope] = useState<string>('');
  const [isTeaching, setIsTeaching] = useState<boolean>(false);
  const [showAddRuleForm, setShowAddRuleForm] = useState<boolean>(false);
  const [newRuleCategory, setNewRuleCategory] = useState<string>('COA_MAPPING_RULE');
  const [newRuleKey, setNewRuleKey] = useState<string>('');
  const [newRuleValue, setNewRuleValue] = useState<string>('');
  const [newRuleNatural, setNewRuleNatural] = useState<string>('');
  const [isSavingRule, setIsSavingRule] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // True Agentic Control Center State (Reasoning Runs, Goals, Autonomy Policy)
  // ---------------------------------------------------------------------------
  const [agentRuns, setAgentRuns] = useState<AgentExecutionRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState<boolean>(false);
  const [goalInput, setGoalInput] = useState<string>('');
  const [isExecutingGoal, setIsExecutingGoal] = useState<boolean>(false);
  const [isRunningHeartbeat, setIsRunningHeartbeat] = useState<boolean>(false);
  const [updatingAutonomyId, setUpdatingAutonomyId] = useState<string | null>(null);
  const [expandedReceipts, setExpandedReceipts] = useState<Record<string | number, boolean>>({});

  useEffect(() => {
    if (agents.length > 0 && (!selectedAgentId || !agents.some((a) => a.id === selectedAgentId))) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  const copyToClipboard = (text: string, key: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Load Tenant WhatsApp Config
  const loadWhatsAppConfig = useCallback(async () => {
    if (!currentClient?.id) return;
    try {
      const cfg = await fetchTenantWhatsAppConfig(currentClient.id);
      setWaConfig(cfg);
      setWaMode(cfg.whatsapp_mode || 'platform_shared');
      setWaPhone(cfg.whatsapp_phone_number || '');
      setWaPhoneId(cfg.whatsapp_phone_number_id || '');
      setWaWabaId(cfg.whatsapp_waba_id || '');
      setWaVerifyToken(cfg.whatsapp_verify_token || '');
      setTwilioSid(cfg.twilio_account_sid || '');
    } catch (err) {
      console.warn('Could not load WhatsApp config:', err);
    }
  }, [currentClient?.id]);

  // Load Agent Messages
  const loadAgentMessages = useCallback(async () => {
    if (!currentClient?.id || !selectedAgentId) return;
    setIsLoadingMessages(true);
    try {
      const res = await fetchAgentMessages(currentClient.id, selectedAgentId, channelFilter);
      setMessages(res.messages || []);
    } catch (err) {
      console.warn('Could not load agent messages:', err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [currentClient?.id, selectedAgentId, channelFilter]);

  // Load Agent ReAct Runs
  const loadAgentRuns = useCallback(async (overrideAgentId?: string) => {
    const targetAgentId = overrideAgentId || selectedAgentId;
    if (!currentClient?.id || !targetAgentId) return;
    setIsLoadingRuns(true);
    try {
      const res = await fetchAgentRuns(currentClient.id, targetAgentId, 30);
      setAgentRuns(res.runs || []);
    } catch (err) {
      console.warn('Could not load agent reasoning runs:', err);
    } finally {
      setIsLoadingRuns(false);
    }
  }, [currentClient?.id, selectedAgentId]);

  // Load Client Knowledge Base
  const loadKnowledge = useCallback(async () => {
    if (!currentClient?.id) return;
    setIsLoadingKnowledge(true);
    try {
      const res = await fetchClientKnowledge(currentClient.id, {
        category: knowledgeCategoryFilter !== 'ALL' ? knowledgeCategoryFilter : undefined,
        search: knowledgeSearch.trim() || undefined,
      });
      setKnowledgeEntries(res.entries || []);
      setKnowledgeSummary(res.summary || null);
    } catch (err) {
      console.warn('Could not load client knowledge:', err);
    } finally {
      setIsLoadingKnowledge(false);
    }
  }, [currentClient?.id, knowledgeCategoryFilter, knowledgeSearch]);

  useEffect(() => {
    setAgentRuns([]);
  }, [currentClient?.id]);

  useEffect(() => {
    loadWhatsAppConfig();
    loadKnowledge();
  }, [loadWhatsAppConfig, loadKnowledge]);

  useEffect(() => {
    if (selectedAgentId) {
      loadAgentRuns();
    }
  }, [selectedAgentId, loadAgentRuns]);

  useEffect(() => {
    if (subView === 'comms' && selectedAgentId) {
      loadAgentMessages();
    }
    if (subView === 'runs' && selectedAgentId) {
      loadAgentRuns();
    }
  }, [subView, selectedAgentId, channelFilter, loadAgentMessages, loadAgentRuns]);

  const handleExecuteGoal = async (overrideGoal?: string) => {
    const effGoal = (overrideGoal !== undefined ? overrideGoal : goalInput).trim();
    if (!currentClient?.id || !selectedAgentId || !effGoal) return;
    setIsExecutingGoal(true);
    try {
      const res = await executeAgentGoal(currentClient.id, selectedAgentId, {
        goal: effGoal,
        month: selectedMonth,
        year: selectedYear,
        explicit_human_command: true,
      });
      if (overrideGoal === undefined) {
        setGoalInput('');
      }
      addLog(
        res.run?.status === 'FAILED' ? 'error' : 'success',
        `[AGENT RUN ${res.run?.run_id}] ${res.run?.status}: ${res.run?.actions_taken_count || 0} tool action(s) executed.`
      );
      await loadAgentRuns();
      await loadKnowledge();
      await refreshClients();
    } catch (err: any) {
      addLog('error', `Failed to execute agent goal: ${err.message}`);
    } finally {
      setIsExecutingGoal(false);
    }
  };

  const handleRunHeartbeatSweep = async () => {
    if (!currentClient?.id) return;
    setIsRunningHeartbeat(true);
    try {
      const res = await triggerAgentHeartbeat({
        client_id: currentClient.id,
        force: true,
        month: selectedMonth,
        year: selectedYear,
      });
      addLog(
        'success',
        `[HEARTBEAT SWEEP] Evaluated ${res.agents_evaluated} agent(s), executed ${res.runs_executed} autonomous cycle(s).`
      );
      await loadAgentRuns();
      await refreshClients();
    } catch (err: any) {
      addLog('error', `Failed heartbeat sweep: ${err.message}`);
    } finally {
      setIsRunningHeartbeat(false);
    }
  };

  const handleUpdateQuickAutonomy = async (agentId: string, level: AgentAutonomyLevel) => {
    if (!currentClient?.id) return;
    setUpdatingAutonomyId(agentId);
    try {
      await updateAgentAutonomyPolicy(currentClient.id, agentId, { autonomy_level: level });
      addLog('success', `Updated autonomy policy for agent "${agentId}" to ${level}.`);
      await refreshClients();
    } catch (err: any) {
      addLog('error', `Failed updating autonomy policy: ${err.message}`);
    } finally {
      setUpdatingAutonomyId(null);
    }
  };

  const handleOpenNewPipeline = (sec: AccountingSection | React.MouseEvent = 'AR') => {
    setEditingPipeline(null);
    setModalDefaultSection(typeof sec === 'string' ? sec : 'AR');
    setIsPipelineModalOpen(true);
  };

  const handleOpenEditPipeline = (pipe: IngestionPipeline) => {
    setEditingPipeline(pipe);
    setIsPipelineModalOpen(true);
  };

  const handleSavePipelineSubmit = async (pipelineData: IngestionPipeline) => {
    await savePipeline(currentClient.id, pipelineData);
    await refreshClients();
    addLog('success', `Saved autonomous agent: "${pipelineData.name}"`);
  };

  const handleDeletePipelineSubmit = async (pipelineId: string, pipelineName: string) => {
    if (!confirm(`Are you sure you want to delete agent "${pipelineName}"?`)) return;
    try {
      await deletePipeline(currentClient.id, pipelineId);
      addLog('info', `Deleted agent "${pipelineName}" for ${currentClient.name}`);
    } catch (err: any) {
      addLog('error', `Failed to delete agent: ${err.message}`);
    }
  };

  const handleTriggerStream = async (pipelineId: string, pipelineName: string, forceReprocess: boolean = false) => {
    setTriggeringPipeId(pipelineId);
    addLog('info', `[AGENT] Running "${pipelineName}" (${selectedMonth} ${selectedYear})${forceReprocess ? ' [Force Reprocess]' : ''}...`);
    try {
      const result = await triggerClientAgent(currentClient.id, pipelineId, {
        month: selectedMonth,
        year: selectedYear,
        force_reprocess: forceReprocess,
      });

      const summary: PipelineRunSummary = result.last_run_summary || {
        pipeline_id: pipelineId,
        pipeline_name: pipelineName,
        triggered_at: new Date().toISOString(),
        month: selectedMonth,
        year: selectedYear,
        status: result.status,
        summary_message: result.summary_message || result.message || 'Agent finished execution.',
        sources_discovered: result.sources_discovered || 0,
        duplicates_skipped: result.duplicates_skipped || 0,
        items_extracted: result.items_extracted || 0,
        auto_post: !!result.post_results && result.post_results.status !== 'SKIPPED',
        spreadsheet_url: result.spreadsheet_url,
        spreadsheet_id: result.spreadsheet_id,
        documents: result.documents,
        step_logs: result.step_logs,
        errors: result.errors,
        warnings: result.warnings,
      };

      setActiveRunSummary(summary);
      updatePipelineLastRun(currentClient.id, pipelineId, summary);

      if (result.status === 'FAILED' || (result.errors && result.errors.length > 0)) {
        const errorMsg = result.error_message || result.errors?.[0] || 'Agent execution failed';
        addLog('error', `Agent "${pipelineName}" failed: ${errorMsg}`);
        reportError({
          severity: 'error',
          category: 'pipeline',
          title: `Agent Failed: ${pipelineName}`,
          message: errorMsg,
          endpoint: `/api/v1/clients/${currentClient.id}/agents/${pipelineId}/trigger`,
          responseData: result,
          showToast: true,
        });
        await syncServerIssuesNow();
      } else if (result.status === 'COMPLETED_DUPLICATES_SKIPPED') {
        addLog('warning', `Agent "${pipelineName}": All ${result.sources_discovered} file(s) were previously processed and skipped as duplicates.`);
      } else if (result.status === 'WARNING' || (result.warnings && result.warnings.length > 0)) {
        addLog('warning', `Agent "${pipelineName}" completed with warnings: ${result.warnings?.join('; ')}`);
        reportError({
          severity: 'warning',
          category: 'pipeline',
          title: `Agent Warnings: ${pipelineName}`,
          message: result.warnings?.join('; ') || 'Agent completed with warnings.',
          responseData: result,
          showToast: true,
        });
        await syncServerIssuesNow();
      } else {
        addLog('success', `Agent "${pipelineName}": ${result.items_extracted || 0} item(s) extracted & staged.`);
      }
    } catch (err: any) {
      addLog('error', `Agent "${pipelineName}" execution failed: ${err.message}`);
      reportError({
        severity: 'error',
        category: 'pipeline',
        title: `Agent Error: ${pipelineName}`,
        message: err.message,
        endpoint: `/api/v1/clients/${currentClient.id}/agents/${pipelineId}/trigger`,
        showToast: true,
      });
      await syncServerIssuesNow();
    } finally {
      setTriggeringPipeId(null);
    }
  };

  // Send message to agent (Email / WhatsApp / In-App simulation & live AI response)
  const handleSendMessageToAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeText.trim() || !selectedAgentId) return;
    setIsSendingMessage(true);
    try {
      const res = await sendAgentMessage(currentClient.id, selectedAgentId, {
        message: composeText.trim(),
        channel: composeChannel,
        sender_address:
          composeSender.trim() ||
          (composeChannel === 'WHATSAPP' ? '+233240000000' : 'controller@client.com'),
        subject: composeSubject.trim() || undefined,
      });
      setComposeText('');
      addLog(
        'success',
        `[${res.channel}] Agent "${res.agent_name}" replied${
          res.learned_rules?.length ? ` and learned ${res.learned_rules.length} new rule(s)` : ''
        }.`
      );
      await loadAgentMessages();
      await loadAgentRuns();
      if (res.learned_rules && res.learned_rules.length > 0) {
        await loadKnowledge();
      }
    } catch (err: any) {
      addLog('error', `Failed to message agent: ${err.message}`);
    } finally {
      setIsSendingMessage(false);
    }
  };

  // Save Multi-Tenant WhatsApp Business Number Configuration
  const handleSaveWhatsAppConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingWaConfig(true);
    try {
      const updated = await saveTenantWhatsAppConfig(currentClient.id, {
        whatsapp_mode: waMode,
        whatsapp_phone_number: waPhone.trim(),
        whatsapp_phone_number_id: waPhoneId.trim(),
        whatsapp_waba_id: waWabaId.trim(),
        whatsapp_access_token: waAccessToken.trim() || undefined,
        whatsapp_verify_token: waVerifyToken.trim() || undefined,
        twilio_account_sid: twilioSid.trim() || undefined,
        twilio_auth_token: twilioToken.trim() || undefined,
      });
      setWaConfig(updated);
      setWaAccessToken('');
      setTwilioToken('');
      setShowWaSetupModal(false);
      await refreshClients();
      addLog('success', `Saved WhatsApp Business configuration (${waMode}) for ${currentClient.name}`);
    } catch (err: any) {
      addLog('error', `Failed to save WhatsApp configuration: ${err.message}`);
    } finally {
      setIsSavingWaConfig(false);
    }
  };

  // Teach Knowledge from Natural Language
  const handleTeachKnowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teachText.trim()) return;
    setIsTeaching(true);
    try {
      const res = await teachClientKnowledge(currentClient.id, {
        instruction_text: teachText.trim(),
        agent_id: teachAgentScope || null,
        source: 'MANUAL',
      });
      setTeachText('');
      addLog('success', `AI extracted and saved ${res.learned_count} client knowledge rule(s).`);
      await Promise.all([loadKnowledge(), loadAgentRuns()]);
    } catch (err: any) {
      addLog('error', `Failed to teach knowledge: ${err.message}`);
    } finally {
      setIsTeaching(false);
    }
  };

  // Save Structured Knowledge Entry
  const handleCreateStructuredRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleKey.trim() || !newRuleValue.trim()) return;
    setIsSavingRule(true);
    try {
      await saveClientKnowledgeEntry(currentClient.id, {
        category: newRuleCategory,
        rule_key: newRuleKey.trim(),
        rule_value: newRuleValue.trim(),
        natural_language_rule:
          newRuleNatural.trim() || `When matching '${newRuleKey.trim()}', apply '${newRuleValue.trim()}'.`,
        agent_id: teachAgentScope || null,
        source: 'MANUAL',
      });
      setNewRuleKey('');
      setNewRuleValue('');
      setNewRuleNatural('');
      setShowAddRuleForm(false);
      addLog('success', `Saved client knowledge rule: ${newRuleKey.trim()}`);
      await Promise.all([loadKnowledge(), loadAgentRuns()]);
    } catch (err: any) {
      addLog('error', `Failed to save rule: ${err.message}`);
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleToggleRule = async (entry: ClientKnowledgeEntry) => {
    try {
      await toggleClientKnowledgeEntry(currentClient.id, entry.id, !entry.is_active);
      await loadKnowledge();
    } catch (err: any) {
      addLog('error', `Failed to toggle rule: ${err.message}`);
    }
  };

  const handleDeleteRule = async (entry: ClientKnowledgeEntry) => {
    try {
      await deleteClientKnowledgeEntry(currentClient.id, entry.id);
      await loadKnowledge();
    } catch (err: any) {
      addLog('error', `Failed to delete rule: ${err.message}`);
    }
  };

  const activeAgentObj = agents.find((a) => a.id === selectedAgentId) || agents[0];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Hub Header & Sub-View Navigation */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Bot className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Autonomous Accounting Agents
            </h2>
            <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/80 border border-sky-500/30 px-2.5 py-0.5 rounded-full">
              {agents.length} Active {agents.length === 1 ? 'Agent' : 'Agents'}
            </span>
            <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
              {knowledgeSummary?.active_count || knowledgeEntries.length} Learned Rules
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Each agent has a dedicated Email address, multi-tenant WhatsApp channel, and client-specific AI knowledge memory.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sub-View Switcher Pills */}
          <div className="flex items-center bg-slate-900/90 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setSubView('agents')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                subView === 'agents'
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Agents ({agents.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('comms')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                subView === 'comms'
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Email &amp; WhatsApp Comms</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSubView('runs');
                loadAgentRuns();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                subView === 'runs'
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Reasoning &amp; Runs ({agentRuns.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('knowledge')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                subView === 'knowledge'
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Brain className="w-3.5 h-3.5" />
              <span>Knowledge Studio ({knowledgeSummary?.active_count || knowledgeEntries.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowWaSetupModal(true)}
            className="flex items-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold px-3.5 py-2 rounded-xl transition cursor-pointer"
          >
            <Phone className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {waConfig?.whatsapp_mode === 'dedicated_meta' || waConfig?.whatsapp_mode === 'dedicated_twilio'
                ? `WhatsApp: ${waConfig.whatsapp_phone_number || 'Dedicated'}`
                : 'Connect WhatsApp Number'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenNewPipeline('AR')}
            className="flex items-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-sky-600/25 transition cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Accounting Agent</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          SUB-VIEW 1: ACTIVE AGENTS GRID
          ===================================================================== */}
      {subView === 'agents' && (
        <>
          {agents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((pipe, idx) => {
                const sectionBadge =
                  pipe.section === 'AR'
                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                    : pipe.section === 'AP'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : pipe.section === 'BANK'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-purple-500/20 text-purple-300 border-purple-500/40';

                const agentEmail = formatDefaultAgentEmail(currentClient.id, pipe);
                const routingTag = formatDefaultRoutingTag(currentClient.id, pipe);
                const effectiveWaNumber =
                  pipe.whatsapp_phone_number ||
                  waConfig?.whatsapp_phone_number ||
                  waConfig?.platform_shared_number ||
                  '+233500000000';
                const cleanWaDigits = effectiveWaNumber.replace(/[^0-9]/g, '');
                const waUrl = `https://wa.me/${cleanWaDigits}?text=${encodeURIComponent(
                  `${routingTag} Status update for ${pipe.name}`
                )}`;

                return (
                  <div
                    key={pipe.id || idx}
                    className="glass-panel rounded-2xl p-5 flex flex-col justify-between space-y-4 border border-slate-800 hover:border-slate-700 transition group relative"
                  >
                    <div>
                      {/* Top Bar: Section & Actions */}
                      <div className="flex items-center justify-between mb-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border uppercase ${sectionBadge}`}>
                          {pipe.section} Agent • {pipe.entity_type?.replace(/_/g, ' ')}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEditPipeline(pipe)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition cursor-pointer"
                            title="Edit Agent Configuration"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePipelineSubmit(pipe.id, pipe.name)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition cursor-pointer"
                            title="Delete Agent"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Agent Title */}
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            pipe.is_active !== false ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-slate-500'
                          }`}
                        />
                        <span>{pipe.name}</span>
                      </h3>

                      {/* Dedicated Agent Email & WhatsApp Identity Box */}
                      <div className="mt-3 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/90 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Mail className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                            <span
                              className="text-[11px] font-mono text-sky-300 truncate"
                              title={agentEmail}
                            >
                              {agentEmail}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => copyToClipboard(agentEmail, `email_${pipe.id}`)}
                              className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/70 cursor-pointer"
                              title="Copy dedicated agent email address"
                            >
                              {copiedKey === `email_${pipe.id}` ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                            <a
                              href={`mailto:${agentEmail}?subject=${encodeURIComponent(`Instruction for ${pipe.name}`)}`}
                              className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-sky-400 border border-slate-700/70"
                              title="Send email to agent"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Phone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span className="text-[11px] font-mono text-emerald-300 truncate">
                              {effectiveWaNumber} ({routingTag})
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30"
                              title="Open in WhatsApp"
                            >
                              WhatsApp
                            </a>
                          </div>
                        </div>
                      </div>

                      {/* Trigger Details, Autonomy Mode & Active Triggers */}
                      <div className="space-y-2 mt-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(() => {
                              const mode: AgentAutonomyLevel = pipe.autonomy_level || 'semi_autonomous';
                              const badgeCls =
                                mode === 'full_autonomous'
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                  : mode === 'semi_autonomous'
                                  ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                                  : 'bg-amber-500/15 text-amber-300 border-amber-500/40';
                              const modeLabel =
                                mode === 'full_autonomous'
                                  ? 'Full Autopilot'
                                  : mode === 'semi_autonomous'
                                  ? 'Semi-Autonomous'
                                  : 'Copilot';
                              return (
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded border inline-flex items-center gap-1 ${badgeCls}`}
                                  title="Agent Autonomy Level"
                                >
                                  <Shield className="w-2.5 h-2.5" />
                                  {modeLabel}
                                </span>
                              );
                            })()}
                            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-900 text-sky-300 border border-slate-800 flex items-center gap-1">
                              {pipe.trigger_type === 'realtime_webhook' ? (
                                <>Webhook</>
                              ) : pipe.trigger_type === 'manual_only' ? (
                                <>Manual</>
                              ) : (
                                <>
                                  {pipe.schedule_frequency
                                    ? `${pipe.schedule_frequency.toUpperCase()} (${pipe.cron_schedule_human || pipe.schedule || 'Auto'})`
                                    : pipe.cron_schedule_human || pipe.schedule || 'Daily @ 18:00 UTC'}
                                </>
                              )}
                            </span>
                            {pipe.total_runs_count ? (
                              <span className="text-[10px] text-slate-500 font-mono">
                                {pipe.total_runs_count} runs
                              </span>
                            ) : null}
                          </div>

                          <select
                            aria-label={`Autonomy level for ${pipe.name}`}
                            value={pipe.autonomy_level || 'semi_autonomous'}
                            disabled={updatingAutonomyId === pipe.id}
                            onChange={(e) =>
                              handleUpdateQuickAutonomy(pipe.id, e.target.value as AgentAutonomyLevel)
                            }
                            className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 focus:outline-none focus:border-sky-500 cursor-pointer disabled:opacity-50"
                            title="Quick change agent autonomy level"
                          >
                            <option value="copilot">Copilot</option>
                            <option value="semi_autonomous">Semi-Autonomous</option>
                            <option value="full_autonomous">Full Autopilot</option>
                          </select>
                        </div>

                        {/* Active Triggers */}
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-900/90 text-slate-300 border border-slate-800">
                            Schedule: {pipe.schedule_frequency === 'daily' ? 'daily_morning' : pipe.schedule_frequency || 'daily_morning'}
                          </span>
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-500/30">
                            Email Cmds
                          </span>
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-500/30">
                            WhatsApp Cmds
                          </span>
                          {pipe.auto_apply_knowledge !== false && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-500/30">
                              Reactive Knowledge
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAgentId(pipe.id);
                              setSubView('runs');
                              loadAgentRuns(pipe.id);
                            }}
                            className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 transition cursor-pointer inline-flex items-center gap-1"
                            title="Inspect reasoning traces and run goals for this agent"
                          >
                            <Activity className="w-2.5 h-2.5" />
                            <span>View Runs</span>
                          </button>
                        </div>
                      </div>

                      {/* Target Details */}
                      <div className="text-xs text-slate-400 space-y-1 mt-3 pt-3 border-t border-slate-850">
                        <p className="flex items-center justify-between">
                          <span className="text-slate-500 text-[11px]">Ingestion Source:</span>
                          <code className="text-sky-300 font-mono text-[11px]">{pipe.source_type}</code>
                        </p>
                        {pipe.source_identifier && (
                          <p className="flex items-center justify-between">
                            <span className="text-slate-500 text-[11px]">Source Target:</span>
                            <span
                              className="text-slate-300 font-mono text-[11px] truncate max-w-[140px]"
                              title={pipe.source_identifier}
                            >
                              {pipe.source_identifier}
                            </span>
                          </p>
                        )}
                        {pipe.default_account_code && pipe.entity_type !== 'bank_feed' && (
                          <p className="flex items-center justify-between">
                            <span className="text-slate-500 text-[11px]">Default Account:</span>
                            <span className="text-emerald-400 font-mono text-[11px]">
                              {pipe.default_account_code}
                            </span>
                          </p>
                        )}
                        {pipe.section === 'BANK' && (() => {
                          const legacyGl = new Set(['6990', '850', '999', 'suspense', 'uncategorized', 'all']);
                          const rawBankList = pipe.watched_accounts || currentClient.watched_accounts || [];
                          const selectedBanks = rawBankList.filter(
                            (w) => w && !legacyGl.has(String(w).trim().toLowerCase())
                          );
                          return (
                            <div className="mt-2.5 p-2 bg-emerald-950/30 border border-emerald-800/40 rounded-xl space-y-1.5">
                              <div className="flex items-center justify-between text-[10px] text-emerald-400 font-semibold">
                                <span className="flex items-center gap-1">
                                  <Landmark className="w-3 h-3 text-emerald-400" />
                                  <span>Banking Module Scope</span>
                                </span>
                                <span className="text-[9px] font-mono font-bold bg-emerald-950/80 px-1.5 py-0.2 rounded border border-emerald-700/50">
                                  {selectedBanks.length === 0 ? 'All Bank Accounts' : `${selectedBanks.length} selected`}
                                </span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Last Run Summary Preview Card */}
                      {pipe.last_run_summary && (
                        <button
                          type="button"
                          onClick={() => setActiveRunSummary(pipe.last_run_summary!)}
                          className="w-full text-left bg-slate-950/70 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-2.5 transition cursor-pointer mt-3 group/lastrun"
                          title="Click to view detailed execution breakdown"
                        >
                          <div className="flex items-center justify-between text-[10px] mb-1">
                            <span className="text-slate-400 flex items-center gap-1 font-medium">
                              <Clock className="w-3 h-3 text-sky-400" />
                              <span>
                                Last Run:{' '}
                                {new Date(pipe.last_run_summary.triggered_at).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </span>
                            <span
                              className={`px-1.5 py-0.2 rounded font-bold uppercase text-[9px] ${
                                pipe.last_run_summary.status === 'COMPLETED_DUPLICATES_SKIPPED'
                                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                  : pipe.last_run_summary.items_extracted > 0
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {pipe.last_run_summary.status === 'COMPLETED_DUPLICATES_SKIPPED'
                                ? 'Duplicates Skipped'
                                : pipe.last_run_summary.items_extracted > 0
                                ? `${pipe.last_run_summary.items_extracted} Staged`
                                : 'Completed'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-300 line-clamp-1 group-hover/lastrun:text-white">
                            {pipe.last_run_summary.summary_message}
                          </p>
                        </button>
                      )}
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-3 border-t border-slate-850 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAgentId(pipe.id);
                            setSubView('comms');
                          }}
                          className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 hover:text-white border border-indigo-500/30 text-xs font-bold transition cursor-pointer"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Message Agent</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleTriggerStream(pipe.id, pipe.name)}
                          disabled={triggeringPipeId === pipe.id}
                          className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 hover:text-white border border-sky-500/30 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          {triggeringPipeId === pipe.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                          ) : (
                            <PlayCircle className="w-3.5 h-3.5 text-sky-400" />
                          )}
                          <span>{triggeringPipeId === pipe.id ? 'Running...' : 'Run Agent'}</span>
                        </button>
                      </div>

                      {pipe.last_run_summary?.status === 'COMPLETED_DUPLICATES_SKIPPED' && (
                        <button
                          type="button"
                          onClick={() => handleTriggerStream(pipe.id, pipe.name, true)}
                          disabled={triggeringPipeId === pipe.id}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 hover:text-white border border-amber-500/30 text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          <Zap className="w-3 h-3 text-amber-400" />
                          <span>Force Reprocess &amp; Sync Sheet</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="glass-panel rounded-2xl p-12 text-center text-slate-400 border border-dashed border-slate-800 space-y-3">
              <Bot className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-sm font-bold text-white">No Accounting Agents Configured</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Create autonomous accounting agents to parse control slips, supplier bills, or bank statements and communicate via Email and WhatsApp for {currentClient.name}.
              </p>
              <button
                onClick={() => handleOpenNewPipeline()}
                className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create First Agent</span>
              </button>
            </div>
          )}

          {/* Available Specialized Accounting Extensions Catalog */}
          {(() => {
            const glAgent = agents.find((a) => a.section === 'GL' || a.entity_type === 'gl_journal');
            const frAgent = agents.find((a) => a.section === 'FR' || a.entity_type === 'fr_statement_pack');

            return (
              <div className="pt-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span>Available Accounting &amp; Reporting Extensions</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Opt-in specialized agents to automate period-end general ledger adjustments and financial statement synthesis.
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800 self-start sm:self-auto">
                    Opt-In Extensions
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Extension 1: GL Closing Accountant Agent */}
                  <div className="glass-panel rounded-2xl p-5 border border-purple-900/40 hover:border-purple-700/60 transition flex flex-col justify-between space-y-4 relative overflow-hidden bg-gradient-to-br from-purple-950/20 via-slate-900/60 to-slate-950/80">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase bg-purple-500/20 text-purple-300 border-purple-500/40 flex items-center gap-1.5">
                          <Scale className="w-3 h-3 text-purple-400" />
                          <span>General Ledger (GL)</span>
                        </span>
                        {glAgent ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                            <span>Configured &amp; Active</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                            Available (Opt-In)
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>General Ledger Closing Accountant Agent</span>
                      </h4>
                      <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                        Autonomously audits general ledger balances against entity accounting policies, computes straight-line or reducing-balance depreciation (IAS 16), prepayments amortization, operating expense accruals (IAS 37), and drafts balanced manual adjusting journals with technical white papers.
                      </p>

                      <div className="mt-3.5 flex flex-wrap gap-1.5">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40">
                          Period-End Audits
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40">
                          Double-Entry Journals
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40">
                          White Paper Workings
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40">
                          ERP Direct Posting
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-purple-900/30">
                      {glAgent ? (
                        <button
                          type="button"
                          onClick={() => handleOpenEditPipeline(glAgent)}
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 hover:text-white border border-purple-500/30 text-xs font-bold transition cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit GL Policies &amp; Rules</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenNewPipeline('GL')}
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-600/20 transition cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Configure &amp; Activate GL Agent</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Extension 2: Financial Reporting Agent */}
                  <div className="glass-panel rounded-2xl p-5 border border-sky-900/40 hover:border-sky-700/60 transition flex flex-col justify-between space-y-4 relative overflow-hidden bg-gradient-to-br from-sky-950/20 via-slate-900/60 to-slate-950/80">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase bg-sky-500/20 text-sky-300 border-sky-500/40 flex items-center gap-1.5">
                          <BarChart3 className="w-3 h-3 text-sky-400" />
                          <span>Financial Reporting (FR)</span>
                        </span>
                        {frAgent ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                            <span>Configured &amp; Active</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                            Available (Opt-In)
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>Financial Reporting &amp; Disclosures Agent</span>
                      </h4>
                      <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                        Read-only presentation synthesis agent. Produces complete IFRS or US GAAP financial statement packs (Balance Sheet, Profit &amp; Loss, Direct/Indirect Cash Flows, Statement of Changes in Equity, and Disclosure Notes) from settled general ledger balances.
                      </p>

                      <div className="mt-3.5 flex flex-wrap gap-1.5">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-950/60 text-sky-300 border border-sky-800/40">
                          IFRS &amp; US GAAP
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-950/60 text-sky-300 border border-sky-800/40">
                          Read-Only Sourcing
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-950/60 text-sky-300 border border-sky-800/40">
                          Cash Flows &amp; Notes
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-950/60 text-sky-300 border border-sky-800/40">
                          Mathematical Balances
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-sky-900/30">
                      {frAgent ? (
                        <button
                          type="button"
                          onClick={() => handleOpenEditPipeline(frAgent)}
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 hover:text-white border border-sky-500/30 text-xs font-bold transition cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit Reporting Framework</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenNewPipeline('FR')}
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-600/20 transition cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Configure &amp; Activate FR Agent</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* =====================================================================
          SUB-VIEW 2: MULTI-CHANNEL AGENT COMMUNICATIONS (EMAIL & WHATSAPP)
          ===================================================================== */}
      {subView === 'comms' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Agent Selector & Multi-Tenant Endpoints */}
          <div className="lg:col-span-4 space-y-4">
            <div className="glass-panel rounded-2xl p-4 border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Bot className="w-4 h-4 text-sky-400" />
                <span>Select Agent Instance</span>
              </h3>
              <div className="space-y-2">
                {agents.map((ag) => {
                  const isSelected = ag.id === selectedAgentId;
                  const agEmail = formatDefaultAgentEmail(currentClient.id, ag);
                  return (
                    <button
                      key={ag.id}
                      type="button"
                      onClick={() => setSelectedAgentId(ag.id)}
                      className={`w-full text-left p-3 rounded-xl border transition cursor-pointer ${
                        isSelected
                          ? 'bg-sky-950/60 border-sky-500/50 text-white'
                          : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">{ag.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-sky-300">
                          {ag.section}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-slate-400 truncate mt-1">{agEmail}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tenant WhatsApp & Email Webhook Routing Card */}
            <div className="glass-panel rounded-2xl p-4 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Phone className="w-4 h-4 text-emerald-400" />
                  <span>SaaS WhatsApp &amp; Email Routing</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowWaSetupModal(true)}
                  className="text-[11px] font-bold text-sky-400 hover:text-sky-300 cursor-pointer"
                >
                  Configure
                </button>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">WhatsApp Mode:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {waConfig?.whatsapp_mode === 'dedicated_meta'
                      ? 'Dedicated Meta Cloud API'
                      : waConfig?.whatsapp_mode === 'dedicated_twilio'
                      ? 'Dedicated Twilio Number'
                      : 'Platform Shared Gateway'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Listening Number:</span>
                  <span className="font-mono text-white">
                    {waConfig?.whatsapp_phone_number || waConfig?.platform_shared_number || '+233500000000'}
                  </span>
                </div>
                {activeAgentObj && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Dedicated Email:</span>
                    <span className="font-mono text-sky-300 truncate max-w-[180px]">
                      {formatDefaultAgentEmail(currentClient.id, activeAgentObj)}
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-1">
                    Tenant WhatsApp Webhook URL (Meta / Twilio):
                  </span>
                  <div className="flex items-center gap-1.5">
                    <code className="text-[10px] font-mono bg-slate-900 text-slate-300 px-2 py-1 rounded border border-slate-800 truncate flex-1">
                      {waConfig?.webhook_url || `/api/v1/agents/webhooks/whatsapp/${currentClient.id}`}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          waConfig?.webhook_url || `/api/v1/agents/webhooks/whatsapp/${currentClient.id}`,
                          'wa_webhook'
                        )
                      }
                      className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer"
                    >
                      {copiedKey === 'wa_webhook' ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Live Multi-Channel AI Conversation Console */}
          <div className="lg:col-span-8 glass-panel rounded-2xl p-5 border border-slate-800 flex flex-col justify-between min-h-[540px]">
            {/* Conversation Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>{activeAgentObj?.name || 'Agent Conversation'}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                    Gemini AI Engine Active
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Communicate with this agent via Email, WhatsApp, or direct message. Teach it rules or ask about staged transactions.
                </p>
              </div>

              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                {(['ALL', 'EMAIL', 'WHATSAPP', 'IN_APP'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChannelFilter(ch)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      channelFilter === ch
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            {/* Message Thread */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3 max-h-[360px]">
              {isLoadingMessages ? (
                <div className="text-center py-12 text-xs text-slate-400">
                  Loading agent conversation history...
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-12 space-y-2 text-slate-400">
                  <MessageSquare className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs font-bold text-white">No Messages Yet</p>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Send an Email, WhatsApp message, or test prompt below. You can ask for ledger summaries or teach client-specific rules (e.g. &quot;Map ECG to 5020 - Electricity Expense&quot;).
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isOutbound = msg.direction === 'OUTBOUND';
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isOutbound ? 'items-start' : 'items-end'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl p-3.5 text-xs space-y-2 border ${
                          isOutbound
                            ? 'bg-slate-900/90 border-slate-800 text-slate-200'
                            : 'bg-sky-950/70 border-sky-500/40 text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 text-[10px] text-slate-400">
                          <span className="font-bold flex items-center gap-1">
                            {isOutbound ? (
                              <>
                                <Bot className="w-3 h-3 text-sky-400" />
                                <span className="text-sky-300">{activeAgentObj?.name || 'Agent'}</span>
                              </>
                            ) : (
                              <span>{msg.sender_address}</span>
                            )}
                          </span>
                          <span className="font-mono px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800 text-[9px]">
                            {msg.channel}
                          </span>
                        </div>

                        {msg.subject && (
                          <div className="text-[11px] font-bold text-sky-300">
                            Subject: {msg.subject}
                          </div>
                        )}

                        <div className="whitespace-pre-wrap leading-relaxed">{msg.body_text}</div>

                        {isOutbound && msg.ai_metadata?.agent_run && (() => {
                          const receipt = msg.ai_metadata.agent_run;
                          const isExpanded = !!expandedReceipts[msg.id];
                          const steps = receipt.reasoning_steps || [];
                          return (
                            <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedReceipts((prev) => ({
                                    ...prev,
                                    [msg.id]: !prev[msg.id],
                                  }))
                                }
                                className="w-full flex items-center justify-between text-[10px] font-bold text-sky-300 bg-slate-950/70 hover:bg-slate-950 border border-sky-500/30 rounded-lg px-2.5 py-1.5 cursor-pointer transition"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Terminal className="w-3 h-3 text-sky-400" />
                                  <span>
                                    Tool Execution Receipt ({receipt.actions_taken_count || steps.length} action(s), status: {receipt.status})
                                  </span>
                                </span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                )}
                              </button>
                              {isExpanded && (
                                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 space-y-1.5">
                                  <div className="flex flex-wrap gap-2 text-[10px] text-slate-400 font-mono">
                                    <span>Run: {receipt.run_id}</span>
                                    <span>Processed: {receipt.items_processed ?? 0}</span>
                                    <span>Categorized: {receipt.items_categorized ?? 0}</span>
                                    <span>Approved: {receipt.items_auto_approved ?? 0}</span>
                                  </div>
                                  {steps.map((st, sIdx) => (
                                    <div
                                      key={sIdx}
                                      className="text-[10px] bg-slate-900/90 border border-slate-800 rounded-lg p-2 space-y-0.5"
                                    >
                                      <div className="flex items-center justify-between font-bold">
                                        <span className="text-sky-300 font-mono">{st.tool_name}</span>
                                        <span
                                          className={
                                            st.status === 'FAILED'
                                              ? 'text-red-400'
                                              : st.status === 'AWAITING_HUMAN'
                                              ? 'text-amber-300'
                                              : 'text-emerald-400'
                                          }
                                        >
                                          {st.status}
                                        </span>
                                      </div>
                                      <p className="text-slate-300">{st.tool_output_summary}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {msg.knowledge_extracted && msg.knowledge_extracted.length > 0 && (
                          <div className="pt-2 border-t border-slate-800/80 space-y-1">
                            <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                              <Sparkles className="w-3 h-3" />
                              <span>
                                Learned {msg.knowledge_extracted.length} new client knowledge rule(s):
                              </span>
                            </span>
                            {msg.knowledge_extracted.map((kr, kIdx) => (
                              <div
                                key={kIdx}
                                className="text-[10px] font-mono bg-emerald-950/50 border border-emerald-500/30 text-emerald-200 px-2 py-1 rounded"
                              >
                                [{kr.category}] {kr.rule_key} -&gt; {kr.rule_value}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Composer Form */}
            <form onSubmit={handleSendMessageToAgent} className="pt-3 border-t border-slate-800 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-400 font-semibold">Simulate / Send via:</span>
                {(['IN_APP', 'EMAIL', 'WHATSAPP'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setComposeChannel(ch)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                      composeChannel === ch
                        ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    {ch === 'IN_APP' ? 'In-App Chat' : ch === 'EMAIL' ? 'Inbound Email' : 'Inbound WhatsApp'}
                  </button>
                ))}

                {composeChannel !== 'IN_APP' && (
                  <input
                    type="text"
                    value={composeSender}
                    onChange={(e) => setComposeSender(e.target.value)}
                    placeholder={composeChannel === 'WHATSAPP' ? 'Sender Phone (+233...)' : 'Sender Email'}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-sky-500"
                  />
                )}
                {composeChannel === 'EMAIL' && (
                  <input
                    type="text"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="Email Subject"
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-sky-500"
                  />
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  placeholder="Ask the agent a question or teach it a client rule (e.g. 'Remember that Kempinski means Kempinski Hotel Gold Coast City')..."
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500"
                />
                <button
                  type="submit"
                  disabled={isSendingMessage || !composeText.trim()}
                  className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer"
                >
                  {isSendingMessage ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>Send</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-VIEW 3: CLIENT KNOWLEDGE BASE STUDIO
          ===================================================================== */}
      {subView === 'knowledge' && (
        <div className="space-y-6">
          {/* Natural Language AI Teaching Banner */}
          <div className="glass-panel rounded-2xl p-5 border border-sky-500/30 bg-gradient-to-r from-sky-950/40 to-indigo-950/30 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-bold text-white">
                  Teach Client Knowledge in Natural Language
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddRuleForm(!showAddRuleForm)}
                className="text-xs font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showAddRuleForm ? 'Hide Manual Form' : 'Add Structured Rule Manually'}</span>
              </button>
            </div>
            <p className="text-xs text-slate-300">
              Type any client-specific accounting instruction, customer/vendor alias, pricing rule, or chart-of-accounts mapping. Gemini converts it into structured, reusable memory injected into every agent run.
            </p>
            <form onSubmit={handleTeachKnowledge} className="flex flex-col sm:flex-row gap-2">
              <select
                value={teachAgentScope}
                onChange={(e) => setTeachAgentScope(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">Global (All Client Agents)</option>
                {agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.name} ({ag.section})
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={teachText}
                onChange={(e) => setTeachText(e.target.value)}
                placeholder="e.g. Whenever we receive a slip for Labadi Beach, map it to Labadi Beach Hotel Ltd and price Bath Towel at 18 GHS..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              />
              <button
                type="submit"
                disabled={isTeaching || !teachText.trim()}
                className="flex items-center justify-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer shrink-0"
              >
                {isTeaching ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Brain className="w-3.5 h-3.5" />
                )}
                <span>Teach Agent</span>
              </button>
            </form>

            {/* Optional Manual Structured Rule Form */}
            {showAddRuleForm && (
              <form
                onSubmit={handleCreateStructuredRule}
                className="pt-3 mt-3 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-2"
              >
                <select
                  value={newRuleCategory}
                  onChange={(e) => setNewRuleCategory(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                >
                  {KNOWLEDGE_CATEGORIES.filter((c) => c.id !== 'ALL').map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newRuleKey}
                  onChange={(e) => setNewRuleKey(e.target.value)}
                  placeholder="Trigger / Alias / Keyword (e.g. ECG)"
                  className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                />
                <input
                  type="text"
                  value={newRuleValue}
                  onChange={(e) => setNewRuleValue(e.target.value)}
                  placeholder="Target Account / Official Name / Rate"
                  className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                />
                <button
                  type="submit"
                  disabled={isSavingRule || !newRuleKey.trim() || !newRuleValue.trim()}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-xl cursor-pointer"
                >
                  Save Rule
                </button>
              </form>
            )}
          </div>

          {/* Filter & Search Bar */}
          <div className="glass-panel rounded-2xl p-4 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {KNOWLEDGE_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setKnowledgeCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    knowledgeCategoryFilter === cat.id
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="relative min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={knowledgeSearch}
                onChange={(e) => setKnowledgeSearch(e.target.value)}
                placeholder="Search learned rules..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Knowledge Entries List */}
          <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
            {isLoadingKnowledge ? (
              <div className="p-10 text-center text-xs text-slate-400">
                Loading client knowledge base...
              </div>
            ) : knowledgeEntries.length === 0 ? (
              <div className="p-12 text-center space-y-2 text-slate-400">
                <Brain className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-sm font-bold text-white">No Client Knowledge Rules Found</p>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Agents automatically learn rules when you categorize bank transactions, resolve information requests, or teach them via Email, WhatsApp, or the prompt box above.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {knowledgeEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                      entry.is_active ? 'bg-transparent' : 'opacity-50 bg-slate-950/40'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                          {entry.category}
                        </span>
                        <span className="text-xs font-bold text-white font-mono">
                          {entry.rule_key}
                        </span>
                        <span className="text-xs text-slate-500">-&gt;</span>
                        <span className="text-xs font-bold text-emerald-400 font-mono">
                          {entry.rule_value}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                          Source: {entry.source}
                        </span>
                        {entry.usage_count > 0 && (
                          <span className="text-[10px] font-mono text-slate-500">
                            Used {entry.usage_count}x
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-300">{entry.natural_language_rule}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(entry)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                        title={entry.is_active ? 'Disable rule' : 'Enable rule'}
                      >
                        {entry.is_active ? (
                          <ToggleRight className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-slate-500" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(entry)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 cursor-pointer"
                        title="Delete rule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-VIEW 3: AGENT REASONING & RUNS (ReAct CONTROL CENTER)
          ===================================================================== */}
      {subView === 'runs' && (
        <div className="space-y-4">
          {/* Control Bar */}
          <div className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-sky-400" />
                  <span>Autonomous Reasoning Traces &amp; Goal Execution</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Assign ad-hoc accounting goals, sweep due agents across their schedule frequency, and audit step-by-step Thought, Tool Call, and Observation traces.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Select agent for reasoning runs"
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-sky-500 cursor-pointer"
                >
                  {agents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.name} ({ag.section})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => loadAgentRuns()}
                  disabled={isLoadingRuns}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold transition cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRuns ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>

                <button
                  type="button"
                  onClick={handleRunHeartbeatSweep}
                  disabled={isRunningHeartbeat}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Zap className={`w-3.5 h-3.5 ${isRunningHeartbeat ? 'animate-pulse' : ''}`} />
                  <span>
                    {isRunningHeartbeat ? 'Sweeping Heartbeat...' : 'Run Due Agents Heartbeat'}
                  </span>
                </button>
              </div>
            </div>

            {/* Assign Goal Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleExecuteGoal();
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder={`Assign a goal to ${activeAgentObj?.name || 'this agent'} (e.g. "Reconcile bank, apply taught rules, approve >85% confidence entries")`}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
              <button
                type="submit"
                disabled={isExecutingGoal || !goalInput.trim() || !selectedAgentId}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isExecutingGoal ? 'animate-spin' : ''}`} />
                <span>{isExecutingGoal ? 'Executing Goal...' : 'Run Autonomous Cycle'}</span>
              </button>
            </form>

            {/* Quick Goal Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-500 mr-1">Quick Goals:</span>
              {[
                {
                  label: 'Reconcile & Categorize All',
                  goal: 'Scan storage, apply learned knowledge retroactively, and categorize unmapped bank transactions',
                },
                {
                  label: 'Auto-Approve >=85% Confidence',
                  goal: 'Apply learned knowledge rules and auto-approve verified ledger entries meeting threshold',
                },
                {
                  label: 'Chase Overdue Clarifications (>72h)',
                  goal: 'Raise anomaly clarification requests for unresolved transactions and follow up overdue clarification requests',
                },
                {
                  label: 'Draft Customer AR Invoices / Vendor AP Bills',
                  goal: 'Reconcile storage versus ledger and generate draft Customer invoices or Vendor bills',
                },
              ].map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  disabled={isExecutingGoal || !selectedAgentId}
                  onClick={() => handleExecuteGoal(chip.goal)}
                  className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-sky-300 border border-slate-800 hover:border-sky-500/40 transition cursor-pointer disabled:opacity-50"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Execution Run Timeline Cards */}
          {isLoadingRuns ? (
            <div className="glass-panel rounded-2xl p-10 border border-slate-800 text-center text-xs text-slate-400">
              Loading agent reasoning traces...
            </div>
          ) : agentRuns.length === 0 ? (
            <div className="glass-panel rounded-2xl p-10 border border-slate-800 text-center space-y-2">
              <Activity className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs font-bold text-white">No ReAct Execution Runs Recorded Yet</p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Assign a goal above, send an actionable Email/WhatsApp command, or click Run Due Agents Heartbeat to trigger your first autonomous cycle.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {agentRuns.map((run) => {
                const statusBadge =
                  run.status === 'COMPLETED'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : run.status === 'AWAITING_HUMAN'
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                    : run.status === 'FAILED'
                    ? 'bg-red-500/15 text-red-300 border-red-500/40'
                    : 'bg-sky-500/15 text-sky-300 border-sky-500/40';
                return (
                  <div
                    key={run.run_id}
                    className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${statusBadge}`}>
                            {run.status}
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-indigo-300 border border-slate-800">
                            Trigger: {run.trigger_type}
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                            Autonomy: {run.autonomy_level}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            Run {run.run_id}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-white">{run.goal}</p>
                      </div>

                      <div className="text-[11px] text-slate-400 font-mono text-right shrink-0">
                        <div>{new Date(run.started_at).toLocaleString()}</div>
                        {run.trigger_source && (
                          <div className="text-[10px] text-slate-500">Source: {run.trigger_source}</div>
                        )}
                      </div>
                    </div>

                    {/* Metrics Pill Strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-[11px]">
                      <div className="bg-slate-950/70 border border-slate-800 rounded-xl px-2.5 py-1.5">
                        <span className="text-slate-500 block text-[9px] uppercase">Tools Executed</span>
                        <span className="font-mono font-bold text-white">{run.actions_taken_count}</span>
                      </div>
                      <div className="bg-slate-950/70 border border-slate-800 rounded-xl px-2.5 py-1.5">
                        <span className="text-slate-500 block text-[9px] uppercase">Items Processed</span>
                        <span className="font-mono font-bold text-white">{run.items_processed}</span>
                      </div>
                      <div className="bg-slate-950/70 border border-slate-800 rounded-xl px-2.5 py-1.5">
                        <span className="text-slate-500 block text-[9px] uppercase">Categorized</span>
                        <span className="font-mono font-bold text-sky-300">{run.items_categorized}</span>
                      </div>
                      <div className="bg-slate-950/70 border border-slate-800 rounded-xl px-2.5 py-1.5">
                        <span className="text-slate-500 block text-[9px] uppercase">Auto-Approved</span>
                        <span className="font-mono font-bold text-emerald-300">{run.items_auto_approved}</span>
                      </div>
                      <div className="bg-slate-950/70 border border-slate-800 rounded-xl px-2.5 py-1.5">
                        <span className="text-slate-500 block text-[9px] uppercase">Anomaly Queries</span>
                        <span className="font-mono font-bold text-amber-300">{run.queries_dispatched}</span>
                      </div>
                      <div className="bg-slate-950/70 border border-slate-800 rounded-xl px-2.5 py-1.5">
                        <span className="text-slate-500 block text-[9px] uppercase">Drafts Created</span>
                        <span className="font-mono font-bold text-purple-300">{run.invoices_drafted}</span>
                      </div>
                    </div>

                    {/* Step-by-Step ReAct Chain */}
                    {run.reasoning_steps && run.reasoning_steps.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <div className="text-[10px] font-bold uppercase text-slate-400">
                          Step-by-Step ReAct Reasoning Chain
                        </div>
                        <div className="space-y-2">
                          {run.reasoning_steps.map((step) => (
                            <div
                              key={step.step_index}
                              className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-xs space-y-1.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono text-[10px] font-bold inline-flex items-center justify-center">
                                    {step.step_index}
                                  </span>
                                  <code className="text-[11px] font-bold text-sky-300 font-mono">
                                    {step.tool_name}
                                  </code>
                                </div>
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                    step.status === 'FAILED'
                                      ? 'bg-red-500/15 text-red-300 border-red-500/30'
                                      : step.status === 'AWAITING_HUMAN'
                                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  }`}
                                >
                                  {step.status}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400">
                                <strong className="text-slate-300">Thought:</strong> {step.thought}
                              </p>
                              <p className="text-[11px] text-slate-200">
                                <strong className="text-emerald-300">Observation:</strong> {step.tool_output_summary}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Final Report Summary */}
                    {run.summary_report && (
                      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 whitespace-pre-wrap">
                        {run.summary_report}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          MODAL: SAAS MULTI-TENANT WHATSAPP BUSINESS NUMBER SETUP
          ===================================================================== */}
      {showWaSetupModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-2xl border border-slate-800 max-w-xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  WhatsApp Business Channel Setup ({currentClient.name})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowWaSetupModal(false)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSaveWhatsAppConfig} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setWaMode('platform_shared')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    waMode === 'platform_shared'
                      ? 'bg-emerald-950/50 border-emerald-500/50 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold">Shared Gateway</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Zero setup. Uses S4 shared number + @tag.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setWaMode('dedicated_meta')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    waMode === 'dedicated_meta'
                      ? 'bg-emerald-950/50 border-emerald-500/50 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold">Dedicated Meta API</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Connect your own Meta WhatsApp Business number.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setWaMode('dedicated_twilio')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    waMode === 'dedicated_twilio'
                      ? 'bg-emerald-950/50 border-emerald-500/50 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold">Dedicated Twilio</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Connect your own Twilio WhatsApp sender.
                  </div>
                </button>
              </div>

              {waMode !== 'platform_shared' && (
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Dedicated WhatsApp Business Phone Number (E.164)
                    </label>
                    <input
                      type="text"
                      value={waPhone}
                      onChange={(e) => setWaPhone(e.target.value)}
                      placeholder="+233240000000"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white"
                    />
                  </div>

                  {waMode === 'dedicated_meta' && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-slate-300 font-semibold mb-1">
                            Meta Phone Number ID
                          </label>
                          <input
                            type="text"
                            value={waPhoneId}
                            onChange={(e) => setWaPhoneId(e.target.value)}
                            placeholder="e.g. 104928192019201"
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-300 font-semibold mb-1">
                            WhatsApp Business Account (WABA) ID
                          </label>
                          <input
                            type="text"
                            value={waWabaId}
                            onChange={(e) => setWaWabaId(e.target.value)}
                            placeholder="Optional WABA ID"
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-slate-300 font-semibold mb-1">
                            Permanent Meta Access Token
                          </label>
                          <input
                            type="password"
                            value={waAccessToken}
                            onChange={(e) => setWaAccessToken(e.target.value)}
                            placeholder={
                              waConfig?.has_custom_access_token
                                ? 'Stored securely (enter to replace)'
                                : 'EAAG...'
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-300 font-semibold mb-1">
                            Webhook Verify Token
                          </label>
                          <input
                            type="text"
                            value={waVerifyToken}
                            onChange={(e) => setWaVerifyToken(e.target.value)}
                            placeholder="s4_verify_..."
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {waMode === 'dedicated_twilio' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          Twilio Account SID
                        </label>
                        <input
                          type="text"
                          value={twilioSid}
                          onChange={(e) => setTwilioSid(e.target.value)}
                          placeholder="AC..."
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          Twilio Auth Token
                        </label>
                        <input
                          type="password"
                          value={twilioToken}
                          onChange={(e) => setTwilioToken(e.target.value)}
                          placeholder={
                            waConfig?.has_twilio_auth_token
                              ? 'Stored securely (enter to replace)'
                              : 'Auth Token'
                          }
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="text-[11px] font-bold text-sky-300">
                  Your Dedicated Webhook Callback URL
                </div>
                <p className="text-[11px] text-slate-400">
                  Paste this URL into your Meta Developer Portal or Twilio WhatsApp Sandbox/Sender webhook configuration so S4 Automations listens on your number:
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-[11px] font-mono bg-slate-900 text-emerald-300 px-2.5 py-1.5 rounded border border-slate-800 flex-1 truncate">
                    {waConfig?.webhook_url || `/api/v1/agents/webhooks/whatsapp/${currentClient.id}`}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        waConfig?.webhook_url || `/api/v1/agents/webhooks/whatsapp/${currentClient.id}`,
                        'modal_wa_webhook'
                      )
                    }
                    className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold cursor-pointer"
                  >
                    {copiedKey === 'modal_wa_webhook' ? 'Copied' : 'Copy URL'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowWaSetupModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingWaConfig}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
                >
                  {isSavingWaConfig ? 'Saving...' : 'Save WhatsApp Configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Agent Setup Wizard Modal */}
      <PipelineSetupWizardModal
        isOpen={isPipelineModalOpen}
        onClose={() => setIsPipelineModalOpen(false)}
        onSave={handleSavePipelineSubmit}
        clientId={currentClient.id}
        clientName={currentClient.name}
        initialPipeline={editingPipeline}
        targetAccountingSoftware={currentClient.accounting_software}
        defaultSection={modalDefaultSection}
      />

      {/* Agent Execution Result Modal */}
      <StreamExecutionResultModal
        isOpen={!!activeRunSummary}
        onClose={() => setActiveRunSummary(null)}
        runSummary={activeRunSummary}
        clientId={currentClient.id}
        onTriggerAgain={
          activeRunSummary?.pipeline_id
            ? (forceReprocess?: boolean) =>
                handleTriggerStream(
                  activeRunSummary.pipeline_id!,
                  activeRunSummary.pipeline_name || 'Agent',
                  forceReprocess
                )
            : undefined
        }
      />
    </div>
  );
};
