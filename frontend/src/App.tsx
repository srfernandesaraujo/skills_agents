import { useState, useEffect } from 'react';
import { 
  FolderGit2, Sliders, MessageSquare, History, 
  BookOpen, Compass, Server, Sparkles, Brain, Zap, LogOut, User
} from 'lucide-react';
import { FileTree } from './components/FileTree';
import type { SkillSummary, SkillDetail } from './components/FileTree';
import { EditorView } from './components/EditorView';
import { ChatAssistant } from './components/ChatAssistant';
import type { ChatMessage } from './components/ChatAssistant';
import { GitHistory } from './components/GitHistory';
import { IntegrationPanel } from './components/IntegrationPanel';
import { SettingsModal } from './components/SettingsModal';
import { AgentExecution } from './components/AgentExecution';
import { MemoryManager } from './components/MemoryManager';
import { AutomationsDashboard } from './components/AutomationsDashboard';
import { TemplatesGallery } from './components/TemplatesGallery';
import { CreateSkillModal } from './components/CreateSkillModal';
import { LoginPage } from './components/LoginPage';
import { auth, isAuthEnabled } from './firebase';
import { signOut, type User as FirebaseUser } from 'firebase/auth';

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  idToken: string;
}

function App() {
  // Estado de Autenticação do Usuário
  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem('user_profile');
    return saved ? JSON.parse(saved) : null;
  });

  // Configurações do Sistema
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || (import.meta.env.VITE_GEMINI_API_KEY as string) || '');
  const [backendUrl, setBackendUrl] = useState(() => localStorage.getItem('backend_url') || (import.meta.env.VITE_API_URL as string) || 'http://localhost:3001');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Estados de Dados das Skills
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null);
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    content: string;
    isBinary: boolean;
    mimeType?: string;
  } | null>(null);

  // Navegação e Painéis
  const [activeTab, setActiveTab] = useState<'editor' | 'catalog' | 'agent' | 'automations' | 'gallery'>('editor');
  const [rightPanel, setRightPanel] = useState<'chat' | 'git'>('chat');

  // Controle de Tabs da Coluna Central (Editor vs Memória)
  const [centralTab, setCentralTab] = useState<'editor' | 'memory'>('editor');

  // Chat Assistente
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Modal de Criação Inteligente
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSkillGenerating, setIsSkillGenerating] = useState(false);
  const [skillGenerationStep, setSkillGenerationStep] = useState('');

  // Trigger para recarregar histórico Git
  const [gitRefreshTrigger, setGitRefreshTrigger] = useState(0);

  // Estados de Loading e Responsividade
  const [isSkillLoading, setIsSkillLoading] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [mobileSubTab, setMobileSubTab] = useState<'tree' | 'editor' | 'chat'>('tree');

  // Monitoramento do estado de login via Firebase Auth
  useEffect(() => {
    if (!isAuthEnabled || !auth) return;
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        const idToken = await firebaseUser.getIdToken();
        const profile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName || 'Usuário',
          photoURL: firebaseUser.photoURL || '',
          idToken,
        };
        setUser(profile);
        localStorage.setItem('user_profile', JSON.stringify(profile));
      } else {
        setUser(null);
        localStorage.removeItem('user_profile');
      }
    });
    return () => unsubscribe();
  }, []);

  // Inicialização: carrega a lista de skills somente se o usuário estiver autenticado (ou se a autenticação estiver desativada)
  useEffect(() => {
    if (!isAuthEnabled || user) {
      loadSkills();
    }
  }, [backendUrl, user?.idToken]);

  const loadSkills = async () => {
    try {
      const response = await fetch(`${backendUrl}/api/skills`);
      if (response.status === 401) {
        // Token inválido ou expirado
        if (isAuthEnabled) handleLogout();
        return;
      }
      if (!response.ok) throw new Error('Não foi possível se conectar ao servidor');
      const data = await response.json();
      setSkills(data);
    } catch (error) {
      console.error('Erro ao conectar ao backend:', error);
    }
  };

  const handleLogout = async () => {
    if (isAuthEnabled && auth) {
      try {
        await signOut(auth);
      } catch (e) {
        console.error("Erro ao deslogar:", e);
      }
    }
    setUser(null);
    localStorage.removeItem('user_profile');
    setSkills([]);
    setSelectedSkill(null);
    setSelectedFile(null);
  };

  const handleLoginSuccess = (userProfile: UserProfile) => {
    setUser(userProfile);
    localStorage.setItem('user_profile', JSON.stringify(userProfile));
  };

  // Carrega os detalhes de uma Skill (árvore de arquivos)
  const handleSelectSkill = async (skillName: string) => {
    setIsSkillLoading(true);
    try {
      const response = await fetch(`${backendUrl}/api/skills/${skillName}`);
      if (!response.ok) throw new Error('Erro ao obter dados da skill');
      const data = await response.json();
      setSelectedSkill(data);
      // Mantém o arquivo selecionado aberto se pertencer à mesma skill, ou fecha
      setSelectedFile(null);
      setCentralTab('editor');
      // No celular, vai automaticamente para o editor ao selecionar a skill
      setMobileSubTab('editor');
    } catch (error) {
      alert('Erro ao abrir Skill: ' + error);
    } finally {
      setIsSkillLoading(false);
    }
  };

  // Abre um arquivo no Editor
  const handleSelectFile = async (filePath: string) => {
    if (!selectedSkill) return;
    setIsFileLoading(true);
    try {
      const response = await fetch(
        `${backendUrl}/api/skills/${selectedSkill.name}/file?path=${encodeURIComponent(filePath)}`
      );
      if (!response.ok) throw new Error('Erro ao ler arquivo');
      const data = await response.json();
      setSelectedFile({
        path: data.path,
        content: data.content || '',
        isBinary: data.isBinary,
        mimeType: data.mimeType,
      });
      setCentralTab('editor');
      // No celular, vai automaticamente para o editor ao abrir o arquivo
      setMobileSubTab('editor');
    } catch (error) {
      alert('Erro ao carregar arquivo: ' + error);
    } finally {
      setIsFileLoading(false);
    }
  };

  // Salva o arquivo editado no Editor
  const handleSaveFile = async (newContent: string) => {
    if (!selectedSkill || !selectedFile) return;
    try {
      const response = await fetch(`${backendUrl}/api/skills/${selectedSkill.name}/file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: selectedFile.path,
          content: newContent,
        }),
      });

      if (!response.ok) throw new Error('Erro ao salvar');
      
      // Atualiza o arquivo no estado
      setSelectedFile(prev => prev ? { ...prev, content: newContent } : null);
      // Dispara atualização do Git
      setGitRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error(error);
      throw error;
    }
  };



  // Cria uma Skill Premium via IA
  const handleCreateSkillPremium = async (skillData: {
    name: string;
    title: string;
    role: string;
    objective: string;
    targetAudience: string;
    needsFiles: boolean;
    needsTools: boolean;
  }) => {
    setIsSkillGenerating(true);
    setSkillGenerationStep('[1/4] Mapeando estrutura do cenário conceitual...');
    
    const steps = [
      '[1/4] Mapeando estrutura do cenário conceitual...',
      '[2/4] Contatando o Gemini API para gerar Playbook Premium...',
      '[3/4] Gravando playbooks e arquivos de referência (/dados) no servidor local...',
      '[4/4] Finalizando versionamento automático com o Git local...'
    ];

    let currentStepIdx = 0;
    const interval = setInterval(() => {
      if (currentStepIdx < steps.length - 1) {
        currentStepIdx++;
        setSkillGenerationStep(steps[currentStepIdx]);
      }
    }, 4500);

    try {
      const response = await fetch(`${backendUrl}/api/skills/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...skillData,
          apiKey: apiKey,
        }),
      });

      clearInterval(interval);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Erro ao gerar Skill via IA');
      }

      setSkillGenerationStep('[4/4] Concluído! Carregando repositório...');
      await loadSkills();
      await handleSelectSkill(skillData.name);
      setIsCreateModalOpen(false);
    } catch (error: any) {
      clearInterval(interval);
      alert('Erro ao criar Skill via IA: ' + error.message);
    } finally {
      setIsSkillGenerating(false);
      setSkillGenerationStep('');
    }
  };

  // Cria um novo arquivo em uma pasta
  const handleCreateFile = async (skillName: string, parentPath: string, fileName: string) => {
    // Determina o caminho final relativo ao diretório da skill
    // parentPath ex: "tools" ou "dados". Se for raiz da skill, é "."
    let finalPath = fileName;
    if (parentPath !== '.') {
      finalPath = `${parentPath}/${fileName}`;
    }

    try {
      const response = await fetch(`${backendUrl}/api/skills/${skillName}/file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: finalPath,
          content: fileName.endsWith('.md') 
            ? `# ${fileName}\n\nEscreva as diretrizes aqui.` 
            : fileName.endsWith('.py') 
            ? `# coding: utf-8\n# Script de automação da Skill\n\ndef main():\n    print("Executando ferramenta")\n\nif __name__ == "__main__":\n    main()`
            : '',
        }),
      });

      if (!response.ok) throw new Error('Não foi possível criar o arquivo');

      // Atualiza a árvore de arquivos
      await handleSelectSkill(skillName);
      // Abre o arquivo recém-criado
      await handleSelectFile(finalPath);
      setGitRefreshTrigger(prev => prev + 1);
    } catch (error) {
      alert('Erro ao criar arquivo: ' + error);
    }
  };

  // Deleta um arquivo ou pasta
  const handleDeleteFile = async (skillName: string, filePath: string) => {
    if (!window.confirm(`Tem certeza que deseja deletar "${filePath}"? Esta ação gerará um commit de remoção.`)) {
      return;
    }

    try {
      const response = await fetch(
        `${backendUrl}/api/skills/${skillName}/file?path=${encodeURIComponent(filePath)}`,
        { method: 'DELETE' }
      );

      if (!response.ok) throw new Error('Erro ao deletar arquivo');

      await handleSelectSkill(skillName);
      if (selectedFile?.path === filePath) {
        setSelectedFile(null);
      }
      setGitRefreshTrigger(prev => prev + 1);
    } catch (error) {
      alert('Erro: ' + error);
    }
  };

  // Deleta uma Skill inteira
  const handleDeleteSkill = async (skillName: string) => {
    if (!window.confirm(`Tem certeza que deseja deletar a Skill "${skillName}" inteira? Todos os arquivos locais serão apagados.`)) {
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/skills/${skillName}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Erro ao excluir Skill');

      await loadSkills();
      if (selectedSkill?.name === skillName) {
        setSelectedSkill(null);
        setSelectedFile(null);
      }
      setGitRefreshTrigger(prev => prev + 1);
    } catch (error) {
      alert('Erro: ' + error);
    }
  };

  // Exportar Skill como ZIP
  const handleExportSkill = (skillName: string) => {
    window.open(`${backendUrl}/api/skills/${skillName}/export`, '_blank');
  };

  // Upload de arquivos
  const handleUploadFiles = async (skillName: string, folder: 'dados' | 'assets', files: FileList) => {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    try {
      const response = await fetch(`${backendUrl}/api/skills/${skillName}/upload/${folder}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Falha no upload dos arquivos');

      await handleSelectSkill(skillName);
      setGitRefreshTrigger(prev => prev + 1);
      alert('Arquivos enviados com sucesso!');
    } catch (error) {
      alert('Erro no upload: ' + error);
    }
  };

  // Envia mensagem no Chat de IA
  const handleSendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };

    setChatMessages(prev => [...prev, userMsg]);
    setIsChatLoading(true);

    try {
      const apiHistory = [...chatMessages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch(`${backendUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: apiHistory,
          apiKey: apiKey,
        }),
      });

      if (!response.ok) throw new Error('Erro ao processar mensagem no chat');

      const data = await response.json();
      
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.text,
        skillData: data.skillData,
        isMocked: data.mocked,
      };

      setChatMessages(prev => [...prev, assistantMsg]);
    } catch (error) {
      console.error(error);
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Desculpe, ocorreu um erro ao conectar-me com a inteligência artificial. Verifique se o backend está ativo ou tente configurar a chave do Gemini.',
      };
      setChatMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Salva uma skill gerada no Chat automaticamente
  const handleCreateSkillFromChat = async (skillData: {
    name: string;
    title: string;
    description: string;
    markdown: string;
  }) => {
    try {
      // 1. Cria a estrutura da Skill
      const createResponse = await fetch(`${backendUrl}/api/skills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: skillData.name,
          title: skillData.title,
          description: skillData.description,
        }),
      });

      if (!createResponse.ok) {
        const err = await createResponse.json();
        throw new Error(err.error || 'Falha ao criar skill do chat');
      }

      // 2. Salva o markdown principal skill.md
      const fileResponse = await fetch(`${backendUrl}/api/skills/${skillData.name}/file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: 'skill.md',
          content: skillData.markdown,
        }),
      });

      if (!fileResponse.ok) throw new Error('Falha ao gravar arquivo skill.md');

      // 3. Atualiza os dados locais
      await loadSkills();
      await handleSelectSkill(skillData.name);
      await handleSelectFile('skill.md');
      setGitRefreshTrigger(prev => prev + 1);

      alert(`AI Skill '${skillData.title}' criada com sucesso!`);
    } catch (e: any) {
      alert('Erro ao criar skill do chat: ' + e.message);
    }
  };

  const handleSaveSettings = (newKey: string, newUrl: string) => {
    setApiKey(newKey);
    setBackendUrl(newUrl);
    localStorage.setItem('gemini_api_key', newKey);
    localStorage.setItem('backend_url', newUrl);
    alert('Configurações salvas e aplicadas!');
  };

  if (!user) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-wrapper">
      {/* Barra Superior de Navegação */}
      <header className="app-header glass-panel">
        <div className="header-logo">
          <FolderGit2 className="logo-icon text-purple pulse" size={24} />
          <div className="logo-text">
            <h1>AI Skills Manager</h1>
            <span>Playbooks & Automações de IA</span>
          </div>
        </div>

        <nav className="header-nav">
          <button 
            className={`nav-item ${activeTab === 'editor' ? 'active' : ''}`}
            onClick={() => setActiveTab('editor')}
          >
            <BookOpen size={16} />
            Gerenciador de Skills
          </button>
          <button 
            className={`nav-item ${activeTab === 'agent' ? 'active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            <Sparkles size={16} />
            Executar Agente
          </button>
          <button 
            className={`nav-item ${activeTab === 'catalog' ? 'active' : ''}`}
            onClick={() => setActiveTab('catalog')}
          >
            <BookOpen size={16} />
            Catálogo de Integrações
          </button>
          <button 
            className={`nav-item ${activeTab === 'gallery' ? 'active' : ''}`}
            onClick={() => setActiveTab('gallery')}
          >
            <Compass size={16} />
            Explorar Skills
          </button>
          <button 
            className={`nav-item ${activeTab === 'automations' ? 'active' : ''}`}
            onClick={() => setActiveTab('automations')}
          >
            <Zap size={16} />
            Automações
          </button>
        </nav>

        <div className="header-actions">
          <div className="server-status-indicator">
            <Server size={14} className="text-green" />
            <span>Servidor Conectado</span>
          </div>
          
          {user.email === 'srfernandesaraujo@gmail.com' && (
            <button className="btn btn-secondary btn-icon-only" onClick={() => setIsSettingsOpen(true)} title="Configurações">
              <Sliders size={16} />
            </button>
          )}

          <div className="user-profile-widget" title={`${user.displayName} (${user.email})`}>
            {user.photoURL ? (
              <img src={user.photoURL} alt={user.displayName} className="user-avatar" />
            ) : (
              <div className="user-avatar-placeholder">
                <User size={14} />
              </div>
            )}
            <span className="user-name-tooltip">{user.displayName}</span>
            <button className="btn-logout" onClick={handleLogout} title="Sair do Sistema">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Corpo Principal da Aplicação */}
      <main className="app-main-content">
        {activeTab === 'editor' ? (
          <div className={`editor-workspace-layout mobile-tab-${mobileSubTab}`}>
            {/* Seletor de Abas para Celular */}
            <div className="mobile-subtab-bar">
              <button 
                type="button"
                className={`mobile-subtab-btn ${mobileSubTab === 'tree' ? 'active' : ''}`}
                onClick={() => setMobileSubTab('tree')}
              >
                <FolderGit2 size={16} />
                <span>Playbooks</span>
              </button>
              <button 
                type="button"
                className={`mobile-subtab-btn ${mobileSubTab === 'editor' ? 'active' : ''}`}
                onClick={() => setMobileSubTab('editor')}
                disabled={!selectedSkill}
              >
                <BookOpen size={16} />
                <span>Editor</span>
              </button>
              <button 
                type="button"
                className={`mobile-subtab-btn ${mobileSubTab === 'chat' ? 'active' : ''}`}
                onClick={() => setMobileSubTab('chat')}
              >
                <MessageSquare size={16} />
                <span>Assistente</span>
              </button>
            </div>

            {/* Coluna 1: FileTree */}
            <aside className="layout-col-left">
              <FileTree
                skills={skills}
                selectedSkill={selectedSkill}
                selectedFilePath={selectedFile?.path || null}
                onSelectSkill={handleSelectSkill}
                onSelectFile={handleSelectFile}
                onOpenCreateModal={() => setIsCreateModalOpen(true)}
                onCreateFile={handleCreateFile}
                onDeleteFile={handleDeleteFile}
                onDeleteSkill={handleDeleteSkill}
                onExportSkill={handleExportSkill}
                onUploadFiles={handleUploadFiles}
                isAdmin={user?.email === 'srfernandesaraujo@gmail.com'}
              />
            </aside>

            {/* Coluna 2: Editor Central */}
            <section className="layout-col-center">
              {(isSkillLoading || isFileLoading) && (
                <div className="workspace-loader-overlay">
                  <div className="workspace-loader-card glass-panel">
                    <Brain className="pulse text-purple" size={32} />
                    <span>Carregando...</span>
                  </div>
                </div>
              )}
              {selectedSkill ? (
                <div className="central-workspace-container">
                  {/* Abas do Workspace Central */}
                  <div className="central-tabs-header">
                    <button 
                      className={`central-tab-btn ${centralTab === 'editor' ? 'active' : ''}`}
                      onClick={() => setCentralTab('editor')}
                    >
                      <BookOpen size={14} />
                      Editor de Arquivos
                    </button>
                    <button 
                      className={`central-tab-btn ${centralTab === 'memory' ? 'active' : ''}`}
                      onClick={() => setCentralTab('memory')}
                    >
                      <Brain size={14} />
                      Memória (RAG)
                    </button>
                  </div>

                  <div className="central-tab-body">
                    {centralTab === 'editor' ? (
                      selectedFile ? (
                        <EditorView
                          skillName={selectedSkill.name}
                          filePath={selectedFile.path}
                          content={selectedFile.content}
                          isBinary={selectedFile.isBinary}
                          mimeType={selectedFile.mimeType}
                          backendUrl={backendUrl}
                          onSave={handleSaveFile}
                        />
                      ) : (
                        <div className="editor-splash-screen">
                          <div className="splash-card glass-panel">
                            <Compass size={48} className="text-purple pulse" />
                            <h2>Área de Trabalho do Playbook</h2>
                            <p>Selecione uma skill e clique em um arquivo no menu lateral para iniciar a edição ou visualize no editor.</p>
                            
                            <div className="splash-shortcuts">
                              <div className="shortcut-item">
                                <span>Criar Playbook por IA</span>
                                <p>Use o Chat Assistente à direita para gerar uma estrutura inteira apenas digitando o que você quer.</p>
                              </div>
                              <div className="shortcut-item">
                                <span>Salvar Alterações</span>
                                <kbd>Ctrl</kbd> + <kbd>S</kbd> no editor salva e faz commit automático.
                              </div>
                              <div className="shortcut-item">
                                <span>Automação com Python</span>
                                <p>Os scripts na pasta <code>/tools</code> são determinísticos para que agentes externos possam chamar ações da skill.</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    ) : (
                      <MemoryManager skillName={selectedSkill.name} backendUrl={backendUrl} />
                    )}
                  </div>
                </div>
              ) : (
                <div className="editor-splash-screen">
                  <div className="splash-card glass-panel">
                    <Compass size={48} className="text-purple pulse" />
                    <h2>Nenhuma Skill Selecionada</h2>
                    <p>Selecione ou crie uma Skill no menu lateral para começar a gerenciar seus arquivos e memórias.</p>
                  </div>
                </div>
              )}
            </section>

            {/* Coluna 3: Painel Direito (Chat / Git) */}
            <aside className="layout-col-right">
              {/* Tab Selector de utilitários */}
              <div className="right-panel-toggles">
                <button 
                  className={`panel-toggle-btn ${rightPanel === 'chat' ? 'active' : ''}`}
                  onClick={() => setRightPanel('chat')}
                >
                  <MessageSquare size={14} />
                  Chat Assistente
                </button>
                <button 
                  className={`panel-toggle-btn ${rightPanel === 'git' ? 'active' : ''}`}
                  disabled={!selectedSkill}
                  onClick={() => setRightPanel('git')}
                  title={!selectedSkill ? 'Selecione uma skill para ver o histórico' : ''}
                >
                  <History size={14} />
                  Histórico Git
                </button>
              </div>

              {/* Conteúdo do Painel */}
              <div className="right-panel-content">
                {rightPanel === 'chat' ? (
                  <ChatAssistant
                    messages={chatMessages}
                    isLoading={isChatLoading}
                    apiKeyMissing={!apiKey}
                    onSendMessage={handleSendMessage}
                    onCreateSkillFromChat={handleCreateSkillFromChat}
                  />
                ) : (
                  selectedSkill && (
                    <GitHistory
                      skillName={selectedSkill.name}
                      filePath={selectedFile?.path || null}
                      backendUrl={backendUrl}
                      onRevertCompleted={() => {
                        // Recarrega o arquivo atual após reverter no Git
                        if (selectedFile) {
                          handleSelectFile(selectedFile.path);
                        }
                      }}
                      triggerRefresh={gitRefreshTrigger}
                    />
                  )
                )}
              </div>
            </aside>
          </div>
        ) : activeTab === 'agent' ? (
          <AgentExecution skills={skills} apiKey={apiKey} backendUrl={backendUrl} />
        ) : activeTab === 'automations' ? (
          <AutomationsDashboard backendUrl={backendUrl} skills={skills} />
        ) : activeTab === 'gallery' ? (
          <TemplatesGallery backendUrl={backendUrl} installedSkills={skills} onSkillInstalled={loadSkills} />
        ) : (
          <IntegrationPanel skills={skills} backendUrl={backendUrl} />
        )}
      </main>

      {/* Modal de Configurações */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        apiKey={apiKey}
        backendUrl={backendUrl}
        onSave={handleSaveSettings}
      />

      {/* Modal de Criação Inteligente de Skills */}
      <CreateSkillModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateSkillPremium}
        isLoading={isSkillGenerating}
        loadingStep={skillGenerationStep}
        apiKey={apiKey}
      />

      <style>{`
        .app-wrapper {
          display: flex;
          flex-direction: column;
          height: 100vh;
          width: 100vw;
          overflow: hidden;
        }
        .app-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 24px;
          height: 60px;
          flex-shrink: 0;
          background: rgba(13, 20, 35, 0.85);
          border-radius: 0;
          border-bottom: 1px solid var(--border-color);
        }
        .header-logo {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .logo-icon {
          color: var(--accent-purple);
        }
        .logo-text h1 {
          font-family: var(--font-sans);
          font-size: 1.1rem;
          font-weight: 700;
          line-height: 1.1;
        }
        .logo-text span {
          font-size: 0.7rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .header-nav {
          display: flex;
          gap: 6px;
          background: rgba(0, 0, 0, 0.2);
          padding: 3px;
          border-radius: 8px;
          border: 1px solid var(--border-color);
        }
        .nav-item {
          background: none;
          border: none;
          color: var(--text-secondary);
          font-family: var(--font-sans);
          font-size: 0.85rem;
          font-weight: 500;
          padding: 6px 16px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: all var(--transition-fast);
        }
        .nav-item:hover {
          color: var(--text-primary);
        }
        .nav-item.active {
          background: var(--bg-tertiary);
          color: var(--accent-purple);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }
        .header-actions {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .server-status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.75rem;
          color: var(--text-muted);
          background: rgba(16, 185, 129, 0.05);
          padding: 4px 8px;
          border-radius: 20px;
          border: 1px solid rgba(16, 185, 129, 0.15);
        }
        .btn-icon-only {
          padding: 0.6rem;
          border-radius: 8px;
          line-height: 0;
        }
        .app-main-content {
          flex: 1;
          overflow: hidden;
          position: relative;
        }
        .editor-workspace-layout {
          display: grid;
          grid-template-columns: 290px 1fr 360px;
          height: 100%;
          overflow: hidden;
        }
        
        /* Seletor Móvel de Abas */
        .mobile-subtab-bar {
          display: none;
          grid-template-columns: repeat(3, 1fr);
          background: rgba(13, 20, 35, 0.95);
          border-bottom: 1px solid var(--border-color);
          padding: 4px;
          gap: 4px;
          height: 48px;
          align-items: center;
          flex-shrink: 0;
        }
        .mobile-subtab-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          font-family: var(--font-sans);
          font-size: 0.8rem;
          font-weight: 500;
          padding: 8px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all var(--transition-fast);
        }
        .mobile-subtab-btn:hover:not(:disabled) {
          color: var(--text-primary);
        }
        .mobile-subtab-btn.active {
          background: var(--bg-tertiary);
          color: var(--accent-purple);
        }
        .mobile-subtab-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* Overlay de Carregamento */
        .workspace-loader-overlay {
          position: absolute;
          inset: 0;
          background: rgba(8, 12, 20, 0.7);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }
        .workspace-loader-card {
          padding: 24px 40px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          border-color: rgba(139, 92, 246, 0.3) !important;
        }
        .workspace-loader-card span {
          font-size: 0.9rem;
          color: var(--text-primary);
          font-weight: 500;
        }

        .layout-col-left {
          height: 100%;
          overflow: hidden;
        }
        .layout-col-center {
          height: 100%;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          position: relative; /* Garante posicionamento do loader */
        }
        .layout-col-right {
          height: 100%;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background: rgba(13, 20, 35, 0.2);
        }

        /* Regras de Responsividade Geral */
        @media (max-width: 900px) {
          .editor-workspace-layout {
            grid-template-columns: 1fr !important;
            grid-template-rows: 48px 1fr !important;
            height: 100%;
          }
          .mobile-subtab-bar {
            display: grid !important;
          }
          
          /* Oculta/Exibe colunas conforme a aba ativa */
          .mobile-tab-tree .layout-col-left { display: block !important; }
          .mobile-tab-tree .layout-col-center { display: none !important; }
          .mobile-tab-tree .layout-col-right { display: none !important; }

          .mobile-tab-editor .layout-col-left { display: none !important; }
          .mobile-tab-editor .layout-col-center { display: flex !important; }
          .mobile-tab-editor .layout-col-right { display: none !important; }

          .mobile-tab-chat .layout-col-left { display: none !important; }
          .mobile-tab-chat .layout-col-center { display: none !important; }
          .mobile-tab-chat .layout-col-right { display: flex !important; }
          
          .layout-col-left, .layout-col-center, .layout-col-right {
            width: 100% !important;
            height: 100% !important;
          }
          
          /* Ajustes do Header */
          .nav-item span {
            display: none !important;
          }
          .nav-item {
            padding: 8px 12px !important;
          }
          .app-header {
            padding: 8px 12px !important;
            gap: 8px;
          }
          .server-status-indicator {
            display: none !important;
          }
        }
        .right-panel-toggles {
          display: grid;
          grid-template-columns: 1fr 1fr;
          background: rgba(0, 0, 0, 0.25);
          border-bottom: 1px solid var(--border-color);
          padding: 4px;
          height: 40px;
          flex-shrink: 0;
        }
        .panel-toggle-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          font-family: var(--font-sans);
          font-size: 0.8rem;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border-radius: 4px;
          transition: all var(--transition-fast);
        }
        .panel-toggle-btn:hover:not(:disabled) {
          color: var(--text-primary);
        }
        .panel-toggle-btn.active {
          background: var(--bg-tertiary);
          color: var(--accent-purple);
        }
        .panel-toggle-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .right-panel-content {
          flex: 1;
          overflow: hidden;
        }
        .editor-splash-screen {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px;
          background: rgba(8, 12, 20, 0.6);
        }
        .splash-card {
          max-width: 600px;
          padding: 40px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 16px;
          background: rgba(13, 20, 35, 0.8);
        }
        .splash-card h2 {
          font-size: 1.5rem;
        }
        .splash-card p {
          font-size: 0.9rem;
          color: var(--text-secondary);
        }
        .splash-shortcuts {
          display: flex;
          flex-direction: column;
          gap: 16px;
          width: 100%;
          margin-top: 24px;
          text-align: left;
        }
        .shortcut-item {
          border-left: 2px solid var(--accent-purple);
          padding-left: 12px;
        }
        .shortcut-item span {
          display: block;
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 2px;
        }
        .shortcut-item p {
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .shortcut-item kbd {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 0.7rem;
          font-family: var(--font-mono);
          color: var(--accent-cyan);
        }
        .text-purple { color: var(--accent-purple); }
        .text-green { color: var(--accent-green); }

        /* Abas centrais */
        .central-workspace-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }
        .central-tabs-header {
          display: flex;
          background: rgba(13, 20, 35, 0.9);
          border-bottom: 1px solid var(--border-color);
          padding: 4px 16px;
          gap: 8px;
          height: 40px;
          align-items: center;
          flex-shrink: 0;
        }
        .central-tab-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          font-family: var(--font-sans);
          font-size: 0.8rem;
          font-weight: 500;
          padding: 4px 12px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all var(--transition-fast);
        }
        .central-tab-btn:hover {
          color: var(--text-primary);
        }
        .central-tab-btn.active {
          background: var(--bg-tertiary);
          color: var(--accent-purple);
        }
        .central-tab-body {
          flex: 1;
          overflow: hidden;
        }

        /* Estilos do Widget de Perfil de Usuário */
        .user-profile-widget {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-color);
          border-radius: 20px;
          padding: 3px 12px 3px 3px;
          position: relative;
        }
        .user-avatar {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          object-fit: cover;
          border: 1px solid var(--accent-purple);
        }
        .user-avatar-placeholder {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: var(--bg-tertiary);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
        }
        .user-name-tooltip {
          font-size: 0.8rem;
          font-weight: 500;
          color: var(--text-primary);
          max-width: 140px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .btn-logout {
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2px;
          border-radius: 4px;
          transition: all var(--transition-fast);
        }
        .btn-logout:hover {
          color: #f87171;
          background: rgba(239, 68, 68, 0.1);
        }
      `}</style>
    </div>
  );
}

export default App;
