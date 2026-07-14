import React, { useState } from 'react';
import { Sparkles, X, Layers, Cpu, Loader2 } from 'lucide-react';

interface CreateSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (skillData: {
    name: string;
    title: string;
    role: string;
    objective: string;
    targetAudience: string;
    needsFiles: boolean;
    needsTools: boolean;
  }) => void;
  isLoading: boolean;
  loadingStep: string;
  apiKey: string;
}

export const CreateSkillModal: React.FC<CreateSkillModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isLoading,
  loadingStep,
  apiKey,
}) => {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('');
  const [objective, setObjective] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [needsFiles, setNeedsFiles] = useState(false);
  const [needsTools, setNeedsTools] = useState(false);

  if (!isOpen) return null;

  const handleSlugChange = (val: string) => {
    // Sanitiza para slug (apenas minúsculas, números e hifens)
    const slug = val
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-');
    setName(slug);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    onSubmit({
      name: name.trim(),
      title: title.trim() || name.trim(),
      role: role.trim(),
      objective: objective.trim(),
      targetAudience: targetAudience.trim(),
      needsFiles,
      needsTools,
    });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-container create-skill-modal-content glass-panel animated-fade-in">
        <div className="modal-header">
          <div className="modal-header-title">
            <Sparkles className="text-purple pulse-animation" size={20} />
            <h2>Criar Nova Skill por IA</h2>
          </div>
          {!isLoading && (
            <button className="btn-close-modal" onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="modal-loading-state">
            <Loader2 className="spinner text-purple" size={48} />
            <h3>Construindo Skill de Alta Qualidade</h3>
            <p className="loading-step-text">{loadingStep || 'Processando com IA...'}</p>
            <div className="loading-bar-container">
              <div className="loading-bar-fill"></div>
            </div>
            <p className="loading-tip-text">Isso pode levar de 15 a 30 segundos, pois estamos gerando a Skill e os arquivos de referência específicos.</p>
          </div>
        ) : (
          <form onSubmit={handleFormSubmit} className="modal-form-body">
            {!apiKey && (
              <div className="warning-banner-container">
                <p>⚠️ <strong>Chave de API do Gemini ausente:</strong> Por favor, cadastre sua chave de API nas Configurações (ícone de engrenagem) antes de gerar a Skill por IA.</p>
              </div>
            )}

            <div className="form-row-double">
              <div className="form-field">
                <label>
                  Identificador (Slug) <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  placeholder="ex: farmaceutico-anamnese-simulada"
                  value={name}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  required
                />
                <span className="field-hint">Nome da pasta física no sistema (minúsculas, números e hifens).</span>
              </div>

              <div className="form-field">
                <label>Título de Apresentação</label>
                <input
                  type="text"
                  placeholder="ex: Farmacêutico Especialista em Anamnese"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <span className="field-hint">Título exibido na interface visual do gerenciador.</span>
              </div>
            </div>

            <div className="form-field">
              <label>Papel e Especialidade do Agente (Role)</label>
              <input
                type="text"
                placeholder="ex: Farmacêutico Clínico experiente em simulações OSCE..."
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
              <span className="field-hint">A persona do Agente. Define o tom, autoridade e profundidade do playbook.</span>
            </div>

            <div className="form-field">
              <label>Objetivo Central / Cenário da Consulta</label>
              <textarea
                placeholder="ex: Ensinar estudantes a conduzirem consultas de anamnese farmacêutica. O aluno atua como farmacêutico e o agente como paciente simulado, fornecendo um feedback com rubrica de avaliação ao final."
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                rows={3}
                required
              />
              <span className="field-hint">O que a IA fará. A descrição será usada pela IA para criar um playbook contextualizado de altíssima qualidade.</span>
            </div>

            <div className="form-field">
              <label>Público-Alvo da Skill</label>
              <input
                type="text"
                placeholder="ex: Alunos de graduação em Farmácia preparando-se para o OSCE"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
              />
            </div>

            <div className="form-checkbox-row">
              <label className="checkbox-card">
                <input
                  type="checkbox"
                  checked={needsFiles}
                  onChange={(e) => setNeedsFiles(e.target.checked)}
                />
                <div className="checkbox-card-content">
                  <span className="checkbox-title">
                    <Layers size={16} /> Suporta Arquivos (RAG)
                  </span>
                  <span className="checkbox-desc">A Skill fará leitura e ingestão de exames, prontuários ou bulas enviados no chat.</span>
                </div>
              </label>

              <label className="checkbox-card">
                <input
                  type="checkbox"
                  checked={needsTools}
                  onChange={(e) => setNeedsTools(e.target.checked)}
                />
                <div className="checkbox-card-content">
                  <span className="checkbox-title">
                    <Cpu size={16} /> Executa Scripts (Tools)
                  </span>
                  <span className="checkbox-desc">Permite acionar ferramentas e scripts locais Python (/tools) para cálculos ou validações.</span>
                </div>
              </label>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={!name.trim() || !apiKey}>
                Gerar com IA Premium
              </button>
            </div>
          </form>
        )}
      </div>

      <style>{`
        .create-skill-modal-content {
          max-width: 680px;
          width: 90%;
          background: rgba(13, 20, 35, 0.95);
          border: 1px solid rgba(139, 92, 246, 0.3);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
          padding: 24px;
        }
        .modal-form-body {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-top: 16px;
        }
        .form-row-double {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .form-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .form-field label {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .form-field input, .form-field textarea {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          color: var(--text-primary);
          padding: 10px 14px;
          font-size: 0.875rem;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .form-field input:focus, .form-field textarea:focus {
          border-color: var(--accent-purple);
          box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.25);
        }
        .field-hint {
          font-size: 0.72rem;
          color: var(--text-muted);
        }
        .form-checkbox-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-top: 8px;
        }
        .checkbox-card {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .checkbox-card:hover {
          border-color: rgba(139, 92, 246, 0.4);
          background: rgba(139, 92, 246, 0.02);
        }
        .checkbox-card input[type="checkbox"] {
          margin-top: 4px;
          accent-color: var(--accent-purple);
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
        .checkbox-card-content {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .checkbox-title {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .checkbox-desc {
          font-size: 0.72rem;
          color: var(--text-muted);
          line-height: 1.3;
        }
        .warning-banner-container {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 8px;
          padding: 12px;
          color: #fbbf24;
          font-size: 0.8rem;
        }
        .modal-loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 24px;
          text-align: center;
          gap: 16px;
        }
        .modal-loading-state h3 {
          font-size: 1.15rem;
          color: var(--text-primary);
        }
        .loading-step-text {
          font-size: 0.9rem;
          color: var(--accent-purple);
          font-weight: 600;
        }
        .loading-bar-container {
          width: 80%;
          height: 6px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 3px;
          overflow: hidden;
          position: relative;
        }
        .loading-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--accent-purple), var(--accent-cyan));
          width: 50%;
          border-radius: 3px;
          animation: loading-animation 1.5s infinite ease-in-out;
        }
        .loading-tip-text {
          font-size: 0.75rem;
          color: var(--text-muted);
          max-width: 400px;
        }
        @keyframes loading-animation {
          0% {
            left: -50%;
          }
          100% {
            left: 100%;
          }
        }
        .pulse-animation {
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.15);
            opacity: 0.7;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};
