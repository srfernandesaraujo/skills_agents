import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const execPromise = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILLS_DIR = path.join(__dirname, 'skills');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

const ADMIN_EMAIL = 'srfernandesaraujo@gmail.com';
const SKILL_LIMIT_USERS = 2; // máximo de skills para usuários não-admin

// Garante que os diretórios locais existam para o modo local
if (!fs.existsSync(SKILLS_DIR)) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
}
if (!fs.existsSync(TEMPLATES_DIR)) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

export const useFirebase = process.env.USE_FIREBASE === 'true';

let db = null;
let bucket = null;
let firebaseInitError = null;

export function getDb() {
  return db;
}

export function getBucket() {
  return bucket;
}

export function isFirebaseInitialized() {
  return getApps().length > 0;
}

export function getFirebaseInitError() {
  return firebaseInitError;
}

if (useFirebase) {
  try {
    const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      initializeApp({
        credential: cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`
      });
      console.log('Firebase initialized via firebase-service-account.json');
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
      });
      console.log('Firebase initialized via environment variables');
    } else {
      console.warn('Firebase configuration missing. Falling back to local storage.');
      firebaseInitError = 'Credenciais ausentes no ambiente.';
      db = null;
      bucket = null;
    }

    if (getApps().length > 0) {
      db = getFirestore();
      bucket = getStorage().bucket();
    }
  } catch (err) {
    console.error('Failed to initialize Firebase. Falling back to local storage:', err);
    firebaseInitError = err.message || err.toString();
  }
}

/**
 * Verifica o token de autenticação do Firebase.
 * Em modo local (USE_FIREBASE=false), retorna um usuário admin fictício sem validação.
 */
export async function verifyIdToken(idToken) {
  if (!useFirebase) {
    // Modo local: se não há autenticação Firebase ativa, assume usuário admin
    return { uid: 'local-admin', email: ADMIN_EMAIL, name: 'Admin Local', isAdmin: true };
  }

  if (!idToken) {
    throw new Error('Token de autorização ausente.');
  }

  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const email = decodedToken.email || '';
    return {
      uid: decodedToken.uid,
      email: email,
      name: decodedToken.name || email || 'Usuário',
      isAdmin: email.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
    };
  } catch (err) {
    throw new Error('Token inválido ou expirado: ' + err.message);
  }
}

/**
 * Conta quantas skills um usuário criou no Firestore.
 * Retorna 0 no modo local (sem restrição).
 */
export async function countUserSkills(userUid) {
  if (!useFirebase || !db) return 0;
  try {
    const snapshot = await db.collection('skills')
      .where('ownerUid', '==', userUid)
      .count()
      .get();
    return snapshot.data().count || 0;
  } catch {
    return 0;
  }
}

export { ADMIN_EMAIL, SKILL_LIMIT_USERS };

// --- UTILS LOCAL (GIT & PATH) ---
async function runGit(args) {
  const escapedArgs = args.map(arg => {
    if (arg.includes(' ') || arg.includes('"') || arg.includes("'")) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  });
  const cmd = `git ${escapedArgs.join(' ')}`;
  try {
    const { stdout, stderr } = await execPromise(cmd, { cwd: SKILLS_DIR });
    return { stdout, stderr, success: true };
  } catch (error) {
    console.error(`Git error: ${cmd}`, error);
    return { error: error.message, stdout: error.stdout, stderr: error.stderr, success: false };
  }
}

function safePath(base, relative) {
  const target = path.normalize(path.join(base, relative));
  if (!target.startsWith(base)) {
    throw new Error('Acesso não autorizado ao sistema de arquivos');
  }
  return target;
}

// Converte caminho Firestore URL-safe
function getDocIdFromPath(filePath) {
  return filePath.replace(/\//g, '___');
}

function getPathFromDocId(docId) {
  return docId.replace(/___/g, '/');
}

// --- METADADOS (LEITURA DO SKILL.MD) ---
function parseSkillMetadataFromContent(skillName, content) {
  let title = skillName;
  let description = 'Playbook da Skill de IA.';
  let accepts_files = false;
  let supported_formats = ["pdf", "image"];
  let trigger = null;
  let cron_expression = null;
  let webhook_endpoint = null;

  try {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
    const match = content.match(frontmatterRegex);
    let markdownBody = content;

    if (match) {
      const yamlStr = match[1];
      markdownBody = content.replace(frontmatterRegex, '');
      const lines = yamlStr.split('\n');
      for (const line of lines) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const key = parts[0].trim().toLowerCase();
          const value = parts.slice(1).join(':').trim();
          if (key === 'title') {
            title = value.replace(/^['"]|['"]$/g, '');
          } else if (key === 'description') {
            description = value.replace(/^['"]|['"]$/g, '');
          } else if (key === 'accepts_files' || key === 'acceptsfiles') {
            accepts_files = value.toLowerCase() === 'true';
          } else if (key === 'supported_formats' || key === 'supportedformats') {
            const cleanVal = value.replace(/[\[\]'"]/g, '');
            supported_formats = cleanVal.split(',').map(s => s.trim().toLowerCase());
          } else if (key === 'trigger') {
            const cleanVal = value.replace(/^['"]|['"]$/g, '').trim();
            if (cleanVal.startsWith('cron(')) {
              trigger = 'cron';
              const cronMatch = cleanVal.match(/cron\(['"]?(.*?)['"]?\)/i);
              if (cronMatch) {
                cron_expression = cronMatch[1];
              }
            } else if (cleanVal === 'webhook') {
              trigger = 'webhook';
            }
          } else if (key === 'endpoint') {
            webhook_endpoint = value.replace(/^['"]|['"]$/g, '').trim();
          }
        }
      }
    }

    const lines = markdownBody.split('\n');
    const headerLine = lines.find(line => line.startsWith('# '));
    if (headerLine && title === skillName) {
      title = headerLine.replace('# ', '').trim();
    }
  } catch (e) {
    console.error(`Error parsing skill metadata for ${skillName}:`, e);
  }

  return { title, description, accepts_files, supported_formats, trigger, cron_expression, webhook_endpoint };
}

// --- DADOS RECOMENDADOS PARA CRIAÇÃO ---
function getDadosReadme(title, desc) {
  const isMedical = /médic|clin|saúd|anamne|farmac|pacient|receit|dosag|exame/i.test(title + ' ' + desc);
  const isVideoOrMarketing = /video|youtube|seo|marketing|redes|social|post|conteúd/i.test(title + ' ' + desc);

  let recomendedContent = `* **Arquivos de Especificações**: Requisitos de formatação, regras operacionais e manuais do projeto.
* **Exemplos de Referência (Few-Shot)**: Arquivos de texto contendo de 2 a 3 casos de sucesso ou modelos desejados para guiar o Agente.`;

  if (isMedical) {
    recomendedContent = `* **Diretrizes e Protocolos Clínicos**: Artigos científicos da ementa, guidelines de conselhos ou consensos profissionais (ex: Anamnese Farmacêutica, Diretriz da SBC).
* **Banco de Casos Clínicos Simulados**: Histórico de pacientes fictícios para simulação de consulta de anamnese no ensino.
* **Tabelas de Referência**: Tabelas de exames laboratoriais basais, dosagens usuais ou scores de risco (ex: TIMI, Wells).`;
  } else if (isVideoOrMarketing) {
    recomendedContent = `* **Diretrizes de SEO e Thumbnail**: Regras e diretrizes visuais para criação de capas e atração de cliques (CTR).
* **Roteiros Modelo**: Roteiros em markdown de vídeos que performaram acima da média para o agente usar como base.
* **Estatísticas do Canal**: Arquivos CSV ou texto com o engajamento anterior do canal.`;
  }

  return `# 📂 Pasta de Referências e Dados (/dados)\n\nEsta pasta foi criada para armazenar arquivos de referência teóricos e contextuais para a Skill **"${title}"**.\n\n## 🎯 O que colocar aqui (Recomendado para esta Skill)?\n${recomendedContent}\n\n## ⚙️ Como o Agente usa essa pasta?\nO motor de execução faz o carregamento automático dos nomes dos arquivos desta pasta e os apresenta no menu contextual lateral em **"Referências (/dados)"**. A IA lerá o conteúdo desses arquivos sob demanda para responder com dados cientificamente respaldados ou adaptados ao seu domínio de negócio.\n`;
}

function getAssetsReadme(title, desc) {
  const isMedical = /médic|clin|saúd|anamne|farmac|pacient|receit|dosag|exame/i.test(title + ' ' + desc);
  const isVideoOrMarketing = /video|youtube|seo|marketing|redes|social|post|conteúd/i.test(title + ' ' + desc);

  let recomendedContent = `* **Diagramas Técnicos**: Fluxogramas e imagens de arquitetura para visualização.
* **Imagens de Marca**: Logotipos ou elements visuais de branding.`;

  if (isMedical) {
    recomendedContent = `* **Fluxogramas de Decisão Clinical**: Imagens de algoritmos de conduta ou exames para auxiliar na simulação de anamnese farmacêutica.
* **Recursos Visuais de Anatomia/Farmácia**: Imagens de bulas, caixas de medicamentos ou ilustrações anatômicas.`;
  } else if (isVideoOrMarketing) {
    recomendedContent = `* **Exemplos de Capas (Thumbnails)**: Imagens de capas que performaram bem no YouTube para orientar o agente.
* **Layouts de Postagens**: Templates ou wireframes de posts para redes sociais.`;
  }

  return `# 🎨 Pasta de Mídias e Recursos Visuais (/assets)\n\nEsta pasta serve para armazenar mídias de apoio visual para a Skill **"${title}"**.\n\n## 🎯 O que colocar aqui (Recomendado para esta Skill)?\n${recomendedContent}\n\n## ⚙️ Como o Agente usa essa pasta?\nArquivos de imagem salvos aqui podem ser renderizados pelo Agente no chat usando formatação markdown padrão com caminhos relativos (ex: \`![Algoritmo](assets/algoritmo.png)\`).\n`;
}

function getToolsReadme(title, folderName, desc) {
  const isMedical = /médic|clin|saúd|anamne|farmac|pacient|receit|dosag|exame/i.test(title + ' ' + desc);
  const isVideoOrMarketing = /video|youtube|seo|marketing|redes|social|post|conteúd/i.test(title + ' ' + desc);

  let sampleScript = `def executar(args):
    # Insira a lógica de cálculo ou automação do script
    return {"sucesso": True, "resultado": "Executado"}`;

  let descriptionText = `scripts de cálculo matemático ou conectores locais de integração.`;

  if (isMedical) {
    descriptionText = `scripts de cálculo de dosagem farmacêutica, calculadoras de clearance de creatinina, scores de risco ou integradores de exames clínicos.`;
    sampleScript = `def executar(args):
    # Exemplo: Calcula a depuração de creatinina (Cockcroft-Gault) para farmacologia clínica
    idade = float(args.get("idade", 60))
    peso = float(args.get("peso", 70))
    creatinina = float(args.get("creatinina", 1.0))
    sexo = args.get("sexo", "masculino")
    
    # Fórmula básica
    resultado = ((140 - idade) * peso) / (72 * creatinina)
    if sexo.lower() == "feminino":
        resultado *= 0.85
        
    return {
        "clearance_creatinina": f"{round(resultado, 2)} mL/min",
        "interpretacao": "Normal" if resultado >= 90 else "Reduzido",
        "sucesso": True
    }`;
  } else if (isVideoOrMarketing) {
    descriptionText = `scripts para raspagem de dados de views do YouTube, estimadores de CTR ou formatadores de roteiros para redes sociais.`;
    sampleScript = `def executar(args):
    # Exemplo: Estimador de taxa de cliques (CTR) baseado em keywords e tamanho de título
    titulo = args.get("titulo", "")
    tamanho = len(titulo)
    contem_emoji = any(c in titulo for c in ["🔥", "🚨", "🚀", "💡"])
    
    score = 50
    if 30 <= tamanho <= 60: score += 20
    if contem_emoji: score += 15
    
    return {
        "estimativa_ctr": f"{score}% de engajamento",
        "recomendacao": "Título excelente!" if score >= 80 else "Tente encurtar ou adicionar um emoji chamativo.",
        "sucesso": True
    }`;
  }

  return `# ⚙️ Scripts de Automação e Análise (/tools)\n\nEsta pasta armazena os scripts Python executáveis (\`.py\`) que servem como ferramentas (tools) lógicas para a Skill **"${title}"**.\n\n## 🎯 O que colocar aqui (Recomendado para esta Skill)?\n* Scripts Python de suporte clínico ou técnico, especificamente voltados para: ${descriptionText}\n\n## ⚙️ Exemplo de Script Estruturado (salve como \`tools/calculadora.py\`):\n\`\`\`python\n# coding: utf-8\nimport sys\nimport json\n\n${sampleScript}\n\nif __name__ == "__main__":\n    if len(sys.argv) > 1:\n        with open(sys.argv[1], "r", encoding="utf-8") as f:\n            args = json.load(f)\n        resultado = executar(args)\n        print(json.dumps(resultado, ensure_ascii=False))\n    else:\n        print(json.dumps({"error": "Nenhum argumento fornecido"}))\n\`\`\`\n\n## ⚙️ Como o Agente usa essa pasta?\nO motor lista todos os scripts \`.py\` nesta pasta. O Agente invocará o script enviando os parâmetros correspondentes no formato JSON (ex: \`{"callTool": "calculadora.py", "args": {"peso": 80}}\`) e processará o retorno.\n`;
}

// --- FUNÇÕES DE ARMAZENAMENTO DE SKILLS ---

export async function listSkills() {
  if (useFirebase && db) {
    const snapshot = await db.collection('skills').get();
    const skills = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      skills.push({
        name: doc.id,
        title: data.title || doc.id,
        description: data.description || '',
        path: doc.id,
        accepts_files: data.accepts_files || false,
        supported_formats: data.supported_formats || ["pdf", "image"],
        trigger: data.trigger || null,
        cron_expression: data.cron_expression || null,
        webhook_endpoint: data.webhook_endpoint || null
      });
    });
    return skills;
  } else {
    // Local
    const items = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skills = [];
    for (const item of items) {
      if (item.name === '.git' || !item.isDirectory() || item.name === '.memory') continue;
      
      const skillPath = path.join(SKILLS_DIR, item.name);
      const skillMdPath = path.join(skillPath, 'skill.md');
      let content = '';
      if (fs.existsSync(skillMdPath)) {
        content = fs.readFileSync(skillMdPath, 'utf8');
      }
      const meta = parseSkillMetadataFromContent(item.name, content);
      skills.push({
        name: item.name,
        ...meta,
        path: item.name
      });
    }
    return skills;
  }
}

export async function getSkill(name) {
  if (useFirebase && db) {
    const docRef = db.collection('skills').doc(name);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error('Skill não encontrada no Firebase');
    }
    const data = doc.data();
    
    // Lista arquivos do subcollection 'files'
    const filesSnapshot = await docRef.collection('files').get();
    const flatFilesList = [];
    filesSnapshot.forEach(fDoc => {
      const fData = fDoc.data();
      flatFilesList.push({
        path: fData.path,
        type: fData.type || 'file',
        size: fData.size || 0
      });
    });

    // Reconstrói a árvore de arquivos a partir de caminhos planos
    const buildTree = (paths) => {
      const root = [];
      const map = {};

      paths.forEach(item => {
        const parts = item.path.split('/');
        let currentLevel = root;

        parts.forEach((part, index) => {
          const isLast = index === parts.length - 1;
          const currentPath = parts.slice(0, index + 1).join('/');

          if (!map[currentPath]) {
            const node = {
              name: part,
              path: currentPath,
              type: isLast ? 'file' : 'directory',
              size: isLast ? item.size : undefined
            };
            if (!isLast) {
              node.children = [];
            }
            map[currentPath] = node;
            currentLevel.push(node);
          }

          if (!isLast) {
            currentLevel = map[currentPath].children;
          }
        });
      });

      return root.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      });
    };

    const files = buildTree(flatFilesList);

    return {
      name,
      title: data.title || name,
      description: data.description || '',
      accepts_files: data.accepts_files || false,
      supported_formats: data.supported_formats || ["pdf", "image"],
      trigger: data.trigger || null,
      cron_expression: data.cron_expression || null,
      webhook_endpoint: data.webhook_endpoint || null,
      files
    };
  } else {
    // Local
    const skillPath = safePath(SKILLS_DIR, name);
    if (!fs.existsSync(skillPath)) {
      throw new Error('Skill não encontrada localmente');
    }

    const skillMdPath = path.join(skillPath, 'skill.md');
    let content = '';
    if (fs.existsSync(skillMdPath)) {
      content = fs.readFileSync(skillMdPath, 'utf8');
    }
    const meta = parseSkillMetadataFromContent(name, content);

    // Recursivo para listar árvore
    const getFileTreeLocal = (dirPath, rootDir = dirPath) => {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      let results = [];

      for (const item of items) {
        if (item.name === '.git' || item.name === 'node_modules') continue;
        
        const fullPath = path.join(dirPath, item.name);
        const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

        if (item.isDirectory()) {
          results.push({
            name: item.name,
            path: relativePath,
            type: 'directory',
            children: getFileTreeLocal(fullPath, rootDir)
          });
        } else {
          const stats = fs.statSync(fullPath);
          results.push({
            name: item.name,
            path: relativePath,
            type: 'file',
            size: stats.size
          });
        }
      }
      return results.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      });
    };

    const files = getFileTreeLocal(skillPath);
    return {
      name,
      ...meta,
      files
    };
  }
}

