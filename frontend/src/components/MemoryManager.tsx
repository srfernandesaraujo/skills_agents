import React, { useState, useEffect } from 'react';
import { Brain, Trash2, Clock, Inbox, Sparkles } from 'lucide-react';

interface MemoryItem {
  id: string;
  text: string;
  timestamp: string;
}

interface MemoryManagerProps {
  skillName: string;
  backendUrl: string;
}

export const MemoryManager: React.FC<MemoryManagerProps> = ({ skillName, backendUrl }) => {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMemories();
  }, [skillName, backendUrl]);

  const loadMemories = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${backendUrl}/api/skills/${skillName}/memories`);
      if (!response.ok) throw new Error('Falha ao carregar memórias do servidor.');
      const data = await response.json();
      setMemories(data);
    } catch (err: any) {
      setError(err.message || 'Erro de conexão.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza de que deseja apagar este aprendizado? O agente não lembrará mais disso no futuro.')) {
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/skills/${skillName}/memories/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Não foi possível excluir a memória.');
      
      // Remove do estado
      setMemories(prev => prev.filter(m => m.id !== id));
    } catch (err: any) {
      alert('Erro ao excluir: ' + err.message);
    }
  };

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return isoString;
    }
  };

  return (
    <div className="memory-manager-container glass-panel animate-fade-in">
      <div className="memory-manager-header">
        <div className="title-with-icon">
          <Brain className="text-purple pulse" size={20} />
          <div>
            <h3>Memória Semântica da Skill</h3>
            <p>Histórico de preferências e lições de comportamento aprendidas em conversas do agente.</p>
          </div>
        </div>
      </div>

      <div className="memory-manager-content">
        {isLoading ? (
          <div className="memory-loading">
            <Brain className="pulse text-purple" size={32} />
            <span>Consultando memórias vetoriais...</span>
          </div>
        ) : error ? (
          <div className="memory-error">
            <p>⚠️ {error}</p>
            <button className="btn btn-secondary btn-sm" onClick={loadMemories}>
              Tentar Novamente
            </button>
          </div>
        ) : memories.length === 0 ? (
          <div className="memory-empty">
            <Inbox size={48} className="text-muted" />
            <h4>Nenhum aprendizado registrado</h4>
            <p>
              O motor de execução detectará preferências automaticamente nas conversas.
              <br />
              Diga coisas como: <em>"A partir de agora responda apenas usando tabelas"</em> ou <em>"Não utilize abreviações"</em> no chat do Agente!
            </p>
            <div className="empty-rag-tip">
              <Sparkles size={14} className="text-purple" />
              <span>O RAG Dinâmico injetará essas regras no contexto ao detectar temas similares no chat.</span>
            </div>
          </div>
        ) : (
          <div className="memories-timeline">
            {memories.map(m => (
              <div key={m.id} className="memory-timeline-card glass-panel">
                <div className="memory-card-header">
                  <div className="memory-date">
                    <Clock size={12} className="text-muted" />
                    <span>Aprendido em: {formatDate(m.timestamp)}</span>
                  </div>
                  <button 
                    className="btn-delete-memory" 
                    onClick={() => handleDelete(m.id)}
                    title="Apagar este aprendizado"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="memory-card-body">
                  <p>"{m.text}"</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .memory-manager-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: rgba(13, 20, 35, 0.8);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          overflow: hidden;
        }
        .memory-manager-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color);
          background: rgba(0, 0, 0, 0.15);
        }
        .title-with-icon {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .title-with-icon h3 {
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .title-with-icon p {
          font-size: 0.78rem;
          color: var(--text-muted);
        }
        .memory-manager-content {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }
        .memory-loading, .memory-error, .memory-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          height: 100%;
          min-height: 250px;
          gap: 12px;
        }
        .memory-loading span {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .memory-error p {
          font-size: 0.85rem;
          color: var(--accent-pink);
        }
        .memory-empty h4 {
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .memory-empty p {
          font-size: 0.8rem;
          color: var(--text-muted);
          line-height: 1.5;
          max-width: 420px;
        }
        .empty-rag-tip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(139, 92, 246, 0.05);
          border: 1px solid rgba(139, 92, 246, 0.15);
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 0.72rem;
          color: var(--text-secondary);
          margin-top: 10px;
        }
        .memories-timeline {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .memory-timeline-card {
          background: rgba(13, 20, 35, 0.4);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 12px 16px;
          transition: all var(--transition-fast);
        }
        .memory-timeline-card:hover {
          border-color: rgba(139, 92, 246, 0.3);
          background: rgba(13, 20, 35, 0.6);
        }
        .memory-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .memory-date {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.7rem;
          color: var(--text-muted);
        }
        .btn-delete-memory {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          width: 24px;
          height: 24px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all var(--transition-fast);
        }
        .btn-delete-memory:hover {
          background: rgba(239, 68, 68, 0.1);
          color: var(--accent-pink);
        }
        .memory-card-body p {
          font-size: 0.85rem;
          color: var(--text-primary);
          line-height: 1.4;
          font-style: italic;
        }
      `}</style>
    </div>
  );
};
