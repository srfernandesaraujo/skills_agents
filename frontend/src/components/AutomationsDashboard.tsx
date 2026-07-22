import React, { useState, useEffect } from 'react';
import { 
  Zap, Clock, Play, 
  CheckCircle, RefreshCw, Eye, X, Copy,
  GitBranch, Bot, Send, Bell, Plus, Trash2, Edit3, ArrowRight, Layers, Sliders, Check
} from 'lucide-react';

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'condition' | 'ai_skill' | 'http_request' | 'log_notify';
  name: string;
  config: {
    triggerType?: 'webhook' | 'cron';
    cronExpression?: string;
    endpoint?: string;
    field?: string;
    operator?: 'equals' | 'contains' | 'not_empty' | 'greater_than';
    value?: string;
    skillName?: string;
    inputMapping?: string;
    method?: 'POST' | 'GET' | 'PUT';
    url?: string;
    headers?: Record<string, string>;
    message?: string;
  };
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  active: boolean;
  triggerEndpoint: string;
  nodes: WorkflowNode[];
}

export interface AutomationLog {
  id: string;
  skillName: string;
  workflowId?: string;
  workflowName?: string;
  triggerType: string;
  payload: any;
  status: 'queued' | 'running' | 'completed' | 'failed';
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  trace: any | null;
  error: string | null;
}

interface AutomationsDashboardProps {
  backendUrl: string;
  skills: Array<{ name: string; title: string }>;
}