export async function getFileContent(name, filePath) {
  if (useFirebase && db) {
    const docId = getDocIdFromPath(filePath);
    const docRef = db.collection('skills').doc(name).collection('files').doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error('Arquivo não encontrado no Firebase');
    }

    const data = doc.data();
    return {
      path: filePath,
      content: data.content || '',
      isBinary: data.isBinary || false,
      size: data.size || 0,
      mimeType: data.mimeType || 'text/plain',
      url: data.url || null
    };
  } else {
    // Local
    const fullPath = safePath(path.join(SKILLS_DIR, name), filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error('Arquivo não encontrado localmente');
    }

    const stats = fs.statSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const isBinary = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip'].includes(ext);

    if (isBinary) {
      return {
        path: filePath,
        isBinary: true,
        size: stats.size,
        mimeType: ext === '.pdf' ? 'application/pdf' : 'image/' + ext.replace('.', '')
      };
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    return {
      path: filePath,
      content,
      isBinary: false,
      size: stats.size
    };
  }
}

export async function saveFile(name, filePath, content, isBinary = false, mimeType = 'text/plain') {
  if (useFirebase && db) {
    const docId = getDocIdFromPath(filePath);
    const skillRef = db.collection('skills').doc(name);
    const docRef = skillRef.collection('files').doc(docId);

    const size = Buffer.byteLength(content, 'utf8');

    // Salva metadados e conteúdo do arquivo
    await docRef.set({
      path: filePath,
      content: isBinary ? '' : content,
      isBinary,
      size,
      mimeType,
      updatedAt: new Date().toISOString()
    });

    // Se salvou o skill.md principal, sincroniza os metadados do documento pai
    if (filePath === 'skill.md') {
      const meta = parseSkillMetadataFromContent(name, content);
      await skillRef.set(meta, { merge: true });
    }

    // Registra no histórico do Firestore (Simula Git commit)
    const commitHash = 'rev_' + Math.random().toString(36).substring(2, 9) + Date.now();
    await skillRef.collection('history').add({
      hash: commitHash,
      message: `Atualizar arquivo: ${filePath}`,
      date: new Date().toISOString(),
      author: 'AI Skills Manager',
      filePath,
      content: isBinary ? '' : content
    });

    return { commitHash };
  } else {
    // Local
    const fullPath = safePath(path.join(SKILLS_DIR, name), filePath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content || '');

    // Git commit automático
    const gitRelativePath = path.join(name, filePath).replace(/\\/g, '/');
    await runGit(['add', gitRelativePath]);
    await runGit(['commit', '-m', `Atualizar arquivo: ${gitRelativePath}`]);

    // Se salvou o skill.md principal, lê metadados (atualiza trigger, cron)
    if (filePath === 'skill.md') {
      // O chamador faz a sincronização de gatilhos cron locais
    }

    return { success: true };
  }
}

