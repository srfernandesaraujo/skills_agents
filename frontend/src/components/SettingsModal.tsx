import React, { useState } from 'react';
import { X, Eye, EyeOff, Save, Key, Server } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  backendUrl: string;
  onSave: (apiKey: string, backendUrl: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  apiKey: initialApiKey,
  backendUrl: initialBackendUrl,
  onSave,
}) => {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [backendUrl, setBackendUrl] = useState(initialBackendUrl);
  const [showKey, setShowKey] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(apiKey.trim(), backendUrl.trim());
    onClose();
  };

  return (
    <div className="settings-overlay">
      <div className="glass-panel settings-container animate-slide-in">
        <div className="settings-header">
          <div className="settings-title">
            <h2>Configurações do Sistema</h2>
            <p>Ajuste as chaves de API e URLs do servidor local</p>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="settings-form">
          <div className="form-group">
            <label className="form-label">
              <Key size={16} className="text-purple" />
              Chave de API do Gemini (salva localmente)
            </label>
            <div className="input-with-action">
              <input
                type={showKey ? 'text' : 'password'}
                className="input-text"
                placeholder="Insira sua GEMINI_API_KEY..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                className="btn-icon-inside"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <span className="form-help">
              Necessária para a geração avançada de Skills por Inteligência Artificial no chat.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">
              <Server size={16} className="text-cyan" />
              URL do Servidor Backend
            </label>
            <input
              type="text"
              className="input-text"
              placeholder="http://localhost:3001"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              required
            />
            <span className="form-help">
              Endereço do servidor Express local que gerencia seus arquivos e comandos git.
            </span>
          </div>

          <div className="settings-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              <Save size={16} />
              Salvar Configurações
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .settings-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .settings-container {
          width: 100%;
          max-width: 500px;
          padding: 24px;
          background: rgba(15, 23, 42, 0.9);
          border: 1px solid var(--border-color);
        }
        .settings-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 16px;
        }
        .settings-title h2 {
          font-size: 1.25rem;
          margin-bottom: 4px;
        }
        .settings-title p {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .settings-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .form-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.9rem;
          font-weight: 500;
        }
        .form-help {
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .input-with-action {
          position: relative;
          display: flex;
          width: 100%;
        }
        .input-with-action .input-text {
          width: 100%;
          padding-right: 40px;
        }
        .btn-icon-inside {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
        }
        .btn-icon-inside:hover {
          color: var(--text-primary);
        }
        .settings-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 10px;
          border-top: 1px solid var(--border-color);
          padding-top: 16px;
        }
        .text-purple { color: var(--accent-purple); }
        .text-cyan { color: var(--accent-cyan); }
      `}</style>
    </div>
  );
};
