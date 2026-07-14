import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, AlertCircle, Bot, User, Check, Plus } from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  skillData?: {
    name: string;
    title: string;
    description: string;
    markdown: string;
  };
  isMocked?: boolean;
}

interface ChatAssistantProps {
  messages: ChatMessage[];
  isLoading: boolean;
  apiKeyMissing: boolean;
  onSendMessage: (message: string) => void;
  onCreateSkillFromChat: (skillData: { name: string; title: string; description: string; markdown: string }) => void;
}

export const ChatAssistant: React.FC<ChatAssistantProps> = ({
  messages,
  isLoading,
  apiKeyMissing,
  onSendMessage,
  onCreateSkillFromChat,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [createdSkillNames, setCreatedSkillNames] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll automático para a última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  const handleCreateSkill = (skillData: any, messageId: string) => {
    onCreateSkillFromChat(skillData);
    setCreatedSkillNames(prev => [...prev, messageId]);
  };

  return (
    <div className="chat-container">
      {/* Cabeçalho do Chat */}
      <div className="chat-header">
        <Sparkles size={16} className="text-purple pulse" />
        <h3>Assistente de AI Skills</h3>
      </div>

      {/* Banner de aviso se não houver chave de API configurada */}
      {apiKeyMissing && (
        <div className="offline-banner">
          <AlertCircle size={14} className="text-pink" />
          <span>Offline. Configure a chave do Gemini nas Configurações para IA ativa.</span>
        </div>
      )}

      {/* Histórico do Chat */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <Bot size={36} className="text-purple" />
            <h4>Crie seu Playbook por Chat</h4>
            <p>
              Digite o que você precisa. Por exemplo:
              <br />
              <em>"Quero uma skill para gerar roteiros para o canal Posologia Tech"</em>
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const isAssistant = msg.role === 'assistant';
          const hasSkillData = !!msg.skillData;
          const wasCreated = createdSkillNames.includes(msg.id);

          return (
            <div key={msg.id} className={`message-wrapper ${msg.role}`}>
              <div className="message-icon">
                {isAssistant ? <Bot size={14} /> : <User size={14} />}
              </div>
              <div className="message-bubble-container">
                <div className="message-bubble">
                  {msg.content}
                </div>

                {/* Exibição da Skill de IA Gerada */}
                {hasSkillData && msg.skillData && (
                  <div className="generated-skill-card glass-panel animate-slide-in">
                    <div className="skill-card-badge">Skill Proposta</div>
                    <h5 className="skill-card-title">{msg.skillData.title}</h5>
                    <p className="skill-card-desc">{msg.skillData.description}</p>
                    <div className="skill-card-meta">
                      <span>Diretório: <code>skills/{msg.skillData.name}/</code></span>
                    </div>
                    
                    <button
                      className={`btn btn-sm btn-full ${wasCreated ? 'btn-success-custom' : 'btn-primary'}`}
                      onClick={() => msg.skillData && handleCreateSkill(msg.skillData, msg.id)}
                      disabled={wasCreated}
                    >
                      {wasCreated ? (
                        <>
                          <Check size={14} />
                          Estrutura Criada!
                        </>
                      ) : (
                        <>
                          <Plus size={14} />
                          Criar Pasta e Arquivos
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Indicador de Carregamento */}
        {isLoading && (
          <div className="message-wrapper assistant">
            <div className="message-icon">
              <Bot size={14} className="pulse" />
            </div>
            <div className="message-bubble loading-bubble">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Formulário de Input */}
      <form onSubmit={handleSubmit} className="chat-input-form">
        <input
          type="text"
          className="input-text chat-input"
          placeholder="O que esta Skill deve fazer?"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={isLoading}
        />
        <button type="submit" className="btn-send-chat" disabled={!inputValue.trim() || isLoading}>
          <Send size={16} />
        </button>
      </form>

      <style>{`
        .chat-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          border-left: 1px solid var(--border-color);
          background: rgba(13, 20, 35, 0.3);
        }
        .chat-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 16px;
          border-bottom: 1px solid var(--border-color);
          height: 57px;
          flex-shrink: 0;
        }
        .chat-header h3 {
          font-size: 1rem;
        }
        .offline-banner {
          background: rgba(236, 72, 153, 0.1);
          border-bottom: 1px solid rgba(236, 72, 153, 0.2);
          padding: 8px 12px;
          font-size: 0.75rem;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--accent-pink);
        }
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .chat-welcome {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          margin-top: 60px;
          gap: 12px;
          padding: 20px;
        }
        .chat-welcome h4 {
          font-size: 1rem;
          color: var(--text-primary);
        }
        .chat-welcome p {
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .message-wrapper {
          display: flex;
          gap: 10px;
          max-width: 85%;
        }
        .message-wrapper.user {
          align-self: flex-end;
          flex-direction: row-reverse;
        }
        .message-wrapper.assistant {
          align-self: flex-start;
        }
        .message-icon {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .user .message-icon {
          background: var(--bg-tertiary);
          color: var(--accent-cyan);
          border: 1px solid var(--border-color);
        }
        .assistant .message-icon {
          background: rgba(139, 92, 246, 0.2);
          color: var(--accent-purple);
          border: 1px solid rgba(139, 92, 246, 0.4);
        }
        .message-bubble-container {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .message-bubble {
          padding: 10px 14px;
          border-radius: 12px;
          font-size: 0.85rem;
          line-height: 1.4;
          white-space: pre-line;
        }
        .user .message-bubble {
          background: linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(6, 182, 212, 0.05));
          border: 1px solid rgba(6, 182, 212, 0.2);
          color: var(--text-primary);
          border-top-right-radius: 2px;
        }
        .assistant .message-bubble {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          border-top-left-radius: 2px;
        }
        .loading-bubble {
          display: flex;
          gap: 4px;
          align-items: center;
          padding: 12px 16px;
        }
        .loading-bubble .dot {
          width: 6px;
          height: 6px;
          background: var(--text-muted);
          border-radius: 50%;
          animation: bounce 1.4s infinite ease-in-out both;
        }
        .loading-bubble .dot:nth-child(1) { animation-delay: -0.32s; }
        .loading-bubble .dot:nth-child(2) { animation-delay: -0.16s; }
        
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1.0); }
        }
        .generated-skill-card {
          padding: 14px;
          background: rgba(13, 20, 35, 0.8);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .skill-card-badge {
          align-self: flex-start;
          font-size: 0.65rem;
          text-transform: uppercase;
          font-weight: 700;
          color: var(--accent-purple);
          background: rgba(139, 92, 246, 0.15);
          padding: 2px 6px;
          border-radius: 4px;
        }
        .skill-card-title {
          font-size: 0.9rem;
          font-weight: 600;
        }
        .skill-card-desc {
          font-size: 0.8rem;
          color: var(--text-secondary);
        }
        .skill-card-meta {
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .skill-card-meta code {
          font-family: var(--font-mono);
          color: var(--accent-cyan);
        }
        .btn-full {
          width: 100%;
          justify-content: center;
          margin-top: 4px;
        }
        .btn-success-custom {
          background: rgba(16, 185, 129, 0.15);
          color: var(--accent-green);
          border: 1px solid rgba(16, 185, 129, 0.3);
          cursor: default;
        }
        .chat-input-form {
          display: flex;
          padding: 12px 16px;
          border-top: 1px solid var(--border-color);
          gap: 8px;
          background: rgba(13, 20, 35, 0.5);
          flex-shrink: 0;
        }
        .chat-input {
          flex: 1;
        }
        .btn-send-chat {
          width: 38px;
          height: 38px;
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
        .btn-send-chat:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 0 12px rgba(139, 92, 246, 0.4);
        }
        .btn-send-chat:disabled {
          background: var(--bg-tertiary);
          color: var(--text-muted);
          cursor: not-allowed;
        }
        .text-pink { color: var(--accent-pink); }
      `}</style>
    </div>
  );
};
