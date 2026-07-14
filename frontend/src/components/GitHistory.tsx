import React, { useState, useEffect } from 'react';
import { GitCommit, RotateCcw, Clock, AlertCircle } from 'lucide-react';

interface Commit {
  hash: string;
  message: string;
  date: string;
  author: string;
}

interface GitHistoryProps {
  skillName: string;
  filePath: string | null;
  backendUrl: string;
  onRevertCompleted: () => void;
  triggerRefresh: number;
}

export const GitHistory: React.FC<GitHistoryProps> = ({
  skillName,
  filePath,
  backendUrl,
  onRevertCompleted,
  triggerRefresh,
}) => {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revertingHash, setRevertingHash] = useState<string | null>(null);

  const fetchHistory = async () => {
    if (!skillName) return;
    setIsLoading(true);
    setError(null);
    try {
      let url = `${backendUrl}/api/skills/${skillName}/history`;
      if (filePath) {
        url += `?path=${encodeURIComponent(filePath)}`;
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Falha ao carregar histórico git');
      }
      const data = await response.json();
      setCommits(data);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar histórico');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [skillName, filePath, triggerRefresh]);

  const handleRevert = async (commitHash: string) => {
    if (!window.confirm(`Tem certeza que deseja reverter para a versão ${commitHash.substring(0, 7)}?`)) {
      return;
    }
    
    setRevertingHash(commitHash);
    try {
      const response = await fetch(`${backendUrl}/api/skills/${skillName}/revert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          commitHash,
          path: filePath,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Erro ao reverter versão');
      }

      alert('Versão restaurada com sucesso! Um commit de reversão foi adicionado.');
      onRevertCompleted();
      fetchHistory(); // Recarrega histórico
    } catch (e: any) {
      alert('Erro: ' + e.message);
    } finally {
      setRevertingHash(null);
    }
  };

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('pt-BR');
    } catch (e) {
      return isoString;
    }
  };

  return (
    <div className="git-history-container">
      <div className="git-header">
        <Clock size={16} className="text-purple" />
        <h4>Histórico de Alterações (Git)</h4>
      </div>

      <div className="git-body">
        {filePath ? (
          <span className="git-filter-info">
            Filtrando por: <code>{filePath}</code>
          </span>
        ) : (
          <span className="git-filter-info">
            Histórico completo da Skill: <code>{skillName}/</code>
          </span>
        )}

        {isLoading && (
          <div className="git-status-message">
            <span className="pulse">Carregando histórico Git...</span>
          </div>
        )}

        {error && (
          <div className="git-error">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {!isLoading && !error && commits.length === 0 && (
          <div className="git-empty">
            <GitCommit size={28} className="text-muted" />
            <p>Nenhuma alteração registrada ainda.</p>
          </div>
        )}

        {!isLoading && commits.length > 0 && (
          <div className="commit-list">
            {commits.map((commit, index) => {
              const isLatest = index === 0;
              const isReverting = revertingHash === commit.hash;

              return (
                <div key={commit.hash} className={`commit-card glass-panel ${isLatest ? 'latest' : ''}`}>
                  <div className="commit-card-header">
                    <div className="commit-hash">
                      <GitCommit size={14} />
                      <code>{commit.hash.substring(0, 7)}</code>
                    </div>
                    <span className="commit-date">{formatDate(commit.date)}</span>
                  </div>

                  <p className="commit-message">{commit.message}</p>
                  
                  <div className="commit-card-footer">
                    <span className="commit-author">Autor: {commit.author}</span>
                    {!isLatest && (
                      <button 
                        className="btn btn-secondary btn-mini-git" 
                        onClick={() => handleRevert(commit.hash)}
                        disabled={isReverting}
                      >
                        <RotateCcw size={12} />
                        {isReverting ? 'Revertendo...' : 'Restaurar'}
                      </button>
                    )}
                    {isLatest && <span className="latest-badge">Atual</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        .git-history-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          border-left: 1px solid var(--border-color);
          background: rgba(13, 20, 35, 0.4);
        }
        .git-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 16px;
          border-bottom: 1px solid var(--border-color);
          height: 57px;
          flex-shrink: 0;
        }
        .git-header h4 {
          font-size: 0.95rem;
        }
        .git-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .git-filter-info {
          font-size: 0.75rem;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.02);
          padding: 6px 10px;
          border-radius: 6px;
          border: 1px solid var(--border-color);
          word-break: break-all;
        }
        .git-filter-info code {
          color: var(--accent-cyan);
          font-family: var(--font-mono);
        }
        .git-status-message {
          text-align: center;
          padding: 20px;
          font-size: 0.8rem;
          color: var(--text-secondary);
        }
        .git-error {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(239, 68, 68, 0.1);
          color: #fca5a5;
          padding: 10px;
          border-radius: 6px;
          border: 1px solid rgba(239, 68, 68, 0.2);
          font-size: 0.75rem;
        }
        .git-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 40px 10px;
          gap: 12px;
          color: var(--text-muted);
        }
        .git-empty p {
          font-size: 0.8rem;
        }
        .commit-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow-y: auto;
          padding-right: 4px;
        }
        .commit-card {
          padding: 12px;
          background: rgba(255, 255, 255, 0.01);
          border: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .commit-card.latest {
          border-color: rgba(16, 185, 129, 0.3);
          background: rgba(16, 185, 129, 0.02);
        }
        .commit-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .commit-hash {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .commit-hash code {
          font-family: var(--font-mono);
          color: var(--accent-cyan);
        }
        .commit-date {
          font-size: 0.7rem;
          color: var(--text-muted);
        }
        .commit-message {
          font-size: 0.8rem;
          line-height: 1.4;
          color: var(--text-secondary);
        }
        .commit-card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid rgba(255, 255, 255, 0.04);
          padding-top: 6px;
          margin-top: 4px;
        }
        .commit-author {
          font-size: 0.7rem;
          color: var(--text-muted);
        }
        .btn-mini-git {
          padding: 2px 6px;
          font-size: 0.7rem;
          border-radius: 4px;
          background: var(--bg-tertiary);
          border-color: var(--border-color);
        }
        .btn-mini-git:hover {
          color: var(--accent-purple);
          border-color: var(--accent-purple);
        }
        .latest-badge {
          font-size: 0.65rem;
          color: var(--accent-green);
          background: rgba(16, 185, 129, 0.15);
          padding: 1px 4px;
          border-radius: 4px;
          font-weight: 600;
        }
        .text-purple { color: var(--accent-purple); }
      `}</style>
    </div>
  );
};
