import React, { useState } from 'react';
import { 
  Folder, FolderOpen, FileText, ChevronRight, ChevronDown, 
  Plus, Trash2, Download, Upload, Cpu, Database, Image, 
  Sparkles, FileCode
} from 'lucide-react';

// Tipagem dos arquivos e diretórios
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
}

export interface SkillDetail {
  name: string;
  title: string;
  description: string;
  files: FileNode[];
}

export interface SkillSummary {
  name: string;
  title: string;
  description: string;
  path: string;
}

interface FileTreeProps {
  skills: SkillSummary[];
  selectedSkill: SkillDetail | null;
  selectedFilePath: string | null;
  onSelectSkill: (name: string) => void;
  onSelectFile: (path: string) => void;
  onOpenCreateModal: () => void;
  onCreateFile: (skillName: string, parentPath: string, fileName: string) => void;
  onDeleteFile: (skillName: string, filePath: string) => void;
  onDeleteSkill: (skillName: string) => void;
  onExportSkill: (skillName: string) => void;
  onPublishSkill: (skillName: string) => void;
  onUploadFiles: (skillName: string, folder: 'dados' | 'assets', files: FileList) => void;
  isAdmin: boolean;
}

export const FileTree: React.FC<FileTreeProps> = ({
  skills,
  selectedSkill,
  selectedFilePath,
  onSelectSkill,
  onSelectFile,
  onOpenCreateModal,
  onCreateFile,
  onDeleteFile,
  onDeleteSkill,
  onExportSkill,
  onPublishSkill,
  onUploadFiles,
  isAdmin,
}) => {
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({
    'dados': true,
    'assets': true,
    'tools': true
  });
  
  // Controles para criação de arquivo
  const [addingToPath, setAddingToPath] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState('');

  const toggleDir = (path: string) => {
    setOpenDirs(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const handleCreateFileSubmit = (e: React.FormEvent, parentPath: string) => {
    e.preventDefault();
    if (!newFileName.trim() || !selectedSkill) return;
    onCreateFile(selectedSkill.name, parentPath, newFileName.trim());
    setNewFileName('');
    setAddingToPath(null);
  };

  const handleFileClick = (node: FileNode) => {
    if (node.type === 'file') {
      onSelectFile(node.path);
    } else {
      toggleDir(node.path);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, folder: 'dados' | 'assets') => {
    if (e.target.files && e.target.files.length > 0 && selectedSkill) {
      onUploadFiles(selectedSkill.name, folder, e.target.files);
    }
  };

  // Helper para renderizar ícones baseados no tipo de arquivo
  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'md') return <FileText size={16} className="file-icon-md" />;
    if (ext === 'py') return <FileCode size={16} className="file-icon-py" />;
    if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext || '')) {
      return <Image size={16} className="file-icon-media" />;
    }
    return <FileText size={16} className="file-icon-generic" />;
  };

  // Helper para renderizar ícones para as subpastas obrigatórias
  const getDirIcon = (dirName: string, isOpen: boolean) => {
    if (dirName === 'tools') return <Cpu size={16} className="dir-icon-tools" />;
    if (dirName === 'dados') return <Database size={16} className="dir-icon-dados" />;
    if (dirName === 'assets') return <Image size={16} className="dir-icon-assets" />;
    return isOpen ? <FolderOpen size={16} /> : <Folder size={16} />;
  };

  // Renderiza recursivamente a árvore de arquivos
  const renderTree = (nodes: FileNode[]) => {
    return (
      <ul className="file-list">
        {nodes.map(node => {
          const isOpen = openDirs[node.path];
          const isSelected = selectedFilePath === node.path;
          const isAddingFile = addingToPath === node.path;

          return (
            <li key={node.path} className="file-item-container">
              <div 
                className={`file-item ${node.type === 'file' ? 'item-file' : 'item-dir'} ${isSelected ? 'selected' : ''}`}
                onClick={() => handleFileClick(node)}
              >
                <span className="chevron-placeholder">
                  {node.type === 'directory' && (
                    isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                  )}
                </span>
                
                <span className="item-icon">
                  {node.type === 'directory' ? getDirIcon(node.name, isOpen) : getFileIcon(node.name)}
                </span>

                <span className="item-name" title={node.name}>{node.name}</span>

                {/* Ações contextuais de hover */}
                <div className="item-actions" onClick={e => e.stopPropagation()}>
                  {node.type === 'directory' && (
                    <>
                      {/* Upload de arquivos em dados ou assets */}
                      {['dados', 'assets'].includes(node.name) && (
                        <label className="action-btn-label" title="Fazer Upload">
                          <Upload size={14} />
                          <input 
                            type="file" 
                            multiple 
                            onChange={(e) => handleFileUpload(e, node.name as 'dados' | 'assets')}
                            style={{ display: 'none' }}
                          />
                        </label>
                      )}
                      
                      {/* Criar novo arquivo no diretório */}
                      <button 
                        className="action-btn" 
                        onClick={() => setAddingToPath(isAddingFile ? null : node.path)}
                        title="Novo Arquivo"
                      >
                        <Plus size={14} />
                      </button>
                    </>
                  )}

                  {/* Não permite deletar pastas de sistema da skill */}
                  {!(node.type === 'directory' && ['dados', 'assets', 'tools'].includes(node.name)) && (
                    <button 
                      className="action-btn text-danger" 
                      onClick={() => selectedSkill && onDeleteFile(selectedSkill.name, node.path)}
                      title="Deletar Item"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Formulário para adicionar arquivo */}
              {isAddingFile && (
                <form 
                  onSubmit={(e) => handleCreateFileSubmit(e, node.path)}
                  className="add-file-form"
                  onClick={e => e.stopPropagation()}
                >
                  <input 
                    type="text" 
                    className="input-text-mini" 
                    placeholder="Nome do arquivo..."
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    autoFocus
                  />
                  <div className="add-file-actions">
                    <button type="submit" className="btn-mini btn-primary-mini">Criar</button>
                    <button type="button" className="btn-mini btn-secondary-mini" onClick={() => setAddingToPath(null)}>X</button>
                  </div>
                </form>
              )}

              {/* Renderização de filhos */}
              {node.type === 'directory' && isOpen && node.children && (
                <div className="dir-children">
                  {node.children.length === 0 ? (
                    <div className="empty-dir-text">Pasta Vazia</div>
                  ) : (
                    renderTree(node.children)
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const skillLimitReached = !isAdmin && skills.length >= 2;

  return (
    <div className="file-tree-container">
      {/* Botões do Topo */}
      <div className="tree-header">
        <h3>Minhas AI Skills</h3>
        {!skillLimitReached ? (
          <button 
            className="btn btn-primary btn-sm-custom"
            onClick={onOpenCreateModal}
          >
            <Sparkles size={14} />
            Nova Skill
          </button>
        ) : (
          <span className="skill-limit-badge" title="Limite de 2 Skills atingido para usuários gratuitos">
            🔒 Limite atingido
          </span>
        )}
      </div>
      {skillLimitReached && (
        <div className="skill-limit-notice">
          Você atingiu o limite de <strong>2 Skills</strong> do plano gratuito.
        </div>
      )}

      {/* Lista de Skills */}
      <div className="skills-list-section">
        {skills.length === 0 ? (
          <div className="empty-state">
            <Folder size={32} className="text-muted" />
            <p>Nenhuma skill criada. Use o Chat à direita ou crie manualmente!</p>
          </div>
        ) : (
          <div className="skills-explorer">
            {skills.map(skill => {
              const isSkillSelected = selectedSkill?.name === skill.name;
              return (
                <div key={skill.name} className={`skill-folder ${isSkillSelected ? 'active' : ''}`}>
                  <div 
                    className="skill-folder-header"
                    onClick={() => onSelectSkill(skill.name)}
                  >
                    <Folder size={18} className="skill-main-icon" />
                    <div className="skill-info">
                      <span className="skill-title">{skill.title}</span>
                      <span className="skill-desc-short">{skill.name}/</span>
                    </div>

                    <div className="skill-header-actions" onClick={e => e.stopPropagation()}>
                      <button 
                        className="action-btn" 
                        onClick={() => onPublishSkill(skill.name)}
                        title="Publicar no Hub de Skills da Comunidade"
                        style={{ color: 'var(--accent-cyan)' }}
                      >
                        <Sparkles size={14} />
                      </button>
                      <button 
                        className="action-btn" 
                        onClick={() => onExportSkill(skill.name)}
                        title="Exportar como .ZIP"
                      >
                        <Download size={14} />
                      </button>
                      <button 
                        className="action-btn text-danger" 
                        onClick={() => onDeleteSkill(skill.name)}
                        title="Excluir Skill"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Mostra arquivos se esta for a skill ativa */}
                  {isSkillSelected && selectedSkill && (
                    <div className="skill-files-tree">
                      {renderTree(selectedSkill.files)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        .file-tree-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          border-right: 1px solid var(--border-color);
          background: rgba(13, 20, 35, 0.4);
        }
        .tree-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid var(--border-color);
        }
        .tree-header h3 {
          font-size: 1rem;
          color: var(--text-primary);
        }
        .btn-sm-custom {
          padding: 0.4rem 0.8rem;
          font-size: 0.75rem;
        }
        .create-skill-form {
          padding: 16px;
          background: rgba(13, 20, 35, 0.95);
          border-bottom: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .form-field-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .form-field-group label {
          font-size: 0.72rem;
          color: var(--text-secondary);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }
        .textarea-custom {
          background: var(--bg-input);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          padding: 6px 10px;
          border-radius: 6px;
          font-family: var(--font-sans);
          font-size: 0.8rem;
          outline: none;
          resize: none;
          transition: border-color var(--transition-fast);
        }
        .textarea-custom:focus {
          border-color: var(--accent-purple);
        }
        .form-actions-mini {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        .btn-sm {
          padding: 0.3rem 0.6rem;
          font-size: 0.75rem;
        }
        .skills-list-section {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
        }
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 40px 10px;
          gap: 12px;
        }
        .empty-state p {
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .skills-explorer {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .skill-folder {
          border-radius: 8px;
          border: 1px solid var(--border-color);
          background: rgba(255, 255, 255, 0.02);
          overflow: hidden;
          transition: border-color var(--transition-fast);
        }
        .skill-folder:hover {
          border-color: rgba(255, 255, 255, 0.12);
        }
        .skill-folder.active {
          border-color: var(--accent-purple);
          background: rgba(139, 92, 246, 0.03);
        }
        .skill-folder-header {
          display: flex;
          align-items: center;
          padding: 12px;
          cursor: pointer;
          gap: 10px;
        }
        .skill-main-icon {
          color: var(--accent-purple);
          flex-shrink: 0;
        }
        .skill-info {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow: hidden;
        }
        .skill-title {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .skill-desc-short {
          font-size: 0.75rem;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .skill-header-actions {
          display: flex;
          gap: 4px;
          opacity: 0;
          transition: opacity var(--transition-fast);
        }
        .skill-folder-header:hover .skill-header-actions {
          opacity: 1;
        }
        .skill-files-tree {
          border-top: 1px solid var(--border-color);
          background: rgba(0, 0, 0, 0.15);
          padding: 8px 4px 8px 12px;
        }
        .file-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .file-item-container {
          display: flex;
          flex-direction: column;
        }
        .file-item {
          display: flex;
          align-items: center;
          padding: 6px 8px;
          border-radius: 6px;
          cursor: pointer;
          gap: 6px;
          transition: all var(--transition-fast);
        }
        .file-item:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        .file-item.selected {
          background: rgba(6, 182, 212, 0.15);
          border-left: 2px solid var(--accent-cyan);
        }
        .chevron-placeholder {
          width: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
        }
        .item-icon {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .file-icon-md { color: var(--accent-purple); }
        .file-icon-py { color: var(--accent-cyan); }
        .file-icon-media { color: var(--accent-pink); }
        .file-icon-generic { color: var(--text-secondary); }
        .dir-icon-tools { color: var(--accent-cyan); }
        .dir-icon-dados { color: #f59e0b; }
        .dir-icon-assets { color: var(--accent-pink); }
        
        .item-name {
          font-size: 0.8rem;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }
        .file-item.selected .item-name {
          color: var(--text-primary);
        }
        .item-actions {
          display: flex;
          gap: 4px;
          opacity: 0;
          transition: opacity var(--transition-fast);
        }
        .file-item:hover .item-actions {
          opacity: 1;
        }
        .action-btn, .action-btn-label {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          width: 22px;
          height: 22px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all var(--transition-fast);
        }
        .action-btn:hover, .action-btn-label:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-primary);
        }
        .action-btn.text-danger:hover {
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.1);
        }
        .dir-children {
          border-left: 1px dashed rgba(255, 255, 255, 0.08);
          margin-left: 14px;
          padding-left: 6px;
        }
        .empty-dir-text {
          font-size: 0.7rem;
          color: var(--text-muted);
          padding: 4px 20px;
          font-style: italic;
        }
        .add-file-form {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 20px;
          background: rgba(0,0,0,0.1);
        }
        .input-text-mini {
          background: var(--bg-input);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          padding: 2px 6px;
          border-radius: 4px;
          font-family: var(--font-sans);
          font-size: 0.75rem;
          width: 100px;
          outline: none;
        }
        .add-file-actions {
          display: flex;
          gap: 4px;
        }
        .btn-mini {
          padding: 2px 6px;
          font-size: 0.7rem;
          border-radius: 4px;
          border: 1px solid var(--border-color);
          cursor: pointer;
        }
        .btn-primary-mini {
          background: var(--accent-purple);
          color: #fff;
          border-color: var(--accent-purple);
        }
        .btn-secondary-mini {
          background: var(--bg-tertiary);
          color: var(--text-secondary);
        }
        .skill-limit-badge {
          font-size: 0.72rem;
          color: #f59e0b;
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.25);
          border-radius: 20px;
          padding: 3px 10px;
          white-space: nowrap;
        }
        .skill-limit-notice {
          font-size: 0.78rem;
          color: #f59e0b;
          background: rgba(245, 158, 11, 0.08);
          border-bottom: 1px solid rgba(245, 158, 11, 0.15);
          padding: 8px 16px;
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
};
