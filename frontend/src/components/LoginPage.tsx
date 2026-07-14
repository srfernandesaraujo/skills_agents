import React, { useState } from 'react';
import { LogIn, Sparkles, AlertCircle, ShieldAlert, Cpu } from 'lucide-react';
import { auth, googleProvider, isAuthEnabled } from '../firebase';
import { signInWithPopup } from 'firebase/auth';

interface LoginPageProps {
  onLoginSuccess: (user: {
    uid: string;
    email: string;
    displayName: string;
    photoURL: string;
    idToken: string;
  }) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Estados para simulação de login local
  const [mockEmail, setMockEmail] = useState('srfernandesaraujo@gmail.com');

  const handleGoogleLogin = async () => {
    if (!isAuthEnabled) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();
      onLoginSuccess({
        uid: result.user.uid,
        email: result.user.email || '',
        displayName: result.user.displayName || 'Usuário',
        photoURL: result.user.photoURL || '',
        idToken,
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Falha ao autenticar com o Google.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMockLogin = (emailToUse: string) => {
    setIsLoading(true);
    setTimeout(() => {
      onLoginSuccess({
        uid: emailToUse === 'srfernandesaraujo@gmail.com' ? 'admin-local-uid' : 'user-local-uid',
        email: emailToUse,
        displayName: emailToUse === 'srfernandesaraujo@gmail.com' ? 'Sérgio Araújo (Admin)' : 'Usuário de Teste',
        photoURL: 'https://api.dicebear.com/7.x/bottts/svg?seed=' + emailToUse,
        idToken: 'mock-token-' + emailToUse,
      });
      setIsLoading(false);
    }, 800);
  };

  return (
    <div className="login-wrapper">
      <div className="gradient-bg">
        <div className="glow-orb orb-1"></div>
        <div className="glow-orb orb-2"></div>
      </div>

      <div className="glass-panel login-card animate-fade-in">
        <div className="brand-header">
          <div className="logo-container">
            <Cpu className="logo-icon text-cyan" />
            <Sparkles className="logo-sparkle text-purple" />
          </div>
          <h1 className="brand-name">AI Skills Manager</h1>
          <p className="brand-subtitle">Gestão & Versionamento de Playbooks de IA</p>
        </div>

        <div className="divider"></div>

        {error && (
          <div className="alert alert-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {isAuthEnabled ? (
          <div className="auth-section">
            <p className="auth-instructions">
              Acesse a plataforma de forma segura utilizando sua Conta do Google corporativa ou pessoal.
            </p>

            <button 
              className={`btn-google ${isLoading ? 'loading' : ''}`}
              onClick={handleGoogleLogin}
              disabled={isLoading}
            >
              {!isLoading && (
                <svg className="google-icon" viewBox="0 0 24 24" width="20" height="20">
                  <path fill="#EA4335" d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114-3.478 0-6.3-2.823-6.3-6.3 0-3.478 2.822-6.3 6.3-6.3 1.63 0 3.11.62 4.237 1.63l2.907-2.907C18.995 2.625 15.823 1.5 12.24 1.5 6.308 1.5 1.5 6.308 1.5 12.24s4.808 10.74 10.74 10.74c5.932 0 10.74-4.808 10.74-10.74 0-.756-.08-1.5-.236-2.215H12.24z"/>
                  <path fill="#4285F4" d="M22.744 12.24c0-.756-.08-1.5-.236-2.215H12.24v4.375h6.887c-.28 1.04-.888 1.93-1.742 2.502v2.852h2.82c1.65-1.522 2.6-3.763 2.6-6.314z" />
                  <path fill="#FBBC05" d="M12.24 22.98c2.903 0 5.34-.962 7.124-2.61l-2.82-2.852c-.783.526-1.785.836-2.852.836-2.617 0-4.832-1.767-5.62-4.143H2.072v2.946c1.785 3.554 5.438 5.823 9.684 5.823z" />
                  <path fill="#34A853" d="M6.62 14.21c-.2-.6-.312-1.246-.312-1.92 0-.674.112-1.32.312-1.92V7.424H2.072A10.702 10.702 0 001.5 12.24c0 1.704.4 3.315 1.11 4.773l4.01-2.803z" />
                </svg>
              )}
              {isLoading ? 'Autenticando...' : 'Entrar com o Google'}
            </button>
          </div>
        ) : (
          <div className="auth-section">
            <div className="alert alert-warning">
              <ShieldAlert size={16} />
              <span>Modo de Desenvolvimento Local</span>
            </div>
            
            <p className="auth-instructions">
              O Firebase Auth não está ativado no ambiente local. Simule a entrada com perfis diferentes:
            </p>

            <div className="mock-login-form">
              <div className="form-group">
                <label className="form-label">E-mail para Simulação</label>
                <input 
                  type="email" 
                  className="input-text"
                  value={mockEmail}
                  onChange={(e) => setMockEmail(e.target.value)}
                  placeholder="exemplo@gmail.com"
                />
              </div>

              <div className="mock-actions">
                <button 
                  className="btn btn-primary"
                  onClick={() => handleMockLogin(mockEmail)}
                  disabled={isLoading}
                >
                  <LogIn size={16} />
                  Entrar como {mockEmail === 'srfernandesaraujo@gmail.com' ? 'Admin' : 'Usuário'}
                </button>
                
                {mockEmail !== 'srfernandesaraujo@gmail.com' && (
                  <button 
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setMockEmail('srfernandesaraujo@gmail.com');
                      handleMockLogin('srfernandesaraujo@gmail.com');
                    }}
                  >
                    Ativar Conta Admin
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="login-footer">
          <p>AI Skills Manager v1.5 Premium</p>
        </div>
      </div>

      <style>{`
        .login-wrapper {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #090d16;
          font-family: 'Inter', system-ui, sans-serif;
          z-index: 9999;
          overflow: hidden;
        }

        .gradient-bg {
          position: absolute;
          width: 100%;
          height: 100%;
          top: 0;
          left: 0;
          z-index: 1;
        }

        .glow-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
          opacity: 0.15;
          animation: float 20s infinite alternate ease-in-out;
        }

        .orb-1 {
          width: 500px;
          height: 500px;
          background: var(--accent-purple, #a855f7);
          top: -100px;
          left: -100px;
        }

        .orb-2 {
          width: 600px;
          height: 600px;
          background: var(--accent-cyan, #06b6d4);
          bottom: -150px;
          right: -150px;
          animation-delay: -5s;
        }

        @keyframes float {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(100px, 50px) scale(1.2); }
        }

        .login-card {
          position: relative;
          z-index: 2;
          width: 100%;
          max-width: 440px;
          padding: 40px;
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
          text-align: center;
        }

        .brand-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 24px;
        }

        .logo-container {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 64px;
          height: 64px;
          background: rgba(6, 182, 212, 0.1);
          border: 1px solid rgba(6, 182, 212, 0.2);
          border-radius: 16px;
          margin-bottom: 16px;
          box-shadow: 0 0 20px rgba(6, 182, 212, 0.15);
        }

        .logo-icon {
          width: 32px;
          height: 32px;
        }

        .logo-sparkle {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 16px;
          height: 16px;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.1); }
        }

        .brand-name {
          font-size: 1.75rem;
          font-weight: 700;
          letter-spacing: -0.025em;
          background: linear-gradient(135deg, #ffffff 50%, #a855f7 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin: 0 0 6px 0;
        }

        .brand-subtitle {
          font-size: 0.9rem;
          color: #94a3b8;
          margin: 0;
        }

        .divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08) 20%, rgba(255, 255, 255, 0.08) 80%, transparent);
          margin: 24px 0;
        }

        .auth-instructions {
          font-size: 0.85rem;
          color: #94a3b8;
          line-height: 1.5;
          margin-bottom: 24px;
        }

        .btn-google {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 100%;
          padding: 12px 24px;
          background: #ffffff;
          color: #0f172a;
          border: none;
          border-radius: 12px;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease-in-out;
          box-shadow: 0 4px 12px rgba(255, 255, 255, 0.1);
        }

        .btn-google:hover {
          background: #f1f5f9;
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(255, 255, 255, 0.15);
        }

        .btn-google:active {
          transform: translateY(0);
        }

        .btn-google:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .google-icon {
          flex-shrink: 0;
        }

        .alert {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 0.8rem;
          text-align: left;
          margin-bottom: 20px;
        }

        .alert-error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #f87171;
        }

        .alert-warning {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.2);
          color: #fbbf24;
        }

        .mock-login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
          text-align: left;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-label {
          font-size: 0.8rem;
          font-weight: 600;
          color: #94a3b8;
        }

        .input-text {
          padding: 10px 14px;
          background: rgba(15, 23, 42, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          color: #ffffff;
          font-size: 0.9rem;
          transition: border-color 0.2s;
        }

        .input-text:focus {
          outline: none;
          border-color: var(--accent-cyan, #06b6d4);
        }

        .mock-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 8px;
        }

        .login-footer {
          margin-top: 32px;
          font-size: 0.75rem;
          color: #475569;
        }

        /* Classes utilitárias herdadas ou injetadas */
        .btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 0.9rem;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }
        .btn-primary {
          background: linear-gradient(135deg, #a855f7, #06b6d4);
          color: #ffffff;
        }
        .btn-primary:hover {
          opacity: 0.9;
          transform: translateY(-1px);
        }
        .btn-secondary {
          background: rgba(255, 255, 255, 0.05);
          color: #e2e8f0;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        .btn-sm {
          padding: 6px 12px;
          font-size: 0.8rem;
        }
        .text-cyan { color: #06b6d4; }
        .text-purple { color: #a855f7; }

        .animate-fade-in {
          animation: fadeIn 0.4s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};
