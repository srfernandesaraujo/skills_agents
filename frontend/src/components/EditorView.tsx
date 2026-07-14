import React, { useState, useEffect, useRef } from 'react';
import { Save, Eye, Edit, Columns, Image, FileText, FileCode } from 'lucide-react';

interface EditorViewProps {
  skillName: string;
  filePath: string;
  content: string;
  isBinary: boolean;
  mimeType?: string;
  backendUrl: string;
  onSave: (content: string) => Promise<void>;
}

export const EditorView: React.FC<EditorViewProps> = ({
  skillName,
  filePath,
  content: initialContent,
  isBinary,
  mimeType,
  backendUrl,
  onSave,
}) => {
  const [content, setContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('edit');
  const [lineCount, setLineCount] = useState(1);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Reseta estado quando abre outro arquivo
  useEffect(() => {
    setContent(initialContent);
    setIsDirty(false);
    setIsSaving(false);
    
    const lines = initialContent.split('\n').length;
    setLineCount(lines || 1);

    // Ajusta o modo de visualização padrão
    if (filePath.endsWith('.md')) {
      setViewMode('split');
    } else {
      setViewMode('edit');
    }
  }, [initialContent, filePath]);

  // Atualiza contagem de linhas
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    setIsDirty(val !== initialContent);
    
    const lines = val.split('\n').length;
    setLineCount(lines || 1);
  };

  // Sincroniza scroll entre os números de linha e o textarea
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Atalho de salvar (Ctrl + S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty && !isSaving && !isBinary) {
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [content, isDirty, isSaving, isBinary]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(content);
      setIsDirty(false);
    } catch (e) {
      alert('Erro ao salvar arquivo.');
    } finally {
      setIsSaving(false);
    }
  };

  // Renderizador simples de Markdown para o Preview
  const renderMarkdown = (md: string) => {
    if (!md) return <p className="text-muted">Sem conteúdo para visualizar.</p>;

    let html = md;
    
    // Escapa HTML básico para evitar XSS
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Cabeçalhos
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^#### (.*?)$/gm, '<h4>$1</h4>');

    // Negrito e Itálico
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Citações (Blockquotes)
    html = html.replace(/^&gt; (.*?)$/gm, '<blockquote>$1</blockquote>');

    // Código em linha e blocos de código
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

    // Listas não ordenadas e ordenadas
    html = html.replace(/^\s*-\s+(.*?)$/gm, '<li>$1</li>');
    html = html.replace(/^\s*\*\s+(.*?)$/gm, '<li>$1</li>');
    
    // Ajusta parágrafos simples
    const paragraphs = html.split('\n\n');
    const parsedParagraphs = paragraphs.map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<h') || trimmed.startsWith('<pre') || trimmed.startsWith('<blockquote') || trimmed.startsWith('<li')) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, '<br />')}</p>`;
    });
    
    html = parsedParagraphs.join('\n');

    return (
      <div 
        className="markdown-body" 
        dangerouslySetInnerHTML={{ __html: html }} 
      />
    );
  };

  const isMarkdown = filePath.endsWith('.md');
  const fileExtension = filePath.split('.').pop() || '';
  const mediaUrl = `${backendUrl}/api/skills/${skillName}/media?path=${encodeURIComponent(filePath)}`;

  // Renderiza Visualização Binária (Imagens)
  if (isBinary) {
    const isImage = mimeType?.startsWith('image/');
    return (
      <div className="editor-container binary-preview-mode">
        <div className="editor-header">
          <div className="file-info-header">
            <Image size={18} className="text-pink" />
            <span className="file-path">{filePath}</span>
            <span className="file-badge">Mídia</span>
          </div>
        </div>
        <div className="binary-preview-body">
          {isImage ? (
            <div className="image-preview-container glass-panel">
              <img src={mediaUrl} alt={filePath} className="media-preview-image" />
              <div className="media-meta">
                <span>URL local: {filePath}</span>
              </div>
            </div>
          ) : (
            <div className="generic-binary-preview glass-panel">
              <FileText size={64} className="text-muted" />
              <p>Visualização não disponível para este tipo de arquivo binário ({fileExtension.toUpperCase()}).</p>
              <a href={mediaUrl} download className="btn btn-primary" style={{ marginTop: '16px' }}>
                Baixar Arquivo
              </a>
            </div>
          )}
        </div>
        
        <style>{`
          .binary-preview-mode {
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          .binary-preview-body {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            overflow-y: auto;
          }
          .image-preview-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px;
            max-width: 90%;
            max-height: 90%;
          }
          .media-preview-image {
            max-width: 100%;
            max-height: 60vh;
            border-radius: 6px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            background-image: 
              linear-gradient(45deg, #111 25%, transparent 25%), 
              linear-gradient(-45deg, #111 25%, transparent 25%), 
              linear-gradient(45deg, transparent 75%, #111 75%), 
              linear-gradient(-45deg, transparent 75%, #111 75%);
            background-size: 20px 20px;
            background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
          }
          .media-meta {
            margin-top: 12px;
            font-size: 0.8rem;
            color: var(--text-muted);
          }
          .generic-binary-preview {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px;
            text-align: center;
          }
          .text-pink { color: var(--accent-pink); }
        `}</style>
      </div>
    );
  }

  return (
    <div className="editor-container">
      {/* Cabeçalho do Editor */}
      <div className="editor-header">
        <div className="file-info-header">
          {isMarkdown ? (
            <FileText size={18} className="text-purple" />
          ) : (
            <FileCode size={18} className="text-cyan" />
          )}
          <span className="file-path">{filePath}</span>
          {isDirty && <span className="dirty-indicator" title="Não salvo">* modificado</span>}
        </div>

        <div className="editor-controls">
          {/* Toggles de Visualização do Markdown */}
          {isMarkdown && (
            <div className="view-mode-toggles">
              <button 
                className={`btn-toggle ${viewMode === 'edit' ? 'active' : ''}`}
                onClick={() => setViewMode('edit')}
                title="Editar Apenas"
              >
                <Edit size={14} />
              </button>
              <button 
                className={`btn-toggle ${viewMode === 'split' ? 'active' : ''}`}
                onClick={() => setViewMode('split')}
                title="Lado a Lado"
              >
                <Columns size={14} />
              </button>
              <button 
                className={`btn-toggle ${viewMode === 'preview' ? 'active' : ''}`}
                onClick={() => setViewMode('preview')}
                title="Visualizar Apenas"
              >
                <Eye size={14} />
              </button>
            </div>
          )}

          {/* Botão de Salvar */}
          <button 
            className={`btn btn-sm ${isDirty ? 'btn-primary' : 'btn-secondary'}`}
            disabled={!isDirty || isSaving}
            onClick={handleSave}
          >
            <Save size={14} />
            {isSaving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Área de Conteúdo */}
      <div className="editor-body">
        {/* Editor de Texto (Modo Edit ou Split) */}
        {viewMode !== 'preview' && (
          <div className="editor-workspace">
            {/* Números das Linhas */}
            <div className="line-numbers" ref={lineNumbersRef}>
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i} className="line-number-item">{i + 1}</div>
              ))}
            </div>

            {/* Caixa de Texto do Editor */}
            <textarea
              ref={textareaRef}
              className="editor-textarea"
              value={content}
              onChange={handleContentChange}
              onScroll={handleScroll}
              placeholder="Digite aqui..."
              spellCheck="false"
            />
          </div>
        )}

        {/* Pré-visualização do Markdown (Modo Preview ou Split) */}
        {isMarkdown && viewMode !== 'edit' && (
          <div className="markdown-preview-pane">
            {renderMarkdown(content)}
          </div>
        )}
      </div>

      <style>{`
        .editor-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: rgba(8, 12, 20, 0.6);
        }
        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color);
          background: rgba(13, 20, 35, 0.8);
          height: 57px;
          flex-shrink: 0;
        }
        .file-info-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .file-path {
          font-size: 0.875rem;
          font-weight: 500;
          font-family: var(--font-mono);
          color: var(--text-primary);
        }
        .file-badge {
          background: rgba(236, 72, 153, 0.15);
          color: var(--accent-pink);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.7rem;
        }
        .dirty-indicator {
          font-size: 0.75rem;
          color: #f59e0b;
          font-style: italic;
        }
        .editor-controls {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .view-mode-toggles {
          display: flex;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 2px;
        }
        .btn-toggle {
          background: none;
          border: none;
          color: var(--text-secondary);
          padding: 4px 8px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all var(--transition-fast);
        }
        .btn-toggle:hover {
          color: var(--text-primary);
        }
        .btn-toggle.active {
          background: var(--bg-tertiary);
          color: var(--accent-purple);
        }
        .editor-body {
          display: flex;
          flex: 1;
          overflow: hidden;
          position: relative;
        }
        .editor-workspace {
          display: flex;
          flex: 1;
          height: 100%;
          position: relative;
          background: #0d1117;
          border-right: 1px solid var(--border-color);
          overflow: hidden;
        }
        .line-numbers {
          width: 45px;
          padding: 16px 0;
          background: rgba(0, 0, 0, 0.15);
          color: #484f58;
          text-align: right;
          padding-right: 12px;
          font-family: var(--font-mono);
          font-size: 0.85rem;
          user-select: none;
          overflow: hidden;
          line-height: 1.6;
          flex-shrink: 0;
        }
        .line-number-item {
          height: 1.36rem;
        }
        .editor-textarea {
          flex: 1;
          height: 100%;
          background: transparent;
          border: none;
          outline: none;
          color: #c9d1d9;
          font-family: var(--font-mono);
          font-size: 0.875rem;
          padding: 16px;
          resize: none;
          line-height: 1.6;
          overflow-y: auto;
        }
        .markdown-preview-pane {
          flex: 1;
          height: 100%;
          overflow-y: auto;
          padding: 24px;
          background: #0f1420;
          color: var(--text-primary);
        }
        .text-purple { color: var(--accent-purple); }
        .text-cyan { color: var(--accent-cyan); }

        @media (max-width: 768px) {
          .editor-body {
            flex-direction: column !important;
          }
          .editor-workspace {
            border-right: none !important;
            border-bottom: 1px solid var(--border-color);
            height: 50% !important;
            flex: none !important;
            width: 100% !important;
          }
          .markdown-preview-pane {
            height: 50% !important;
            flex: none !important;
            width: 100% !important;
          }
        }
      `}</style>
    </div>
  );
};
