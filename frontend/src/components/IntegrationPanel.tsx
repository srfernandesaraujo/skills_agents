import React, { useState } from 'react';
import { Copy, Check, Box, Code } from 'lucide-react';
import type { SkillSummary } from './FileTree';

interface IntegrationPanelProps {
  skills: SkillSummary[];
  backendUrl: string;
}

export const IntegrationPanel: React.FC<IntegrationPanelProps> = ({ skills, backendUrl }) => {
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [copiedFormat, setCopiedFormat] = useState<'text' | 'json' | null>(null);

  const toggleSkillSelection = (skillName: string) => {
    setSelectedSkills(prev => 
      prev.includes(skillName)
        ? prev.filter(name => name !== skillName)
        : [...prev, skillName]
    );
  };

  const selectAll = () => {
    setSelectedSkills(skills.map(s => s.name));
  };

  const selectNone = () => {
    setSelectedSkills([]);
  };

  // Filtra as skills selecionadas ou usa todas se nenhuma estiver selecionada
  const activeSkills = skills.filter(s => 
    selectedSkills.length === 0 ? true : selectedSkills.includes(s.name)
  );

  // Gera o Prompt em Formato Texto (Pronto para copiar para GPTs/Claude)
  const generateTextPrompt = () => {
    let prompt = `Você é um agente inteligente integrado ao ecossistema de AI Skills.
Você tem acesso às seguintes Skills estruturadas locais (playbooks). Quando receber uma solicitação condizente, siga rigorosamente o roteiro e utilize as ferramentas indicadas:

`;

    activeSkills.forEach((skill, index) => {
      prompt += `${index + 1}. AI SKILL: ${skill.title}
   - Identificador/Pasta: "${skill.name}"
   - Descrição: ${skill.description}
   - Localização: ${backendUrl}/api/skills/${skill.name}
   - Diretrizes Principais: Consulte o playbook em "skills/${skill.name}/skill.md" para executar a tarefa.
\n`;
    });

    prompt += `Regra de Execução: Sempre que a intenção do usuário bater com uma das skills acima, avise ao usuário que estará usando a skill e siga o roteiro de perguntas correspondente.`;
    return prompt;
  };

  // Gera o Catálogo em Formato JSON
  const generateJsonCatalog = () => {
    const catalog = {
      description: "Catálogo de Skills locais disponíveis para o Agente",
      backendUrl: backendUrl,
      skills: activeSkills.map(s => ({
        id: s.name,
        title: s.title,
        description: s.description,
        playbookPath: `skills/${s.name}/skill.md`,
        toolsFolder: `skills/${s.name}/tools/`
      }))
    };
    return JSON.stringify(catalog, null, 2);
  };

  const handleCopy = (format: 'text' | 'json', text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFormat(format);
    setTimeout(() => setCopiedFormat(null), 2000);
  };

  return (
    <div className="integration-container animate-slide-in">
      <div className="integration-header-section">
        <h2>Catálogo de Integração</h2>
        <p>Gere e copie as instruções necessárias para injetar suas Skills em Agentes Externos (N8N, GPTs, Claude Projects ou Dify).</p>
      </div>

      <div className="integration-content">
        {/* Lado Esquerdo: Seleção de Skills */}
        <div className="skills-selector-pane glass-panel">
          <div className="pane-header">
            <h4>Selecione as Skills</h4>
            <div className="pane-actions">
              <button className="btn-link" onClick={selectAll}>Todas</button>
              <button className="btn-link" onClick={selectNone}>Limpar</button>
            </div>
          </div>

          {skills.length === 0 ? (
            <div className="empty-catalog">
              <p>Nenhuma skill disponível no catálogo. Crie uma skill primeiro!</p>
            </div>
          ) : (
            <div className="selector-list">
              {skills.map(skill => {
                const isSelected = selectedSkills.includes(skill.name);
                return (
                  <div 
                    key={skill.name}
                    className={`selector-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleSkillSelection(skill.name)}
                  >
                    <div className="checkbox-custom">
                      {isSelected && <div className="checked-indicator" />}
                    </div>
                    <div className="selector-card-info">
                      <h5>{skill.title}</h5>
                      <span>ID: <code>{skill.name}</code></span>
                      <p>{skill.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Lado Direito: Resultados Gerados (Instruções de Injeção) */}
        <div className="prompts-generator-pane">
          {/* Opção 1: System Prompt em Texto */}
          <div className="prompt-block glass-panel">
            <div className="prompt-block-header">
              <div className="prompt-block-title">
                <Box size={16} className="text-purple" />
                <h4>Injeção de Prompt de Sistema (Recomendado)</h4>
              </div>
              <button 
                className="btn btn-secondary btn-sm"
                onClick={() => handleCopy('text', generateTextPrompt())}
              >
                {copiedFormat === 'text' ? (
                  <>
                    <Check size={14} className="text-green" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    Copiar Prompt
                  </>
                )}
              </button>
            </div>
            <p className="block-instruction-text">
              Cole este bloco de instruções no campo de <strong>System Prompt / Custom Instructions</strong> do seu agente no ChatGPT, Claude ou N8N.
            </p>
            <pre className="prompt-preview-box">
              {generateTextPrompt()}
            </pre>
          </div>

          {/* Opção 2: JSON Catalog */}
          <div className="prompt-block glass-panel">
            <div className="prompt-block-header">
              <div className="prompt-block-title">
                <Code size={16} className="text-cyan" />
                <h4>Catálogo Estruturado em JSON</h4>
              </div>
              <button 
                className="btn btn-secondary btn-sm"
                onClick={() => handleCopy('json', generateJsonCatalog())}
              >
                {copiedFormat === 'json' ? (
                  <>
                    <Check size={14} className="text-green" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    Copiar JSON
                  </>
                )}
              </button>
            </div>
            <p className="block-instruction-text">
              Formato útil para passar via API, alimentar bancos de dados vetoriais, ou carregar dinamicamente em fluxos N8N.
            </p>
            <pre className="prompt-preview-box json-format">
              {generateJsonCatalog()}
            </pre>
          </div>
        </div>
      </div>

      <style>{`
        .integration-container {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          height: 100%;
          overflow-y: auto;
        }
        .integration-header-section h2 {
          font-size: 1.5rem;
          margin-bottom: 6px;
        }
        .integration-header-section p {
          font-size: 0.9rem;
          color: var(--text-secondary);
          max-width: 800px;
        }
        .integration-content {
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 20px;
          align-items: start;
        }
        .skills-selector-pane {
          padding: 16px;
          background: rgba(13, 20, 35, 0.6);
        }
        .pane-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 10px;
        }
        .pane-header h4 {
          font-size: 0.95rem;
        }
        .pane-actions {
          display: flex;
          gap: 8px;
        }
        .btn-link {
          background: none;
          border: none;
          color: var(--accent-purple);
          font-size: 0.75rem;
          cursor: pointer;
        }
        .btn-link:hover {
          text-decoration: underline;
        }
        .selector-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 50vh;
          overflow-y: auto;
          padding-right: 4px;
        }
        .selector-card {
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 10px;
          cursor: pointer;
          display: flex;
          gap: 10px;
          transition: all var(--transition-fast);
          background: rgba(255, 255, 255, 0.01);
        }
        .selector-card:hover {
          border-color: var(--border-color-hover);
          background: rgba(255, 255, 255, 0.03);
        }
        .selector-card.selected {
          border-color: var(--accent-purple);
          background: rgba(139, 92, 246, 0.04);
        }
        .checkbox-custom {
          width: 16px;
          height: 16px;
          border: 1.5px solid var(--text-muted);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 2px;
          transition: border-color var(--transition-fast);
        }
        .selector-card.selected .checkbox-custom {
          border-color: var(--accent-purple);
        }
        .checked-indicator {
          width: 8px;
          height: 8px;
          background: var(--accent-purple);
          border-radius: 2px;
        }
        .selector-card-info h5 {
          font-size: 0.85rem;
          font-weight: 600;
          margin-bottom: 2px;
        }
        .selector-card-info span {
          font-size: 0.7rem;
          color: var(--text-muted);
        }
        .selector-card-info code {
          color: var(--accent-cyan);
        }
        .selector-card-info p {
          font-size: 0.75rem;
          color: var(--text-secondary);
          margin-top: 4px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .prompts-generator-pane {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .prompt-block {
          padding: 20px;
          background: rgba(13, 20, 35, 0.5);
        }
        .prompt-block-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .prompt-block-title {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .prompt-block-title h4 {
          font-size: 1rem;
        }
        .block-instruction-text {
          font-size: 0.8rem;
          color: var(--text-muted);
          margin-bottom: 12px;
        }
        .prompt-preview-box {
          background: #0d1117;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 14px;
          font-family: var(--font-mono);
          font-size: 0.8rem;
          color: #c9d1d9;
          white-space: pre-wrap;
          word-break: break-all;
          max-height: 250px;
          overflow-y: auto;
          line-height: 1.5;
        }
        .prompt-preview-box.json-format {
          color: var(--accent-cyan);
        }
        .text-purple { color: var(--accent-purple); }
        .text-cyan { color: var(--accent-cyan); }
        .text-green { color: var(--accent-green); }
        .empty-catalog {
          padding: 40px 10px;
          text-align: center;
          color: var(--text-muted);
          font-size: 0.8rem;
        }
      `}</style>
    </div>
  );
};
