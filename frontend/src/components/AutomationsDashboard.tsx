import React, { useState, useEffect } from 'react';
import { 
  Zap, Clock, Link, Play, AlertCircle, 
  CheckCircle, RefreshCw, Eye, X, Copy, Database, Cpu
} from 'lucide-react';

interface AutomationLog {
  id: string;
  skillName: string;
  triggerType: string;
  payload: any;
  status: 'queued' | 'running' | 'completed' | 'failed';
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  trace: any | null;
  error: string | null;
}

interface AutomationTrigger {
  skillName: string;
  title: string;
  description: string;
  triggerType: 'cron' | 'webhook';
  cronExpression: string | null;
  webhookEndpoint: string;
  paused: boolean;
  lastExecution: AutomationLog | null;
}

interface AutomationsDashboardProps {
  backendUrl: string;
  skills: Array<{ name: string; title: string }>;
}

export const AutomationsDashboard: React.FC<AutomationsDashboardProps> = ({ backendUrl, skills }) => {
  const [triggers, setTriggers] = useState<AutomationTrigger[]>([]);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<any | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'raciocinio' | 'rag' | 'ferramentas' | 'metricas'>('raciocinio');
  const [manualPayloadInput, setManualPayloadInput] = useState('{\n  "statusExame": "urgente",\n  "paciente": "Maria Silva",\n  "idade": 45\n}');
  const [triggeringSkill, setTriggeringSkill] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Estados do Modal de Configuração de Automação
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [selectedSkillName, setSelectedSkillName] = useState('');
  const [selectedTriggerType, setSelectedTriggerType] = useState<'webhook' | 'cron' | 'none'>('none');
  const [cronExprInput, setCronExprInput] = useState('0 8 * * 1');
  const [isSavingAutomation, setIsSavingAutomation] = useState(false);

  const handleSaveAutomation = async (skillName: string, triggerType: 'webhook' | 'cron' | 'none', cronExpression: string) => {
    setIsSavingAutomation(true);
    try {
      const response = await fetch(`${backendUrl}/api/skills/${skillName}/automation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ triggerType, cronExpression })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Erro ao salvar automação.');
      }

      setIsConfigModalOpen(false);
      setSelectedSkillName('');
      setSelectedTriggerType('none');
      setCronExprInput('0 8 * * 1');
      loadAutomationsData();
    } catch (err: any) {
      alert('Erro ao configurar automação: ' + err.message);
    } finally {
      setIsSavingAutomation(false);
    }
  };

  const handleConfigModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSkillName) return;
    handleSaveAutomation(selectedSkillName, selectedTriggerType, cronExprInput);
  };

  useEffect(() => {
    loadAutomationsData();
  }, [backendUrl]);

  const loadAutomationsData = async () => {
    setIsLoading(true);
    try {
      const trgRes = await fetch(`${backendUrl}/api/automations`);
      const logsRes = await fetch(`${backendUrl}/api/automations/logs`);
      
      if (trgRes.ok && logsRes.ok) {
        setTriggers(await trgRes.json());
        setLogs(await logsRes.json());
      }
    } catch (err) {
      console.error('Erro ao buscar dados de automações:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleTrigger = async (skillName: string) => {
    try {
      const response = await fetch(`${backendUrl}/api/automations/${skillName}/toggle`, {
        method: 'POST'
      });
      if (response.ok) {
        loadAutomationsData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTriggerManual = async (skillName: string) => {
    let parsedPayload = {};
    try {
      parsedPayload = JSON.parse(manualPayloadInput);
    } catch (e) {
      alert('JSON de Payload inválido! Corrija antes de disparar.');
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/automations/${skillName}/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(parsedPayload)
      });
      if (response.ok) {
        setTriggeringSkill(null);
        setTimeout(() => loadAutomationsData(), 800); // Aguarda enfileiramento
      }
    } catch (err) {
      console.error(err);
    }
  };

  const copyToClipboard = (text: string) => {
    const fullUrl = `${window.location.protocol}//${window.location.host}${text}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle size={14} className="text-green" />;
      case 'failed': return <AlertCircle size={14} className="text-pink" />;
      case 'running': return <RefreshCw size={14} className="text-purple pulse" />;
      default: return <Clock size={14} className="text-muted" />;
    }
  };

  // Renderiza o modal de configuração visual de automação
  const renderConfigModal = () => {
    if (!isConfigModalOpen) return null;

    return (
      <div className="modal-backdrop" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000
      }}>
        <div className="modal-container config-automation-modal glass-panel animate-fade-in" style={{
          maxWidth: '480px',
          width: '90%',
          background: 'rgba(13, 20, 35, 0.98)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          padding: '24px',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
        }}>
          <div className="modal-header" style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '12px'
          }}>
            <div className="modal-header-title" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <Zap className="text-purple pulse" size={18} />
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Configurar Gatilho de Automação</h2>
            </div>
            <button 
              className="btn-close-modal" 
              onClick={() => {
                setIsConfigModalOpen(false);
                setSelectedSkillName('');
                setSelectedTriggerType('none');
              }} 
              disabled={isSavingAutomation}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleConfigModalSubmit} className="modal-form-body" style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Selecione a Skill de IA</label>
              <select 
                value={selectedSkillName} 
                onChange={e => {
                  setSelectedSkillName(e.target.value);
                  // Auto-seleciona webhook para inicializar
                  setSelectedTriggerType('webhook');
                }}
                required
                disabled={isSavingAutomation}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  padding: '10px 14px',
                  fontSize: '0.875rem',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="" style={{ background: '#0d1423' }}>-- Escolha uma Skill --</option>
                {skills.map(s => (
                  <option key={s.name} value={s.name} style={{ background: '#0d1423' }}>{s.title} ({s.name}/)</option>
                ))}
              </select>
            </div>

            <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Tipo de Gatilho (Trigger)</label>
              <select 
                value={selectedTriggerType} 
                onChange={e => setSelectedTriggerType(e.target.value as any)}
                required
                disabled={isSavingAutomation}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  padding: '10px 14px',
                  fontSize: '0.875rem',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="none" style={{ background: '#0d1423' }}>Desativado (Nenhum)</option>
                <option value="webhook" style={{ background: '#0d1423' }}>Webhook (Event-Driven por POST)</option>
                <option value="cron" style={{ background: '#0d1423' }}>Agendamento Cron (Temporal)</option>
              </select>
            </div>

            {selectedTriggerType === 'cron' && (
              <div className="form-field animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Expressão Cron</label>
                <input 
                  type="text" 
                  placeholder="ex: 0 8 * * 1" 
                  value={cronExprInput}
                  onChange={e => setCronExprInput(e.target.value)}
                  required
                  disabled={isSavingAutomation}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    padding: '10px 14px',
                    fontSize: '0.875rem',
                    outline: 'none'
                  }}
                />
                <span className="field-hint" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  Estrutura: <code>minuto hora dia-do-mês mês dia-da-semana</code>.<br />
                  Exemplos: <code>0 8 * * 1</code> (Toda segunda às 8h), <code>0 * * * *</code> (Toda hora), <code>*/15 * * * *</code> (A cada 15 min).
                </span>
              </div>
            )}

            {selectedTriggerType === 'webhook' && (
              <div className="webhook-preview-box animate-fade-in" style={{
                background: 'rgba(139, 92, 246, 0.05)',
                border: '1px solid rgba(139, 92, 246, 0.15)',
                borderRadius: '8px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                <span className="preview-label" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Rota de Webhook Criada:</span>
                <code className="preview-url" style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  color: 'var(--accent-cyan)',
                  background: 'rgba(0,0,0,0.2)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  wordBreak: 'break-all'
                }}>/api/webhooks/{selectedSkillName || ':skill-slug'}</code>
                <span className="preview-hint" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>O sistema gerará um token Bearer para requisições POST seguras a este endpoint.</span>
              </div>
            )}

            <div className="modal-footer" style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              borderTop: '1px solid var(--border-color)',
              paddingTop: '12px',
              marginTop: '8px'
            }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => {
                  setIsConfigModalOpen(false);
                  setSelectedSkillName('');
                  setSelectedTriggerType('none');
                }}
                disabled={isSavingAutomation}
              >
                Cancelar
              </button>
              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={isSavingAutomation || !selectedSkillName}
              >
                {isSavingAutomation ? 'Salvando...' : 'Salvar Automação'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="automations-dashboard-layout">
      {renderConfigModal()}
      {/* Corpo Central: Dashboard e histórico */}
      <div className="automations-main-pane scrollbar-custom">
        <div className="dashboard-header-bar">
          <div className="dashboard-title">
            <Zap size={22} className="text-purple pulse" />
            <div>
              <h3>Painel de Automações (Event-Driven)</h3>
              <p>Gatilhos inteligentes disparados por Webhooks locais ou Agendamento Cron.</p>
            </div>
          </div>
          <div className="dashboard-header-actions" style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" onClick={() => setIsConfigModalOpen(true)}>
              <Zap size={14} />
              Configurar Novo Gatilho
            </button>
            <button className="btn btn-secondary" onClick={loadAutomationsData} disabled={isLoading}>
              <RefreshCw size={14} className={isLoading ? 'pulse' : ''} />
              Atualizar Painel
            </button>
          </div>
        </div>

        {/* Dashboard Cards Grid */}
        <section className="triggers-section">
          <h4>Gatilhos Ativos</h4>
          {triggers.length === 0 ? (
            <div className="empty-triggers-card glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '32px' }}>
              <Zap size={32} className="text-muted" />
              <p>Nenhum gatilho de automação detectado nos playbooks locais.</p>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '8px' }}>Gatilhos são definidos no cabeçalho YAML do arquivo skill.md ou configurados visualmente clicando no botão abaixo:</span>
              <button className="btn btn-primary btn-sm" onClick={() => setIsConfigModalOpen(true)}>
                <Zap size={13} />
                Configurar Primeiro Gatilho
              </button>
            </div>
          ) : (
            <div className="triggers-grid">
              {triggers.map(t => (
                <div key={t.skillName} className={`trigger-card glass-panel ${t.paused ? 'paused-card' : ''}`}>
                  <div className="trigger-card-header">
                    <div className="trigger-icon-wrapper">
                      {t.triggerType === 'cron' ? <Clock size={18} className="text-cyan" /> : <Link size={18} className="text-purple" />}
                    </div>
                    <div className="trigger-header-info">
                      <h5>{t.title}</h5>
                      <span className="trigger-skill-folder">Pasta: <code>{t.skillName}</code></span>
                    </div>
                    <div className="toggle-switch-container" title={t.paused ? 'Pausado' : 'Ativo'}>
                      <button 
                        className={`toggle-btn ${t.paused ? 'paused' : 'active'}`}
                        onClick={() => handleToggleTrigger(t.skillName)}
                      >
                        {t.paused ? 'Pausado' : 'Ativo'}
                      </button>
                    </div>
                  </div>

                  <p className="trigger-desc">{t.description}</p>

                  <div className="trigger-meta-details">
                    {t.triggerType === 'cron' ? (
                      <div className="meta-detail-row">
                        <span className="detail-label">Agendamento:</span>
                        <span className="detail-val cron-val font-mono">{t.cronExpression}</span>
                      </div>
                    ) : (
                      <div className="meta-detail-row vertical">
                        <span className="detail-label">Webhook Endpoint:</span>
                        <div className="webhook-copy-wrapper">
                          <span className="detail-val font-mono truncate">{t.webhookEndpoint}</span>
                          <button 
                            className="btn-copy-webhook"
                            onClick={() => copyToClipboard(t.webhookEndpoint)}
                            title="Copiar URL Completa"
                          >
                            <Copy size={12} />
                            {copiedText === t.webhookEndpoint ? 'Copiado!' : 'Copiar'}
                          </button>
                        </div>
                      </div>
                    )}

                    {t.lastExecution && (
                      <div className="meta-detail-row">
                        <span className="detail-label">Última execução:</span>
                        <span className="detail-val execution-status-tag">
                          {getStatusIcon(t.lastExecution.status)}
                          <span className="capitalize">{t.lastExecution.status}</span>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="trigger-actions">
                    <button 
                      className="btn btn-secondary btn-sm"
                      onClick={() => setTriggeringSkill(t.skillName)}
                      disabled={t.paused}
                    >
                      <Play size={12} />
                      Disparar Manual
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Logs de Execução de Background */}
        <section className="logs-section">
          <h4>Histórico de Auditoria em Segundo Plano</h4>
          {logs.length === 0 ? (
            <p className="empty-logs-text">Nenhuma execução em background registrada ainda.</p>
          ) : (
            <div className="logs-table-container glass-panel">
              <table className="logs-table">
                <thead>
                  <tr>
                    <th>Gatilho</th>
                    <th>Skill</th>
                    <th>Status</th>
                    <th>Agendado em</th>
                    <th>Latência</th>
                    <th>Consumo</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td className="log-type-cell">
                        <span className={`log-type-badge ${log.triggerType}`}>
                          {log.triggerType}
                        </span>
                      </td>
                      <td className="log-skill-cell font-mono">{log.skillName}</td>
                      <td className="log-status-cell">
                        <div className="status-flex">
                          {getStatusIcon(log.status)}
                          <span>{log.status}</span>
                        </div>
                      </td>
                      <td className="log-time-cell">
                        {new Date(log.queuedAt).toLocaleString('pt-BR')}
                      </td>
                      <td className="log-latency-cell font-mono">
                        {log.trace?.metrics?.latencyMs ? `${log.trace.metrics.latencyMs}ms` : '-'}
                      </td>
                      <td className="log-tokens-cell font-mono">
                        {log.trace?.metrics?.tokens?.total ? `${log.trace.metrics.tokens.total} tk` : '-'}
                      </td>
                      <td>
                        {log.trace ? (
                          <button 
                            className="btn btn-secondary btn-xs btn-icon"
                            onClick={() => { setSelectedTrace(log.trace); setInspectorTab('raciocinio'); }}
                            title="Ver Auditoria Detalhada"
                          >
                            <Eye size={12} />
                            Auditar
                          </button>
                        ) : (
                          <span className="text-muted text-xs">{log.error || '-'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Modal Disparar Manual */}
      {triggeringSkill && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel animate-slide-in">
            <div className="modal-header">
              <h4>Disparar Manualmente: {triggeringSkill}</h4>
              <button className="btn-close-modal" onClick={() => setTriggeringSkill(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">
                Injete um payload JSON customizado para simular a chegada do evento no Webhook/Cron em segundo plano:
              </p>
              <textarea
                className="input-text payload-textarea font-mono"
                rows={8}
                value={manualPayloadInput}
                onChange={e => setManualPayloadInput(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setTriggeringSkill(null)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={() => handleTriggerManual(triggeringSkill)}>
                Enfileirar Tarefa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer do Inspetor Shadowing (Reutilizado) */}
      {selectedTrace && (
        <div className="inspector-drawer glass-panel animate-slide-in-right">
          <div className="inspector-header">
            <div className="inspector-title">
              <Eye size={18} className="text-purple pulse" />
              <div>
                <h3>Auditorias de Segundo Plano</h3>
                <p>Modo Shadowing & Explicabilidade</p>
              </div>
            </div>
            <button className="btn-close-inspector" onClick={() => setSelectedTrace(null)}>
              <X size={16} />
            </button>
          </div>

          <div className="inspector-tabs-bar">
            <button 
              className={`inspector-tab-btn ${inspectorTab === 'raciocinio' ? 'active' : ''}`}
              onClick={() => setInspectorTab('raciocinio')}
            >
              Raciocínio
            </button>
            <button 
              className={`inspector-tab-btn ${inspectorTab === 'rag' ? 'active' : ''}`}
              onClick={() => setInspectorTab('rag')}
            >
              Memória (RAG)
            </button>
            <button 
              className={`inspector-tab-btn ${inspectorTab === 'ferramentas' ? 'active' : ''}`}
              onClick={() => setInspectorTab('ferramentas')}
            >
              Ferramentas
            </button>
            <button 
              className={`inspector-tab-btn ${inspectorTab === 'metricas' ? 'active' : ''}`}
              onClick={() => setInspectorTab('metricas')}
            >
              Métricas
            </button>
          </div>

          <div className="inspector-content scrollbar-custom">
            {inspectorTab === 'raciocinio' && (
              <div className="inspector-tab-pane animate-fade-in">
                <h4>Cadeia de Pensamento (Chain of Thought)</h4>
                <p className="tab-description">Processo analítico interno executado em background:</p>
                {selectedTrace.thoughtProcess ? (
                  <div className="thought-process-block">
                    {selectedTrace.thoughtProcess.split('\n').map((line: string, i: number) => (
                      <p key={i} className="thought-line">{line}</p>
                    ))}
                  </div>
                ) : (
                  <p className="empty-trace-text">Nenhum raciocínio interno documentado nesta chamada.</p>
                )}
              </div>
            )}

            {inspectorTab === 'rag' && (
              <div className="inspector-tab-pane animate-fade-in">
                <h4>Memórias Recuperadas</h4>
                {selectedTrace.memories && selectedTrace.memories.length > 0 ? (
                  <div className="retrieved-memories-list">
                    {selectedTrace.memories.map((m: string, i: number) => (
                      <div key={i} className="retrieved-memory-item glass-panel">
                        <Database size={14} className="text-cyan" />
                        <span>{m}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-trace-text">Nenhuma memória vetorial resgatada para este job.</p>
                )}
              </div>
            )}

            {inspectorTab === 'ferramentas' && (
              <div className="inspector-tab-pane animate-fade-in">
                <h4>Ferramentas Executadas</h4>
                {selectedTrace.tools && selectedTrace.tools.length > 0 ? (
                  <div className="executed-tools-list">
                    {selectedTrace.tools.map((t: any, i: number) => (
                      <div key={i} className="executed-tool-card glass-panel">
                        <div className="tool-card-header">
                          <Cpu size={14} className={t.success ? "text-green" : "text-pink"} />
                          <h5>{t.name}</h5>
                        </div>
                        <div className="tool-card-details">
                          <h6>Parâmetros de Entrada (Inputs):</h6>
                          <pre>{JSON.stringify(t.inputs, null, 2)}</pre>
                          <h6>Resultado (Outputs):</h6>
                          <pre>{t.outputs}</pre>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-trace-text">Nenhum script Python executado neste job.</p>
                )}
              </div>
            )}

            {inspectorTab === 'metricas' && (
              <div className="inspector-tab-pane animate-fade-in">
                <h4>Métricas de Execução</h4>
                <div className="metrics-grid">
                  <div className="metric-card glass-panel">
                    <span className="metric-label">Latência Total</span>
                    <span className="metric-value">{selectedTrace.metrics?.latencyMs} ms</span>
                  </div>
                  <div className="metric-card glass-panel">
                    <span className="metric-label">Tokens Totais</span>
                    <span className="metric-value">{selectedTrace.metrics?.tokens?.total}</span>
                  </div>
                  <div className="metric-card glass-panel">
                    <span className="metric-label">Prompt Tokens</span>
                    <span className="metric-value">{selectedTrace.metrics?.tokens?.prompt}</span>
                  </div>
                  <div className="metric-card glass-panel">
                    <span className="metric-label">Completion Tokens</span>
                    <span className="metric-value">{selectedTrace.metrics?.tokens?.completion}</span>
                  </div>
                </div>

                <div className="trace-meta-info glass-panel">
                  <h5>Informações do Roteamento</h5>
                  <div className="meta-row">
                    <span className="meta-label">Skill Utilizada:</span>
                    <span className="meta-val text-cyan">{selectedTrace.skillName}</span>
                  </div>
                  {selectedTrace.routingReason && (
                    <div className="meta-row vertical">
                      <span className="meta-label">Justificativa:</span>
                      <p className="meta-text">{selectedTrace.routingReason}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Estilos embutidos */}
      <style>{`
        .automations-dashboard-layout {
          display: flex;
          height: 100%;
          overflow: hidden;
          position: relative;
          background: rgba(8, 12, 20, 0.4);
          width: 100%;
        }
        .automations-main-pane {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 28px;
        }
        .dashboard-header-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 16px;
        }
        .dashboard-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .dashboard-title h3 {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .dashboard-title p {
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .triggers-section h4, .logs-section h4 {
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 16px;
        }
        .empty-triggers-card {
          padding: 30px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          background: rgba(13, 20, 35, 0.2);
        }
        .empty-triggers-card p {
          font-size: 0.85rem;
          color: var(--text-secondary);
          font-weight: 500;
        }
        .empty-triggers-card span {
          font-size: 0.75rem;
          color: var(--text-muted);
          max-width: 450px;
          line-height: 1.4;
        }
        .triggers-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
        }
        .trigger-card {
          background: rgba(13, 20, 35, 0.4);
          padding: 20px;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          transition: all var(--transition-fast);
          border: 1px solid var(--border-color);
        }
        .trigger-card:hover {
          border-color: rgba(139, 92, 246, 0.3);
          box-shadow: 0 4px 20px rgba(139, 92, 246, 0.05);
        }
        .trigger-card.paused-card {
          opacity: 0.65;
          background: rgba(10, 10, 15, 0.2);
        }
        .trigger-card-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .trigger-icon-wrapper {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          background: rgba(255,255,255,0.03);
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--border-color);
        }
        .trigger-header-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .trigger-header-info h5 {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .trigger-skill-folder {
          font-size: 0.7rem;
          color: var(--text-muted);
        }
        .toggle-btn {
          border: none;
          border-radius: 30px;
          padding: 4px 10px;
          font-size: 0.65rem;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
        }
        .toggle-btn.active {
          background: rgba(16, 185, 129, 0.15);
          color: var(--accent-green);
          border: 1px solid rgba(16, 185, 129, 0.3);
        }
        .toggle-btn.paused {
          background: rgba(244, 63, 94, 0.15);
          color: var(--accent-pink);
          border: 1px solid rgba(244, 63, 94, 0.3);
        }
        .trigger-desc {
          font-size: 0.78rem;
          color: var(--text-secondary);
          line-height: 1.4;
          min-height: 36px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .trigger-meta-details {
          background: rgba(0,0,0,0.15);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border: 1px solid rgba(255,255,255,0.02);
        }
        .meta-detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.75rem;
        }
        .meta-detail-row.vertical {
          flex-direction: column;
          align-items: flex-start;
          gap: 6px;
        }
        .detail-label {
          color: var(--text-muted);
        }
        .detail-val {
          color: var(--text-secondary);
          font-weight: 500;
        }
        .detail-val.cron-val {
          background: rgba(6, 182, 212, 0.08);
          color: var(--accent-cyan);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.7rem;
        }
        .webhook-copy-wrapper {
          display: flex;
          align-items: center;
          width: 100%;
          gap: 8px;
        }
        .webhook-copy-wrapper .detail-val {
          flex: 1;
          background: rgba(139, 92, 246, 0.08);
          color: var(--accent-purple);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.68rem;
          min-width: 0;
        }
        .btn-copy-webhook {
          background: rgba(255,255,255,0.05);
          border: 1px solid var(--border-color);
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 0.65rem;
          color: var(--text-secondary);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        }
        .btn-copy-webhook:hover {
          background: rgba(255,255,255,0.1);
          color: var(--text-primary);
        }
        .execution-status-tag {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.72rem;
          font-weight: 500;
        }
        .trigger-actions {
          margin-top: 4px;
          display: flex;
          gap: 10px;
        }
        .logs-table-container {
          background: rgba(13, 20, 35, 0.2);
          overflow-x: auto;
          border-radius: 12px;
          border: 1px solid var(--border-color);
        }
        .logs-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.78rem;
        }
        .logs-table th, .logs-table td {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color);
        }
        .logs-table th {
          background: rgba(0,0,0,0.25);
          color: var(--text-muted);
          font-weight: 600;
          font-size: 0.72rem;
          text-transform: uppercase;
        }
        .logs-table tr:hover td {
          background: rgba(255,255,255,0.01);
        }
        .log-type-badge {
          font-size: 0.65rem;
          font-weight: 600;
          text-transform: uppercase;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .log-type-badge.cron {
          background: rgba(6, 182, 212, 0.1);
          color: var(--accent-cyan);
        }
        .log-type-badge.webhook {
          background: rgba(139, 92, 246, 0.1);
          color: var(--accent-purple);
        }
        .log-type-badge.manual {
          background: rgba(255,255,255,0.06);
          color: var(--text-secondary);
        }
        .status-flex {
          display: flex;
          align-items: center;
          gap: 6px;
          text-transform: capitalize;
        }
        .empty-logs-text {
          font-size: 0.78rem;
          color: var(--text-muted);
          font-style: italic;
          text-align: center;
          padding: 30px 0;
        }

        /* Modal custom payload */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
        }
        .modal-content {
          background: rgba(13, 20, 35, 0.98);
          border: 1px solid var(--accent-purple);
          border-radius: 12px;
          width: 450px;
          max-width: 90%;
          display: flex;
          flex-direction: column;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color);
        }
        .modal-header h4 {
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .btn-close-modal {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
        }
        .modal-body {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .modal-desc {
          font-size: 0.78rem;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        .payload-textarea {
          width: 100%;
          background: #090d16;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 10px;
          font-size: 0.75rem;
          resize: none;
          color: #c9d1d9;
          outline: none;
        }
        .payload-textarea:focus {
          border-color: var(--accent-purple);
        }
        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 16px 20px;
          border-top: 1px solid var(--border-color);
        }
      `}</style>
    </div>
  );
};
