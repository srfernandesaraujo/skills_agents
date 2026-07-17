import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, Sparkles, Bot, User, Cpu, 
  Database, RefreshCw, Play, Download, Paperclip, X, FileText, Eye,
  Plus, MessageSquare, Trash2
} from 'lucide-react';
import type { SkillSummary, SkillDetail } from './FileTree';

interface ExecutionStep {
  step: 'routing' | 'load_skill' | 'generic_chat' | 'tool_executing' | 'tool_completed' | 'error' | 'rag_query' | 'rag_retrieved' | 'memory_saved';
  detail: string;
}

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  fileName?: string;
  fileMime?: string;
  filePreview?: string;
  trace?: {
    skillName: string | null;
    routingReason: string | null;
    memories: string[];
    files: { name: string; mimeType: string }[];
    tools: { name: string; inputs: any; outputs: string; success: boolean }[];
    thoughtProcess: string;
    metrics: {
      latencyMs: number;
      tokens: { prompt: number; completion: number; total: number }
    }
  };
}

interface AgentExecutionProps {
  skills: SkillSummary[];
  apiKey: string;
  backendUrl: string;
}

interface SideBySideDiffProps {
  oldText: string;
  newText: string;
}

const SideBySideDiff: React.FC<SideBySideDiffProps> = ({ oldText, newText }) => {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  return (
    <div className="side-by-side-diff-container" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', background: 'rgba(0, 0, 0, 0.4)', borderRadius: '8px', border: '1px solid var(--border-color)', height: '400px', overflow: 'hidden' }}>
      {/* Coluna 1: Original */}
      <div className="diff-column original-column" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', fontSize: '0.8rem', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Playbook Original (Antes)</div>
        <div style={{ flex: 1, padding: '12px', overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
          {oldLines.map((line, idx) => {
            const isDifferent = !newLines.includes(line);
            return (
              <div key={idx} style={{ background: isDifferent ? 'rgba(239, 68, 68, 0.2)' : 'transparent', color: isDifferent ? '#fca5a5' : 'var(--text-secondary)', padding: '0 4px', borderLeft: isDifferent ? '3px solid #ef4444' : 'none' }}>
                <span style={{ display: 'inline-block', width: '24px', color: 'var(--text-muted)', userSelect: 'none', marginRight: '8px' }}>{idx + 1}</span>
                {line || ' '}
              </div>
            );
          })}
        </div>
      </div>

      {/* Coluna 2: Modificado */}
      <div className="diff-column modified-column" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '8px 12px', background: 'rgba(16, 185, 129, 0.1)', color: '#34d399', fontSize: '0.8rem', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Playbook Otimizado pela IA (Depois)</div>
        <div style={{ flex: 1, padding: '12px', overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
          {newLines.map((line, idx) => {
            const isDifferent = !oldLines.includes(line);
            return (
              <div key={idx} style={{ background: isDifferent ? 'rgba(16, 185, 129, 0.15)' : 'transparent', color: isDifferent ? '#a7f3d0' : 'var(--text-secondary)', padding: '0 4px', borderLeft: isDifferent ? '3px solid #10b981' : 'none' }}>
                <span style={{ display: 'inline-block', width: '24px', color: 'var(--text-muted)', userSelect: 'none', marginRight: '8px' }}>{idx + 1}</span>
                {line || ' '}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const AgentExecution: React.FC<AgentExecutionProps> = ({
  skills,
  apiKey,
  backendUrl,
}) => {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Estados de Human-in-the-Loop (Aprovação de Ferramentas) e Sandbox
  const [pendingApproval, setPendingApproval] = useState<{ toolName: string; args: any } | null>(null);
  const [requireApprovalGlobal, setRequireApprovalGlobal] = useState(() => localStorage.getItem('require_approval_global') === 'true');
  const [useDockerSandbox, setUseDockerSandbox] = useState(() => localStorage.getItem('use_docker_sandbox') === 'true');

  // Estados de Auto-Tuning (Refinamento de Playbooks)
  const [tuningSkillName, setTuningSkillName] = useState<string | null>(null);
  const [tuningFeedback, setTuningFeedback] = useState('');
  const [tuningModalOpen, setTuningModalOpen] = useState(false);
  const [tuningLoading, setTuningLoading] = useState(false);
  const [tuningDiffData, setTuningDiffData] = useState<{ oldContent: string; newContent: string } | null>(null);
  const [tuningContext, setTuningContext] = useState<{ question: string; reply: string } | null>(null);

  // Estados de Histórico de Conversas
  const [conversations, setConversations] = useState<any[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const fetchConversations = async () => {
    try {
      setIsHistoryLoading(true);
      const response = await fetch(`${backendUrl}/api/conversations`);
      if (response.ok) {
        const data = await response.json();
        setConversations(data);
      }
    } catch (e) {
      console.error('Erro ao buscar conversas no frontend:', e);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, [backendUrl]);

  const handleSelectConversation = async (conversationId: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(`${backendUrl}/api/conversations/${conversationId}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
        setCurrentConversationId(conversationId);
        if (data.skillName && data.skillName !== 'general') {
          setActiveSkillName(data.skillName);
        } else {
          setActiveSkillName(null);
        }
      }
    } catch (e) {
      console.error('Erro ao obter detalhes da conversa:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteConversation = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    if (!window.confirm('Deseja realmente excluir esta conversa?')) return;
    try {
      const response = await fetch(`${backendUrl}/api/conversations/${conversationId}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setConversations(prev => prev.filter(c => c.id !== conversationId));
        if (currentConversationId === conversationId) {
          handleReset(true);
        }
      }
    } catch (e) {
      console.error('Erro ao excluir conversa:', e);
    }
  };

  const groupConversationsBySkill = (list: any[]) => {
    const groups: { [key: string]: any[] } = {};
    for (const c of list) {
      const key = c.skillName || 'general';
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(c);
    }
    return groups;
  };

  
  // Estado da Skill Ativa carregada no Agente
  const [activeSkillName, setActiveSkillName] = useState<string | null>(null);
  const [activeSkillDetail, setActiveSkillDetail] = useState<SkillDetail | null>(null);
  
  // Status flutuantes de background
  const [currentStep, setCurrentStep] = useState<ExecutionStep | null>(null);
  const [stepsLog, setStepsLog] = useState<ExecutionStep[]>([]);
  
  // Manual tool test states
  const [testingTool, setTestingTool] = useState<string | null>(null);
  const [toolOutput, setToolOutput] = useState<{ stdout: string; stderr: string; success: boolean } | null>(null);
  const [toolArgsInput, setToolArgsInput] = useState('{\n  "exemplo": "valor"\n}');

  // Estado para Arquivo Anexado e Drag and Drop
  const [attachedFile, setAttachedFile] = useState<{
    name: string;
    mimeType: string;
    base64: string;
    previewUrl: string;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Estado para o Inspetor de Auditoria (Modo Shadowing)
  const [selectedTrace, setSelectedTrace] = useState<any | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'raciocinio' | 'rag' | 'ferramentas' | 'metricas'>('raciocinio');

  const handleOpenInspector = (trace: any) => {
    setSelectedTrace(trace);
    setInspectorTab('raciocinio');
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const processFile = (file: File) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      alert('Formato de arquivo não suportado. Envie apenas imagens (JPEG, PNG, WebP) ou PDFs.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      
      setAttachedFile({
        name: file.name,
        mimeType: file.type,
        base64: base64Data,
        previewUrl: file.type.startsWith('image/') 
          ? URL.createObjectURL(file) 
          : ''
      });
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  // Helper para achatar a árvore de arquivos e retornar apenas arquivos com caminhos completos
  const flattenFiles = (items: any[]): any[] => {
    let flat: any[] = [];
    const traverse = (list: any[]) => {
      for (const item of list) {
        if (item.type === 'file') {
          flat.push(item);
        } else if (item.type === 'directory' && item.children) {
          traverse(item.children);
        }
      }
    };
    traverse(items);
    return flat;
  };

  // Scroll para baixo
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Carrega informações da Skill ativa
  useEffect(() => {
    if (activeSkillName) {
      fetchSkillDetail(activeSkillName);
    } else {
      setActiveSkillDetail(null);
    }
  }, [activeSkillName]);

  const fetchSkillDetail = async (name: string) => {
    try {
      const response = await fetch(`${backendUrl}/api/skills/${name}`);
      if (response.ok) {
        const data = await response.json();
        setActiveSkillDetail(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    
    const textToSend = customText !== undefined ? customText : inputValue.trim();
    if ((!textToSend && !attachedFile) || isLoading) return;

    const userMsg: AgentMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: textToSend,
      fileName: attachedFile?.name,
      fileMime: attachedFile?.mimeType,
      filePreview: attachedFile?.previewUrl || (attachedFile?.mimeType === 'application/pdf' ? 'pdf' : '')
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputValue('');
    setIsLoading(true);
    setToolOutput(null);
    setStepsLog([]);
    setPendingApproval(null); // Limpa qualquer aprovação pendente ao iniciar nova interação

    // Salva o anexo atual localmente para enviar e limpa o estado
    const fileToSend = attachedFile;
    setAttachedFile(null);

    try {
      const response = await fetch(`${backendUrl}/api/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
          activeSkillName,
          apiKey,
          fileData: fileToSend?.base64 || null,
          fileMime: fileToSend?.mimeType || null,
          fileName: fileToSend?.name || null,
          conversationId: currentConversationId,
          requireApprovalGlobal,
          useDockerSandbox
        }),
      });

      if (!response.ok) {
        let errorMsg = 'Erro na conexão com o Motor do Agente';
        try {
          const errData = await response.json();
          if (errData && errData.error) {
            errorMsg = errData.error;
          }
        } catch (e) {}
        throw new Error(errorMsg);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Atualiza passos flutuantes do background
      if (data.steps && data.steps.length > 0) {
        setStepsLog(data.steps);
        // Exibe o último passo relevante como flutuante
        const lastStep = data.steps[data.steps.length - 1];
        setCurrentStep(lastStep);
        // Auto-apaga o badge flutuante após 5 segundos
        setTimeout(() => setCurrentStep(null), 5000);
      }

      // Define a skill ativa se ela foi roteada pela IA
      if (data.activeSkillName) {
        setActiveSkillName(data.activeSkillName);
      }

      // Se retornou um ID de conversa, atualiza e recarrega a lista lateral
      if (data.conversationId) {
        setCurrentConversationId(data.conversationId);
        fetchConversations();
      }

      // Verifica se o backend requer aprovação para rodar ferramenta
      if (data.requiresApproval) {
        setPendingApproval(data.requiresApproval);
      }

      // Adiciona mensagem da IA
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.reply,
          trace: data.trace
        },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `🚨 Erro no Motor do Agente: ${err.message || err}`,
        },
      ]);
      setCurrentStep({ step: 'error', detail: 'Falha na execução' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApproveTool = async (toolName: string, args: any) => {
    if (isLoading) return;
    setIsLoading(true);
    setToolOutput(null);
    setPendingApproval(null); // Limpa o estado pendente ao enviar

    try {
      const response = await fetch(`${backendUrl}/api/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          activeSkillName,
          apiKey,
          fileData: null,
          fileMime: null,
          fileName: null,
          conversationId: currentConversationId,
          requireApprovalGlobal,
          bypassApproval: { toolName, args },
          useDockerSandbox
        }),
      });

      if (!response.ok) {
        let errorMsg = 'Erro na conexão com o Motor do Agente';
        try {
          const errData = await response.json();
          if (errData && errData.error) {
            errorMsg = errData.error;
          }
        } catch (e) {}
        throw new Error(errorMsg);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.steps && data.steps.length > 0) {
        setStepsLog(data.steps);
        const lastStep = data.steps[data.steps.length - 1];
        setCurrentStep(lastStep);
        setTimeout(() => setCurrentStep(null), 5000);
      }

      if (data.activeSkillName) {
        setActiveSkillName(data.activeSkillName);
      }

      if (data.conversationId) {
        setCurrentConversationId(data.conversationId);
        fetchConversations();
      }

      // Se o próximo passo também requerer aprovação
      if (data.requiresApproval) {
        setPendingApproval(data.requiresApproval);
      }

      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.reply,
          trace: data.trace
        },
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `🚨 Erro na aprovação da ferramenta: ${err.message || err}`,
        },
      ]);
      setCurrentStep({ step: 'error', detail: 'Falha na execução' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRejectTool = (toolName: string) => {
    setPendingApproval(null);
    const rejectText = `Execução da ferramenta '${toolName}' rejeitada pelo usuário.`;
    handleSendMessage(undefined, rejectText);
  };

  const handleReset = (force: boolean = false) => {
    if (force || window.confirm('Tem certeza de que deseja resetar a sessão do agente? Isso apagará o histórico da tela e descarregará a skill atual.')) {
      setMessages([]);
      setActiveSkillName(null);
      setActiveSkillDetail(null);
      setCurrentStep(null);
      setStepsLog([]);
      setToolOutput(null);
      setCurrentConversationId(null);
    }
  };

  const handleOpenAutoTune = (msg: AgentMessage) => {
    if (!activeSkillName) return;
    
    // Encontra a pergunta anterior do usuário para dar contexto
    const msgIdx = messages.findIndex(m => m.id === msg.id);
    const prevUserMsg = msgIdx > 0 ? messages[msgIdx - 1]?.content : '';

    setTuningSkillName(activeSkillName);
    setTuningContext({
      question: prevUserMsg || '',
      reply: msg.content
    });
    setTuningFeedback('');
    setTuningDiffData(null);
    setTuningModalOpen(true);
  };

  const handleTriggerAutoTune = async () => {
    if (!tuningSkillName || !tuningFeedback.trim()) return;
    setTuningLoading(true);
    setTuningDiffData(null);

    try {
      const response = await fetch(`${backendUrl}/api/agent/auto-tune`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          skillName: tuningSkillName,
          userFeedback: tuningFeedback,
          interactionContext: tuningContext,
          apiKey
        }),
      });

      if (!response.ok) {
        throw new Error('Falha ao gerar auto-tuning.');
      }

      const data = await response.json();
      if (data.success) {
        setTuningDiffData({
          oldContent: data.oldContent,
          newContent: data.newContent
        });
      }
    } catch (e: any) {
      alert('Erro ao otimizar playbook: ' + e.message);
    } finally {
      setTuningLoading(false);
    }
  };

  const handleConfirmAutoTune = async (confirmed: boolean) => {
    if (!tuningSkillName || !tuningDiffData) return;
    setTuningLoading(true);

    try {
      const response = await fetch(`${backendUrl}/api/agent/auto-tune/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          skillName: tuningSkillName,
          oldContent: tuningDiffData.oldContent,
          confirmed
        }),
      });

      if (response.ok) {
        alert(confirmed ? 'Playbook atualizado e salvo com sucesso!' : 'Alterações descartadas.');
        setTuningModalOpen(false);
        setTuningDiffData(null);
        
        if (activeSkillName) {
          fetchSkillDetail(activeSkillName);
        }
      }
    } catch (e: any) {
      alert('Erro ao confirmar alteração: ' + e.message);
    } finally {
      setTuningLoading(false);
    }
  };

  // Testa manualmente o script python
  const handleRunTool = async (toolName: string) => {
    if (!activeSkillName) return;
    setTestingTool(toolName);
    setToolOutput(null);

    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(toolArgsInput);
    } catch (e) {
      alert('Argumentos inválidos. Insira um JSON válido.');
      setTestingTool(null);
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/agent/run-tool`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          skillName: activeSkillName,
          toolName,
          args: parsedArgs,
          useDockerSandbox
        }),
      });

      if (!response.ok) throw new Error('Erro na execução do script');
      const data = await response.json();
      setToolOutput(data);
    } catch (err: any) {
      setToolOutput({
        success: false,
        stdout: '',
        stderr: err.message || err,
      });
    } finally {
      setTestingTool(null);
    }
  };

  // Renderizador simples de Markdown com suporte a tabelas
  const renderMarkdown = (md: string) => {
    let html = md;
    
    // Escapa HTML
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Tabela básica
    const lines = html.split('\n');
    let isInTable = false;
    const processedLines = lines.map(line => {
      const trimmed = line.trim();
      
      // Detecção de linha de tabela
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        let cells = trimmed.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
        
        // Se for linha de separação |---|---|
        if (trimmed.replace(/[\s-|-]/g, '') === '') {
          return '';
        }
        
        const cellTag = isInTable ? 'td' : 'th';
        const row = `<tr>${cells.map(c => `<${cellTag}>${c}</${cellTag}>`).join('')}</tr>`;
        
        if (!isInTable) {
          isInTable = true;
          return `<table><thead>${row}</thead><tbody>`;
        }
        return row;
      } else {
        if (isInTable) {
          isInTable = false;
          return `</tbody></table>\n${trimmed}`;
        }
      }
      
      return line;
    });
    
    html = processedLines.filter(l => l !== '').join('\n');

    // Cabeçalhos
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');

    // Negrito e Itálico
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Listas
    html = html.replace(/^\s*-\s+(.*?)$/gm, '<li>$1</li>');
    html = html.replace(/^\s*\*\s+(.*?)$/gm, '<li>$1</li>');

    // Links de Download (flexível para qualquer texto e normalizando caminhos relativos de media com backendUrl absoluta)
    html = html.replace(/\[(.*?)\]\((.*?media\?path=.*?)\)/gi, (_, text, url) => {
      const label = text.toLowerCase() === 'download' ? 'Baixar Arquivo Gerado' : `Baixar ${text}`;
      let normalizedUrl = url;
      if (!url.startsWith('http')) {
        const cleanPath = url.startsWith('/') ? url.substring(1) : url;
        normalizedUrl = `${backendUrl}/${cleanPath}`;
      }
      return `<a href="${normalizedUrl}" download class="chat-download-link"><Download size="12" /> ${label}</a>`;
    });

    // Blocos de código
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

    return <div className="chat-markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  // Helper para obter o badge flutuante correspondente ao estado
  const getBadgeIcon = (step: string) => {
    switch (step) {
      case 'routing': return '🔍';
      case 'load_skill': return '📥';
      case 'tool_executing': return '⚙️';
      case 'tool_completed': return '✅';
      case 'generic_chat': return '💬';
      case 'error': return '🚨';
      case 'rag_query': return '🧠';
      case 'rag_retrieved': return '📥';
      case 'memory_saved': return '💡';
      default: return '⚡';
    }
  };

  return (
    <div className="agent-execution-layout">
      {/* Coluna Esquerda: Histórico de Conversas */}
      <aside className="agent-history-sidebar">
        <div className="sidebar-section-header">
          <h4>Conversas Recentes</h4>
        </div>
        <button 
          className="btn btn-primary btn-new-chat" 
          onClick={() => handleReset(true)}
        >
          <Plus size={14} style={{ marginRight: '6px' }} />
          Nova Conversa
        </button>

        <div className="history-groups scrollbar-custom" style={{ flex: 1, overflowY: 'auto' }}>
          {isHistoryLoading && conversations.length === 0 ? (
            <p className="loading-text">Carregando histórico...</p>
          ) : conversations.length === 0 ? (
            <p className="empty-text">Nenhuma conversa recente.</p>
          ) : (
            Object.entries(groupConversationsBySkill(conversations)).map(([skillKey, list]: any) => {
              const skillDetail = skills.find(s => s.name === skillKey);
              const skillTitle = skillKey === 'general' ? 'Chat Geral' : (skillDetail?.title || skillKey);
              return (
                <div key={skillKey} className="history-group">
                  <span className="history-group-label">{skillTitle}</span>
                  <div className="history-items">
                    {list.map((c: any) => (
                      <div 
                        key={c.id} 
                        className={`history-item-row ${currentConversationId === c.id ? 'active' : ''}`}
                        onClick={() => handleSelectConversation(c.id)}
                      >
                        <MessageSquare size={14} className="item-icon" />
                        <span className="item-title" title={c.title}>{c.title}</span>
                        <button 
                          type="button"
                          className="btn-delete-item"
                          onClick={(e) => handleDeleteConversation(e, c.id)}
                          title="Excluir conversa"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Coluna Central: Chat do Agente */}
      <div 
        className={`agent-chat-pane ${isDragging ? 'dragging-active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="drag-drop-overlay animate-fade-in">
            <div className="drag-drop-overlay-card glass-panel">
              <Download size={48} className="text-purple pulse" />
              <h3>Solte o arquivo para anexar</h3>
              <p>Suporta Imagens (PNG, JPEG, WebP) e PDFs</p>
            </div>
          </div>
        )}

        {/* Topo do Painel de Chat */}
        <div className="chat-pane-header">
          <div className="chat-pane-title">
            <Sparkles size={18} className="text-purple pulse" />
            <div>
              <h3>Canal de Execução</h3>
              <p>O Agente roteará suas solicitações dinamicamente para as AI Skills locais.</p>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => handleReset(false)}>
            <RefreshCw size={14} />
            Resetar Sessão
          </button>
        </div>

        {/* Badges Flutuantes no Topo do Chat */}
        {currentStep && (
          <div className="floating-badge-container animate-slide-in">
            <div className="floating-badge">
              <span className="badge-icon">{getBadgeIcon(currentStep.step)}</span>
              <span className="badge-text">{currentStep.detail}</span>
              <button className="badge-close" onClick={() => setCurrentStep(null)}>×</button>
            </div>
          </div>
        )}

        {/* Timeline de Mensagens */}
        <div className="chat-timeline">
          {messages.length === 0 && (
            <div className="execution-welcome">
              <Sparkles size={48} className="text-purple pulse" />
              <h2>O que você deseja executar hoje?</h2>
              <p>
                Diga sua solicitação e o agente analisará o catálogo de playbooks.
                <br />
                Por exemplo: <strong>"Quero montar o roteiro de TypeScript no Posologia Tech"</strong>
              </p>
              
              <div className="routing-info-card glass-panel">
                <h4>Como o Roteamento Funciona:</h4>
                <ul>
                  <li>Inicia com um prompt enxuto e estuda o catálogo.</li>
                  <li>Ativa e carrega o playbook da skill sob demanda.</li>
                  <li>Executa scripts locais na pasta <code>/tools</code> no background.</li>
                </ul>
              </div>

              {skills.length > 0 && (
                <div className="manual-load-skills-section">
                  <span className="section-label">Ou selecione uma Skill manualmente:</span>
                  <div className="manual-skills-grid">
                    {skills.map(s => (
                      <div 
                        key={s.name} 
                        className="manual-skill-card glass-panel"
                        onClick={() => setActiveSkillName(s.name)}
                      >
                        <h5>{s.title}</h5>
                        <p>{s.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`chat-row ${msg.role}`}>
              <div className="chat-avatar">
                {msg.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}
              </div>
              <div className="chat-bubble-container">
                <span className="chat-author-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span>{msg.role === 'assistant' ? 'Agente Inteligente' : 'Você'}</span>
                  {msg.role === 'assistant' && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {msg.trace && (
                        <button 
                          type="button" 
                          className="btn-inspect-message" 
                          onClick={() => handleOpenInspector(msg.trace)}
                          title="Abrir Rastro de Auditoria (Modo Shadowing)"
                        >
                          <Eye size={12} style={{ marginRight: '4px' }} />
                          Inspetor
                        </button>
                      )}
                      {activeSkillName && (
                        <button 
                          type="button" 
                          className="btn-inspect-message" 
                          onClick={() => handleOpenAutoTune(msg)}
                          title="Ajustar regras do playbook por IA com base nesta interação"
                          style={{ borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }}
                        >
                          👎 Corrigir Regra
                        </button>
                      )}
                    </div>
                  )}
                </span>
                <div className="chat-bubble">
                  {msg.content && renderMarkdown(msg.content)}
                  
                  {msg.fileName && (
                    <div className="chat-bubble-attachment glass-panel">
                      {msg.fileMime?.startsWith('image/') ? (
                        <div className="attachment-image-wrapper">
                          {msg.filePreview && (
                            <img src={msg.filePreview} alt={msg.fileName} className="attachment-preview-img" />
                          )}
                          <span className="attachment-name">{msg.fileName}</span>
                        </div>
                      ) : (
                        <div className="attachment-pdf-wrapper">
                          <FileText size={20} className="text-purple" />
                          <div className="attachment-pdf-info">
                            <span className="attachment-name">{msg.fileName}</span>
                            <p>Documento PDF</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {pendingApproval && (
            <div className="chat-row assistant tool-approval-row">
              <div className="chat-avatar">
                <Cpu size={16} className="text-cyan pulse" style={{ color: 'var(--accent-cyan)' }} />
              </div>
              <div className="chat-bubble-container">
                <span className="chat-author-label" style={{ color: 'var(--accent-cyan)' }}>Permissão de Execução Requerida</span>
                <div className="chat-bubble tool-approval-bubble glass-panel" style={{ border: '1px solid rgba(6, 182, 212, 0.3)', padding: '16px', borderRadius: '12px', background: 'rgba(8, 20, 32, 0.85)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="tool-approval-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className="tool-approval-icon" style={{ fontSize: '20px' }}>⚙️</span>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-primary)' }}>O agente deseja rodar o script:</h4>
                      <code style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', background: 'rgba(0, 0, 0, 0.3)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'var(--font-mono)' }}>{pendingApproval.toolName}</code>
                    </div>
                  </div>
                  
                  {pendingApproval.args && Object.keys(pendingApproval.args).length > 0 && (
                    <div className="tool-approval-args" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span className="args-label" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Parâmetros de Entrada:</span>
                      <pre style={{ margin: 0, padding: '10px', background: 'rgba(0, 0, 0, 0.4)', borderRadius: '6px', overflowX: 'auto' }}><code style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#a5f3fc' }}>{JSON.stringify(pendingApproval.args, null, 2)}</code></pre>
                    </div>
                  )}

                  <div className="tool-approval-actions" style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button 
                      type="button" 
                      className="btn btn-primary btn-approve-tool" 
                      onClick={() => handleApproveTool(pendingApproval.toolName, pendingApproval.args)}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '6px 14px', background: 'var(--accent-purple)', borderColor: 'var(--accent-purple)' }}
                    >
                      <Play size={12} />
                      Aprovar Execução
                    </button>
                    <button 
                      type="button" 
                      className="btn btn-secondary btn-reject-tool" 
                      onClick={() => handleRejectTool(pendingApproval.toolName)}
                      style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                    >
                      Rejeitar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="chat-row assistant">
              <div className="chat-avatar">
                <Bot size={16} className="pulse" />
              </div>
              <div className="chat-bubble-container">
                <span className="chat-author-label">Agente pensando...</span>
                <div className="chat-bubble thinking-bubble">
                  <div className="dot"></div>
                  <div className="dot"></div>
                  <div className="dot"></div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Preview do arquivo anexado */}
        {attachedFile && (
          <div className="attached-file-preview-bar glass-panel animate-slide-in">
            <div className="attached-file-info">
              {attachedFile.mimeType.startsWith('image/') ? (
                <img src={attachedFile.previewUrl} alt={attachedFile.name} className="attached-img-thumb" />
              ) : (
                <FileText size={18} className="text-purple" />
              )}
              <span className="attached-file-name" title={attachedFile.name}>{attachedFile.name}</span>
            </div>
            <button type="button" className="btn-remove-attachment" onClick={() => setAttachedFile(null)} title="Remover anexo">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Formulário de Input do Chat */}
        <form onSubmit={handleSendMessage} className="chat-pane-input-bar">
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={handleFileChange}
            accept=".pdf,image/png,image/jpeg,image/webp"
          />
          <button 
            type="button" 
            className="btn-attach" 
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            title="Anexar arquivo (PDF ou Imagem)"
          >
            <Paperclip size={16} />
          </button>
          <input
            type="text"
            className="input-text chat-input-field"
            placeholder={isLoading ? "Agente trabalhando..." : "Digite sua mensagem..."}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            disabled={isLoading}
          />
          <button 
            type="submit" 
            className="btn-send" 
            disabled={(!inputValue.trim() && !attachedFile) || isLoading}
          >
            <Send size={16} />
          </button>
        </form>
      </div>

      {/* Coluna Direita: Contexto do Agente Ativo */}
      <aside className="agent-context-sidebar">
        <div className="sidebar-section-header">
          <h4>Contexto do Agente</h4>
        </div>

        {/* Controle de Segurança */}
        <div className="context-card glass-panel security-control-card" style={{ marginBottom: '12px', padding: '12px' }}>
          <div className="card-header-with-icon" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
            <Cpu size={14} className="text-purple" style={{ color: 'var(--accent-purple)' }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Controle de Segurança</span>
          </div>
          <div className="security-toggle-container">
            <label className="security-toggle-label" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.3' }}>
              <input 
                type="checkbox"
                checked={requireApprovalGlobal}
                onChange={e => {
                  const val = e.target.checked;
                  setRequireApprovalGlobal(val);
                  localStorage.setItem('require_approval_global', val ? 'true' : 'false');
                }}
                style={{ cursor: 'pointer', marginTop: '2px' }}
              />
              Exigir aprovação manual para scripts locais (Human-in-the-Loop)
            </label>
          </div>
          <div className="security-toggle-container" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <label className="security-toggle-label" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.3' }}>
              <input 
                type="checkbox"
                checked={useDockerSandbox}
                onChange={e => {
                  const val = e.target.checked;
                  setUseDockerSandbox(val);
                  localStorage.setItem('use_docker_sandbox', val ? 'true' : 'false');
                }}
                style={{ cursor: 'pointer', marginTop: '2px' }}
              />
              Isolamento Total de scripts locais (Container Docker Sandbox)
            </label>
          </div>
        </div>

        {/* Status da Skill Ativa */}
        <div className="context-card glass-panel">
          <span className="context-card-label">Skill Carregada</span>
          {activeSkillDetail ? (
            <div className="active-skill-info">
              <h5 className="text-purple">{activeSkillDetail.title}</h5>
              <p>{activeSkillDetail.description}</p>
              <div className="skill-id-tag">ID: <code>{activeSkillDetail.name}</code></div>
            </div>
          ) : (
            <div className="inactive-skill-info">
              <p>Nenhuma skill carregada ainda.</p>
              <span>A IA ativará o playbook apropriado no momento em que você enviar a solicitação.</span>
            </div>
          )}
        </div>

        {/* Subpastas de Ferramentas e Dados se houver Skill ativa */}
        {activeSkillDetail && (
          <>
            {/* Lista de Ferramentas Python (/tools) */}
            <div className="context-card glass-panel">
              <div className="card-header-with-icon">
                <Cpu size={14} className="text-cyan" />
                <span>Scripts de Automação (/tools)</span>
              </div>
              
              <div className="tools-list">
                {flattenFiles(activeSkillDetail.files).filter(f => f.path.startsWith('tools/')).length === 0 ? (
                  <span className="empty-list-text">Nenhum script Python disponível.</span>
                ) : (
                  flattenFiles(activeSkillDetail.files)
                    .filter(f => f.path.startsWith('tools/'))
                    .map(file => {
                      const fileName = file.name;
                      const isTesting = testingTool === fileName;
                      return (
                        <div key={file.path} className="tool-row-item">
                          <div className="tool-info">
                            <code className="tool-code">{fileName}</code>
                          </div>
                          
                          <button 
                            className="btn btn-secondary btn-mini-test"
                            onClick={() => handleRunTool(fileName)}
                            disabled={isTesting || isLoading}
                            title="Executar ferramenta localmente"
                          >
                            <Play size={10} />
                            {isTesting ? 'Rodando...' : 'Testar'}
                          </button>
                        </div>
                      );
                    })
                )}
              </div>
            </div>

            {/* Teste Manual de Parâmetros */}
            <div className="context-card glass-panel">
              <span className="context-card-label">Argumentos do Teste (JSON)</span>
              <textarea 
                className="args-textarea" 
                value={toolArgsInput}
                onChange={e => setToolArgsInput(e.target.value)}
                placeholder='{"key": "value"}'
              />
            </div>

            {/* Logs de execução manual */}
            {toolOutput && (
              <div className="context-card tool-output-card glass-panel">
                <span className="context-card-label">Output da Ferramenta</span>
                <pre className="tool-output-console">
                  {toolOutput.stdout && `stdout:\n${toolOutput.stdout}\n`}
                  {toolOutput.stderr && `stderr:\n${toolOutput.stderr}\n`}
                  {!toolOutput.stdout && !toolOutput.stderr && 'Executado (Sem logs de saída).'}
                </pre>
              </div>
            )}

            {/* Referências (/dados) */}
            <div className="context-card glass-panel">
              <div className="card-header-with-icon">
                <Database size={14} className="text-pink" />
                <span>Referências (/dados)</span>
              </div>
              <div className="references-list">
                {flattenFiles(activeSkillDetail.files).filter(f => f.path.startsWith('dados/')).length === 0 ? (
                  <span className="empty-list-text">Nenhum arquivo de referência.</span>
                ) : (
                  flattenFiles(activeSkillDetail.files)
                    .filter(f => f.path.startsWith('dados/'))
                    .map(file => (
                      <div key={file.path} className="reference-row-item">
                        <span className="reference-name" title={file.name}>{file.name}</span>
                        <a 
                          href={`${backendUrl}/api/skills/${activeSkillDetail.name}/media?path=${encodeURIComponent(file.path)}`}
                          download
                          className="btn-icon-download"
                          title="Baixar arquivo de referência"
                        >
                          <Download size={12} />
                        </a>
                      </div>
                    ))
                )}
              </div>
            </div>
          </>
        )}

        {/* Logs da Sessão (stepsLog) */}
        {stepsLog.length > 0 && (
          <div className="context-card glass-panel">
            <span className="context-card-label">Logs do Motor de Execução</span>
            <div className="steps-log-list">
              {stepsLog.map((step, idx) => (
                <div key={idx} className="step-log-item">
                  <span className="step-log-icon">{getBadgeIcon(step.step)}</span>
                  <span className="step-log-detail">{step.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Drawer Lateral do Inspetor (Modo Shadowing) */}
      {selectedTrace && (
        <div className="inspector-drawer glass-panel animate-slide-in-right">
          <div className="inspector-header">
            <div className="inspector-title">
              <Eye size={18} className="text-purple pulse" />
              <div>
                <h3>Inspetor de Execução</h3>
                <p>Modo Shadowing & Auditoria</p>
              </div>
            </div>
            <button className="btn-close-inspector" onClick={() => setSelectedTrace(null)}>
              <X size={16} />
            </button>
          </div>

          {/* Abas do Inspetor */}
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
                <h4>Debugger de Raciocínio (Visual Thinking Trace)</h4>
                <p className="tab-description">Linha do tempo diagramada de tomadas de decisão da IA:</p>
                
                <div className="visual-trace-timeline" style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative', paddingLeft: '24px', marginTop: '16px' }}>
                  {/* Linha vertical conectando os passos */}
                  <div style={{ position: 'absolute', left: '7px', top: '8px', bottom: '8px', width: '2px', background: 'var(--border-color)' }}></div>

                  {/* Passo 1: Entrada / Roteamento */}
                  <div className="trace-step-item" style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '-23px', top: '3px', width: '12px', height: '12px', borderRadius: '50%', background: 'var(--accent-purple)', border: '2px solid var(--bg-primary)' }}></div>
                    <h5 style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: 'var(--text-primary)' }}>1. Entrada e Roteamento</h5>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {selectedTrace.skillName 
                        ? `A solicitação foi roteada para a Skill: ${selectedTrace.skillName}.` 
                        : 'Executado no modo de Chat Geral (Roteamento Direto).'}
                    </p>
                    {selectedTrace.routingReason && (
                      <div style={{ marginTop: '6px', padding: '6px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        "{selectedTrace.routingReason}"
                      </div>
                    )}
                  </div>

                  {/* Passo 2: Contexto Vetorial (RAG) */}
                  <div className="trace-step-item" style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '-23px', top: '3px', width: '12px', height: '12px', borderRadius: '50%', background: selectedTrace.memories && selectedTrace.memories.length > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)', border: '2px solid var(--bg-primary)' }}></div>
                    <h5 style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: 'var(--text-primary)' }}>2. Contexto de Aprendizado e RAG</h5>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {selectedTrace.memories && selectedTrace.memories.length > 0 
                        ? `Recuperou ${selectedTrace.memories.length} preferências/memórias do banco de dados vetorial para guiar a resposta.` 
                        : 'Nenhuma memória de conversações anteriores foi necessária.'}
                    </p>
                  </div>

                  {/* Passo 3: Chamada de Ferramentas / Automações */}
                  <div className="trace-step-item" style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '-23px', top: '3px', width: '12px', height: '12px', borderRadius: '50%', background: selectedTrace.tools && selectedTrace.tools.length > 0 ? '#eab308' : 'var(--text-muted)', border: '2px solid var(--bg-primary)' }}></div>
                    <h5 style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: 'var(--text-primary)' }}>3. Execução de Ferramentas (Automações)</h5>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {selectedTrace.tools && selectedTrace.tools.length > 0 
                        ? `Foram executados ${selectedTrace.tools.length} scripts locais na sandbox durante o raciocínio.` 
                        : 'Nenhuma automação local foi acionada para esta resposta.'}
                    </p>
                  </div>

                  {/* Passo 4: Pensamento Interno */}
                  <div className="trace-step-item" style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '-23px', top: '3px', width: '12px', height: '12px', borderRadius: '50%', background: 'var(--accent-green)', border: '2px solid var(--bg-primary)' }}></div>
                    <h5 style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: 'var(--text-primary)' }}>4. Cadeia de Raciocínio (Chain of Thought)</h5>
                    <div className="thought-process-block" style={{ marginTop: '8px' }}>
                      {selectedTrace.thoughtProcess ? (
                        selectedTrace.thoughtProcess.split('\n').map((line: string, i: number) => (
                          <p key={i} className="thought-line" style={{ margin: '0 0 4px 0', fontSize: '0.75rem', lineHeight: '1.4' }}>{line}</p>
                        ))
                      ) : (
                        <p className="empty-trace-text">Nenhum rastro cognitivo oculto gerado.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {inspectorTab === 'rag' && (
              <div className="inspector-tab-pane animate-fade-in">
                <h4>Memórias Recuperadas</h4>
                <p className="tab-description">Fatos e preferências puxados semanticamente do banco vetorial:</p>
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
                  <p className="empty-trace-text">Nenhuma memória vetorial resgatada para esta pergunta.</p>
                )}
              </div>
            )}

            {inspectorTab === 'ferramentas' && (
              <div className="inspector-tab-pane animate-fade-in">
                <h4>Ferramentas Executadas</h4>
                <p className="tab-description">Ações e scripts Python acionados localmente:</p>
                {selectedTrace.tools && selectedTrace.tools.length > 0 ? (
                  <div className="executed-tools-list">
                    {selectedTrace.tools.map((t: any, i: number) => (
                      <div key={i} className="executed-tool-card glass-panel">
                        <div className="tool-card-header">
                          <Cpu size={14} className={t.success ? "text-green" : "text-pink"} />
                          <h5>{t.name}</h5>
                          <span className={`tool-badge ${t.success ? 'success' : 'failed'}`}>
                            {t.success ? 'Sucesso' : 'Erro'}
                          </span>
                        </div>
                        <div className="tool-card-details">
                          <h6>Parâmetros de Entrada (Inputs):</h6>
                          <pre>{JSON.stringify(t.inputs, null, 2)}</pre>
                          <h6>Resultado de Saída (Outputs):</h6>
                          <pre>{t.outputs}</pre>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-trace-text">Nenhum script Python executado nesta interação.</p>
                )}
              </div>
            )}

            {inspectorTab === 'metricas' && (
              <div className="inspector-tab-pane animate-fade-in">
                <h4>Métricas de Execução</h4>
                <p className="tab-description">Consumo de recursos, latência e estatísticas do modelo:</p>
                
                <div className="metrics-grid">
                  <div className="metric-card glass-panel">
                    <span className="metric-label">Latência Total</span>
                    <span className="metric-value">{selectedTrace.metrics.latencyMs} ms</span>
                    <div className="metric-sub">Tempo total de processamento</div>
                  </div>

                  <div className="metric-card glass-panel">
                    <span className="metric-label">Tokens Totais</span>
                    <span className="metric-value">{selectedTrace.metrics.tokens.total}</span>
                    <div className="metric-sub">Soma de Prompt + Completion</div>
                  </div>

                  <div className="metric-card glass-panel">
                    <span className="metric-label">Prompt Tokens</span>
                    <span className="metric-value">{selectedTrace.metrics.tokens.prompt}</span>
                    <div className="metric-sub">Tokens de entrada</div>
                  </div>

                  <div className="metric-card glass-panel">
                    <span className="metric-label">Completion Tokens</span>
                    <span className="metric-value">{selectedTrace.metrics.tokens.completion}</span>
                    <div className="metric-sub">Tokens gerados pela IA</div>
                  </div>
                </div>

                <div className="trace-meta-info glass-panel">
                  <h5>Informações de Roteamento</h5>
                  <div className="meta-row">
                    <span className="meta-label">Skill Utilizada:</span>
                    <span className="meta-val text-cyan">{selectedTrace.skillName || 'Nenhuma (Chat Genérico)'}</span>
                  </div>
                  {selectedTrace.routingReason && (
                    <div className="meta-row vertical">
                      <span className="meta-label">Justificativa do Roteamento:</span>
                      <p className="meta-text">{selectedTrace.routingReason}</p>
                    </div>
                  )}
                  {selectedTrace.files && selectedTrace.files.length > 0 && (
                    <div className="meta-row vertical">
                      <span className="meta-label">Arquivos Processados:</span>
                      <div className="processed-files-list">
                        {selectedTrace.files.map((f: any, idx: number) => (
                          <div key={idx} className="processed-file-tag">
                            <FileText size={12} />
                            <span>{f.name} ({f.mimeType})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Auto-Tuning (Ajuste inteligente de playbooks) */}
      {tuningModalOpen && (
        <div className="tuning-modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(8, 12, 20, 0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }}>
          <div className="tuning-modal-card glass-panel" style={{ width: '100%', maxWidth: '950px', background: 'rgba(13, 20, 35, 0.95)', border: '1px solid rgba(139, 92, 246, 0.3)', borderRadius: '12px', display: 'flex', flexDirection: 'column', maxHeight: '90vh', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 0 40px rgba(139, 92, 246, 0.15)' }}>
            <div className="tuning-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Cpu className="text-purple pulse" size={20} style={{ color: 'var(--accent-purple)' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Corrigir Regra do Playbook (Auto-Tuning)</h3>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>Otimização automática do playbook via Gemini e versionamento Git</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => {
                  if (tuningDiffData) {
                    if (window.confirm('Deseja descartar as alterações geradas antes de fechar?')) {
                      handleConfirmAutoTune(false);
                    }
                  } else {
                    setTuningModalOpen(false);
                  }
                }} 
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="tuning-body" style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Contexto da Interação */}
              {tuningContext && (
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.75rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>Contexto da Falha (Interação do Chat):</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderLeft: '2px solid var(--accent-purple)', paddingLeft: '8px' }}>
                    <p style={{ margin: 0 }}><strong>Você:</strong> {tuningContext.question}</p>
                    <p style={{ margin: 0, color: 'var(--text-secondary)' }}><strong>Agente:</strong> {tuningContext.reply}</p>
                  </div>
                </div>
              )}

              {/* Formulário de Crítica do Usuário (se ainda não gerou a diff) */}
              {!tuningDiffData ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Descreva qual foi o desvio e o que a IA deve fazer para corrigir:</label>
                  <textarea
                    rows={4}
                    className="input-text"
                    placeholder="Ex: Ela não deveria ter cobrado o valor do frete nesta etapa. Para clientes VIP, o frete é grátis. Corrija o playbook para refletir isso."
                    value={tuningFeedback}
                    onChange={e => setTuningFeedback(e.target.value)}
                    style={{ width: '100%', resize: 'none', padding: '10px', fontSize: '0.8rem', borderRadius: '6px', background: 'rgba(0,0,0,0.3)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', fontFamily: 'var(--font-sans)' }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>A IA analisará seu feedback e reescreverá a regra correspondente no arquivo `skill.md` gerando uma revisão temporária.</span>
                </div>
              ) : (
                /* Visualizador Side-by-Side Diff */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Compare as Alterações Propostas (Side-by-Side):</span>
                  <SideBySideDiff oldText={tuningDiffData.oldContent} newText={tuningDiffData.newContent} />
                </div>
              )}
            </div>

            <div className="tuning-footer" style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: 'rgba(0,0,0,0.1)' }}>
              {!tuningDiffData ? (
                <>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    onClick={() => setTuningModalOpen(false)}
                    disabled={tuningLoading}
                  >
                    Cancelar
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    onClick={handleTriggerAutoTune}
                    disabled={tuningLoading || !tuningFeedback.trim()}
                    style={{ background: 'var(--accent-purple)', borderColor: 'var(--accent-purple)' }}
                  >
                    {tuningLoading ? 'Otimizando Playbook...' : 'Gerar Otimização por IA'}
                  </button>
                </>
              ) : (
                <>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    onClick={() => handleConfirmAutoTune(false)}
                    disabled={tuningLoading}
                    style={{ borderColor: '#ef4444', color: '#f87171' }}
                  >
                    Descartar Ajustes (Reverter)
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    onClick={() => handleConfirmAutoTune(true)}
                    disabled={tuningLoading}
                    style={{ background: '#10b981', borderColor: '#10b981' }}
                  >
                    Confirmar Ajuste no Playbook
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .agent-execution-layout {
          display: grid;
          grid-template-columns: 260px 1fr 340px;
          height: 100%;
          overflow: hidden;
          background: rgba(8, 12, 20, 0.4);
        }
        .agent-history-sidebar {
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border-color);
          background: rgba(13, 20, 35, 0.5);
          height: 100%;
          overflow: hidden;
          flex-shrink: 0;
          min-height: 0;
        }
        .btn-new-chat {
          margin: 12px 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, var(--accent-purple), #7c3aed);
          color: white;
          border: none;
          font-weight: 500;
          font-size: 0.85rem;
          padding: 8px 16px;
          border-radius: 8px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }
        .btn-new-chat:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
        }
        .history-groups {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 0 16px 16px 16px;
        }
        .history-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .history-group-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          font-weight: 600;
          padding-left: 4px;
        }
        .history-items {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .history-item-row {
          display: flex;
          align-items: center;
          padding: 8px 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: all var(--transition-fast);
          position: relative;
        }
        .history-item-row:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        .history-item-row.active {
          background: rgba(139, 92, 246, 0.15);
          border: 1px solid rgba(139, 92, 246, 0.3);
        }
        .history-item-row .item-icon {
          color: var(--text-muted);
          margin-right: 8px;
          flex-shrink: 0;
        }
        .history-item-row.active .item-icon {
          color: var(--accent-purple);
        }
        .history-item-row .item-title {
          font-size: 0.8rem;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          padding-right: 20px;
        }
        .history-item-row.active .item-title {
          color: var(--text-primary);
          font-weight: 500;
        }
        .btn-delete-item {
          position: absolute;
          right: 6px;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          opacity: 0;
          transition: opacity var(--transition-fast);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          border-radius: 4px;
        }
        .btn-delete-item:hover {
          color: var(--accent-pink);
          background: rgba(255, 255, 255, 0.05);
        }
        .history-item-row:hover .btn-delete-item {
          opacity: 1;
        }
        .loading-text, .empty-text {
          font-size: 0.75rem;
          color: var(--text-muted);
          text-align: center;
          padding-top: 12px;
        }
        .agent-chat-pane {
          display: flex;
          flex-direction: column;
          height: 100%;
          border-right: 1px solid var(--border-color);
          position: relative;
          background: rgba(8, 12, 20, 0.6);
          min-height: 0;
        }
        .chat-pane-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 20px;
          border-bottom: 1px solid var(--border-color);
          background: rgba(13, 20, 35, 0.9);
          height: 57px;
          flex-shrink: 0;
        }
        .chat-pane-title {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .chat-pane-title h3 {
          font-size: 0.95rem;
          font-weight: 600;
        }
        .chat-pane-title p {
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .floating-badge-container {
          position: absolute;
          top: 70px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 100;
          pointer-events: none;
        }
        .floating-badge {
          pointer-events: auto;
          background: rgba(15, 23, 42, 0.95);
          border: 1px solid var(--accent-purple);
          box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 10px rgba(139, 92, 246, 0.2);
          border-radius: 30px;
          padding: 6px 14px;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-primary);
          font-size: 0.8rem;
          font-weight: 500;
        }
        .badge-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 1rem;
          line-height: 1;
        }
        .badge-close:hover {
          color: var(--text-primary);
        }
        .chat-timeline {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .execution-welcome {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          margin-top: 40px;
          gap: 14px;
          max-width: 550px;
          align-self: center;
        }
        .execution-welcome h2 {
          font-size: 1.4rem;
        }
        .execution-welcome p {
          font-size: 0.875rem;
          color: var(--text-secondary);
          line-height: 1.5;
        }
        .routing-info-card {
          text-align: left;
          padding: 16px 20px;
          width: 100%;
          background: rgba(13, 20, 35, 0.5);
          margin-top: 10px;
        }
        .routing-info-card h4 {
          font-size: 0.85rem;
          margin-bottom: 8px;
          color: var(--text-primary);
        }
        .routing-info-card ul {
          padding-left: 20px;
          font-size: 0.8rem;
          color: var(--text-muted);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .chat-row {
          display: flex;
          gap: 12px;
          max-width: 80%;
        }
        .chat-row.user {
          align-self: flex-end;
          flex-direction: row-reverse;
        }
        .chat-row.assistant {
          align-self: flex-start;
        }
        .chat-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .user .chat-avatar {
          background: var(--bg-tertiary);
          color: var(--accent-cyan);
          border: 1px solid var(--border-color);
        }
        .assistant .chat-avatar {
          background: rgba(139, 92, 246, 0.2);
          color: var(--accent-purple);
          border: 1px solid rgba(139, 92, 246, 0.4);
        }
        .chat-bubble-container {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .chat-author-label {
          font-size: 0.75rem;
          color: var(--text-muted);
          font-weight: 500;
        }
        .user .chat-author-label {
          text-align: right;
        }
        .chat-bubble {
          padding: 12px 16px;
          border-radius: 12px;
          font-size: 0.9rem;
          line-height: 1.5;
        }
        .user .chat-bubble {
          background: linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(6, 182, 212, 0.05));
          border: 1px solid rgba(6, 182, 212, 0.25);
          color: var(--text-primary);
          border-top-right-radius: 2px;
        }
        .assistant .chat-bubble {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          border-top-left-radius: 2px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .thinking-bubble {
          display: flex;
          gap: 4px;
          align-items: center;
          padding: 14px 20px;
        }
        .thinking-bubble .dot {
          width: 6px;
          height: 6px;
          background: var(--text-muted);
          border-radius: 50%;
          animation: bounce 1.4s infinite ease-in-out both;
        }
        .thinking-bubble .dot:nth-child(1) { animation-delay: -0.32s; }
        .thinking-bubble .dot:nth-child(2) { animation-delay: -0.16s; }
        
        .chat-pane-input-bar {
          display: flex;
          padding: 16px 20px;
          border-top: 1px solid var(--border-color);
          gap: 10px;
          background: rgba(13, 20, 35, 0.9);
          flex-shrink: 0;
        }
        .chat-input-field {
          flex: 1;
        }
        .btn-send {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, var(--accent-purple), #7c3aed);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all var(--transition-fast);
        }
        .btn-send:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 0 12px rgba(139, 92, 246, 0.4);
        }
        .btn-send:disabled {
          background: var(--bg-tertiary);
          color: var(--text-muted);
          cursor: not-allowed;
        }
        
        /* Estilos Markdown no Chat */
        .chat-markdown-body h1 {
          font-size: 1.3rem;
          margin-bottom: 8px;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 4px;
        }
        .chat-markdown-body h2 {
          font-size: 1.15rem;
          margin-top: 12px;
          margin-bottom: 6px;
        }
        .chat-markdown-body h3 {
          font-size: 1.05rem;
          margin-top: 10px;
          margin-bottom: 4px;
        }
        .chat-markdown-body p {
          font-size: 0.875rem;
          color: #e2e8f0;
          margin-bottom: 8px;
        }
        .chat-markdown-body ul, .chat-markdown-body ol {
          margin-bottom: 8px;
          padding-left: 20px;
        }
        .chat-markdown-body li {
          font-size: 0.875rem;
          color: #cbd5e1;
          margin-bottom: 2px;
        }
        .chat-markdown-body pre {
          background: #090d16;
          border: 1px solid var(--border-color);
          padding: 10px;
          border-radius: 6px;
          overflow-x: auto;
          margin-bottom: 8px;
        }
        .chat-markdown-body code {
          font-family: var(--font-mono);
          font-size: 0.8rem;
          background: rgba(255, 255, 255, 0.08);
          padding: 1px 4px;
          border-radius: 4px;
          color: var(--accent-cyan);
        }
        .chat-markdown-body pre code {
          background: none;
          padding: 0;
          color: #cbd5e1;
        }
        .chat-markdown-body table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
          font-size: 0.8rem;
        }
        .chat-markdown-body th, .chat-markdown-body td {
          border: 1px solid var(--border-color);
          padding: 6px 10px;
          text-align: left;
        }
        .chat-markdown-body th {
          background: rgba(255,255,255,0.05);
          font-weight: 600;
        }
        .chat-download-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(16, 185, 129, 0.15);
          color: var(--accent-green);
          border: 1px solid rgba(16, 185, 129, 0.3);
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 0.8rem;
          text-decoration: none;
          margin-top: 6px;
          transition: all var(--transition-fast);
        }
        .chat-download-link:hover {
          background: rgba(16, 185, 129, 0.25);
          border-color: rgba(16, 185, 129, 0.5);
        }
        
        /* Sidebar Contexto */
        .agent-context-sidebar {
          background: rgba(13, 20, 35, 0.5);
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 16px;
          overflow-y: auto;
          height: 100%;
          max-height: 100%;
          min-height: 0;
        }
        .sidebar-section-header {
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 8px;
          margin-bottom: 4px;
        }
        .sidebar-section-header h4 {
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
        }
        .context-card {
          padding: 12px;
          background: rgba(13, 20, 35, 0.6);
        }
        .context-card-label {
          display: block;
          font-size: 0.7rem;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .active-skill-info h5 {
          font-size: 0.9rem;
          margin-bottom: 4px;
        }
        .active-skill-info p {
          font-size: 0.78rem;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        .skill-id-tag {
          margin-top: 6px;
          font-size: 0.7rem;
        }
        .skill-id-tag code {
          color: var(--accent-cyan);
        }
        .inactive-skill-info p {
          font-size: 0.8rem;
          font-weight: 500;
          color: var(--text-secondary);
        }
        .inactive-skill-info span {
          display: block;
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-top: 4px;
        }
        .card-header-with-icon {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-secondary);
          margin-bottom: 8px;
        }
        .tools-list, .references-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tool-row-item, .reference-row-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 6px 8px;
        }
        .tool-code {
          font-family: var(--font-mono);
          font-size: 0.75rem;
          color: var(--accent-cyan);
        }
        .btn-mini-test {
          padding: 2px 8px;
          font-size: 0.7rem;
          gap: 4px;
          border-radius: 4px;
        }
        .args-textarea {
          width: 100%;
          height: 60px;
          background: var(--bg-input);
          border: 1px solid var(--border-color);
          color: var(--accent-cyan);
          font-family: var(--font-mono);
          font-size: 0.75rem;
          padding: 6px;
          border-radius: 6px;
          resize: none;
          outline: none;
        }
        .args-textarea:focus {
          border-color: var(--accent-purple);
        }
        .tool-output-card {
          border-color: rgba(6, 182, 212, 0.3);
          background: rgba(6, 182, 212, 0.02);
        }
        .tool-output-console {
          font-family: var(--font-mono);
          font-size: 0.7rem;
          background: #090d16;
          padding: 6px;
          border-radius: 4px;
          max-height: 120px;
          overflow-y: auto;
          white-space: pre-wrap;
          color: #c9d1d9;
        }
        .reference-name {
          font-size: 0.75rem;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          padding-right: 8px;
        }
        .btn-icon-download {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 4px;
        }
        .btn-icon-download:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--accent-green);
        }
        .empty-list-text {
          font-size: 0.72rem;
          color: var(--text-muted);
          font-style: italic;
        }
        .text-cyan { color: var(--accent-cyan); }
        .text-pink { color: var(--accent-pink); }

        /* Estilos da Seleção Manual de Skills */
        .manual-load-skills-section {
          width: 100%;
          margin-top: 20px;
          text-align: left;
        }
        .section-label {
          display: block;
          font-size: 0.8rem;
          color: var(--text-muted);
          margin-bottom: 10px;
          font-weight: 500;
        }
        .manual-skills-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          width: 100%;
        }
        .manual-skill-card {
          padding: 12px;
          cursor: pointer;
          transition: all var(--transition-fast);
          background: rgba(13, 20, 35, 0.4);
          text-align: left;
        }
        .manual-skill-card:hover {
          border-color: var(--accent-purple);
          background: rgba(139, 92, 246, 0.05);
          transform: translateY(-1px);
        }
        .manual-skill-card h5 {
          font-size: 0.85rem;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .manual-skill-card p {
          font-size: 0.75rem;
          color: var(--text-muted);
          line-height: 1.3;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* Estilos dos logs do motor na barra lateral */
        .steps-log-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 150px;
          overflow-y: auto;
        }
        .step-log-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.75rem;
          color: var(--text-secondary);
          background: rgba(0,0,0,0.15);
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid var(--border-color);
        }
        .step-log-icon {
          flex-shrink: 0;
        }
        .step-log-detail {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Estilos de Anexo de Arquivo no Chat */
        .btn-attach {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          width: 40px;
          height: 40px;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all var(--transition-fast);
          flex-shrink: 0;
        }
        .btn-attach:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary);
          border-color: var(--text-muted);
        }
        .attached-file-preview-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 16px;
          margin: 0 20px 10px 20px;
          background: rgba(13, 20, 35, 0.95);
          border: 1px solid var(--accent-purple);
          border-radius: 8px;
          box-shadow: 0 0 10px rgba(139, 92, 246, 0.15);
          flex-shrink: 0;
        }
        .attached-file-info {
          display: flex;
          align-items: center;
          gap: 10px;
          max-width: 80%;
        }
        .attached-img-thumb {
          width: 32px;
          height: 32px;
          border-radius: 4px;
          object-fit: cover;
          border: 1px solid var(--border-color);
        }
        .attached-file-name {
          font-size: 0.8rem;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .btn-remove-attachment {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 4px;
          transition: all var(--transition-fast);
        }
        .btn-remove-attachment:hover {
          background: rgba(239, 68, 68, 0.1);
          color: var(--accent-pink);
        }

        /* Drag and Drop Overlay */
        .agent-chat-pane.dragging-active {
          border-color: var(--accent-purple) !important;
          background: rgba(139, 92, 246, 0.02) !important;
        }
        .drag-drop-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(8, 12, 20, 0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          pointer-events: none;
        }
        .drag-drop-overlay-card {
          padding: 30px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          background: rgba(13, 20, 35, 0.95);
          border: 1px solid var(--accent-purple);
          box-shadow: 0 0 30px rgba(139, 92, 246, 0.3);
          border-radius: 12px;
          max-width: 400px;
        }
        .drag-drop-overlay-card h3 {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .drag-drop-overlay-card p {
          font-size: 0.8rem;
          color: var(--text-muted);
        }

        /* Previews de anexos dentro da bolha de chat */
        .chat-bubble-attachment {
          margin-top: 8px;
          padding: 8px 12px;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          display: flex;
          align-items: center;
          max-width: 280px;
        }
        .attachment-image-wrapper {
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
        }
        .attachment-preview-img {
          max-width: 100%;
          max-height: 150px;
          border-radius: 4px;
          object-fit: cover;
          border: 1px solid var(--border-color);
        }
        .attachment-name {
          font-size: 0.75rem;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 500;
        }
        .attachment-pdf-wrapper {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
        }
        .attachment-pdf-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .attachment-pdf-info span {
          font-size: 0.75rem;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 500;
        }
        .attachment-pdf-info p {
          font-size: 0.65rem;
          color: var(--text-muted);
        }

        /* Estilos do Inspetor (Modo Shadowing) */
        .btn-inspect-message {
          background: rgba(139, 92, 246, 0.15);
          border: 1px solid rgba(139, 92, 246, 0.3);
          color: var(--accent-purple);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 0.65rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          transition: all var(--transition-fast);
        }
        .btn-inspect-message:hover {
          background: var(--accent-purple);
          color: #fff;
          border-color: var(--accent-purple);
        }
        .inspector-drawer {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          width: 380px;
          background: rgba(10, 15, 30, 0.96);
          border-left: 1px solid var(--border-color);
          z-index: 1000;
          display: flex;
          flex-direction: column;
          box-shadow: -10px 0 30px rgba(0, 0, 0, 0.5);
        }
        .inspector-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color);
          flex-shrink: 0;
        }
        .inspector-title {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .inspector-title h3 {
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .inspector-title p {
          font-size: 0.7rem;
          color: var(--text-muted);
        }
        .btn-close-inspector {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 4px;
          transition: all var(--transition-fast);
        }
        .btn-close-inspector:hover {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }
        .inspector-tabs-bar {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          border-bottom: 1px solid var(--border-color);
          background: rgba(0,0,0,0.15);
          flex-shrink: 0;
        }
        .inspector-tab-btn {
          border: none;
          background: none;
          color: var(--text-secondary);
          font-size: 0.72rem;
          font-weight: 500;
          padding: 10px 0;
          cursor: pointer;
          transition: all var(--transition-fast);
          text-align: center;
          border-bottom: 2px solid transparent;
        }
        .inspector-tab-btn:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.02);
        }
        .inspector-tab-btn.active {
          color: var(--accent-purple);
          border-bottom-color: var(--accent-purple);
          background: rgba(139, 92, 246, 0.04);
        }
        .inspector-content {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }
        .inspector-tab-pane h4 {
          font-size: 0.9rem;
          font-weight: 600;
          margin-bottom: 4px;
          color: var(--text-primary);
        }
        .tab-description {
          font-size: 0.72rem;
          color: var(--text-muted);
          margin-bottom: 16px;
        }
        .thought-process-block {
          background: rgba(0, 0, 0, 0.25);
          border: 1px dashed rgba(139, 92, 246, 0.25);
          border-radius: 8px;
          padding: 12px;
          font-family: var(--font-sans);
          font-size: 0.78rem;
          line-height: 1.5;
          color: #c9d1d9;
        }
        .thought-line {
          margin-bottom: 8px;
        }
        .thought-line:last-child {
          margin-bottom: 0;
        }
        .empty-trace-text {
          font-size: 0.78rem;
          color: var(--text-muted);
          font-style: italic;
          text-align: center;
          padding: 30px 0;
        }
        .retrieved-memories-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .retrieved-memory-item {
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.02);
          display: flex;
          align-items: flex-start;
          gap: 10px;
          font-size: 0.75rem;
          line-height: 1.4;
          color: var(--text-secondary);
          border-radius: 6px;
          border: 1px solid var(--border-color);
        }
        .retrieved-memory-item span {
          flex: 1;
        }
        .executed-tools-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .executed-tool-card {
          background: rgba(255, 255, 255, 0.02);
          overflow: hidden;
          border-radius: 8px;
          border: 1px solid var(--border-color);
        }
        .tool-card-header {
          padding: 8px 12px;
          background: rgba(0,0,0,0.2);
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid var(--border-color);
        }
        .tool-card-header h5 {
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--text-primary);
          flex: 1;
        }
        .tool-badge {
          font-size: 0.62rem;
          padding: 1px 6px;
          border-radius: 4px;
          font-weight: 600;
        }
        .tool-badge.success {
          background: rgba(16, 185, 129, 0.15);
          color: var(--accent-green);
        }
        .tool-badge.failed {
          background: rgba(244, 63, 94, 0.15);
          color: var(--accent-pink);
        }
        .tool-card-details {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tool-card-details h6 {
          font-size: 0.7rem;
          color: var(--text-muted);
          font-weight: 500;
          margin-top: 4px;
        }
        .tool-card-details h6:first-child {
          margin-top: 0;
        }
        .tool-card-details pre {
          background: #090d16;
          padding: 8px;
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 0.7rem;
          color: #c9d1d9;
          white-space: pre-wrap;
          overflow-x: auto;
          border: 1px solid rgba(255,255,255,0.03);
        }
        .metrics-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 20px;
        }
        .metric-card {
          padding: 12px;
          background: rgba(255, 255, 255, 0.02);
          display: flex;
          flex-direction: column;
          gap: 4px;
          border-radius: 8px;
          border: 1px solid var(--border-color);
        }
        .metric-label {
          font-size: 0.65rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .metric-value {
          font-size: 1.15rem;
          font-weight: 700;
          color: var(--accent-purple);
        }
        .metric-card:nth-child(3) .metric-value,
        .metric-card:nth-child(4) .metric-value {
          color: var(--text-secondary);
          font-size: 1rem;
        }
        .metric-sub {
          font-size: 0.62rem;
          color: var(--text-muted);
        }
        .trace-meta-info {
          padding: 14px;
          background: rgba(255, 255, 255, 0.01);
          display: flex;
          flex-direction: column;
          gap: 10px;
          border-radius: 8px;
          border: 1px solid var(--border-color);
        }
        .trace-meta-info h5 {
          font-size: 0.78rem;
          font-weight: 600;
          margin-bottom: 4px;
          color: var(--text-primary);
        }
        .meta-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.72rem;
        }
        .meta-row.vertical {
          flex-direction: column;
          gap: 4px;
        }
        .meta-label {
          color: var(--text-muted);
        }
        .meta-val {
          font-weight: 500;
        }
        .meta-text {
          color: var(--text-secondary);
          line-height: 1.4;
          background: rgba(0,0,0,0.15);
          padding: 8px;
          border-radius: 6px;
        }
        .processed-files-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 2px;
        }
        .processed-file-tag {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(255, 255, 255, 0.04);
          padding: 4px 8px;
          border-radius: 4px;
          color: var(--text-secondary);
          font-size: 0.7rem;
        }
      `}</style>
    </div>
  );
};
