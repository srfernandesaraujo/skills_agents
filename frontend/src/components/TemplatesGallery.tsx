import React, { useState, useEffect } from 'react';
import { 
  Compass, Download, CheckCircle, Search, 
  Tag, Database, Layers, Calendar, AlertCircle
} from 'lucide-react';

interface TemplateItem {
  name: string;
  title: string;
  description: string;
  accepts_files: boolean;
  trigger: string | null;
  category: string;
}

interface TemplatesGalleryProps {
  backendUrl: string;
  installedSkills: Array<{ name: string }>;
  onSkillInstalled: () => void;
}

export const TemplatesGallery: React.FC<TemplatesGalleryProps> = ({ 
  backendUrl, 
  installedSkills, 
  onSkillInstalled 
}) => {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('todos');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [installingTemplate, setInstallingTemplate] = useState<string | null>(null);
  const [installedSuccessfully, setInstalledSuccessfully] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    loadTemplates();
  }, [backendUrl]);

  const loadTemplates = async () => {
    try {
      const response = await fetch(`${backendUrl}/api/templates`);
      if (response.ok) {
        setTemplates(await response.json());
      }
    } catch (err) {
      console.error('Erro ao carregar templates:', err);
    }
  };

  const handleInstallTemplate = async (templateName: string) => {
    setInstallingTemplate(templateName);
    setErrorMessage(null);
    try {
      const response = await fetch(`${backendUrl}/api/templates/${templateName}/clone`, {
        method: 'POST'
      });
      const data = await response.json();
      
      if (response.ok) {
        setInstalledSuccessfully(templateName);
        onSkillInstalled(); // Recarrega lista lateral
        setTimeout(() => setInstalledSuccessfully(null), 3000);
      } else {
        setErrorMessage(data.error || 'Erro ao instalar template.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro de rede ao conectar com o servidor.');
    } finally {
      setInstallingTemplate(null);
    }
  };

  const isAlreadyInstalled = (name: string) => {
    return installedSkills.some(s => s.name === name);
  };

  // Extrai categorias únicas
  const categories = ['todos', ...Array.from(new Set(templates.map(t => t.category)))];

  // Filtra templates
  const filteredTemplates = templates.filter(t => {
    const matchesCategory = filterCategory === 'todos' || t.category === filterCategory;
    const matchesQuery = t.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         t.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="templates-gallery-container scrollbar-custom">
      <div className="gallery-header-section">
        <div className="header-title-wrapper">
          <Compass size={24} className="text-purple pulse" />
          <div>
            <h3>Explorar Skills & Playbooks</h3>
            <p>Selecione templates prontos desenvolvidos por especialistas para acelerar seus fluxos de trabalho e tomadas de decisão.</p>
          </div>
        </div>

        <div className="gallery-filters-bar glass-panel">
          <div className="search-box-wrapper">
            <Search size={14} className="text-muted" />
            <input 
              type="text" 
              placeholder="Buscar playbooks..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="categories-pills scrollbar-custom">
            {categories.map(cat => (
              <button
                key={cat}
                className={`category-pill ${filterCategory === cat ? 'active' : ''}`}
                onClick={() => setFilterCategory(cat)}
              >
                <Tag size={10} />
                <span className="capitalize">{cat}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="error-alert animate-fade-in">
          <AlertCircle size={16} />
          <span>{errorMessage}</span>
          <button className="btn-close-alert" onClick={() => setErrorMessage(null)}>×</button>
        </div>
      )}

      {filteredTemplates.length === 0 ? (
        <div className="empty-gallery glass-panel">
          <Layers size={36} className="text-muted" />
          <p>Nenhum template encontrado correspondente aos filtros.</p>
        </div>
      ) : (
        <div className="templates-grid">
          {filteredTemplates.map(t => {
            const installed = isAlreadyInstalled(t.name);
            const installing = installingTemplate === t.name;
            const success = installedSuccessfully === t.name;

            return (
              <div key={t.name} className={`template-card glass-panel ${installed ? 'installed-card' : ''}`}>
                <div className="template-card-header">
                  <span className="template-category-badge">{t.category}</span>
                  <div className="features-badges">
                    {t.accepts_files && (
                      <span className="feature-badge file-badge" title="Suporta Multimodalidade (PDFs/Imagens)">
                        <Layers size={11} />
                        Multimodal
                      </span>
                    )}
                    {t.trigger && (
                      <span className="feature-badge cron-badge" title={`Gatilho ativo: ${t.trigger}`}>
                        <Calendar size={11} />
                        Automação
                      </span>
                    )}
                    <span className="feature-badge rag-badge" title="Suporta Banco Vetorial RAG Dinâmico">
                      <Database size={11} />
                      RAG Ativo
                    </span>
                  </div>
                </div>

                <div className="template-card-body">
                  <h4>{t.title}</h4>
                  <p>{t.description}</p>
                </div>

                <div className="template-card-footer">
                  {installed ? (
                    <div className="installed-indicator">
                      <CheckCircle size={14} className="text-green" />
                      <span>Instalado</span>
                    </div>
                  ) : success ? (
                    <div className="installed-indicator animate-fade-in">
                      <CheckCircle size={14} className="text-green pulse" />
                      <span className="text-green font-semibold">Instalado com Sucesso!</span>
                    </div>
                  ) : (
                    <button 
                      className={`btn ${installing ? 'btn-secondary' : 'btn-primary'} btn-sm btn-block`}
                      onClick={() => handleInstallTemplate(t.name)}
                      disabled={installing}
                    >
                      {installing ? (
                        <>
                          <span className="spinner"></span>
                          Clonando...
                        </>
                      ) : (
                        <>
                          <Download size={13} />
                          Clonar Playbook
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .templates-gallery-container {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          height: 100%;
          overflow-y: auto;
          background: rgba(8, 12, 20, 0.4);
          width: 100%;
        }
        .gallery-header-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .header-title-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .header-title-wrapper h3 {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .header-title-wrapper p {
          font-size: 0.8rem;
          color: var(--text-muted);
          margin-top: 2px;
        }
        .gallery-filters-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-radius: 8px;
          gap: 16px;
          background: rgba(13, 20, 35, 0.3);
          border: 1px solid var(--border-color);
        }
        .search-box-wrapper {
          display: flex;
          align-items: center;
          background: rgba(0,0,0,0.25);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 6px 12px;
          gap: 8px;
          width: 250px;
        }
        .search-box-wrapper input {
          background: none;
          border: none;
          outline: none;
          font-size: 0.78rem;
          color: var(--text-primary);
          width: 100%;
        }
        .categories-pills {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          max-width: 100%;
          padding-bottom: 2px;
        }
        .category-pill {
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          padding: 5px 12px;
          border-radius: 30px;
          font-size: 0.7rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          transition: all var(--transition-fast);
        }
        .category-pill:hover {
          background: rgba(255,255,255,0.07);
          color: var(--text-primary);
        }
        .category-pill.active {
          background: rgba(139, 92, 246, 0.15);
          border-color: var(--accent-purple);
          color: var(--text-primary);
        }
        .templates-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
        }
        .template-card {
          background: rgba(13, 20, 35, 0.4);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          height: 230px;
          transition: all var(--transition-fast);
        }
        .template-card:hover {
          border-color: rgba(139, 92, 246, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(139, 92, 246, 0.05);
        }
        .template-card.installed-card {
          border-color: rgba(16, 185, 129, 0.25);
          background: rgba(10, 25, 20, 0.15);
        }
        .template-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .template-category-badge {
          font-size: 0.65rem;
          font-weight: 600;
          color: var(--accent-purple);
          background: rgba(139, 92, 246, 0.1);
          padding: 2px 8px;
          border-radius: 4px;
          text-transform: uppercase;
        }
        .features-badges {
          display: flex;
          gap: 4px;
        }
        .feature-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 0.62rem;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .feature-badge.file-badge {
          background: rgba(236, 72, 153, 0.08);
          color: var(--accent-pink);
        }
        .feature-badge.cron-badge {
          background: rgba(6, 182, 212, 0.08);
          color: var(--accent-cyan);
        }
        .feature-badge.rag-badge {
          background: rgba(16, 185, 129, 0.08);
          color: var(--accent-green);
        }
        .template-card-body {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 12px;
          flex: 1;
        }
        .template-card-body h4 {
          font-size: 0.92rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .template-card-body p {
          font-size: 0.78rem;
          color: var(--text-secondary);
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .template-card-footer {
          margin-top: 16px;
        }
        .installed-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 0.75rem;
          color: var(--text-muted);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 6px;
          background: rgba(0,0,0,0.1);
        }
        .error-alert {
          background: rgba(244, 63, 94, 0.15);
          border: 1px solid rgba(244, 63, 94, 0.3);
          color: var(--accent-pink);
          padding: 10px 14px;
          border-radius: 6px;
          font-size: 0.78rem;
          display: flex;
          align-items: center;
          gap: 10px;
          position: relative;
        }
        .btn-close-alert {
          background: none;
          border: none;
          color: var(--accent-pink);
          font-size: 1.1rem;
          position: absolute;
          right: 12px;
          cursor: pointer;
        }
        .empty-gallery {
          text-align: center;
          padding: 40px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .empty-gallery p {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
};