export const AutomationsDashboard: React.FC<AutomationsDashboardProps> = ({ backendUrl, skills }) => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<any | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Payload de teste manual
  const [manualPayloadInput, setManualPayloadInput] = useState<string>(
    '{\n  "statusExame": "urgente",\n  "paciente": "Maria Silva",\n  "idade": 45,\n  "prescricao": "Cisplatina 50mg/m2 IV D1 + Paclitaxel 175mg/m2 IV D1"\n}'
  );
  const [isTriggeringWorkflow, setIsTriggeringWorkflow] = useState(false);

  // Estados dos Modais
  const [editingNode, setEditingNode] = useState<WorkflowNode | null>(null);
  const [isAddNodeModalOpen, setIsAddNodeModalOpen] = useState(false);
  const [newNodeType, setNewNodeType] = useState<WorkflowNode['type']>('ai_skill');
  const [isCreateWorkflowModalOpen, setIsCreateWorkflowModalOpen] = useState(false);
  const [newWfName, setNewWfName] = useState('');
  const [newWfDesc, setNewWfDesc] = useState('');

  useEffect(() => {
    loadWorkflowsAndLogs();
  }, [backendUrl]);

  const loadWorkflowsAndLogs = async () => {
    setIsLoading(true);
    try {
      const [wfRes, logsRes] = await Promise.all([
        fetch(`${backendUrl}/api/automations/workflows`),
        fetch(`${backendUrl}/api/automations/logs`)
      ]);

      if (wfRes.ok) {
        const wfData: Workflow[] = await wfRes.json();
        setWorkflows(wfData);
        if (wfData.length > 0 && !selectedWorkflowId) {
          setSelectedWorkflowId(wfData[0].id);
        }
      }

      if (logsRes.ok) {
        setLogs(await logsRes.json());
      }
    } catch (err) {
      console.error('Erro ao carregar automações:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedWorkflow = workflows.find(w => w.id === selectedWorkflowId) || workflows[0] || null;

  const handleToggleWorkflow = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`${backendUrl}/api/automations/workflows/${id}/toggle`, { method: 'POST' });
      if (res.ok) {
        loadWorkflowsAndLogs();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteWorkflow = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Deseja realmente excluir este workflow de automação?')) return;
    try {
      const res = await fetch(`${backendUrl}/api/automations/workflows/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedWorkflowId === id) setSelectedWorkflowId(null);
        loadWorkflowsAndLogs();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTriggerManualWorkflow = async () => {
    if (!selectedWorkflow) return;
    let parsedPayload = {};
    try {
      parsedPayload = JSON.parse(manualPayloadInput);
    } catch (e) {
      alert('JSON de Payload de Entrada é inválido! Por favor, corrija antes de disparar.');
      return;
    }

    setIsTriggeringWorkflow(true);
    try {
      const res = await fetch(`${backendUrl}/api/automations/workflows/${selectedWorkflow.id}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedPayload)
      });
      if (res.ok) {
        setTimeout(() => loadWorkflowsAndLogs(), 1000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsTriggeringWorkflow(false);
    }
  };

  const handleSaveNodeConfig = async (updatedNode: WorkflowNode) => {
    if (!selectedWorkflow) return;
    const updatedNodes = selectedWorkflow.nodes.map(n => n.id === updatedNode.id ? updatedNode : n);
    const updatedWf = { ...selectedWorkflow, nodes: updatedNodes };

    try {
      const res = await fetch(`${backendUrl}/api/automations/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedWf)
      });
      if (res.ok) {
        setEditingNode(null);
        loadWorkflowsAndLogs();
      }
    } catch (err) {
      alert('Erro ao salvar nó: ' + err);
    }
  };

  const handleAddNodeSubmit = async () => {
    if (!selectedWorkflow) return;
    const nodeCount = selectedWorkflow.nodes.length + 1;
    let newName = 'Nova Etapa';
    let defaultConfig: WorkflowNode['config'] = {};

    if (newNodeType === 'ai_skill') {
      newName = 'Executar IA';
      defaultConfig = { skillName: skills[0]?.name || 'analista-interacoes-polifarmacia-onco', inputMapping: 'Analise o payload recebido.' };
    } else if (newNodeType === 'condition') {
      newName = 'Filtro Condicional (IF)';
      defaultConfig = { field: 'statusExame', operator: 'equals', value: 'urgente' };
    } else if (newNodeType === 'http_request') {
      newName = 'Webhook HTTP de Saída';
      defaultConfig = { method: 'POST', url: 'https://api.meusistema.com/webhook-saida' };
    } else if (newNodeType === 'log_notify') {
      newName = 'Notificação no Sistema';
      defaultConfig = { message: 'Workflow executado com sucesso.' };
    }

    const newNode: WorkflowNode = {
      id: 'node_' + Date.now(),
      type: newNodeType,
      name: `${newName} (#${nodeCount})`,
      config: defaultConfig
    };

    const updatedWf = { ...selectedWorkflow, nodes: [...selectedWorkflow.nodes, newNode] };

    try {
      const res = await fetch(`${backendUrl}/api/automations/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedWf)
      });
      if (res.ok) {
        setIsAddNodeModalOpen(false);
        loadWorkflowsAndLogs();
      }
    } catch (err) {
      alert('Erro ao adicionar nó: ' + err);
    }
  };

  const handleDeleteNode = async (nodeId: string) => {
    if (!selectedWorkflow) return;
    if (selectedWorkflow.nodes.length <= 1) {
      alert('O workflow precisa ter pelo menos um nó de gatilho.');
      return;
    }
    const updatedNodes = selectedWorkflow.nodes.filter(n => n.id !== nodeId);
    const updatedWf = { ...selectedWorkflow, nodes: updatedNodes };

    try {
      const res = await fetch(`${backendUrl}/api/automations/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedWf)
      });
      if (res.ok) {
        loadWorkflowsAndLogs();
      }
    } catch (err) {
      alert('Erro ao excluir nó: ' + err);
    }
  };

  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWfName) return;

    const id = 'wf_' + Date.now();
    const newWf: Workflow = {
      id,
      name: newWfName,
      description: newWfDesc || 'Workflow customizado criado pelo usuário.',
      active: true,
      triggerEndpoint: 'endpoint_' + Date.now(),
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          name: 'Gatilho: Webhook HTTP Inbound',
          config: { triggerType: 'webhook', endpoint: `/api/webhooks/endpoint_${Date.now()}` }
        },
        {
          id: 'node_2',
          type: 'ai_skill',
          name: 'Etapa 1: Execução de IA',
          config: { skillName: skills[0]?.name || 'analista-interacoes-polifarmacia-onco', inputMapping: 'Analise os dados fornecidos.' }
        }
      ]
    };

    try {
      const res = await fetch(`${backendUrl}/api/automations/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWf)
      });
      if (res.ok) {
        setIsCreateWorkflowModalOpen(false);
        setNewWfName('');
        setNewWfDesc('');
        setSelectedWorkflowId(id);
        loadWorkflowsAndLogs();
      }
    } catch (err) {
      alert('Erro ao criar workflow: ' + err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const getNodeIcon = (type: WorkflowNode['type']) => {
    switch (type) {
      case 'trigger': return <Zap className="text-amber-400" size={18} style={{ color: '#fbbf24' }} />;
      case 'condition': return <GitBranch className="text-cyan" size={18} style={{ color: 'var(--accent-cyan)' }} />;
      case 'ai_skill': return <Bot className="text-purple" size={18} style={{ color: 'var(--accent-purple)' }} />;
      case 'http_request': return <Send className="text-green" size={18} style={{ color: 'var(--accent-green)' }} />;
      case 'log_notify': return <Bell className="text-blue-400" size={18} style={{ color: '#60a5fa' }} />;
      default: return <Sliders size={18} />;
    }
  };

  const getNodeBadgeColor = (type: WorkflowNode['type']) => {
    switch (type) {
      case 'trigger': return 'rgba(251, 191, 36, 0.15)';
      case 'condition': return 'rgba(6, 182, 212, 0.15)';
      case 'ai_skill': return 'rgba(139, 92, 246, 0.15)';
      case 'http_request': return 'rgba(16, 185, 129, 0.15)';
      case 'log_notify': return 'rgba(96, 165, 250, 0.15)';
      default: return 'rgba(255, 255, 255, 0.05)';
    }
  };

  return (
    <div className="automations-dashboard-container animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      
      {/* Top Header Section */}
      <div className="automations-header-section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Zap className="text-purple pulse" size={24} /> Engine de Automações & Workflows (Nível n8n)
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Construa fluxos interativos de nós (Gatilhos, Condições IF, Execução de Skills de IA e Webhooks de Saída) e acompanhe a execução em tempo real.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            className="btn btn-secondary btn-sm"
            onClick={loadWorkflowsAndLogs}
            disabled={isLoading}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} className={isLoading ? 'pulse' : ''} />
            Atualizar Status
          </button>
          <button 
            className="btn btn-primary btn-sm"
            onClick={() => setIsCreateWorkflowModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={16} />
            Novo Workflow
          </button>
        </div>
      </div>

      {/* Carrossel / Seletor de Workflows Salvos */}
      <div className="workflows-selector-bar glass-panel" style={{ padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={16} className="text-purple" /> Workflows de Automação Ativos ({workflows.length})
          </h4>
        </div>

        <div className="workflows-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
          {workflows.map(wf => {
            const isSelected = wf.id === selectedWorkflowId;
            const triggerNode = wf.nodes.find(n => n.type === 'trigger');
            const aiNode = wf.nodes.find(n => n.type === 'ai_skill');

            return (
              <div 
                key={wf.id} 
                onClick={() => setSelectedWorkflowId(wf.id)}
                className={`glass-panel ${isSelected ? 'selected-wf-card' : ''}`}
                style={{
                  padding: '14px 16px',
                  borderRadius: '10px',
                  border: isSelected ? '1px solid var(--accent-purple)' : '1px solid var(--border-color)',
                  background: isSelected ? 'rgba(139, 92, 246, 0.1)' : 'rgba(0, 0, 0, 0.2)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>{wf.name}</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{wf.description}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button 
                      onClick={(e) => handleToggleWorkflow(wf.id, e)}
                      style={{
                        background: wf.active ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '2px 8px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: wf.active ? '#34d399' : '#f87171',
                        cursor: 'pointer'
                      }}
                    >
                      {wf.active ? 'Ativo' : 'Pausado'}
                    </button>
                    <button 
                      onClick={(e) => handleDeleteWorkflow(wf.id, e)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                      title="Excluir Workflow"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255, 255, 255, 0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                    {triggerNode?.config?.triggerType === 'cron' ? <Clock size={12} /> : <Zap size={12} />}
                    {triggerNode?.name || 'Gatilho'}
                  </span>
                  <span>→</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(139, 92, 246, 0.15)', padding: '2px 6px', borderRadius: '4px', color: 'var(--accent-purple)' }}>
                    <Bot size={12} />
                    {aiNode?.config?.skillName || 'IA Skill'}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {wf.nodes.length} nós
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedWorkflow && (
        <>
          {/* PAINEL PRINCIPAL: CONSTRUTOR VISUAL DE WORKFLOW POR NÓS (n8n level) */}
          <div className="workflow-canvas-panel glass-panel" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '20px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
            
            {/* Header do Canvas */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)' }}>{selectedWorkflow.name}</h3>
                  <span style={{ background: selectedWorkflow.active ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)', color: selectedWorkflow.active ? '#34d399' : '#f87171', fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
                    {selectedWorkflow.active ? '● Executando em Tempo Real' : '○ Pausado'}
                  </span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{selectedWorkflow.description}</p>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button 
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsAddNodeModalOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Plus size={14} /> Adicionar Nó de Etapa
                </button>

                <button 
                  className="btn btn-primary btn-sm"
                  onClick={handleTriggerManualWorkflow}
                  disabled={isTriggeringWorkflow}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Play size={14} className={isTriggeringWorkflow ? 'pulse' : ''} />
                  {isTriggeringWorkflow ? 'Disparando Workflow...' : 'Testar Execução Manual'}
                </button>
              </div>
            </div>

            {/* VISUALIZADOR DE GRAFO / FLUXO DE NÓS SEQUENCIAIS E RAMIFICADOS */}
            <div className="nodes-pipeline-canvas" style={{ background: 'rgba(0,0,0,0.3)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
                Fluxo de Execução Interativo (Clique em qualquer nó para editar parâmetros):
              </div>

              <div className="nodes-flow-row" style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 'max-content' }}>
                {selectedWorkflow.nodes.map((node, index) => (
                  <React.Fragment key={node.id}>
                    {/* Nó de Etapa */}
                    <div 
                      className="workflow-node-card glass-panel animate-slide-in"
                      onClick={() => setEditingNode(node)}
                      style={{
                        background: getNodeBadgeColor(node.type),
                        border: '1px solid var(--border-color)',
                        borderRadius: '10px',
                        padding: '16px',
                        width: '240px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        cursor: 'pointer',
                        position: 'relative',
                        transition: 'transform 0.2s ease, border-color 0.2s ease',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {getNodeIcon(node.type)}
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                            {node.type === 'trigger' ? 'Gatilho Inbound' :
                             node.type === 'condition' ? 'Filtro (IF)' :
                             node.type === 'ai_skill' ? 'IA Playbook' :
                             node.type === 'http_request' ? 'Webhook Saída' : 'Notificação'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button 
                            className="btn-link" 
                            style={{ padding: '2px', color: 'var(--text-muted)' }}
                            onClick={(e) => { e.stopPropagation(); setEditingNode(node); }}
                            title="Editar Nó"
                          >
                            <Edit3 size={12} />
                          </button>
                          {node.type !== 'trigger' && (
                            <button 
                              className="btn-link" 
                              style={{ padding: '2px', color: '#f87171' }}
                              onClick={(e) => { e.stopPropagation(); handleDeleteNode(node.id); }}
                              title="Excluir Nó"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      <div>
                        <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>{node.name}</h4>
                        
                        {/* Resumo da Configuração do Nó */}
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.3)', padding: '6px 8px', borderRadius: '6px', fontFamily: 'var(--font-mono)' }}>
                          {node.type === 'trigger' && (
                            <span>
                              {node.config.triggerType === 'cron' ? `Cron: "${node.config.cronExpression}"` : `Endpoint: ${node.config.endpoint}`}
                            </span>
                          )}
                          {node.type === 'condition' && (
                            <span>
                              IF payload.{node.config.field} {node.config.operator} "{node.config.value}"
                            </span>
                          )}
                          {node.type === 'ai_skill' && (
                            <span>
                              Skill: <strong>{node.config.skillName}</strong>
                            </span>
                          )}
                          {node.type === 'http_request' && (
                            <span>
                              {node.config.method || 'POST'} {node.config.url?.slice(0, 25)}...
                            </span>
                          )}
                          {node.type === 'log_notify' && (
                            <span>
                              Msg: {node.config.message || 'Log registrado.'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Seta de Conexão entre Nós (Next Arrow) */}
                    {index < selectedWorkflow.nodes.length - 1 && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <ArrowRight size={20} className="text-purple pulse" style={{ color: 'var(--accent-purple)' }} />
                      </div>
                    )}
                  </React.Fragment>
                ))}

                {/* Botão Adicionar Nó ao final da cadeia */}
                <button 
                  onClick={() => setIsAddNodeModalOpen(true)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px dashed var(--border-color)',
                    borderRadius: '10px',
                    padding: '16px',
                    width: '120px',
                    height: '100px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    color: 'var(--text-muted)',
                    cursor: 'pointer'
                  }}
                >
                  <Plus size={20} />
                  <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>Nó</span>
                </button>
              </div>
            </div>

            {/* Painel de Endpoint & cURL Snippet para Injeção Externa */}
            {selectedWorkflow.triggerEndpoint && (
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '14px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Webhook Endpoint de Disparo do Workflow:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                    <code style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {backendUrl}/api/webhooks/{selectedWorkflow.triggerEndpoint}
                    </code>
                    <button 
                      className="btn-link" 
                      onClick={() => copyToClipboard(`${backendUrl}/api/webhooks/${selectedWorkflow.triggerEndpoint}`)}
                      style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      {copiedText ? <Check size={12} className="text-green" /> : <Copy size={12} />}
                      {copiedText ? 'Copiado!' : 'Copiar URL'}
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Header: <code style={{ color: 'var(--text-primary)' }}>Authorization: Bearer skills_automation_secret</code>
                </div>
              </div>
            )}
          </div>

          {/* INSPECTOR DE AUDITORIA & EXECUÇÃO DO WORKFLOW */}
          <div className="workflow-inspector-panel glass-panel" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Eye size={18} className="text-purple" />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Inspetor de Execuções e Auditoria de Nós</h3>
              </div>

              {/* Payload de Teste Rápido Input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Payload JSON para Teste:</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
              {/* Lado Esquerdo: Payload JSON de Teste e Disparo Manual */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Editar Payload JSON de Teste:</label>
                <textarea 
                  value={manualPayloadInput}
                  onChange={e => setManualPayloadInput(e.target.value)}
                  style={{
                    width: '100%',
                    height: '180px',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '10px',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.75rem',
                    resize: 'none',
                    outline: 'none'
                  }}
                />
                <button 
                  className="btn btn-primary btn-sm"
                  onClick={handleTriggerManualWorkflow}
                  disabled={isTriggeringWorkflow}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <Play size={14} className={isTriggeringWorkflow ? 'pulse' : ''} />
                  {isTriggeringWorkflow ? 'Executando Workflow...' : 'Disparar Teste Manual'}
                </button>
              </div>

              {/* Lado Direito: Histórico e Rastro de Auditoria */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Histórico de Execuções Recentes:</label>
                
                {logs.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Nenhuma execução registrada ainda. Dispare o teste manual acima para ver os nós em ação!
                  </div>
                ) : (
                  <div className="logs-history-list" style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {logs.map(log => (
                      <div 
                        key={log.id}
                        onClick={() => setSelectedTrace(log.trace)}
                        style={{
                          background: 'rgba(0, 0, 0, 0.3)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          padding: '10px 14px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <CheckCircle size={14} className={log.status === 'completed' ? 'text-green' : 'text-pink'} style={{ color: log.status === 'completed' ? '#34d399' : '#f87171' }} />
                          <div>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {log.workflowName || log.skillName} ({log.triggerType.toUpperCase()})
                            </span>
                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              Iniciado em: {new Date(log.queuedAt).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>

                        <button className="btn-link" style={{ fontSize: '0.75rem', color: 'var(--accent-purple)' }}>Ver Nós & Trace →</button>
                      </div>
                    ))}
                  </div>
                )}

                {selectedTrace && (
                  <div className="trace-modal-box glass-panel animate-slide-in" style={{ marginTop: '12px', padding: '14px', borderRadius: '8px', border: '1px solid var(--accent-purple)', background: 'rgba(139, 92, 246, 0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Rastro de Auditoria de Nós (Trace)</h4>
                      <button className="btn-link" onClick={() => setSelectedTrace(null)} style={{ color: 'var(--text-muted)' }}><X size={14} /></button>
                    </div>
                    <pre style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', maxHeight: '160px', overflowY: 'auto' }}>
                      {JSON.stringify(selectedTrace, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* MODAL DE EDIÇÃO DE NÓ */}
      {editingNode && (
        <div className="modal-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
          <div className="glass-panel animate-slide-in" style={{ width: '480px', padding: '24px', borderRadius: '12px', background: '#0d1423', border: '1px solid var(--accent-purple)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {getNodeIcon(editingNode.type)} Configurar Nó: {editingNode.name}
              </h3>
              <button className="btn-link" onClick={() => setEditingNode(null)} style={{ color: 'var(--text-muted)' }}><X size={16} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Nome do Nó:</label>
                <input 
                  type="text" 
                  value={editingNode.name} 
                  onChange={e => setEditingNode({ ...editingNode, name: e.target.value })}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              {editingNode.type === 'condition' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Campo do JSON (payload.campo):</label>
                    <input 
                      type="text" 
                      value={editingNode.config.field || ''} 
                      onChange={e => setEditingNode({ ...editingNode, config: { ...editingNode.config, field: e.target.value } })}
                      placeholder="ex: statusExame"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: 'var(--text-primary)', outline: 'none' }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Operador de Comparação:</label>
                    <select 
                      value={editingNode.config.operator || 'equals'} 
                      onChange={e => setEditingNode({ ...editingNode, config: { ...editingNode.config, operator: e.target.value as any } })}
                      style={{ background: '#0d1423', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: 'var(--text-primary)', outline: 'none' }}
                    >
                      <option value="equals">Igual a (equals)</option>
                      <option value="contains">Contém (contains)</option>
                      <option value="not_empty">Não está vazio (not_empty)</option>
                      <option value="greater_than">Maior que (greater_than)</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Valor Esperado:</label>
                    <input 
                      type="text" 
                      value={editingNode.config.value || ''} 
                      onChange={e => setEditingNode({ ...editingNode, config: { ...editingNode.config, value: e.target.value } })}
                      placeholder="ex: urgente"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: 'var(--text-primary)', outline: 'none' }}
                    />
                  </div>
                </>
              )}

              {editingNode.type === 'ai_skill' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Skill de IA Responsável:</label>
                    <select 
                      value={editingNode.config.skillName || ''} 
                      onChange={e => setEditingNode({ ...editingNode, config: { ...editingNode.config, skillName: e.target.value } })}
                      style={{ background: '#0d1423', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: 'var(--text-primary)', outline: 'none' }}
                    >
                      {skills.map(s => (
                        <option key={s.name} value={s.name}>{s.title} ({s.name})</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Instrução Adicional para a IA:</label>
                    <textarea 
                      value={editingNode.config.inputMapping || ''} 
                      onChange={e => setEditingNode({ ...editingNode, config: { ...editingNode.config, inputMapping: e.target.value } })}
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: 'var(--text-primary)', outline: 'none', height: '80px', resize: 'none' }}
                    />
                  </div>
                </>
              )}

              {editingNode.type === 'http_request' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>URL de Destino:</label>
                    <input 
                      type="text" 
                      value={editingNode.config.url || ''} 
                      onChange={e => setEditingNode({ ...editingNode, config: { ...editingNode.config, url: e.target.value } })}
                      placeholder="https://api.meusistema.com/webhook"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: 'var(--text-primary)', outline: 'none' }}
                    />
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditingNode(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={() => handleSaveNodeConfig(editingNode)}>Salvar Alterações</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE ADICIONAR NÓ */}
      {isAddNodeModalOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
          <div className="glass-panel animate-slide-in" style={{ width: '400px', padding: '24px', borderRadius: '12px', background: '#0d1423', border: '1px solid var(--accent-purple)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Adicionar Novo Nó de Etapa</h3>
              <button className="btn-link" onClick={() => setIsAddNodeModalOpen(false)} style={{ color: 'var(--text-muted)' }}><X size={16} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Tipo de Nó:</label>
              
              <div 
                onClick={() => setNewNodeType('condition')}
                style={{ padding: '12px', borderRadius: '8px', border: newNodeType === 'condition' ? '1px solid var(--accent-cyan)' : '1px solid var(--border-color)', background: newNodeType === 'condition' ? 'rgba(6, 182, 212, 0.1)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <GitBranch size={18} style={{ color: 'var(--accent-cyan)' }} />
                <div>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Filtro Condicional (IF)</h4>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Desvia ou filtra o fluxo baseado nos campos do JSON.</p>
                </div>
              </div>

              <div 
                onClick={() => setNewNodeType('ai_skill')}
                style={{ padding: '12px', borderRadius: '8px', border: newNodeType === 'ai_skill' ? '1px solid var(--accent-purple)' : '1px solid var(--border-color)', background: newNodeType === 'ai_skill' ? 'rgba(139, 92, 246, 0.1)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <Bot size={18} style={{ color: 'var(--accent-purple)' }} />
                <div>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Executar Skill de IA</h4>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Executa um playbook da IA com os dados recebidos.</p>
                </div>
              </div>

              <div 
                onClick={() => setNewNodeType('http_request')}
                style={{ padding: '12px', borderRadius: '8px', border: newNodeType === 'http_request' ? '1px solid var(--accent-green)' : '1px solid var(--border-color)', background: newNodeType === 'http_request' ? 'rgba(16, 185, 129, 0.1)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <Send size={18} style={{ color: 'var(--accent-green)' }} />
                <div>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Webhook HTTP de Saída</h4>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Envia o resultado para uma API ou sistema externo.</p>
                </div>
              </div>

              <div 
                onClick={() => setNewNodeType('log_notify')}
                style={{ padding: '12px', borderRadius: '8px', border: newNodeType === 'log_notify' ? '1px solid #60a5fa' : '1px solid var(--border-color)', background: newNodeType === 'log_notify' ? 'rgba(96, 165, 250, 0.1)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <Bell size={18} style={{ color: '#60a5fa' }} />
                <div>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Log / Alerta do Sistema</h4>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Grava notificação nos logs internos de auditoria.</p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setIsAddNodeModalOpen(false)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={handleAddNodeSubmit}>Inserir Nó no Fluxo</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CRIAR NOVO WORKFLOW */}
      {isCreateWorkflowModalOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
          <form onSubmit={handleCreateWorkflow} className="glass-panel animate-slide-in" style={{ width: '420px', padding: '24px', borderRadius: '12px', background: '#0d1423', border: '1px solid var(--accent-purple)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Criar Novo Workflow de Automação</h3>
              <button type="button" className="btn-link" onClick={() => setIsCreateWorkflowModalOpen(false)} style={{ color: 'var(--text-muted)' }}><X size={16} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Nome do Workflow:</label>
                <input 
                  type="text" 
                  value={newWfName}
                  onChange={e => setNewWfName(e.target.value)}
                  placeholder="ex: Processamento de Receitas Hospitalares"
                  required
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Descrição do Objetivo:</label>
                <textarea 
                  value={newWfDesc}
                  onChange={e => setNewWfDesc(e.target.value)}
                  placeholder="Descreva o que este fluxo de automação realiza..."
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: 'var(--text-primary)', outline: 'none', height: '70px', resize: 'none' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsCreateWorkflowModalOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary btn-sm">Criar e Abrir Canvas</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