export async function saveBinaryFile(name, filePath, buffer, mimeType) {
  if (useFirebase && db && bucket) {
    // Envia para o Firebase Storage
    const storagePath = `skills/${name}/${filePath}`;
    const file = bucket.file(storagePath);
    await file.save(buffer, {
      metadata: { contentType: mimeType }
    });

    // Torna o arquivo legível ou gera URL pública
    // No Firebase Storage padrão, podemos usar URLs públicas padrão do googleapis
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media`;

    const docId = getDocIdFromPath(filePath);
    const skillRef = db.collection('skills').doc(name);
    const docRef = skillRef.collection('files').doc(docId);

    const size = buffer.length;

    await docRef.set({
      path: filePath,
      content: '',
      isBinary: true,
      size,
      mimeType,
      url,
      updatedAt: new Date().toISOString()
    });

    // Registra histórico
    const commitHash = 'rev_' + Math.random().toString(36).substring(2, 9) + Date.now();
    await skillRef.collection('history').add({
      hash: commitHash,
      message: `Upload arquivo binário: ${filePath}`,
      date: new Date().toISOString(),
      author: 'AI Skills Manager',
      filePath,
      content: ''
    });

    return { url };
  } else {
    // Local
    const fullPath = safePath(path.join(SKILLS_DIR, name), filePath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(fullPath, buffer);

    const gitRelativePath = path.join(name, filePath).replace(/\\/g, '/');
    await runGit(['add', gitRelativePath]);
    await runGit(['commit', '-m', `Upload de arquivo binário: ${gitRelativePath}`]);
    return { success: true };
  }
}

export async function deleteFile(name, filePath) {
  if (useFirebase && db) {
    const docId = getDocIdFromPath(filePath);
    const skillRef = db.collection('skills').doc(name);
    const docRef = skillRef.collection('files').doc(docId);

    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error('Arquivo não encontrado no Firebase');
    }

    const data = doc.data();

    // Se for binário, remove do Storage
    if (data.isBinary && bucket) {
      try {
        const storagePath = `skills/${name}/${filePath}`;
        await bucket.file(storagePath).delete();
      } catch (err) {
        console.error('Storage file deletion error:', err);
      }
    }

    await docRef.delete();

    // Registra deleção no histórico
    await skillRef.collection('history').add({
      hash: 'rev_del_' + Math.random().toString(36).substring(2, 9) + Date.now(),
      message: `Remover arquivo: ${filePath}`,
      date: new Date().toISOString(),
      author: 'AI Skills Manager',
      filePath,
      content: '[DELETED]'
    });

    return { success: true };
  } else {
    // Local
    const fullPath = safePath(path.join(SKILLS_DIR, name), filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error('Arquivo/pasta não encontrado localmente');
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }

    await runGit(['add', '-A', name]);
    await runGit(['commit', '-m', `Remover: ${path.join(name, filePath).replace(/\\/g, '/')}`]);
    return { success: true };
  }
}

export async function saveSkill(name, title, description, customMarkdown = null, user = null) {
  const folderName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  if (useFirebase && db) {
    const skillRef = db.collection('skills').doc(folderName);
    const doc = await skillRef.get();
    if (doc.exists) {
      throw new Error('Já existe uma Skill com esta pasta/nome no Firebase');
    }

    // Verificar limite de Skills para usuários não-admin
    if (user && !user.isAdmin) {
      const count = await countUserSkills(user.uid);
      if (count >= SKILL_LIMIT_USERS) {
        throw new Error(`Limite de ${SKILL_LIMIT_USERS} Skills excedido. Usuários gratuitos podem criar no máximo ${SKILL_LIMIT_USERS} Skills.`);
      }
    }

    const accepts_files = /médic|clin|saúd|anamne|farmac|pacient/i.test(title + ' ' + description);
    
    // Salva metadados do documento da Skill
    const metadata = {
      title,
      description,
      accepts_files,
      supported_formats: ["pdf", "image"],
      trigger: null,
      cron_expression: null,
      webhook_endpoint: null,
      createdAt: new Date().toISOString(),
      ownerUid: user?.uid || null,
      ownerEmail: user?.email || null,
    };
    await skillRef.set(metadata);

    // Cria arquivos iniciais de leitura e o playbook
    const playbookContent = customMarkdown || `---
title: "${title}"
description: "${description}"
accepts_files: ${accepts_files}
supported_formats: ["pdf", "image"]
trigger: null
endpoint: null
---

# ${title}

${description}

## Diferença Fundamental (Abordagem Tradicional vs. Abordagem com a Skill)

| Abordagem Tradicional | Abordagem de Excelência (Esta Skill) |
|---|---|
| Tratamento superficial ou respostas genéricas | Análise aprofundada, conceitual e orientada a regras do playbook |

## Passo 0 — Alinhamento e Entrevista Diagnóstica

Antes de executar, confirme com o usuário o que for essencial para a personalização do entregável:
1. Qual é o nível de profundidade e o público-alvo do entregável?

## Workflow Operacional Detalhado

| Etapa | Tempo | Função | Ação |
|---|---|---|---|
| 1. Alinhamento | 5 min | Alinhamento inicial | Entrevista |

## Diretrizes de Implementação e Gotchas

- **Densidade de Informação**: Mantenha cada resposta focada, objetiva e sem rodeios.

## Checkpoints de Validação (QA)

- [ ] Todos os objetivos levantados no Passo 0 foram atingidos?
`;

    // Grava no Firestore os arquivos padrão
    await saveFile(folderName, 'skill.md', playbookContent);
    await saveFile(folderName, 'dados/LEIA-ME.md', getDadosReadme(title, description));
    await saveFile(folderName, 'assets/LEIA-ME.md', getAssetsReadme(title, description));
    await saveFile(folderName, 'tools/LEIA-ME.md', getToolsReadme(title, folderName, description));

    return { folderName, title, description };
  } else {
    // Local
    const skillPath = path.join(SKILLS_DIR, folderName);
    if (fs.existsSync(skillPath)) {
      throw new Error('Já existe uma Skill com esta pasta/nome localmente');
    }

    fs.mkdirSync(skillPath);
    fs.mkdirSync(path.join(skillPath, 'dados'));
    fs.mkdirSync(path.join(skillPath, 'assets'));
    fs.mkdirSync(path.join(skillPath, 'tools'));

    fs.writeFileSync(path.join(skillPath, 'dados', 'LEIA-ME.md'), getDadosReadme(title || name, description || ''));
    fs.writeFileSync(path.join(skillPath, 'assets', 'LEIA-ME.md'), getAssetsReadme(title || name, description || ''));
    fs.writeFileSync(path.join(skillPath, 'tools', 'LEIA-ME.md'), getToolsReadme(title || name, folderName, description || ''));

    const accepts_files = /médic|clin|saúd|anamne|farmac|pacient/i.test((title || name) + ' ' + (description || ''));
    const playbookContent = customMarkdown || `---
title: "${title || name}"
description: "${description || 'Uma nova Skill.'}"
accepts_files: ${accepts_files}
supported_formats: ["pdf", "image"]
trigger: null
endpoint: null
---

# ${title || name}

${description || 'Uma nova Skill.'}
`;
    fs.writeFileSync(path.join(skillPath, 'skill.md'), playbookContent);

    // Git
    await runGit(['add', folderName]);
    await runGit(['commit', '-m', `Criar Skill: ${folderName}`]);

    return { folderName, title: title || name, description: description || '' };
  }
}

export async function deleteSkill(name) {
  if (useFirebase && db) {
    const docRef = db.collection('skills').doc(name);
    
    // Deleta arquivos do Storage (se houver)
    if (bucket) {
      try {
        await bucket.deleteFiles({ prefix: `skills/${name}/` });
      } catch (err) {
        console.error('Storage deletion failed for skill folder:', err);
      }
    }

    // Deleta subcoleção 'files'
    const filesSnap = await docRef.collection('files').get();
    const batch = db.batch();
    filesSnap.forEach(doc => batch.delete(doc.ref));
    
    // Deleta subcoleção 'history'
    const historySnap = await docRef.collection('history').get();
    historySnap.forEach(doc => batch.delete(doc.ref));

    // Deleta subcoleção 'memories' se houver
    const memoriesSnap = await docRef.collection('memories').get();
    memoriesSnap.forEach(doc => batch.delete(doc.ref));

    await batch.commit();
    await docRef.delete();
    return { success: true };
  } else {
    // Local
    const skillPath = safePath(SKILLS_DIR, name);
    if (!fs.existsSync(skillPath)) {
      throw new Error('Skill não encontrada');
    }
    fs.rmSync(skillPath, { recursive: true, force: true });
    await runGit(['add', '-A']);
    await runGit(['commit', '-m', `Deletar Skill inteira: ${name}`]);
    return { success: true };
  }
}

// --- HISTÓRICO ---
export async function getHistory(name, filePath = null) {
  if (useFirebase && db) {
    const skillRef = db.collection('skills').doc(name);
    let query = skillRef.collection('history');
    if (filePath) {
      query = query.where('filePath', '==', filePath);
    }
    
    const snapshot = await query.orderBy('date', 'desc').get();
    const history = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      history.push({
        hash: data.hash || doc.id,
        message: data.message || '',
        date: data.date || '',
        author: data.author || 'System',
        filePath: data.filePath || '',
        content: data.content || ''
      });
    });
    return history;
  } else {
    // Local
    const gitPath = filePath ? path.join(name, filePath).replace(/\\/g, '/') : name;
    const result = await runGit(['log', '--date=iso', '--format=%H|%s|%ad|%an', '--', gitPath]);
    if (!result.success) {
      return [];
    }
    return result.stdout
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        const [hash, message, date, author] = line.split('|');
        return { hash, message, date, author };
      });
  }
}

export async function revertFile(name, filePath, commitHash) {
  if (useFirebase && db) {
    const skillRef = db.collection('skills').doc(name);
    const snap = await skillRef.collection('history').where('hash', '==', commitHash).get();
    if (snap.empty) {
      throw new Error('Revisão não encontrada no histórico');
    }
    const revision = snap.docs[0].data();
    
    // Salva o conteúdo restaurado de volta na coleção de arquivos
    await saveFile(name, filePath, revision.content || '');
    return { success: true };
  } else {
    // Local
    const gitPath = filePath ? path.join(name, filePath).replace(/\\/g, '/') : name;
    const revertResult = await runGit(['checkout', commitHash, '--', gitPath]);
    if (!revertResult.success) {
      throw new Error(revertResult.stderr || revertResult.error);
    }
    await runGit(['add', gitPath]);
    await runGit(['commit', '-m', `Reverter arquivo ${filePath} para versão ${commitHash.substring(0, 7)}`]);
    return { success: true };
  }
}

// --- MEMÓRIAS (RAG) ---
export async function getMemories(skillName) {
  if (useFirebase && db) {
    const snapshot = await db.collection('skills').doc(skillName).collection('memories').get();
    const list = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      list.push({
        id: doc.id,
        text: data.text || '',
        embedding: data.embedding || null,
        timestamp: data.timestamp || ''
      });
    });
    return list;
  } else {
    // Mock local (retorna do banco vetorial carregado em server.js via vectorDB.getMemories)
    return null; // O chamador local continuará usando local DB
  }
}

export async function addMemory(skillName, text, embedding) {
  if (useFirebase && db) {
    const ref = db.collection('skills').doc(skillName).collection('memories').doc();
    const memory = {
      text,
      embedding,
      timestamp: new Date().toISOString()
    };
    await ref.set(memory);
    return { id: ref.id, ...memory };
  }
  return null;
}

export async function deleteMemory(skillName, id) {
  if (useFirebase && db) {
    await db.collection('skills').doc(skillName).collection('memories').doc(id).delete();
    return true;
  }
  return false;
}

// --- CONFIGURAÇÃO DE SISTEMA / AUTOMACÕES ---
export async function getSystemConfig() {
  if (useFirebase && db) {
    const doc = await db.collection('system').doc('config').get();
    return doc.exists ? doc.data() : {};
  }
  return null;
}

export async function saveSystemConfig(config) {
  if (useFirebase && db) {
    await db.collection('system').doc('config').set(config, { merge: true });
    return true;
  }
  return false;
}

export async function getSystemAutomationLogs() {
  if (useFirebase && db) {
    const doc = await db.collection('system').doc('automation_logs').get();
    return doc.exists ? doc.data().jobs || [] : [];
  }
  return null;
}

export async function saveSystemAutomationLogs(jobs) {
  if (useFirebase && db) {
    await db.collection('system').doc('automation_logs').set({ jobs });
    return true;
  }
  return false;
}

export async function downloadBinaryFile(name, filePath) {
  if (useFirebase && bucket) {
    const file = bucket.file(`skills/${name}/${filePath}`);
    const [buffer] = await file.download();
    return buffer;
  }
  return null;
}
