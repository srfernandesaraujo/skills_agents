import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Configuração do Firebase
// Se as variáveis de ambiente VITE_FIREBASE_* não forem informadas, o sistema
// assumirá o project_id 'skills-agents' como padrão de fallback.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${import.meta.env.VITE_FIREBASE_PROJECT_ID || 'skills-agents'}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "skills-agents",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${import.meta.env.VITE_FIREBASE_PROJECT_ID || 'skills-agents'}.firebasestorage.app`,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ""
};

// Verifica se deve rodar no modo de autenticação simulada (modo local puro)
export const isAuthEnabled = import.meta.env.VITE_USE_FIREBASE === 'true';

let authInstance: any = null;
let googleProviderInstance: any = null;

if (isAuthEnabled) {
  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    authInstance = getAuth(app);
    googleProviderInstance = new GoogleAuthProvider();
  } catch (error) {
    console.error("Erro ao inicializar Firebase Auth no frontend:", error);
  }
}

export const auth = authInstance;
export const googleProvider = googleProviderInstance;

// Interceptor Global de Fetch para injetar tokens de autenticação automaticamente
const originalFetch = window.fetch;
window.fetch = async function (input, init) {
  let token = '';

  if (isAuthEnabled && auth && auth.currentUser) {
    try {
      // Obtém o token atualizado e renova caso esteja prestes a expirar
      token = await auth.currentUser.getIdToken();
      const savedUser = localStorage.getItem('user_profile');
      if (savedUser) {
        const profile = JSON.parse(savedUser);
        profile.idToken = token;
        localStorage.setItem('user_profile', JSON.stringify(profile));
      }
    } catch (e) {
      console.error('Erro ao obter token Firebase no interceptor:', e);
    }
  } else {
    // Fallback: se não estiver rodando Firebase ativo, pega o token simulado
    const savedUser = localStorage.getItem('user_profile');
    if (savedUser) {
      const profile = JSON.parse(savedUser);
      token = profile.idToken || '';
    }
  }

  const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');

  // Se o destino for a nossa API, injeta o token Bearer
  if (token && (url.includes('/api/') || url.startsWith('/api/'))) {
    init = init || {};
    init.headers = init.headers || {};
    
    if (init.headers instanceof Headers) {
      init.headers.set('Authorization', `Bearer ${token}`);
    } else if (Array.isArray(init.headers)) {
      const hasAuth = init.headers.some(h => h[0].toLowerCase() === 'authorization');
      if (!hasAuth) {
        init.headers.push(['Authorization', `Bearer ${token}`]);
      }
    } else {
      if (!init.headers['Authorization'] && !init.headers['authorization']) {
        init.headers = {
          ...init.headers,
          'Authorization': `Bearer ${token}`
        };
      }
    }
  }

  return originalFetch.apply(this, [input, init]);
};
