import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import AdmZip from 'adm-zip';
import dotenv from 'dotenv';
import cron from 'node-cron';
import * as storage from './storage.js';

dotenv.config();

const execPromise = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Detecção de Docker disponível no sistema do usuário
let isDockerAvailable = false;
async function checkDockerAvailability() {
  try {
    // Executa uma checagem rápida para ver se o Docker daemon está ativo
    await execPromise('docker info');
    isDockerAvailable = true;
    console.log('🐳 [SANDBOX] Docker detectado e ativo! Execuções em Sandbox isoladas disponíveis.');
  } catch (err) {
    isDockerAvailable = false;
    console.log('⚠️ [SANDBOX] Docker não detectado ou inativo. Execuções em Sandbox utilizarão fallback por venv local.');
  }
}
checkDockerAvailability();

// Configuração do CORS
app.use(cors());
app.use(express.json());

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    req.user = await storage.verifyIdToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Não autorizado: ' + err.message });
  }
};

// Middleware que só permite o admin passar
const adminMiddleware = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem executar esta ação.' });
  }
  next();
};



// Diretório base onde as Skills serão armazenadas
const SKILLS_DIR = path.join(__dirname, 'skills');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Garante que o diretório de skills exista e inicializa o Git
if (!fs.existsSync(SKILLS_DIR)) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
}
if (!fs.existsSync(TEMPLATES_DIR)) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

// --- BANCO VETORIAL EMBARCADO (EMBEDDED VECTOR STORE) ---
const MEMORY_DIR = path.join(SKILLS_DIR, '.memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'db.json');

if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

class LocalVectorDB {
  constructor() {
    this.memories = [];
    this.load();
  }

  load() {
    if (fs.existsSync(MEMORY_FILE)) {
      try {
        const content = fs.readFileSync(MEMORY_FILE, 'utf8');
        this.memories = JSON.parse(content);
      } catch (err) {
        console.error('Erro ao carregar banco vetorial:', err);
        this.memories = [];
      }
    } else {
      this.memories = [];
      this.save();
    }
  }

  save() {
    try {
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.memories, null, 2), 'utf8');
    } catch (err) {
      console.error('Erro ao salvar banco vetorial:', err);
    }
  }

  addMemory(skillName, text, embedding) {
    const memory = {
      id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
      skillName,
      text,
      embedding,
      timestamp: new Date().toISOString()
    };
    this.memories.push(memory);
    this.save();
    return memory;
  }

  deleteMemory(id) {
    const initialLength = this.memories.length;
    this.memories = this.memories.filter(m => m.id !== id);
    this.save();
    return this.memories.length < initialLength;
  }

  getMemories(skillName) {
    return this.memories.filter(m => m.skillName === skillName);
  }

  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  search(skillName, queryEmbedding, topK = 3, threshold = 0.4) {
    const skillMemories = this.getMemories(skillName);
    const results = skillMemories.map(m => {
      const similarity = this.cosineSimilarity(queryEmbedding, m.embedding);
      return {
        id: m.id,
        text: m.text,
        timestamp: m.timestamp,
        similarity
      };
    });

    return results
      .filter(r => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }
}

const vectorDB = new LocalVectorDB();

async function getGeminiEmbedding(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: {
        parts: [{ text }]
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erro na geração de embedding: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const values = data.embedding?.values;
  if (!values) throw new Error('Estrutura de embedding inválida.');
  return values;
}


// Helper para executar comandos git no diretório de skills
async function runGit(args) {
  const escapedArgs = args.map(arg => {
    // Escapa argumentos com espaços ou caracteres especiais para o cmd
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
    console.error(`Erro ao executar comando git: ${cmd}`, error);
    return { 
      error: error.message, 
      stdout: error.stdout, 
      stderr: error.stderr, 
      success: false 
    };
  }
}

// Inicializa o repositório Git se necessário
async function initGitRepository() {
  const gitDir = path.join(SKILLS_DIR, '.git');
  if (!fs.existsSync(gitDir)) {
    console.log('Inicializando repositório Git na pasta de Skills...');
    await runGit(['init']);
    await runGit(['config', 'user.name', 'AI Skills Manager']);
    await runGit(['config', 'user.email', 'manager@ai-skills.local']);
    // Cria um arquivo .gitignore para não rastrear uploads gigantes desnecessários se houver
    fs.writeFileSync(path.join(SKILLS_DIR, '.gitignore'), '*.zip\n');
    await runGit(['add', '.gitignore']);
    await runGit(['commit', '-m', 'Initial commit: Configurar repositório de Skills']);
  } else {
    console.log('Repositório Git já inicializado.');
  }
}

initGitRepository();

// Middleware de upload com multer
const multerStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const { name, folder } = req.params; // folder: 'dados' ou 'assets'
    const targetDir = path.join(SKILLS_DIR, name, folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: function (req, file, cb) {
    // Preservar o nome do arquivo original com segurança
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, sanitizedName);
  }
});

const upload = multer({ storage: multerStorage });

// --- UTILS ---

// Previne Directory Traversal
function safePath(base, relative) {
  const target = path.normalize(path.join(base, relative));
  if (!target.startsWith(base)) {
    throw new Error('Acesso não autorizado ao sistema de arquivos');
  }
  return target;
}

// Lê recursivamente a estrutura de arquivos de uma pasta
function getFileTree(dirPath, rootDir = dirPath) {
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
        children: getFileTree(fullPath, rootDir)
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

  // Ordena diretórios primeiro, depois arquivos
  return results.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'directory' ? -1 : 1;
  });
}
// Extrai título, descrição e gatilhos de um arquivo markdown, analisando frontmatter YAML se houver
function parseSkillMetadata(skillName) {
  const filePath = path.join(SKILLS_DIR, skillName, 'skill.md');
  let title = skillName;
  let description = 'Playbook da Skill de IA.';
  let accepts_files = false;
  let supported_formats = ["pdf", "image"];
  let trigger = null;
  let cron_expression = null;
  let webhook_endpoint = null;

  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Checa por frontmatter YAML no topo do arquivo (entre ---)
      let markdownBody = content;
      const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
      const match = content.match(frontmatterRegex);
      
      if (match) {
        const yamlStr = match[1];
        markdownBody = content.replace(frontmatterRegex, '');
        
        // Parse de pares chave-valor simples
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
      
      // Busca pelo primeiro cabeçalho #
      const headerLine = lines.find(line => line.startsWith('# '));
      if (headerLine && title === skillName) {
        title = headerLine.replace('# ', '').trim();
      }

      // Busca pelo primeiro parágrafo não vazio após o cabeçalho
      const headerIndex = lines.indexOf(headerLine);
      const descLine = lines.slice(headerIndex + 1).find(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('>') && !trimmed.startsWith('-');
      });

      if (descLine && description === 'Playbook da Skill de IA.') {
        description = descLine.trim();
        if (description.length > 100) {
          description = description.substring(0, 97) + '...';
        }
      }
    } catch (e) {
      console.error(`Erro ao analisar metadata da skill ${skillName}`, e);
    }
  }

  return { title, description, accepts_files, supported_formats, trigger, cron_expression, webhook_endpoint };
}

// --- API ENDPOINTS ---

// Endpoint de Status de Configuração Pública
app.get('/api/config/status', async (req, res) => {
  try {
    const dbApiKey = await getLastApiKey();
    const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
    res.json({
      hasGlobalApiKey: !!process.env.GEMINI_API_KEY || !!dbApiKey,
      useFirebase: storage.useFirebase,
      firebaseInitialized: storage.isFirebaseInitialized(),
      firebaseInitError: storage.getFirebaseInitError(),
      keyDebug: {
        length: rawKey.length,
        startsWith: rawKey.substring(0, 35),
        endsWith: rawKey.substring(Math.max(0, rawKey.length - 35)),
        includesRealNewlines: rawKey.includes('\n'),
        includesLiteralSlashN: rawKey.includes('\\n'),
        spacesCount: (rawKey.match(/ /g) || []).length,
      },
      envCheck: {
        hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
        hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
        hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
        hasStorageBucket: !!process.env.FIREBASE_STORAGE_BUCKET
      }
    });
  } catch (err) {
    const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
    res.json({
      hasGlobalApiKey: !!process.env.GEMINI_API_KEY,
      useFirebase: storage.useFirebase,
      firebaseInitialized: storage.isFirebaseInitialized(),
      firebaseInitError: storage.getFirebaseInitError(),
      keyDebug: {
        length: rawKey.length,
        startsWith: rawKey.substring(0, 35),
        endsWith: rawKey.substring(Math.max(0, rawKey.length - 35)),
        includesRealNewlines: rawKey.includes('\n'),
        includesLiteralSlashN: rawKey.includes('\\n'),
        spacesCount: (rawKey.match(/ /g) || []).length,
      },
      envCheck: {
        hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
        hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
        hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
        hasStorageBucket: !!process.env.FIREBASE_STORAGE_BUCKET
      }
    });
  }
});

// GET /api/config - Carrega as configurações (somente admin)
app.get('/api/config', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const key = await getLastApiKey();
    const sdkKey = await getSdkApiKey();
    res.json({ apiKey: key, sdkApiKey: sdkKey });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao ler configurações: ' + error.message });
  }
});

// POST /api/config - Salva as configurações centralizadas (somente admin)
app.post('/api/config', authMiddleware, adminMiddleware, async (req, res) => {
  const { apiKey, sdkApiKey } = req.body;
  try {
    if (apiKey !== undefined) await saveLastApiKey(apiKey);
    if (sdkApiKey !== undefined) await saveSdkApiKey(sdkApiKey);
    res.json({ message: 'Configurações salvas no servidor com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar no servidor: ' + error.message });
  }
});

// 1. Listar todas as Skills
app.get('/api/skills', async (req, res) => {
  try {
    const list = await storage.listSkills();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar skills: ' + error.message });
  }
});

// 2. Obter a árvore de arquivos de uma Skill
app.get('/api/skills/:name', async (req, res) => {
  const { name } = req.params;
  try {
    const details = await storage.getSkill(name);
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao obter dados da skill: ' + error.message });
  }
});

// 3. Obter conteúdo de um arquivo da Skill
app.get('/api/skills/:name/file', async (req, res) => {
  const { name } = req.params;
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).json({ error: 'Parâmetro path é obrigatório' });
  }

  try {
    const file = await storage.getFileContent(name, filePath);
    res.json(file);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao ler arquivo: ' + error.message });
  }
});

// 3b. Rota para servir arquivos de mídia diretamente (ex: preview de imagem)
app.get('/api/skills/:name/media', async (req, res) => {
  const { name } = req.params;
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).json({ error: 'Parâmetro path é obrigatório' });
  }

  try {
    if (storage.useFirebase) {
      const file = await storage.getFileContent(name, filePath);
      const buffer = await storage.downloadBinaryFile(name, filePath);
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.send(buffer);
    } else {
      const fullPath = safePath(path.join(SKILLS_DIR, name), filePath);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Arquivo não encontrado' });
      }
      res.sendFile(fullPath);
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao servir arquivo de mídia: ' + error.message });
  }
});

// Funções auxiliares para gerar guias LEIA-ME.md dinâmicos e adaptativos por Skill
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

  return `# 📂 Pasta de Referências e Dados (/dados)

Esta pasta foi criada para armazenar arquivos de referência teóricos e contextuais para a Skill **"${title}"**.

## 🎯 O que colocar aqui (Recomendado para esta Skill)?
${recomendedContent}

## ⚙️ Como o Agente usa essa pasta?
O motor de execução faz o carregamento automático dos nomes dos arquivos desta pasta e os apresenta no menu contextual lateral em **"Referências (/dados)"**. A IA lerá o conteúdo desses arquivos sob demanda para responder com dados cientificamente respaldados ou adaptados ao seu domínio de negócio.
`;
}

function getAssetsReadme(title, desc) {
  const isMedical = /médic|clin|saúd|anamne|farmac|pacient|receit|dosag|exame/i.test(title + ' ' + desc);
  const isVideoOrMarketing = /video|youtube|seo|marketing|redes|social|post|conteúd/i.test(title + ' ' + desc);

  let recomendedContent = `* **Diagramas Técnicos**: Fluxogramas e imagens de arquitetura para visualização.
* **Imagens de Marca**: Logotipos ou elementos visuais de branding.`;

  if (isMedical) {
    recomendedContent = `* **Fluxogramas de Decisão Clínica**: Imagens de algoritmos de conduta ou exames para auxiliar na simulação de anamnese farmacêutica.
* **Recursos Visuais de Anatomia/Farmácia**: Imagens de bulas, caixas de medicamentos ou ilustrações anatômicas.`;
  } else if (isVideoOrMarketing) {
    recomendedContent = `* **Exemplos de Capas (Thumbnails)**: Imagens de capas que performaram bem no YouTube para orientar o agente.
* **Layouts de Postagens**: Templates ou wireframes de posts para redes sociais.`;
  }

  return `# 🎨 Pasta de Mídias e Recursos Visuais (/assets)

Esta pasta serve para armazenar mídias de apoio visual para a Skill **"${title}"**.

## 🎯 O que colocar aqui (Recomendado para esta Skill)?
${recomendedContent}

## ⚙️ Como o Agente usa essa pasta?
Arquivos de imagem salvos aqui podem ser renderizados pelo Agente no chat usando formatação markdown padrão com caminhos relativos (ex: \`![Algoritmo](assets/algoritmo.png)\`).
`;
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

  return `# ⚙️ Scripts de Automação e Análise (/tools)

Esta pasta armazena os scripts Python executáveis (\`.py\`) que servem como ferramentas (tools) lógicas para a Skill **"${title}"**.

## 🎯 O que colocar aqui (Recomendado para esta Skill)?
* Scripts Python de suporte clínico ou técnico, especificamente voltados para: ${descriptionText}

## ⚙️ Exemplo de Script Estruturado (salve como \`tools/calculadora.py\`):
\`\`\`python
# coding: utf-8
import sys
import json

${sampleScript}

if __name__ == "__main__":
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            args = json.load(f)
        resultado = executar(args)
        print(json.dumps(resultado, ensure_ascii=False))
    else:
        print(json.dumps({"error": "Nenhum argumento fornecido"}))
\`\`\`

## ⚙️ Como o Agente usa essa pasta?
O motor lista todos os scripts \`.py\` nesta pasta. O Agente invocará o script enviando os parâmetros correspondentes no formato JSON (ex: \`{"callTool": "calculadora.py", "args": {"peso": 80}}\`) e processará o retorno.
`;
}

// 4. Criar uma nova Skill manualmente
app.post('/api/skills', authMiddleware, async (req, res) => {
  const { name, title, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Nome da Skill é obrigatório' });
  }

  try {
    const result = await storage.saveSkill(name, title, description, null, req.user);
    res.status(201).json({
      name: result.folderName,
      title: result.title,
      description: result.description,
      message: 'Skill criada com sucesso!'
    });
  } catch (error) {
    const statusCode = error.message.includes('Limite') ? 403 : 500;
    res.status(statusCode).json({ error: 'Erro ao criar Skill: ' + error.message });
  }
});

// 4b. Rota para Geração de Skill Avançada por IA (Gemini)
app.post('/api/skills/generate', authMiddleware, async (req, res) => {
  const { name, title, role, objective, targetAudience, needsFiles, needsTools, apiKey } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Nome da Skill (Slug) é obrigatório.' });
  }

  const actualApiKey = apiKey || process.env.GEMINI_API_KEY || await getLastApiKey();
  if (!actualApiKey) {
    return res.status(400).json({ error: 'Chave de API do Gemini é necessária para geração avançada por IA.' });
  }

  const folderName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  
  let exists = false;
  try {
    if (storage.useFirebase) {
      const skills = await storage.listSkills();
      exists = skills.some(s => s.name === folderName);
    } else {
      const skillPath = path.join(SKILLS_DIR, folderName);
      exists = fs.existsSync(skillPath);
    }
  } catch (err) {
    console.error('Erro ao verificar existência da skill:', err);
  }

  if (exists) {
    return res.status(400).json({ error: 'Já existe uma Skill com esta pasta/nome.' });
  }

  try {
    const formattedTitle = title || name;
    const formattedDesc = objective || 'Uma nova Skill de IA especialista.';

    const systemPrompt = `Você é um Engenheiro de Software e Arquiteto de IA Sênior especialista em gerar pacotes de playbooks operacionais de IA ("AI Skills") de altíssimo nível, focados em pragmatismo, profundidade técnica e adaptabilidade de conteúdo.

O usuário deseja criar uma nova Skill de IA com as seguintes especificações:
- Nome/Slug: ${folderName}
- Título: ${formattedTitle}
- Papel/Especialidade: ${role || 'Agente de IA especialista'}
- Objetivo Central/Cenário: ${formattedDesc}
- Público-Alvo: ${targetAudience || 'Profissionais e estudantes'}
- Suporta Arquivos (Multimodal): ${needsFiles ? 'Sim' : 'Não'}
- Executa Scripts (Tools): ${needsTools ? 'Sim' : 'Não'}

Sua tarefa é gerar uma estrutura completa de arquivos em formato JSON válido:
{
  "skillMd": "O conteúdo do arquivo principal skill.md em markdown completo. Deve ser adaptado à temática da Skill, evitando templates engessados ou repetitivos. O playbook DEVE conter: frontmatter YAML no topo; uma introdução clara ao papel do agente; uma seção de 'Princípios Centrais' ou 'Diretrizes de Execução'; um fluxo operacional/conversacional passo a passo detalhando como a interação ou raciocínio deve se desdobrar turno a turno ou etapa por etapa (incluindo exemplos de relatórios, rubricas ou estruturas de outputs que o agente deve gerar); e uma seção contendo regras críticas de 'O que esta Skill NUNCA faz' (definindo limites claros, salvaguardas contra suposições e momentos exatos para requisitar revisão humana ou sinalizar lacunas). NÃO force tabelas comparativas genéricas (como tradicional vs excelência) ou cronogramas arbitrários, a menos que sejam pertinentes ao tema.",
  "readmes": {
    "dados": "Conteúdo em markdown do dados/LEIA-ME.md específico para o tema, listando quais arquivos do mundo real (como diretrizes, consensos, ementas) são recomendados inserir.",
    "assets": "Conteúdo em markdown do assets/LEIA-ME.md orientando quais esquemas visuais, fluxogramas de decisão ou mídias são recomendados inserir.",
    "tools": "Conteúdo em markdown do tools/LEIA-ME.md descrevendo ferramentas úteis e fornecendo um esqueleto/código Python completo e funcional relevante para este cenário."
  },
  "references": [
    {
      "path": "dados/nome-do-arquivo.md",
      "content": "Conteúdo completo em markdown para este arquivo de referência. O arquivo deve ser extremamente detalhado e aprofundado, cobrindo o tema (ex: banco de casos clínicos detalhados com histórias e personalidades, roteiros de atendimento completos, tabelas de referência clínica, rubricas de avaliação pedagógica estruturadas, técnicas de comunicação avançadas, etc.)."
    }
  ]
}

REGRAS CRÍTICAS:
1. Gere de 2 a 3 arquivos adicionais de referência no array 'references' (gravados na subpasta /dados). Cada arquivo de referência deve ser focado, contendo casos e roteiros de suporte claros e práticos. Evite textos repetitivos ou prolixos para não ultrapassar o limite de tokens da API do Gemini.
2. O limite de saída da API é de 8192 tokens. Balanceie a quantidade de texto gerado para que todo o JSON seja concluído perfeitamente sem truncar na metade.
3. O JSON retornado deve ser estritamente válido e bem-formado. Não envolva o JSON em delimitadores de código markdown (como \`\`\`json ... \`\`\`) na resposta bruta. Retorne apenas o JSON limpo.
4. Responda sempre em Português do Brasil (pt-BR).`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${actualApiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: 'Gere a estrutura completa da Skill agora de acordo com as instruções do sistema.' }]
        }],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 8192
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro na API do Gemini: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('Retorno vazio da API do Gemini.');
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(rawText.trim());
    } catch (parseError) {
      console.error('Falha ao fazer o parse do JSON retornado pela IA. Tentando recuperar o Playbook principal...', parseError);
      
      // Regex de resgate para capturar o conteúdo do campo skillMd caso tenha truncado no meio dos readmes/references
      const skillMdRegex = /"skillMd"\s*:\s*"([\s\S]*?)"\s*,\s*"/i;
      const match = rawText.match(skillMdRegex);
      
      if (match && match[1]) {
        // Des-escapa caracteres comuns que viriam da string do JSON
        let recoveredSkillMd = match[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
          
        parsedResult = {
          skillMd: recoveredSkillMd,
          readmes: {
            dados: getDadosReadme(formattedTitle, formattedDesc),
            assets: getAssetsReadme(formattedTitle, formattedDesc),
            tools: getToolsReadme(formattedTitle, folderName, formattedDesc)
          },
          references: []
        };
        console.log('Recuperação parcial do Playbook concluída com sucesso após truncamento de JSON.');
      } else {
        throw new Error('O JSON gerado pela IA foi truncado devido ao tamanho excessivo do texto. Por favor, tente novamente com uma descrição de cenário ligeiramente mais focada.');
      }
    }

    // Cria a Skill no storage (passando o usuário autenticado para controle de cota)
    await storage.saveSkill(folderName, formattedTitle, formattedDesc, parsedResult.skillMd || '', req.user);

    // Salva os arquivos guia LEIA-ME.md no storage
    const readmes = parsedResult.readmes || {};
    await storage.saveFile(folderName, 'dados/LEIA-ME.md', readmes.dados || getDadosReadme(formattedTitle, formattedDesc));
    await storage.saveFile(folderName, 'assets/LEIA-ME.md', readmes.assets || getAssetsReadme(formattedTitle, formattedDesc));
    await storage.saveFile(folderName, 'tools/LEIA-ME.md', readmes.tools || getToolsReadme(formattedTitle, folderName, formattedDesc));

    // Salva os arquivos de referência adicionais criados pela IA
    const references = parsedResult.references || [];
    for (const ref of references) {
      if (ref.path && ref.content) {
        await storage.saveFile(folderName, ref.path, ref.content);
      }
    }

    res.status(201).json({
      name: folderName,
      title: formattedTitle,
      description: formattedDesc,
      message: 'Skill Premium gerada por IA com sucesso!'
    });

  } catch (error) {
    console.error('Erro ao gerar Skill via IA:', error);
    const statusCode = error.message.includes('Limite') ? 403 : 500;
    res.status(statusCode).json({ error: 'Erro ao gerar Skill via IA: ' + error.message });
  }
});

// 5. Criar ou editar arquivo de uma Skill
app.post('/api/skills/:name/file', async (req, res) => {
  const { name } = req.params;
  const { path: relativePath, content } = req.body;

  if (!relativePath) {
    return res.status(400).json({ error: 'Caminho do arquivo é obrigatório' });
  }

  try {
    const isBinary = false;
    await storage.saveFile(name, relativePath, content, isBinary);

    // Se for o playbook skill.md, sincroniza os gatilhos de automação
    if (relativePath === 'skill.md') {
      try {
        syncAutomationTriggers();
      } catch (err) {
        console.error('Erro ao sincronizar gatilhos no salvamento:', err);
      }
    }

    res.json({ message: 'Arquivo salvo com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar arquivo: ' + error.message });
  }
});

// 6. Deletar arquivo ou diretório de uma Skill
app.delete('/api/skills/:name/file', async (req, res) => {
  const { name } = req.params;
  const relativePath = req.query.path;

  if (!relativePath) {
    return res.status(400).json({ error: 'Caminho do arquivo/pasta é obrigatório' });
  }

  try {
    await storage.deleteFile(name, relativePath);
    res.json({ message: 'Item removido com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar item: ' + error.message });
  }
});

// 7. Upload de arquivos para as subpastas dados ou assets
app.post('/api/skills/:name/upload/:folder', upload.array('files'), async (req, res) => {
  const { name, folder } = req.params;
  
  if (!['dados', 'assets'].includes(folder)) {
    return res.status(400).json({ error: 'Pasta de destino inválida. Escolha dados ou assets.' });
  }

  try {
    const uploadedFiles = req.files || [];
    if (uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    for (const file of uploadedFiles) {
      const relativePath = `${folder}/${file.filename}`;
      
      if (storage.useFirebase) {
        const buffer = fs.readFileSync(file.path);
        await storage.saveBinaryFile(name, relativePath, buffer, file.mimetype);
        fs.unlinkSync(file.path); // Limpa temp
      } else {
        const gitRelativePath = path.join(name, folder, file.filename).replace(/\\/g, '/');
        await runGit(['add', gitRelativePath]);
      }
    }
    
    if (!storage.useFirebase) {
      await runGit(['commit', '-m', `Upload de ${uploadedFiles.length} arquivo(s) na pasta ${folder} de ${name}`]);
    }

    res.json({
      message: 'Upload concluído com sucesso!',
      files: uploadedFiles.map(f => ({ name: f.filename, size: f.size }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao fazer upload: ' + error.message });
  }
});

// 8. Obter histórico de commits de um arquivo ou da Skill inteira
app.get('/api/skills/:name/history', async (req, res) => {
  const { name } = req.params;
  const filePath = req.query.path;

  try {
    const commits = await storage.getHistory(name, filePath);
    res.json(commits);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao obter histórico: ' + error.message });
  }
});

// 9. Reverter arquivo ou Skill inteira para um commit específico
app.post('/api/skills/:name/revert', async (req, res) => {
  const { name } = req.params;
  const { commitHash, path: filePath } = req.body;

  if (!commitHash) {
    return res.status(400).json({ error: 'Hash do commit é obrigatório.' });
  }

  try {
    await storage.revertFile(name, filePath, commitHash);
    res.json({ message: 'Reversão concluída com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao reverter: ' + error.message });
  }
});

// 10. Exportar Skill como ZIP
app.get('/api/skills/:name/export', async (req, res) => {
  const { name } = req.params;

  try {
    const zip = new AdmZip();
    
    if (storage.useFirebase) {
      const details = await storage.getSkill(name);
      // Detalhes contém a árvore de arquivos, mas para exportar vamos ler todos os arquivos de texto e binários
      // Podemos consultar a coleção de arquivos diretamente usando a referência do Firestore do storage
      const skillsCollection = storage.getDb().collection('skills').doc(name).collection('files');
      const snapshot = await skillsCollection.get();
      
      for (const doc of snapshot.docs) {
        const fileData = doc.data();
        const filePath = fileData.path;
        if (fileData.isBinary) {
          const buffer = await storage.downloadBinaryFile(name, filePath);
          zip.addFile(filePath, buffer);
        } else {
          zip.addFile(filePath, Buffer.from(fileData.content || '', 'utf8'));
        }
      }
    } else {
      const skillPath = safePath(SKILLS_DIR, name);
      if (!fs.existsSync(skillPath)) {
        return res.status(404).json({ error: 'Skill não encontrada' });
      }
      zip.addLocalFolder(skillPath);
    }
    
    const buffer = zip.toBuffer();
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${name}.zip`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao exportar ZIP: ' + error.message });
  }
});

// 11. Chat Conversacional com Gemini API
app.post('/api/chat', async (req, res) => {
  const { messages, apiKey } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Lista de mensagens é obrigatória.' });
  }

  // Usa a chave enviada pela requisição, ou caso contrário, a do .env ou a salva no banco de dados
  const actualApiKey = apiKey || process.env.GEMINI_API_KEY || await getLastApiKey();

  if (!actualApiKey) {
    // Retorna resposta mockada de alta qualidade se não houver chave
    console.log('Gemini API Key ausente. Retornando resposta de template mockada...');
    
    const lastUserMessage = messages[messages.length - 1]?.content || '';
    
    // Simula uma resposta baseada no que o usuário escreveu
    const skillNameSuggestion = lastUserMessage
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, '-');

    const formattedTitle = lastUserMessage.substring(0, 40) || 'Skill de IA';

    const mockResponse = {
      mocked: true,
      text: `Olá! Percebi que você não configurou a chave de API do Gemini nas configurações. 
Estou operando no modo offline. Com base na sua solicitação, gerei uma estrutura padrão premium para a sua Skill.

Para usufruir da geração inteligente automatizada por IA avançada, por favor configure sua chave de API do Gemini clicando no ícone de engrenagem no rodapé da página.

Abaixo está o esboço gerado. Clique no botão de criação para salvá-lo como uma Skill.`,
      skillData: {
        name: skillNameSuggestion || 'minha-skill-offline',
        title: formattedTitle,
        description: `Playbook gerado automaticamente no modo offline para: ${lastUserMessage}`,
        markdown: `---
title: "${formattedTitle}"
description: "Playbook para análise e estruturação de processos relativos a ${formattedTitle}."
accepts_files: false
supported_formats: ["pdf", "image"]
trigger: null
endpoint: null
---

# ${formattedTitle}

Playbook elaborado para estruturar, auditar e conduzir o processo de ${formattedTitle} com o máximo nível de rigor técnico.

## Diferença Fundamental (Abordagem Tradicional vs. Abordagem de Excelência)

| Abordagem Tradicional | Abordagem de Excelência (Esta Skill) |
|---|---|
| Tratamento superficial ou respostas genéricas | Análise aprofundada, conceitual e orientada a regras do playbook |
| Falta de estruturação de entregáveis | Entrega de relatórios polidos e prontos para uso profissional |
| Processamento reativo a e-mails ou mensagens | Orquestração orientada a metas e validação proativa |

## Passo 0 — Alinhamento e Entrevista Diagnóstica

Antes de executar, confirme com o usuário o que for essencial para a personalização do entregável:
1. Qual é o nível de profundidade e o público-alvo do entregável?
2. Quais restrições de formato ou dados devem ser obrigatoriamente incluídas?
3. Há algum arquivo de referência ou histórico a ser considerado na análise?

## Workflow Operacional Detalhado

| Etapa / Bloco | Tempo Sugerido | Função / Ação | O que acontece |
|---|---|---|---|
| **1. Alinhamento** | 5 min | Confirmar os objetivos e o tom do entregável | Solicitação de esclarecimentos sobre lacunas e mapeamento do contexto |
| **2. Coleta & RAG** | 15 min | Pesquisar na memória da Skill e dados locais | Recuperação de diretrizes semânticas anteriores e leitura de arquivos |
| **3. Raciocínio & Análise** | 20 min | Execução lógica e crítica | Escrita do Chain of Thought, testes de hipóteses e roteamento de scripts |
| **4. Validação & Entrega** | 10 min | Garantia de qualidade (QA) | Auditoria do material produzido frente às restrições do playbook |

## Diretrizes de Implementação e Gotchas

- **Densidade de Informação**: Mantenha cada resposta focada, objetiva e sem rodeios.
- **Roteiros Claros**: Sempre use formatação em Markdown bem delineado com tabelas de comparação, blocos de código e listas claras.
- **Integração de Scripts**: Scripts Python locais localizados em \`/tools\` devem ser usados para tarefas matemáticas, integração com bases de dados e checagens lógicas.

## Checkpoints de Validação (QA)

- [ ] Todos os objetivos levantados no Passo 0 foram atingidos?
- [ ] A resposta cumpre os limites de densidade de texto e tom de voz?
- [ ] Foram feitas checagens lógicas ou rodados scripts para validar a veracidade dos dados?
`
      }
    };

    return res.json(mockResponse);
  }

  try {
    // Formata o histórico de mensagens para a API do Gemini
    const geminiContents = messages.map(msg => {
      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      };
    });

    // Injeta instruções de sistema adicionais no início para garantir retorno JSON estruturado
    const systemInstruction = `Você é um Engenheiro de Software e Arquiteto de IA Sênior especializado em criar Playbooks de Instrução de Sistema ("AI Skills") extremamente robustos, de nível profissional e detalhados.
Sua tarefa é criar um playbook estruturado em Markdown para uma "Skill de IA" com base na requisição do usuário.
Você DEVE SEMPRE responder no formato JSON válido. O formato JSON esperado é:
{
  "text": "Mensagem amigável explicando o que você gerou, destacando o nível de profundidade inserido no playbook.",
  "skillData": {
    "name": "nome-da-skill-slugificado (usar apenas minúsculas, números e hifens)",
    "title": "Título da Skill de IA",
    "description": "Uma descrição concisa de 1 linha sobre o que esta Skill realiza.",
    "markdown": "O conteúdo do arquivo skill.md em markdown completo."
  }
}

Use exatamente essa estrutura de JSON e nada mais. Não inclua blocos de código markdown (como \`\`\`json ...) na raiz, apenas envie o JSON puro ou use markdown dentro do campo \"markdown\". Responda sempre em Português do Brasil (pt-BR).

### DIRETRIZES DE EXCELÊNCIA PARA O CONTEÚDO DO PLAYBOOK (skill.md):
Para que a Skill gerada seja profissional, rica e sob medida para o tema do usuário, ela deve ser adaptada à sua finalidade real em vez de seguir um template rígido de seções. O Markdown gerado DEVE incluir:

1. **Frontmatter YAML Completo**:
   O markdown gerado DEVE iniciar com um bloco frontmatter YAML contendo:
   ---
   title: "Título da Skill"
   description: "Breve descrição operacional de 1 linha."
   accepts_files: true ou false (com base no contexto de uso de arquivos)
   supported_formats: ["pdf", "image"] (se accepts_files for true)
   trigger: webhook ou cron("expressão") ou null
   endpoint: "/api/webhooks/nome-da-skill" (se trigger for webhook)
   ---

2. **Princípios Centrais ou Regras de Ouro**:
   Mapeie as regras fundamentais de comportamento, tom de voz e diretrizes cruciais que orientam o Agente de IA especificamente nesta Skill.

3. **Fluxo Operacional ou Conversacional Passo a Passo**:
   Detone a dinâmica da conversa ou o processo de análise detalhadamente, etapa por etapa ou turno a turno (explicando o que o agente deve perguntar primeiro, como validar a resposta e como estruturar os relatórios de saída ou feedbacks finais). Apresente estruturas detalhadas de outputs ou tabelas apenas se forem pertinentes ao tema.

4. **Diretrizes e Restrições ("O que esta Skill NUNCA faz")**:
   Escreva restrições estritas e limitações críticas (ex: nunca inferir dados que o usuário não passou, alertar sobre termos ilegíveis para revisão humana, não dar notas ou pareceres como absolutos se requererem validação profissional).

5. **Ações Locais e Integrações (Se aplicável)**:
   Se o tema envolver cálculos ou scripts locais em \`/tools\`, detalhe o papel das ferramentas Python e como executá-las.`;

    // Chamada direta para o Gemini 2.5 Flash usando fetch
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${actualApiKey}`;
    
    // Para simplificar, adicionamos a instrução de sistema na primeira mensagem ou como systemInstruction
    const requestBody = {
      contents: geminiContents,
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        responseMimeType: 'application/json'
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro na API do Gemini: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawText) {
      throw new Error('Retorno vazio da API do Gemini.');
    }

    // Faz o parse do JSON retornado pelo Gemini
    const parsedResult = JSON.parse(rawText.trim());
    res.json(parsedResult);

  } catch (error) {
    console.error('Erro na chamada do Gemini API:', error);
    res.status(500).json({ error: 'Erro ao interagir com o assistente do Gemini: ' + error.message });
  }
});

// Helper robusto para analisar e extrair chamadas de ferramentas de forma tolerante a erros
function parseToolCall(cleanedReply) {
  if (!cleanedReply) return null;
  
  let cleaned = cleanedReply.replace(/^```json/, '').replace(/```$/, '').trim();
  
  // Trata formato malformado com colchetes ["callTool": ... ] -> {"callTool": ... }
  if (cleaned.startsWith('["callTool":') && cleaned.endsWith(']')) {
    cleaned = '{' + cleaned.slice(1, -1) + '}';
  }
  
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      if (parsed.length > 0 && parsed[0].callTool) {
        return parsed[0];
      }
    } else if (parsed && parsed.callTool) {
      return parsed;
    }
  } catch (e) {
    // Fallback robusto usando regex em caso de JSON malformado
    try {
      const callToolRegex = /"callTool"\s*:\s*"([^"]+)"/;
      const argsRegex = /"args"\s*:\s*({[\s\S]+})/;
      
      const toolMatch = cleaned.match(callToolRegex);
      const argsMatch = cleaned.match(argsRegex);
      
      if (toolMatch) {
        const toolName = toolMatch[1];
        let args = {};
        if (argsMatch) {
          try {
            let argsStr = argsMatch[1];
            if (argsStr.endsWith(']')) argsStr = argsStr.slice(0, -1);
            args = JSON.parse(argsStr);
          } catch (argsErr) {
            console.error('Erro ao fazer parse dos args por regex:', argsErr);
          }
        }
        return { callTool: toolName, args };
      }
    } catch (regexErr) {
      console.error('Falha no parser fallback regex:', regexErr);
    }
  }
  return null;
}

// Helper para realizar busca vetorial por similaridade de cosseno nas memórias do Firebase
function searchMemoriesInList(memoriesList, queryEmbedding, topK = 3, threshold = 0.4) {
  function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  const results = memoriesList.map(m => {
    const similarity = cosineSimilarity(queryEmbedding, m.embedding);
    return {
      id: m.id,
      text: m.text,
      timestamp: m.timestamp,
      similarity
    };
  });

  return results
    .filter(r => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

// Helper para ler e processar o frontmatter YAML do playbook skill.md
function parsePlaybookFrontmatter(playbookContent) {
  const result = {
    needs_approval: false,
    restricted_tools: []
  };
  if (!playbookContent) return result;

  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
  const match = playbookContent.match(frontmatterRegex);
  if (!match) return result;

  const yamlText = match[1];
  const lines = yamlText.split('\n');
  
  let currentKey = null;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Se for um item de lista tipo "- ferramenta.py"
    if (trimmed.startsWith('-') && currentKey === 'restricted_tools') {
      const toolName = trimmed.replace(/^-\s*/, '').replace(/^["']|["']$/g, '').trim();
      if (toolName) {
        result.restricted_tools.push(toolName);
      }
      continue;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const key = line.substring(0, colonIndex).trim();
      let val = line.substring(colonIndex + 1).trim();

      // Remove aspas simples/duplas das pontas do valor
      val = val.replace(/^["']|["']$/g, '');

      if (key === 'needs_approval') {
        result.needs_approval = (val.toLowerCase() === 'true');
        currentKey = key;
      } else if (key === 'restricted_tools') {
        currentKey = key;
        // Se for no formato inline JSON [tool1, tool2]
        if (val.startsWith('[') && val.endsWith(']')) {
          try {
            const cleanedVal = val.replace(/'/g, '"');
            result.restricted_tools = JSON.parse(cleanedVal);
          } catch (e) {
            console.error('Erro ao fazer parse de restricted_tools inline:', e);
          }
        }
      } else {
        currentKey = key;
      }
    }
  }

  return result;
}

// Executa um script Python em ambiente de sandbox (Docker ou venv local isolado)
async function runPythonSandbox(skillName, scriptPath, tempArgsFile, useDocker) {
  const canUseDocker = useDocker && isDockerAvailable;

  if (canUseDocker) {
    console.log(`🐳 [SANDBOX] Executando script no Docker para a skill: ${skillName}...`);
    const absoluteScriptPath = path.resolve(scriptPath);
    const absoluteArgsPath = path.resolve(tempArgsFile);

    const containerScript = '/app/tool.py';
    const containerArgs = '/app/args.json';

    // Monta o script e os argumentos como volumes de leitura (ro)
    const dockerCmd = `docker run --rm -v "${absoluteScriptPath}:${containerScript}:ro" -v "${absoluteArgsPath}:${containerArgs}:ro" python:3.10-slim python "${containerScript}" "${containerArgs}"`;

    try {
      const { stdout, stderr } = await execPromise(dockerCmd);
      return { stdout, stderr, success: true };
    } catch (cmdErr) {
      return {
        stdout: cmdErr.stdout || '',
        stderr: cmdErr.stderr || cmdErr.message,
        success: false
      };
    }
  }

  // Fallback: Execução em ambiente virtual local (venv) específico da Skill
  console.log(`📦 [SANDBOX] Executando em ambiente virtual (venv) para a skill: ${skillName}...`);

  const sandboxDir = storage.useFirebase 
    ? path.join(process.cwd(), '.sandboxes', skillName) 
    : path.join(SKILLS_DIR, skillName);

  if (!fs.existsSync(sandboxDir)) {
    fs.mkdirSync(sandboxDir, { recursive: true });
  }

  const venvDir = path.join(sandboxDir, '.venv');
  const isWindows = process.platform === 'win32';
  const pythonExec = isWindows 
    ? path.join(venvDir, 'Scripts', 'python.exe') 
    : path.join(venvDir, 'bin', 'python');

  // Cria o venv se ele não existir
  if (!fs.existsSync(pythonExec)) {
    console.log(`📦 [SANDBOX] Criando venv para a skill '${skillName}' em ${venvDir}...`);
    try {
      await execPromise(`python -m venv "${venvDir}"`);
      console.log(`📦 [SANDBOX] Ambiente virtual criado com sucesso.`);
    } catch (venvErr) {
      console.error(`📦 [SANDBOX] Erro ao criar venv:`, venvErr);
      // Fallback para o python do sistema se falhar
      try {
        const { stdout, stderr } = await execPromise(`python "${scriptPath}" "${tempArgsFile}"`);
        return { stdout, stderr, success: true };
      } catch (globalErr) {
        return {
          stdout: globalErr.stdout || '',
          stderr: globalErr.stderr || globalErr.message,
          success: false
        };
      }
    }
  }

  // Instala dependências se houver requirements.txt na pasta da Skill
  let requirementsPath = '';
  if (storage.useFirebase) {
    try {
      const file = await storage.getFileContent(skillName, 'requirements.txt');
      if (file && file.content) {
        requirementsPath = path.join(sandboxDir, 'requirements.txt');
        fs.writeFileSync(requirementsPath, file.content);
      }
    } catch (e) {
      // requirements.txt não existe no Firebase
    }
  } else {
    const localReqPath = path.join(sandboxDir, 'requirements.txt');
    if (fs.existsSync(localReqPath)) {
      requirementsPath = localReqPath;
    }
  }

  if (requirementsPath) {
    const hashFile = path.join(venvDir, '.pip_installed_hash');
    const currentReqs = fs.readFileSync(requirementsPath, 'utf8');
    let needsInstall = true;
    
    if (fs.existsSync(hashFile)) {
      const installedHash = fs.readFileSync(hashFile, 'utf8');
      if (installedHash === currentReqs) {
        needsInstall = false;
      }
    }

    if (needsInstall) {
      console.log(`📦 [SANDBOX] Instalando dependências de requirements.txt para a skill '${skillName}'...`);
      const pipExec = isWindows 
        ? path.join(venvDir, 'Scripts', 'pip.exe') 
        : path.join(venvDir, 'bin', 'pip');
      try {
        await execPromise(`"${pipExec}" install -r "${requirementsPath}"`);
        fs.writeFileSync(hashFile, currentReqs);
        console.log(`📦 [SANDBOX] Pip instalado/atualizado com sucesso.`);
      } catch (pipErr) {
        console.warn(`📦 [SANDBOX] Falha parcial na execução do pip install: ${pipErr.message}`);
      }
    }
  }

  // Executa o script utilizando o python do venv
  try {
    const { stdout, stderr } = await execPromise(`"${pythonExec}" "${scriptPath}" "${tempArgsFile}"`);
    return { stdout, stderr, success: true };
  } catch (cmdErr) {
    return {
      stdout: cmdErr.stdout || '',
      stderr: cmdErr.stderr || cmdErr.message,
      success: false
    };
  }
}

// --- MOTOR DE EXECUÇÃO DO AGENTE ---



app.post('/api/agent/chat', authMiddleware, async (req, res) => {
  const startTime = performance.now();
  const { messages, activeSkillName, apiKey, fileData, fileMime, fileName, conversationId, useDockerSandbox } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Mensagens são obrigatórias.' });
  }

  const userId = req.user.uid;
  const activeConversationId = conversationId || 'chat_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);


  const actualApiKey = apiKey || process.env.GEMINI_API_KEY || await getLastApiKey();
  if (actualApiKey) {
    saveLastApiKey(actualApiKey);
  }

  if (!actualApiKey) {
    return res.json({
      reply: "Chave do Gemini API não configurada. Por favor, acesse as Configurações (ícone de engrenagem) e insira sua chave para iniciar o Agente.",
      activeSkillName: null,
      steps: [{ step: 'error', detail: 'Chave API ausente' }]
    });
  }

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokensCount = 0;

  const trace = {
    skillName: activeSkillName || null,
    routingReason: null,
    memories: [],
    files: [],
    tools: [],
    thoughtProcess: '',
    metrics: {
      latencyMs: 0,
      tokens: { prompt: 0, completion: 0, total: 0 }
    }
  };

  if (fileData && fileMime) {
    trace.files.push({ name: fileName || 'documento', mimeType: fileMime });
  }

  // Lista as skills disponíveis para formar o catálogo dinâmico
  let availableSkills = [];
  try {
    availableSkills = await storage.listSkills();
  } catch (err) {
    console.error('Erro ao listar catálogo para o agente:', err);
  }

  const lastUserMessage = messages[messages.length - 1]?.content || '';
  let skillToUse = activeSkillName;
  let steps = [];

  // Fase 1: Roteamento Dinâmico (se nenhuma skill estiver ativa)
  if (!skillToUse && availableSkills.length > 0) {
    steps.push({ step: 'routing', detail: 'Analisando catálogo de AI Skills...' });
    
    try {
      const routingSystemInstruction = `Você é o roteador do sistema de AI Skills. Sua tarefa é analisar o pedido do usuário (incluindo possíveis anexos informados na mensagem) e decidir se alguma das Skills do catálogo abaixo é relevante para resolver o pedido.
Catálogo de Skills disponíveis:
${JSON.stringify(availableSkills, null, 2)}

Se o usuário anexar um arquivo, dê preferência a Skills que possuam "accepts_files": true e cujo formato (ex: pdf, imagem) seja compatível com "supported_formats".

Responda estritamente no formato JSON:
{
  "needsSkill": true ou false,
  "skillName": "nome-da-pasta-da-skill-selecionada" (obrigatório se needsSkill for true),
  "reason": "breve justificativa explicando por que escolheu esta skill ou por que nenhuma se aplica"
}

Se nenhuma skill se aplicar ao pedido do usuário, responda com needsSkill: false. Use exatamente esse formato JSON.`;

      let queryText = lastUserMessage;
      if (fileData && fileMime) {
        queryText = `[Arquivo Anexado: ${fileMime}] ${queryText || 'Analise este arquivo.'}`;
      }

      const routingUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${actualApiKey}`;
      const response = await fetch(routingUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `Pedido do Usuário: "${queryText}"` }] }],
          systemInstruction: { parts: [{ text: routingSystemInstruction }] },
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.usageMetadata) {
          totalPromptTokens += data.usageMetadata.promptTokenCount || 0;
          totalCompletionTokens += data.usageMetadata.candidatesTokenCount || 0;
          totalTokensCount += data.usageMetadata.totalTokenCount || 0;
        }

        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          const routeResult = JSON.parse(rawText.trim());
          trace.routingReason = routeResult.reason || null;
          if (routeResult.needsSkill && routeResult.skillName) {
            const exists = availableSkills.some(s => s.name === routeResult.skillName);
            if (exists) {
              skillToUse = routeResult.skillName;
              trace.skillName = skillToUse;
              const skillTitle = availableSkills.find(s => s.name === skillToUse)?.title || skillToUse;
              steps.push({ step: 'load_skill', detail: `Skill '${skillTitle}' carregada no contexto.` });
            }
          }
        }
      }
    } catch (routeErr) {
      console.error('Erro no roteamento do agente:', routeErr);
    }
  }

  // Se não foi identificado nenhuma skill aplicável, responde como chat genérico
  if (!skillToUse) {
    try {
      steps.push({ step: 'generic_chat', detail: 'Respondendo sem Skill específica...' });
      
      const chatContents = messages.map((m, index) => {
        const isLastMessage = index === messages.length - 1;
        const parts = [{ text: m.content || (isLastMessage && fileData ? 'Analise o arquivo anexo.' : '') }];
        
        if (isLastMessage && m.role === 'user' && fileData && fileMime) {
          parts.push({
            inlineData: {
              mimeType: fileMime,
              data: fileData
            }
          });
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts
        };
      });

      const genericUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${actualApiKey}`;
      const response = await fetch(genericUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: chatContents,
          systemInstruction: { parts: [{ text: "Você é um assistente de IA prestativo e inteligente. Responda em Português do Brasil (pt-BR)." }] }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }

      const data = await response.json();
      if (data.usageMetadata) {
        totalPromptTokens += data.usageMetadata.promptTokenCount || 0;
        totalCompletionTokens += data.usageMetadata.candidatesTokenCount || 0;
        totalTokensCount += data.usageMetadata.totalTokenCount || 0;
      }

      const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      let thoughtProcess = '';
      const thoughtRegex = /<thought_process>([\s\S]*?)<\/thought_process>/i;
    const thoughtMatch = replyText.match(thoughtRegex);
      if (thoughtMatch) {
        thoughtProcess = thoughtMatch[1].trim();
        trace.thoughtProcess = thoughtProcess;
      }
      const cleanedReply = replyText.replace(thoughtRegex, '').trim();

      const endTime = performance.now();
      trace.metrics.latencyMs = Math.round(endTime - startTime);
      trace.metrics.tokens = {
        prompt: totalPromptTokens,
        completion: totalCompletionTokens,
        total: totalTokensCount
      };

      const finalMessages = [
        ...messages,
        { role: 'assistant', content: cleanedReply, trace }
      ];
      const autoTitle = messages[0]?.content ? (messages[0].content.slice(0, 40) + (messages[0].content.length > 40 ? '...' : '')) : 'Chat Geral';
      await storage.saveConversation(activeConversationId, userId, 'general', autoTitle, finalMessages);

      return res.json({
        reply: cleanedReply,
        activeSkillName: null,
        steps,
        trace,
        conversationId: activeConversationId
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erro no chat genérico: ' + err.message });
    }
  }

  // --- EXECUÇÃO COM SKILL ATIVA ---
  try {
    let playbookContent = '';
    try {
      const file = await storage.getFileContent(skillToUse, 'skill.md');
      playbookContent = file.content || '';
    } catch (playbookErr) {
      console.warn('Playbook não encontrado no chat do agente:', playbookErr);
    }

    const skillConfig = parsePlaybookFrontmatter(playbookContent);

    // --- ETAPA RAG: Busca semântica por preferências anteriores ---
    let matchedMemoriesPrompt = '';
    try {
      let matched = [];
      if (storage.useFirebase) {
        const queryEmbedding = await getGeminiEmbedding(lastUserMessage || 'Analise o arquivo.', actualApiKey);
        const memoriesList = await storage.getMemories(skillToUse);
        if (memoriesList && memoriesList.length > 0) {
          matched = searchMemoriesInList(memoriesList, queryEmbedding, 3, 0.45);
        }
      } else {
        const skillMemories = vectorDB.getMemories(skillToUse);
        if (skillMemories && skillMemories.length > 0) {
          const queryEmbedding = await getGeminiEmbedding(lastUserMessage || 'Analise o arquivo.', actualApiKey);
          matched = vectorDB.search(skillToUse, queryEmbedding, 3, 0.45);
        }
      }
      
      if (matched && matched.length > 0) {
        trace.memories = matched.map(m => m.text);
        steps.push({ step: 'rag_retrieved', detail: `Resgatou ${matched.length} preferências do contexto.` });
        matchedMemoriesPrompt = `\n\n=== HISTÓRICO E PREFERÊNCIAS APRENDIDAS (Recuperado do Banco Vetorial) ===
Siga rigorosamente estas preferências de comportamento e regras conceituais aprendidas em conversas anteriores com o usuário para esta Skill:
${matched.map(m => `- ${m.text}`).join('\n')}
=== FIM DAS PREFERÊNCIAS APRENDIDAS ===`;
      }
    } catch (ragErr) {
      console.error('Erro ao realizar busca RAG:', ragErr);
    }

    // Lê os arquivos da pasta dados/ e scripts da pasta tools/
    let dadosFiles = [];
    let toolsScripts = [];
    
    if (storage.useFirebase) {
      const details = await storage.getSkill(skillToUse);
      const findFilesRecursive = (nodes) => {
        const list = [];
        for (const node of nodes) {
          if (node.type === 'file') {
            list.push(node.path);
          } else if (node.children) {
            list.push(...findFilesRecursive(node.children));
          }
        }
        return list;
      };
      const allFiles = findFilesRecursive(details.files || []);
      dadosFiles = allFiles.filter(f => f.startsWith('dados/')).map(f => f.replace('dados/', ''));
      toolsScripts = allFiles.filter(f => f.startsWith('tools/') && f.endsWith('.py')).map(f => f.replace('tools/', ''));
    } else {
      const skillPath = path.join(SKILLS_DIR, skillToUse);
      const dadosPath = path.join(skillPath, 'dados');
      if (fs.existsSync(dadosPath)) {
        dadosFiles = fs.readdirSync(dadosPath);
      }
      const toolsPath = path.join(skillPath, 'tools');
      if (fs.existsSync(toolsPath)) {
        toolsScripts = fs.readdirSync(toolsPath).filter(f => f.endsWith('.py'));
      }
    }

    // Constrói o Prompt de Sistema com o Contexto da Skill e RAG
    const agentSystemInstruction = `Você é o Agente Executivo operando sob a AI SKILL: "${skillToUse}".
Você DEVE obrigatoriamente realizar todas as suas interações, análises, relatórios, notas sugeridas, avaliações de critérios e respostas externas estritamente em Português do Brasil (pt-BR). Sob nenhuma hipótese responda ou gere partes da resposta em inglês, exceto para termos técnicos consagrados e impossíveis de traduzir.

Abaixo estão as instruções do Playbook (skill.md) que você DEVE seguir estritamente:
=== INÍCIO DO PLAYBOOK ===
${playbookContent}
=== FIM DO PLAYBOOK ===
${matchedMemoriesPrompt}

Arquivos de referência disponíveis na pasta /dados: ${JSON.stringify(dadosFiles)}
Scripts de automação disponíveis na pasta /tools: ${JSON.stringify(toolsScripts)}

Instruções de Resposta:
1. Raciocínio Oculto (Chain of Thought): Você DEVE sempre iniciar sua resposta abrindo a tag <thought_process> e descrever nela todo o seu raciocínio, análises e tomadas de decisão (que também devem ser preferencialmente conduzidos em Português). Após concluir seu raciocínio, feche obrigatoriamente a tag com </thought_process> e então depois forneça a resposta ou pergunta ao usuário. Nunca misture o raciocínio com a resposta externa e nunca escreva a palavra "thought_process" solta fora das tags XML.
2. Você deve analisar a conversa e guiar o usuário de acordo com o "Roteiro de Perguntas" do Playbook. Não entregue a resposta final até ter coletado todos os dados do roteiro.
3. Se você precisar rodar um dos scripts de automação (da lista de scripts acima) para obter dados ou realizar cálculos, você DEVE responder estritamente com este formato JSON:
{
  "callTool": "nome_do_script.py",
  "args": {
    "arg1": "valor1",
    "arg2": "valor2"
  }
}
Quando você retornar esse JSON, o sistema executará o script localmente e injetará os resultados de volta na conversa.
4. Se você NÃO precisar chamar ferramentas no momento (apenas conversar, fazer perguntas, interagir como a persona ou avaliar o estudante), responda APENAS com texto plano direto. NÃO use JSON, NÃO use tags, NÃO coloque a resposta dentro de um campo "reply". Apenas digite sua fala/mensagem de texto diretamente.
5. NÃO faça anúncios sobre sua própria conduta conversacional (evite frases explicativas como "Assumo o papel de farmacêutico", "Passando para o papel de paciente" ou "Iniciando modo demonstração"). Fale e aja DIRETAMENTE no personagem/persona de forma natural, realista e imersiva.
6. TODA E QUALQUER SAÍDA destinada ao usuário (feedbacks de critérios, relatórios de notas e conversação) DEVE SER em Português do Brasil (pt-BR).`;

    // Constrói contents com suporte a arquivo multimodal se enviado
    const chatContents = messages.map((m, index) => {
      const isLastMessage = index === messages.length - 1;
      let msgText = m.content || '';
      
      // Limpa rigorosamente resquícios de thought_process ou tags XML do histórico para não viciar a IA
      if (m.role === 'assistant') {
        msgText = msgText
          .replace(/<thought_process>([\s\S]*?)<\/thought_process>/gi, '')
          .replace(/^(?:thought_process|thoughtprocess)\s*:?\s*[\s\S]*?(\n|$)/gi, '')
          .replace(/^(?:thought_process|thoughtprocess)\s*:?\s*/gi, '')
          .trim();
      }
      
      const parts = [{ text: msgText || (isLastMessage && fileData ? 'Analise o arquivo anexo.' : '') }];
      
      if (isLastMessage && m.role === 'user' && fileData && fileMime) {
        parts.push({
          inlineData: {
            mimeType: fileMime,
            data: fileData
          }
        });
      }
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts
      };
    });

    const chatUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${actualApiKey}`;
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: chatContents,
        systemInstruction: { parts: [{ text: agentSystemInstruction }] },
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro no motor: ${response.status} - ${errorText}`);
    }

    const chatData = await response.json();
    if (chatData.usageMetadata) {
      totalPromptTokens += chatData.usageMetadata.promptTokenCount || 0;
      totalCompletionTokens += chatData.usageMetadata.candidatesTokenCount || 0;
      totalTokensCount += chatData.usageMetadata.totalTokenCount || 0;
    }

    const rawReply = chatData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Extrai o processo de raciocínio das tags <thought_process>
    let thoughtProcess = '';
    const thoughtRegex = /<thought_process>([\s\S]*?)<\/thought_process>/i;
    const thoughtMatch = rawReply.match(thoughtRegex);
    if (thoughtMatch) {
      thoughtProcess = thoughtMatch[1].trim();
      trace.thoughtProcess = thoughtProcess;
    }
    let cleanedReply = rawReply.replace(thoughtRegex, '').trim();

    // Fallback: Se o modelo não usou as tags XML mas iniciou o texto plano com "thought_process"
    if (!thoughtMatch && (rawReply.toLowerCase().startsWith('thought_process') || rawReply.toLowerCase().startsWith('thoughtprocess'))) {
      const thoughtPrefixRegex = /^(?:thought_process|thoughtprocess)\s*:?\s*([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i;
      const prefixMatch = rawReply.match(thoughtPrefixRegex);
      if (prefixMatch) {
        thoughtProcess = prefixMatch[0].trim();
        trace.thoughtProcess = prefixMatch[1].trim();
        cleanedReply = rawReply.replace(thoughtPrefixRegex, '').trim();
      }
    }

    // Tenta fazer o parsing para ver se a IA solicitou execução de ferramenta (callTool)
    let parsedResult = parseToolCall(cleanedReply);

    let finalReply = '';
    let loopCount = 0;
    const maxLoops = 8; // Limite de chamadas consecutivas de ferramentas

    let currentParsedResult = parsedResult;
    let currentCleanedReply = cleanedReply;
    let currentChatContents = [...chatContents];

    while (currentParsedResult && currentParsedResult.callTool && loopCount < maxLoops) {
      loopCount++;
      const toolName = currentParsedResult.callTool;
      const toolArgs = currentParsedResult.args || {};

      // --- LÓGICA HUMAN-IN-THE-LOOP ---
      const requireApprovalGlobal = req.body.requireApprovalGlobal === true;
      const isRestricted = skillConfig.restricted_tools && skillConfig.restricted_tools.includes(toolName);
      const needsApproval = skillConfig.needs_approval || isRestricted || requireApprovalGlobal;
      const bypass = req.body.bypassApproval;
      const hasBypass = bypass && bypass.toolName === toolName;

      if (needsApproval && !hasBypass) {
        steps.push({ step: 'tool_approval_required', detail: `Aprovação manual pendente para rodar script: ${toolName}` });
        
        const endTime = performance.now();
        trace.metrics.latencyMs = Math.round(endTime - startTime);
        trace.metrics.tokens = {
          prompt: totalPromptTokens,
          completion: totalCompletionTokens,
          total: totalTokensCount
        };

        const finalMessages = [
          ...messages,
          { role: 'assistant', content: currentCleanedReply, trace }
        ];
        const conversationTitle = messages[0]?.content ? (messages[0].content.slice(0, 40) + (messages[0].content.length > 40 ? '...' : '')) : 'Nova conversa';
        await storage.saveConversation(activeConversationId, userId, skillToUse, conversationTitle, finalMessages);

        return res.json({
          reply: currentCleanedReply,
          activeSkillName: skillToUse,
          steps,
          trace,
          conversationId: activeConversationId,
          requiresApproval: {
            toolName,
            args: toolArgs
          }
        });
      }
      // --- FIM LÓGICA HUMAN-IN-THE-LOOP ---

      steps.push({ step: 'tool_executing', detail: `Invocando script Python: ${toolName}...` });

      let scriptPath = '';
      let tempScriptFile = '';
      
      if (storage.useFirebase) {
        const fileContent = await storage.getFileContent(skillToUse, `tools/${toolName}`);
        tempScriptFile = path.join(process.cwd(), `.tmp_script_${Date.now()}_${toolName}`);
        fs.writeFileSync(tempScriptFile, fileContent.content || '');
        scriptPath = tempScriptFile;
      } else {
        const toolsPath = path.join(SKILLS_DIR, skillToUse, 'tools');
        scriptPath = path.join(toolsPath, toolName);
        if (!fs.existsSync(scriptPath)) {
          throw new Error(`Script de ferramenta não encontrado: ${toolName}`);
        }
      }

      // Cria um arquivo de argumentos temporário em JSON
      const tempArgsFile = path.join(process.cwd(), `.tmp_args_${Date.now()}_${Math.floor(Math.random() * 1000)}.json`);
      fs.writeFileSync(tempArgsFile, JSON.stringify(toolArgs, null, 2));

      let toolStdout = '';
      let toolStderr = '';
      let toolSuccess = false;

      try {
        const useDocker = useDockerSandbox === true;
        const result = await runPythonSandbox(skillToUse, scriptPath, tempArgsFile, useDocker);
        toolStdout = result.stdout;
        toolStderr = result.stderr;
        toolSuccess = result.success;
      } catch (cmdErr) {
        toolStdout = cmdErr.stdout || '';
        toolStderr = cmdErr.stderr || cmdErr.message;
        console.error('Erro na execução do script python:', cmdErr);
      } finally {
        if (fs.existsSync(tempArgsFile)) {
          fs.unlinkSync(tempArgsFile);
        }
        if (tempScriptFile && fs.existsSync(tempScriptFile)) {
          fs.unlinkSync(tempScriptFile);
        }
      }

      steps.push({ 
        step: 'tool_completed', 
        detail: toolSuccess 
          ? `Script finalizado com sucesso.` 
          : `Script finalizado com erro.` 
      });

      trace.tools.push({
        name: toolName,
        inputs: toolArgs,
        outputs: `stdout:\n${toolStdout}\n\nstderr:\n${toolStderr}`,
        success: toolSuccess
      });

      const systemFeedbackMsg = `System Notification: O script '${toolName}' foi executado localmente.
Resultado de saída (stdout):
${toolStdout}
${toolStderr ? '\nLogs de Erros (stderr):\n' + toolStderr : ''}

Por favor, analise a saída do script e continue o raciocínio. Se precisar rodar outro comando ou checagem do script para complementar a auditoria, faça a chamada correspondente usando o formato JSON { "callTool": ... }. Se todas as análises estiverem concluídas, apresente os resultados finais formatados (tabela markdown, parecer clínico, recomendações) conforme as orientações do playbook.`;

      // Atualiza o histórico de mensagens para a próxima chamada
      currentChatContents.push({ role: 'model', parts: [{ text: JSON.stringify(currentParsedResult) }] });
      currentChatContents.push({ role: 'user', parts: [{ text: systemFeedbackMsg }] });

      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: currentChatContents,
          systemInstruction: { parts: [{ text: agentSystemInstruction }] }
        })
      });

      if (!response.ok) {
        throw new Error('Falha na resposta intermediária/final do agente após execução do script.');
      }

      const chatData = await response.json();
      if (chatData.usageMetadata) {
        totalPromptTokens += chatData.usageMetadata.promptTokenCount || 0;
        totalCompletionTokens += chatData.usageMetadata.candidatesTokenCount || 0;
        totalTokensCount += chatData.usageMetadata.totalTokenCount || 0;
      }

      const rawReply = chatData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      let thoughtProcess = '';
      const thoughtMatch = rawReply.match(thoughtRegex);
      if (thoughtMatch) {
        thoughtProcess = thoughtMatch[1].trim();
        trace.thoughtProcess = (trace.thoughtProcess ? trace.thoughtProcess + '\n' : '') + thoughtProcess;
      }
      currentCleanedReply = rawReply.replace(thoughtRegex, '').trim();

      // Tenta parsear a nova resposta para verificar se o agente quer chamar outra ferramenta
      currentParsedResult = parseToolCall(currentCleanedReply);
    }

    // Processamento do resultado final após o loop terminar (seja porque retornou texto plano ou atingiu o maxLoops)
    if (currentParsedResult) {
      finalReply = currentParsedResult.reply || currentCleanedReply;
    } else {
      // Se não for uma chamada de ferramenta válida, pode ser um JSON de texto ou texto plano bruto
      try {
        const cleanJson = currentCleanedReply.replace(/^```json/, '').replace(/```$/, '').trim();
        const parsedSecond = JSON.parse(cleanJson);
        finalReply = parsedSecond.reply || currentCleanedReply;
      } catch (e) {
        // Fallback do replyRegex em caso de JSON malformado
        let matched = false;
        const cleanInput = currentCleanedReply.replace(/^```json/, '').replace(/```$/, '').trim();
        if (cleanInput.startsWith('{') && cleanInput.endsWith('}')) {
          const replyRegex = /"reply"\s*:\s*"([\s\S]*?)"\s*}\s*$/;
          const match = cleanInput.match(replyRegex);
          if (match) {
            let extracted = match[1].trim();
            extracted = extracted.replace(/\\"/g, '"').replace(/\\n/g, '\n');
            finalReply = extracted;
            matched = true;
          }
        }
        if (!matched) {
          finalReply = currentCleanedReply;
        }
      }
    }


    // --- ETAPA AUTO-INGESTÃO: Salva novas preferências dinamicamente no final ---
    if (finalReply) {
      await autoIngestMemory(lastUserMessage || 'Analise o arquivo.', finalReply, skillToUse, actualApiKey, steps);
    }

    const endTime = performance.now();
    trace.metrics.latencyMs = Math.round(endTime - startTime);
    trace.metrics.tokens = {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalTokensCount
    };

    const finalMessages = [
      ...messages,
      { role: 'assistant', content: finalReply, trace }
    ];
    const conversationTitle = messages[0]?.content ? (messages[0].content.slice(0, 40) + (messages[0].content.length > 40 ? '...' : '')) : 'Nova conversa';
    await storage.saveConversation(activeConversationId, userId, skillToUse, conversationTitle, finalMessages);

    return res.json({
      reply: finalReply,
      activeSkillName: skillToUse,
      steps,
      trace,
      conversationId: activeConversationId
    });

  } catch (error) {
    console.error('Erro no processamento da Skill ativa do Agente:', error);
    res.status(500).json({ error: 'Erro no motor de execução: ' + error.message });
  }
});

// GET /api/conversations - Listar conversas do usuário autenticado
app.get('/api/conversations', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const list = await storage.listConversations(userId);
    res.json(list);
  } catch (error) {
    console.error('Erro ao listar conversas:', error);
    res.status(500).json({ error: 'Erro ao listar conversas: ' + error.message });
  }
});

// GET /api/conversations/:id - Obter conversa específica
app.get('/api/conversations/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const conversationId = req.params.id;
    const conversation = await storage.getConversation(conversationId, userId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversa não encontrada.' });
    }
    res.json(conversation);
  } catch (error) {
    console.error('Erro ao buscar conversa:', error);
    res.status(500).json({ error: 'Erro ao buscar conversa: ' + error.message });
  }
});

// DELETE /api/conversations/:id - Excluir conversa
app.delete('/api/conversations/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const conversationId = req.params.id;
    const success = await storage.deleteConversation(conversationId, userId);
    if (!success) {
      return res.status(404).json({ error: 'Conversa não encontrada.' });
    }
    res.json({ message: 'Conversa excluída com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir conversa:', error);
    res.status(500).json({ error: 'Erro ao excluir conversa: ' + error.message });
  }
});


// Função auxiliar de auto-ingestão de memórias em background (RAG de Longo Prazo)
async function autoIngestMemory(lastUserMessage, assistantReply, skillName, apiKey, steps) {
  try {
    const analysisSystemInstruction = `Você é o analisador de memória do sistema AI Skills. Sua tarefa é analisar a última mensagem do usuário e a resposta do agente e identificar se o usuário definiu alguma preferência duradoura, correção de tom, diretriz conceitual ou regra de negócio que o agente deve lembrar para interações futuras nesta Skill.

Exemplos de preferências duradouras:
- "Prefiro respostas curtas"
- "Não use jargões médicos"
- "Escreva sempre em formato de tópicos"
- "Sempre coloque o código TypeScript com strict mode ativo"

Não salve como memória perguntas de rotina, bate-papo informal ou agradecimentos.

Responda estritamente no formato JSON:
{
  "isRelevant": true ou false,
  "summary": "Declaração curta em 3ª pessoa resumindo o aprendizado (ex: 'O usuário prefere explicações concisas por tópicos')" (obrigatório se isRelevant for true)
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `Conversa Recente:\nUsuário: "${lastUserMessage}"\nAgente: "${assistantReply}"` }]
        }],
        systemInstruction: { parts: [{ text: analysisSystemInstruction }] },
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (response.ok) {
      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        const result = JSON.parse(rawText.trim());
        if (result.isRelevant && result.summary) {
          console.log(`Auto-RAG: Nova preferência identificada: "${result.summary}". Vetorizando...`);
          const embedding = await getGeminiEmbedding(result.summary, apiKey);
          if (storage.useFirebase) {
            await storage.addMemory(skillName, result.summary, embedding);
          } else {
            vectorDB.addMemory(skillName, result.summary, embedding);
          }
          steps.push({ step: 'memory_saved', detail: `💡 Preferência aprendida: "${result.summary}"` });
        }
      }
    }
  } catch (err) {
    console.error('Erro ao processar auto-ingestão de memória:', err);
  }
}

// Endpoint para refinamento automático do playbook (Auto-Tuning) via Gemini
app.post('/api/agent/auto-tune', async (req, res) => {
  const { skillName, userFeedback, interactionContext, apiKey } = req.body;

  if (!skillName || !userFeedback) {
    return res.status(400).json({ error: 'Parâmetros skillName e userFeedback são obrigatórios.' });
  }

  try {
    // 1. Lê o conteúdo atual de skill.md
    const file = await storage.getFileContent(skillName, 'skill.md');
    const oldContent = file.content || '';

    // 2. Chama a API do Gemini para reescrever o Playbook com base no feedback
    const actualApiKey = apiKey || process.env.GEMINI_API_KEY || await getLastApiKey();
    if (!actualApiKey) {
      return res.status(400).json({ error: 'Chave do Gemini API não configurada.' });
    }

    const systemInstruction = `Você é um Engenheiro de Prompt de IA Sênior especializado em playbooks de instruções cognitivas.
Sua missão é ler o playbook markdown atual de uma Skill de IA, analisar a falha cometida na conversa e o feedback do usuário.
Você deve reescrever as instruções do playbook markdown (mantendo todo o YAML frontmatter e estrutura de seções originais) adicionando diretrizes rígidas nas seções pertinentes (como nos Gotchas ou Checkpoints de QA) para mitigar o erro.
Responda estritamente com o novo conteúdo completo do playbook markdown editado. Não inclua blocos de código tipo \`\`\`markdown, retorne apenas o texto puro do markdown.`;

    const prompt = `=== PLAYBOOK ATUAL (skill.md) ===
${oldContent}
=== FIM DO PLAYBOOK ===

=== INTERAÇÃO DE ERRO ===
Pergunta do Usuário: "${interactionContext?.question || 'N/A'}"
Resposta Errada da IA: "${interactionContext?.reply || 'N/A'}"
=== FIM DA INTERAÇÃO ===

=== FEEDBACK CORRETIVO DO USUÁRIO ===
"${userFeedback}"
=== FIM DO FEEDBACK ===

Por favor, reescreva o playbook markdown corrigindo este problema de acordo com as instruções do sistema.`;

    const chatUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${actualApiKey}`;
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro no Gemini API: ${response.status} - ${errorText}`);
    }

    const chatData = await response.json();
    let newContent = chatData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    newContent = newContent.replace(/^```markdown/, '').replace(/```$/, '').trim();

    if (!newContent) {
      throw new Error('O Gemini retornou um playbook vazio.');
    }

    // 3. Grava o novo playbook temporariamente no disco/armazenamento
    await storage.saveFile(skillName, 'skill.md', newContent);

    // 4. Retorna o conteúdo antigo e o novo para que o frontend exiba a diff side-by-side
    res.json({
      success: true,
      oldContent,
      newContent,
      message: 'Regras do playbook reescritas temporariamente.'
    });

  } catch (error) {
    console.error('Erro no auto-tune do agente:', error);
    res.status(500).json({ error: 'Erro ao gerar o auto-tune do playbook: ' + error.message });
  }
});

// Endpoint para confirmar ou descartar o auto-tuning do playbook
app.post('/api/agent/auto-tune/confirm', async (req, res) => {
  const { skillName, oldContent, confirmed } = req.body;

  if (!skillName) {
    return res.status(400).json({ error: 'Parâmetro skillName é obrigatório.' });
  }

  try {
    if (!confirmed) {
      console.log(`[AUTO-TUNE] Ajuste rejeitado. Restaurando o playbook da skill ${skillName} ao estado anterior...`);
      await storage.saveFile(skillName, 'skill.md', oldContent || '');
      return res.json({ success: true, message: 'Alterações descartadas com sucesso.' });
    }

    console.log(`[AUTO-TUNE] Ajuste confirmado para a skill ${skillName}.`);
    res.json({ success: true, message: 'Ajuste do playbook confirmado e salvo com sucesso!' });

  } catch (error) {
    console.error('Erro ao confirmar auto-tune:', error);
    res.status(500).json({ error: 'Erro ao confirmar auto-tune: ' + error.message });
  }
});

// Endpoint para rodar manualmente uma ferramenta da Skill
app.post('/api/agent/run-tool', async (req, res) => {
  const { skillName, toolName, args, useDockerSandbox } = req.body;
  if (!skillName || !toolName) {
    return res.status(400).json({ error: 'Parâmetros skillName e toolName são obrigatórios.' });
  }

  try {
    let scriptPath = '';
    let tempScriptFile = '';
    
    if (storage.useFirebase) {
      const fileContent = await storage.getFileContent(skillName, `tools/${toolName}`);
      tempScriptFile = path.join(process.cwd(), `.tmp_script_run_${Date.now()}_${toolName}`);
      fs.writeFileSync(tempScriptFile, fileContent.content || '');
      scriptPath = tempScriptFile;
    } else {
      scriptPath = safePath(path.join(SKILLS_DIR, skillName, 'tools'), toolName);
      if (!fs.existsSync(scriptPath)) {
        return res.status(404).json({ error: 'Script não encontrado' });
      }
    }

    const tempArgsFile = path.join(process.cwd(), `.tmp_args_run_${Date.now()}.json`);
    fs.writeFileSync(tempArgsFile, JSON.stringify(args || {}, null, 2));

    let stdoutStr = '';
    let stderrStr = '';
    let success = false;

    try {
      const useDocker = useDockerSandbox === true;
      const result = await runPythonSandbox(skillName, scriptPath, tempArgsFile, useDocker);
      stdoutStr = result.stdout;
      stderrStr = result.stderr;
      success = result.success;
    } catch (err) {
      stdoutStr = '';
      stderrStr = err.message;
    } finally {
      if (fs.existsSync(tempArgsFile)) {
        fs.unlinkSync(tempArgsFile);
      }
      if (tempScriptFile && fs.existsSync(tempScriptFile)) {
        fs.unlinkSync(tempScriptFile);
      }
    }

    res.json({
      success,
      stdout: stdoutStr,
      stderr: stderrStr
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao rodar ferramenta: ' + error.message });
  }
});

// --- ENDPOINTS DE GERENCIAMENTO DE MEMÓRIA VETORIAL ---

// 1. Obter todas as memórias salvas para uma Skill
app.get('/api/skills/:name/memories', async (req, res) => {
  const { name } = req.params;
  try {
    if (storage.useFirebase) {
      const list = await storage.getMemories(name);
      res.json(list ? list.map(m => ({ id: m.id, text: m.text, timestamp: m.timestamp })) : []);
    } else {
      const list = vectorDB.getMemories(name).map(m => ({
        id: m.id,
        text: m.text,
        timestamp: m.timestamp
      }));
      res.json(list);
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar memórias: ' + error.message });
  }
});

// 2. Apagar uma memória específica
app.delete('/api/skills/:name/memories/:id', async (req, res) => {
  const { name, id } = req.params;
  try {
    let deleted = false;
    if (storage.useFirebase) {
      deleted = await storage.deleteMemory(name, id);
    } else {
      deleted = vectorDB.deleteMemory(id);
    }
    
    if (deleted) {
      res.json({ message: 'Memória deletada com sucesso!' });
    } else {
      res.status(404).json({ error: 'Memória não encontrada.' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar memória: ' + error.message });
  }
});


// 12. Deletar uma Skill por inteiro
app.delete('/api/skills/:name', async (req, res) => {
  const { name } = req.params;
  try {
    await storage.deleteSkill(name);
    res.json({ message: `Skill '${name}' deletada com sucesso!` });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar Skill: ' + error.message });
  }
});



// --- SISTEMA DE GATILHOS DE AUTOMAÇÃO E WORKER QUEUE (MODO SHADOWING EM BACKGROUND) ---

let lastUsedApiKey = '';
let lastUsedSdkApiKey = '';

async function getSdkApiKey() {
  if (lastUsedSdkApiKey) return lastUsedSdkApiKey;
  try {
    if (storage.useFirebase) {
      const config = await storage.getSystemConfig();
      if (config) {
        lastUsedSdkApiKey = config.sdkApiKey || '';
        return lastUsedSdkApiKey;
      }
    } else {
      if (fs.existsSync(CONFIG_FILE)) {
        const content = fs.readFileSync(CONFIG_FILE, 'utf8');
        const parsed = JSON.parse(content);
        lastUsedSdkApiKey = parsed.sdkApiKey || '';
        return lastUsedSdkApiKey;
      }
    }
  } catch (e) {
    console.error('Erro ao ler SDK API Key das configurações:', e);
  }
  return '';
}

async function saveSdkApiKey(key) {
  lastUsedSdkApiKey = key;
  try {
    if (storage.useFirebase) {
      await storage.saveSystemConfig({ sdkApiKey: key });
    } else {
      let currentConfig = {};
      if (fs.existsSync(CONFIG_FILE)) {
        currentConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      }
      currentConfig.sdkApiKey = key;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
    }
  } catch (err) {
    console.error('Erro ao salvar SDK API Key nas configurações:', err);
  }
}

const CONFIG_FILE = path.join(MEMORY_DIR, 'config.json');
const AUTOMATION_LOGS_FILE = path.join(MEMORY_DIR, 'automation_logs.json');
const automationJobs = [];
const pausedSkills = new Set();
let activeWorkerCount = 0;
const maxConcurrentJobs = 3;
const maxLogEntries = 100;
const activeCronJobs = new Map();

async function saveLastApiKey(key) {
  lastUsedApiKey = key;
  try {
    if (storage.useFirebase) {
      await storage.saveSystemConfig({ apiKey: key });
    } else {
      let currentConfig = {};
      if (fs.existsSync(CONFIG_FILE)) {
        currentConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      }
      currentConfig.apiKey = key;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
    }
  } catch (err) {
    console.error('Erro ao salvar chave de API nas configurações:', err);
  }
}

async function getLastApiKey() {
  if (lastUsedApiKey) return lastUsedApiKey;
  try {
    if (storage.useFirebase) {
      const config = await storage.getSystemConfig();
      if (config) {
        lastUsedApiKey = config.apiKey || '';
        if (config.pausedSkills && Array.isArray(config.pausedSkills)) {
          config.pausedSkills.forEach(s => pausedSkills.add(s));
        }
        return lastUsedApiKey;
      }
    } else {
      if (fs.existsSync(CONFIG_FILE)) {
        const content = fs.readFileSync(CONFIG_FILE, 'utf8');
        const parsed = JSON.parse(content);
        lastUsedApiKey = parsed.apiKey || '';
        if (parsed.pausedSkills && Array.isArray(parsed.pausedSkills)) {
          parsed.pausedSkills.forEach(s => pausedSkills.add(s));
        }
        return lastUsedApiKey;
      }
    }
  } catch (e) {
    console.error('Erro ao ler chave de API das configurações:', e);
  }
  return '';
}

async function saveConfigState() {
  try {
    if (storage.useFirebase) {
      await storage.saveSystemConfig({ pausedSkills: Array.from(pausedSkills) });
    } else {
      let currentConfig = {};
      if (fs.existsSync(CONFIG_FILE)) {
        currentConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      }
      currentConfig.pausedSkills = Array.from(pausedSkills);
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
    }
  } catch (err) {
    console.error('Erro ao salvar estado de configurações:', err);
  }
}

function queueJob(skillName, triggerType, payload) {
  const job = {
    id: 'job_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    skillName,
    triggerType,
    payload,
    status: 'queued',
    queuedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    trace: null,
    error: null
  };
  automationJobs.unshift(job);
  if (automationJobs.length > maxLogEntries) {
    automationJobs.pop();
  }
  saveAutomationLogs(); // Fire-and-forget
  triggerWorker();
  return job;
}

async function saveAutomationLogs() {
  try {
    if (storage.useFirebase) {
      await storage.saveSystemAutomationLogs(automationJobs.slice(0, 50));
    } else {
      fs.writeFileSync(AUTOMATION_LOGS_FILE, JSON.stringify(automationJobs.slice(0, 50), null, 2));
    }
  } catch (err) {
    console.error('Erro ao salvar logs de automação:', err);
  }
}

async function loadAutomationLogs() {
  try {
    if (storage.useFirebase) {
      const logs = await storage.getSystemAutomationLogs();
      if (logs) {
        automationJobs.push(...logs);
      }
    } else {
      if (fs.existsSync(AUTOMATION_LOGS_FILE)) {
        const content = fs.readFileSync(AUTOMATION_LOGS_FILE, 'utf8');
        const parsed = JSON.parse(content);
        automationJobs.push(...parsed);
      }
    }
  } catch (err) {
    console.error('Erro ao ler logs de automação:', err);
  }
}

async function triggerWorker() {
  if (activeWorkerCount >= maxConcurrentJobs) return;

  const nextJob = automationJobs.find(j => j.status === 'queued');
  if (!nextJob) return;

  activeWorkerCount++;
  
  runBackgroundExecution(nextJob)
    .then(() => {
      activeWorkerCount--;
      triggerWorker();
    })
    .catch((err) => {
      console.error('Erro crítico no Worker loop:', err);
      nextJob.status = 'failed';
      nextJob.completedAt = new Date().toISOString();
      nextJob.error = err.message;
      saveAutomationLogs();
      activeWorkerCount--;
      triggerWorker();
    });
}

async function runBackgroundExecution(job) {
  const startTime = performance.now();
  const actualApiKey = process.env.GEMINI_API_KEY || await getLastApiKey();
  
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  saveAutomationLogs();

  if (!actualApiKey) {
    throw new Error('Chave de API do Gemini não configurada no servidor (Worker).');
  }

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokensCount = 0;

  const trace = {
    skillName: job.skillName,
    routingReason: `Automação disparada via ${job.triggerType.toUpperCase()}`,
    memories: [],
    files: [],
    tools: [],
    thoughtProcess: '',
    metrics: {
      latencyMs: 0,
      tokens: { prompt: 0, completion: 0, total: 0 }
    }
  };

  const steps = [];
  const lastUserMessage = JSON.stringify(job.payload || {});
  
  try {
    let playbookContent = '';
    try {
      const file = await storage.getFileContent(job.skillName, 'skill.md');
      playbookContent = file.content || '';
    } catch (playbookErr) {
      console.warn('Playbook não encontrado no background:', playbookErr);
    }

    // --- ETAPA RAG ---
    let matchedMemoriesPrompt = '';
    try {
      let matched = [];
      if (storage.useFirebase) {
        const queryEmbedding = await getGeminiEmbedding(lastUserMessage || 'Analise o payload.', actualApiKey);
        const memoriesList = await storage.getMemories(job.skillName);
        if (memoriesList && memoriesList.length > 0) {
          matched = searchMemoriesInList(memoriesList, queryEmbedding, 3, 0.45);
        }
      } else {
        const skillMemories = vectorDB.getMemories(job.skillName);
        if (skillMemories && skillMemories.length > 0) {
          steps.push({ step: 'rag_query', detail: 'Pesquisando aprendizados vetoriais...' });
          const queryEmbedding = await getGeminiEmbedding(lastUserMessage || 'Analise o payload.', actualApiKey);
          matched = vectorDB.search(job.skillName, queryEmbedding, 3, 0.45);
        }
      }
      
      if (matched && matched.length > 0) {
        trace.memories = matched.map(m => m.text);
        steps.push({ step: 'rag_retrieved', detail: `Resgatou ${matched.length} preferências.` });
        matchedMemoriesPrompt = `\n\n=== HISTÓRICO E PREFERÊNCIAS APRENDIDAS (RAG) ===\n${matched.map(m => `- ${m.text}`).join('\n')}\n=== FIM ===`;
      }
    } catch (ragErr) {
      console.error('Erro RAG em Worker:', ragErr);
    }

    let dadosFiles = [];
    let toolsScripts = [];
    
    if (storage.useFirebase) {
      const details = await storage.getSkill(job.skillName);
      const findFilesRecursive = (nodes) => {
        const list = [];
        for (const node of nodes) {
          if (node.type === 'file') {
            list.push(node.path);
          } else if (node.children) {
            list.push(...findFilesRecursive(node.children));
          }
        }
        return list;
      };
      const allFiles = findFilesRecursive(details.files || []);
      dadosFiles = allFiles.filter(f => f.startsWith('dados/')).map(f => f.replace('dados/', ''));
      toolsScripts = allFiles.filter(f => f.startsWith('tools/') && f.endsWith('.py')).map(f => f.replace('tools/', ''));
    } else {
      const skillPath = path.join(SKILLS_DIR, job.skillName);
      const dadosPath = path.join(skillPath, 'dados');
      if (fs.existsSync(dadosPath)) {
        dadosFiles = fs.readdirSync(dadosPath);
      }
      const toolsPath = path.join(skillPath, 'tools');
      if (fs.existsSync(toolsPath)) {
        toolsScripts = fs.readdirSync(toolsPath).filter(f => f.endsWith('.py'));
      }
    }

    const agentSystemInstruction = `Você é o Agente Executivo operando a automação da AI SKILL: "${job.skillName}".
Sua tarefa é analisar o payload JSON de entrada recebido do webhook/cron e executar a lógica.
=== INÍCIO DO PLAYBOOK ===
${playbookContent}
=== FIM DO PLAYBOOK ===
${matchedMemoriesPrompt}
 
Arquivos de referência disponíveis: ${JSON.stringify(dadosFiles)}
Scripts de automação disponíveis: ${JSON.stringify(toolsScripts)}
 
Instruções de Resposta:
1. Raciocínio Oculto (Chain of Thought): Antes de dar sua resposta final, documente seu raciocínio dentro da tag XML <thought_process>...</thought_process>.
2. Se precisar rodar um dos scripts de automação, responda estritamente com este formato JSON:
{
  "callTool": "nome_do_script.py",
  "args": {
    "arg1": "valor1"
  }
}
Quando você retornar esse JSON, o sistema executará o script localmente e injetará os resultados.
3. Se não precisar chamar ferramentas, retorne o resultado ou relatório final da automação. Sempre responda em Português (pt-BR).`;

    const chatContents = [{
      role: 'user',
      parts: [{ text: `Automação executada via ${job.triggerType}. Payload recebido:\n${lastUserMessage}` }]
    }];

    const chatUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${actualApiKey}`;
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: chatContents,
        systemInstruction: { parts: [{ text: agentSystemInstruction }] },
      })
    });

    if (!response.ok) {
      throw new Error(`Erro na API do Gemini: ${response.status}`);
    }

    const chatData = await response.json();
    if (chatData.usageMetadata) {
      totalPromptTokens += chatData.usageMetadata.promptTokenCount || 0;
      totalCompletionTokens += chatData.usageMetadata.candidatesTokenCount || 0;
      totalTokensCount += chatData.usageMetadata.totalTokenCount || 0;
    }

    const rawReply = chatData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const thoughtRegex = /<thought_process>([\s\S]*?)<\/thought_process>/i;
    
    let parsedResult = parseToolCall(rawReply);

    let finalReply = '';
    let loopCount = 0;
    const maxLoops = 8; // Limite de chamadas consecutivas de ferramentas

    let currentParsedResult = parsedResult;
    let currentCleanedReply = rawReply.replace(thoughtRegex, '').trim();
    let currentChatContents = [...chatContents, { role: 'model', parts: [{ text: rawReply }] }];

    while (currentParsedResult && currentParsedResult.callTool && loopCount < maxLoops) {
      loopCount++;
      const toolName = currentParsedResult.callTool;
      const toolArgs = currentParsedResult.args || {};

      steps.push({ step: 'tool_executing', detail: `Invocando script Python: ${toolName}...` });

      let scriptPath = '';
      let tempScriptFile = '';
      
      if (storage.useFirebase) {
        const fileContent = await storage.getFileContent(job.skillName, `tools/${toolName}`);
        tempScriptFile = path.join(process.cwd(), `.tmp_script_bg_${Date.now()}_${toolName}`);
        fs.writeFileSync(tempScriptFile, fileContent.content || '');
        scriptPath = tempScriptFile;
      } else {
        const toolsPath = path.join(SKILLS_DIR, job.skillName, 'tools');
        scriptPath = path.join(toolsPath, toolName);
        if (!fs.existsSync(scriptPath)) {
          throw new Error(`Script de ferramenta não encontrado: ${toolName}`);
        }
      }

      const tempArgsFile = path.join(process.cwd(), `.tmp_args_bg_${Date.now()}.json`);
      fs.writeFileSync(tempArgsFile, JSON.stringify(toolArgs, null, 2));

      let toolStdout = '';
      let toolStderr = '';
      let toolSuccess = false;

      try {
        const result = await runPythonSandbox(job.skillName, scriptPath, tempArgsFile, false);
        toolStdout = result.stdout;
        toolStderr = result.stderr;
        toolSuccess = result.success;
      } catch (cmdErr) {
        toolStdout = cmdErr.stdout || '';
        toolStderr = cmdErr.stderr || cmdErr.message;
      } finally {
        if (fs.existsSync(tempArgsFile)) {
          fs.unlinkSync(tempArgsFile);
        }
        if (tempScriptFile && fs.existsSync(tempScriptFile)) {
          fs.unlinkSync(tempScriptFile);
        }
      }

      steps.push({ step: 'tool_completed', detail: 'Script finalizado em background.' });
      trace.tools.push({
        name: toolName,
        inputs: toolArgs,
        outputs: `stdout:\n${toolStdout}\n\nstderr:\n${toolStderr}`,
        success: toolSuccess
      });

      const systemFeedbackMsg = `System Notification: O script '${toolName}' foi executado localmente.
Resultado de saída (stdout):
${toolStdout}
${toolStderr ? '\nLogs de Erros (stderr):\n' + toolStderr : ''}
Por favor, analise a saída do script e continue. Formate a análise final em markdown para o relatório do webhook quando tudo estiver concluído.`;

      // Atualiza o histórico de mensagens para a próxima chamada
      currentChatContents.push({ role: 'user', parts: [{ text: systemFeedbackMsg }] });

      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: currentChatContents,
          systemInstruction: { parts: [{ text: agentSystemInstruction }] }
        })
      });

      if (!response.ok) {
        throw new Error('Falha na resposta intermediária/final em background após execução do script.');
      }

      const chatData = await response.json();
      if (chatData.usageMetadata) {
        totalPromptTokens += chatData.usageMetadata.promptTokenCount || 0;
        totalCompletionTokens += chatData.usageMetadata.candidatesTokenCount || 0;
        totalTokensCount += chatData.usageMetadata.totalTokenCount || 0;
      }

      const rawReply = chatData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      let thoughtProcess = '';
      const thoughtMatch = rawReply.match(thoughtRegex);
      if (thoughtMatch) {
        thoughtProcess = thoughtMatch[1].trim();
        trace.thoughtProcess = (trace.thoughtProcess ? trace.thoughtProcess + '\n' : '') + thoughtProcess;
      }
      currentCleanedReply = rawReply.replace(thoughtRegex, '').trim();

      // Tenta parsear a nova resposta para verificar se o agente quer chamar outra ferramenta
      currentParsedResult = parseToolCall(currentCleanedReply);
    }

    // Processamento do resultado final em background
    if (currentParsedResult) {
      finalReply = currentParsedResult.reply || currentCleanedReply;
    } else {
      try {
        const cleanJson = currentCleanedReply.replace(/^```json/, '').replace(/```$/, '').trim();
        const parsedSecond = JSON.parse(cleanJson);
        finalReply = parsedSecond.reply || currentCleanedReply;
      } catch (e) {
        // Fallback do replyRegex em caso de JSON malformado
        let matched = false;
        const cleanInput = currentCleanedReply.replace(/^```json/, '').replace(/```$/, '').trim();
        if (cleanInput.startsWith('{') && cleanInput.endsWith('}')) {
          const replyRegex = /"reply"\s*:\s*"([\s\S]*?)"\s*}\s*$/;
          const match = cleanInput.match(replyRegex);
          if (match) {
            let extracted = match[1].trim();
            extracted = extracted.replace(/\\"/g, '"').replace(/\\n/g, '\n');
            finalReply = extracted;
            matched = true;
          }
        }
        if (!matched) {
          finalReply = currentCleanedReply;
        }
      }
    }

    const endTime = performance.now();
    trace.metrics.latencyMs = Math.round(endTime - startTime);
    trace.metrics.tokens = {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalTokensCount
    };

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.trace = trace;
    saveAutomationLogs();

  } catch (err) {
    console.error(`Erro ao executar automação da skill ${job.skillName}:`, err);
    job.status = 'failed';
    job.completedAt = new Date().toISOString();
    job.error = err.message;
    saveAutomationLogs();
    throw err;
  }
}

async function syncAutomationTriggers() {
  console.log('Sincronizando gatilhos de automação...');
  
  // Cancela crons ativos
  for (const [skillName, task] of activeCronJobs.entries()) {
    task.stop();
  }
  activeCronJobs.clear();

  try {
    let skillsList = [];
    if (storage.useFirebase) {
      skillsList = await storage.listSkills();
    } else {
      const items = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
      for (const item of items) {
        if (item.name === '.git' || !item.isDirectory() || item.name === '.memory') continue;
        const playbookContent = fs.readFileSync(path.join(SKILLS_DIR, item.name, 'skill.md'), 'utf8');
        const meta = storage.parseSkillMetadataFromContent(item.name, playbookContent);
        skillsList.push({ name: item.name, ...meta });
      }
    }

    for (const skill of skillsList) {
      if (pausedSkills.has(skill.name)) {
        console.log(`Gatilhos da Skill '${skill.name}' estão PAUSADOS.`);
        continue;
      }

      if (skill.trigger === 'cron' && skill.cron_expression) {
        try {
          console.log(`Registrando Cron para Skill '${skill.name}': "${skill.cron_expression}"`);
          const task = cron.schedule(skill.cron_expression, () => {
            console.log(`Cron disparado para Skill '${skill.name}'`);
            queueJob(skill.name, 'cron', { triggeredAt: new Date().toISOString() });
          });
          activeCronJobs.set(skill.name, task);
        } catch (cronErr) {
          console.error(`Erro ao registrar cron para skill ${skill.name}:`, cronErr);
        }
      }
    }
  } catch (err) {
    console.error('Erro ao sincronizar gatilhos:', err);
  }
}

// --- ENDPOINTS DO INSPETOR E DASHBOARD DE AUTOMAÇÕES ---

app.get('/api/automations', async (req, res) => {
  try {
    const skillsList = await storage.listSkills();
    const automations = [];

    for (const skill of skillsList) {
      if (skill.trigger) {
        automations.push({
          skillName: skill.name,
          title: skill.title,
          description: skill.description,
          triggerType: skill.trigger,
          cronExpression: skill.cron_expression,
          webhookEndpoint: `/api/webhooks/${skill.name}`,
          paused: pausedSkills.has(skill.name),
          lastExecution: automationJobs.find(j => j.skillName === skill.name) || null
        });
      }
    }
    res.json(automations);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar automações: ' + error.message });
  }
});

app.get('/api/automations/logs', (req, res) => {
  res.json(automationJobs);
});

app.post('/api/automations/:skillName/trigger', async (req, res) => {
  const { skillName } = req.params;
  const payload = req.body || {};

  try {
    if (storage.useFirebase) {
      const skills = await storage.listSkills();
      const exists = skills.some(s => s.name === skillName);
      if (!exists) {
        return res.status(404).json({ error: 'Skill não encontrada.' });
      }
    } else {
      const skillPath = safePath(SKILLS_DIR, skillName);
      if (!fs.existsSync(skillPath)) {
        return res.status(404).json({ error: 'Skill não encontrada.' });
      }
    }

    const job = queueJob(skillName, 'manual', payload);
    res.json({ message: 'Execução manual enfileirada.', jobId: job.id });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao disparar automação: ' + error.message });
  }
});

app.post('/api/automations/:skillName/toggle', async (req, res) => {
  const { skillName } = req.params;
  try {
    if (pausedSkills.has(skillName)) {
      pausedSkills.delete(skillName);
      console.log(`Skill '${skillName}' ativada.`);
    } else {
      pausedSkills.add(skillName);
      console.log(`Skill '${skillName}' pausada.`);
    }
    await saveConfigState();
    await syncAutomationTriggers();
    res.json({ paused: pausedSkills.has(skillName), message: 'Status alterado com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao alternar status da automação: ' + error.message });
  }
});

app.post('/api/webhooks/:skillName', async (req, res) => {
  const { skillName } = req.params;
  const payload = req.body || {};

  const expectedToken = process.env.AUTOMATION_TOKEN || 'skills_automation_secret';
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Token Bearer inválido ou não autorizado' });
  }

  try {
    let skill = null;
    if (storage.useFirebase) {
      const skills = await storage.listSkills();
      skill = skills.find(s => s.name === skillName);
    } else {
      const skillPath = safePath(SKILLS_DIR, skillName);
      if (!fs.existsSync(skillPath)) {
        return res.status(404).json({ error: `Skill '${skillName}' não encontrada.` });
      }
      const playbookContent = fs.readFileSync(path.join(skillPath, 'skill.md'), 'utf8');
      skill = { name: skillName, ...storage.parseSkillMetadataFromContent(skillName, playbookContent) };
    }

    if (!skill) {
      return res.status(404).json({ error: `Skill '${skillName}' não encontrada.` });
    }

    if (skill.trigger !== 'webhook') {
      return res.status(400).json({ error: `A Skill '${skillName}' não está configurada para receber Webhooks.` });
    }

    if (pausedSkills.has(skillName)) {
      return res.status(503).json({ error: `Os gatilhos da Skill '${skillName}' estão pausados no momento.` });
    }

    const job = queueJob(skillName, 'webhook', payload);
    res.status(202).json({ 
      message: 'Requisição aceita e enfileirada para processamento em background (202 Accepted).', 
      jobId: job.id, 
      status: 'queued' 
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao enfileirar webhook: ' + error.message });
  }
});

// 12c. Configurar Automação de uma Skill (atualiza YAML do skill.md)
app.post('/api/skills/:name/automation', async (req, res) => {
  const { name } = req.params;
  const { triggerType, cronExpression } = req.body;

  try {
    const file = await storage.getFileContent(name, 'skill.md');
    let content = file.content;
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
    const match = content.match(frontmatterRegex);

    let yamlData = {};
    let bodyContent = content;

    if (match) {
      const yamlStr = match[1];
      bodyContent = content.substring(match[0].length);
      const lines = yamlStr.split('\n');
      for (const line of lines) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const key = parts[0].trim().toLowerCase();
          const value = parts.slice(1).join(':').trim();
          yamlData[key] = value.replace(/^['"]|['"]$/g, '');
        }
      }
    }

    if (triggerType === 'webhook') {
      yamlData['trigger'] = 'webhook';
      yamlData['endpoint'] = `"/api/webhooks/${name}"`;
    } else if (triggerType === 'cron') {
      const expression = cronExpression || '0 8 * * 1';
      yamlData['trigger'] = `cron("${expression}")`;
      yamlData['endpoint'] = 'null';
    } else {
      yamlData['trigger'] = 'null';
      yamlData['endpoint'] = 'null';
    }

    let newYamlStr = '---\n';
    for (const [k, v] of Object.entries(yamlData)) {
      newYamlStr += `${k}: ${v}\n`;
    }
    newYamlStr += '---\n';

    const newContent = newYamlStr + bodyContent;
    await storage.saveFile(name, 'skill.md', newContent);

    // Recarrega os gatilhos no servidor
    await syncAutomationTriggers();

    res.json({
      message: 'Gatilho de automação configurado com sucesso!',
      trigger: yamlData['trigger'],
      endpoint: yamlData['endpoint']
    });
  } catch (error) {
    console.error('Erro ao salvar automação:', error);
    res.status(500).json({ error: 'Erro ao configurar automação: ' + error.message });
  }
});

// Inicia o servidor
app.listen(PORT, async () => {
  console.log(`Servidor rodando com sucesso em http://localhost:${PORT}`);
  try {
    await getLastApiKey();
    await loadAutomationLogs();
    seedTemplates();
    await syncAutomationTriggers();
  } catch (startupErr) {
    console.error('Erro na inicialização do modulo de automação:', startupErr);
  }
});

// --- SISTEMA DE GALERIA DE PLAYBOOKS (TEMPLATES SEED & CLONE) ---

function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  const files = fs.readdirSync(source);
  for (const file of files) {
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);
    if (fs.statSync(curSource).isDirectory()) {
      copyFolderRecursiveSync(curSource, curTarget);
    } else {
      fs.copyFileSync(curSource, curTarget);
    }
  }
}

function seedTemplates() {
  console.log('Verificando inicialização da galeria de templates...');
  const templatesData = [
    {
      name: 'estruturador-casos-clinicos',
      title: 'Estruturador de Casos Clínicos (PBL/TBL)',
      description: 'Cria cenários clínicos e roteiros baseados em Aprendizagem Baseada em Problemas.',
      category: 'Educação Ativa',
      playbook: `---
title: Estruturador de Casos Clínicos (PBL/TBL)
description: Cria cenários clínicos e roteiros baseados em Aprendizagem Baseada em Problemas.
accepts_files: false
category: Educação Ativa
---

# Estruturador de Casos Clínicos (PBL/TBL)

Você é um Designer Instrucional especializado em metodologias de ensino ativo em saúde (PBL - Problem-Based Learning e TBL - Team-Based Learning). Seu papel é ajudar professores a criar casos clínicos estruturados que estimulem a discussão acadêmica.

## Diretrizes de Operação

1. **Abordagem Colaborativa**:
   Ao iniciar, se o usuário não forneceu os objetivos ou temas, solicite as informações essenciais:
   - Objetivos pedagógicos de aprendizagem (ex: compreender insuficiência cardíaca congestiva).
   - Nível dos estudantes (graduação, residência, etc.).
   - Tema clínico central.

2. **Estrutura Obrigatória do Caso Clínico**:
   Gere o roteiro completo estruturado exatamente nas seguintes seções Markdown:
   
   ### 1. Objetivos de Aprendizagem
   - Defina os 3 a 5 objetivos de aprendizagem centrais do caso de forma clara e mensurável.
   
   ### 2. Apresentação do Caso (Cenário Clínico)
   - Um texto imersivo contando a história do paciente (anamnese, queixas principais, histórico de saúde e sintomas).
   - Dados vitais e achados do exame físico inicial.
   
   ### 3. Questões Norteadoras (Discussão dos Estudantes)
   - Forneça 4 a 6 perguntas de alta ordem cognitiva para instigar a pesquisa independente dos alunos sobre fisiopatologia, conduta e diagnósticos diferenciais.
   
   ### 4. Guia e Gabarito do Tutor
   - Uma seção exclusiva com as respostas ideais detalhadas, pontos de atenção para o tutor guiar a discussão se o grupo desviar do objetivo, e referências bibliográficas recomendadas.
`
    },
    {
      name: 'auditor-prescricao',
      title: 'Auditor de Prescrição Hospitalar',
      description: 'Analisa receituários (multimodal) cruzando posologias e detectando interações medicamentosas.',
      category: 'Tomada de Decisão',
      playbook: `---
title: Auditor de Prescrição Hospitalar
description: Analisa receituários (multimodal) cruzando posologias e detectando interações medicamentosas.
accepts_files: true
supported_formats: ["pdf", "image"]
category: Tomada de Decisão
trigger: webhook
endpoint: "/api/webhooks/auditor-prescricao"
---

# Auditor de Prescrição Hospitalar

Você é um Farmacêutico Clínico Sênior e Especialista em Segurança do Paciente. Sua missão é auditar prontuários clínicos e imagens de prescrições médicas para encontrar potenciais interações adversas, contraindicações graves ou inconsistências de dosagem em tratamentos clínicos hospitalares.

## Diretrizes de Operação

1. **Extração de Informações**:
   - Leia a imagem ou PDF da prescrição fornecida.
   - Extraia a lista de medicamentos prescritos, dosagens, via de administração e intervalos.

2. **Análise de Interações (Tool Calling)**:
   - Para analisar interações medicamentosas farmacológicas com alta precisão científica, você DEVE invocar a ferramenta local 'interacoes.py'.
   - Passe a lista de medicamentos extraídos no argumento 'medicamentos' (ex: ["Aspirina", "Varfarina"]).
   - Avalie o resultado retornado pelo script Python.

3. **Estrutura do Relatório de Auditoria**:
   Apresente o resultado formatado em Markdown com as seguintes seções:
   
   ### 1. Resumo da Prescrição
   - Tabela com os medicamentos detectados, dosagens e vias.
   
   ### 2. Alertas de Interações Farmacológicas
   - Detalhe de cada interação crítica detectada (com base no script de ferramentas e em seu conhecimento médico).
   - Classifique a gravidade em: **Crítica**, **Moderada** ou **Sem Alerta**.
   
   ### 3. Parecer Clínico e Recomendações
   - Sugestões para substituição de fármacos ou alterações de dosagem para discussão médica imediata.
`,
      script: `import sys
import json
import os

def check_interactions(prescription_data):
    drugs = prescription_data.get('medicamentos', [])
    dangerous_pairs = [
        ({"Amiodarona", "Simvastatina"}, "Risco aumentado de miopatia e rabdomiólise (lesão muscular)."),
        ({"Varfarina", "Aspirina"}, "Aumento severo do risco de sangramentos gastrointestinais e internos."),
        ({"Enalapril", "Espironolactona"}, "Risco aumentado de hipercalemia (níveis perigosos de potássio)."),
        ({"Clopidogrel", "Omeprazol"}, "Redução da eficácia anticoagulante do Clopidogrel, aumentando risco cardíaco.")
    ]
    
    found_interactions = []
    drugs_set = {d.strip().capitalize() for d in drugs}
    
    for pair, warning in dangerous_pairs:
        if pair.issubset(drugs_set):
            found_interactions.append({
                "medicamentos": list(pair),
                "gravidade": "Alta/Crítica",
                "detalhes": warning
            })
            
    return {
        "status": "sucesso",
        "analise": {
            "interacoes_encontradas": found_interactions,
            "total_medicamentos_analisados": len(drugs),
            "alerta": len(found_interactions) > 0
        }
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "erro", "mensagem": "Arquivo de argumentos temporario nao fornecido."}))
        sys.exit(1)
        
    temp_file = sys.argv[1]
    if not os.path.exists(temp_file):
        print(json.dumps({"status": "erro", "mensagem": f"Arquivo {temp_file} nao existe."}))
        sys.exit(1)
        
    try:
        with open(temp_file, 'r', encoding='utf-8') as f:
            prescription_data = json.load(f)
            
        result = check_interactions(prescription_data)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"status": "erro", "mensagem": str(e)}))
`
    },
    {
      name: 'produtor-conteudo-seo',
      title: 'Produtor de Conteúdo e SEO',
      description: 'Otimiza roteiros, títulos magnéticos e descrições detalhadas para vídeos e thumbnails.',
      category: 'Criação de Conteúdo',
      playbook: `---
title: Produtor de Conteúdo e SEO
description: Otimiza roteiros, títulos magnéticos e descrições detalhadas para vídeos e thumbnails.
accepts_files: false
category: Criação de Conteúdo
---

# Produtor de Conteúdo e SEO (Tech & Saúde)

Você é um Copywriter Especialista em Marketing Digital de Conteúdo e SEO para canais de Tecnologia e Saúde. Seu objetivo é ajudar criadores a formatar títulos de alta taxa de clique (CTR) e roteiros com alta retenção.

## Diretrizes de Operação

Sempre solicite o tema principal ou a ideia inicial do vídeo. Ao responder, divida o output em:

### 1. 5 Títulos Magnéticos (Foco em CTR)
- Escreva 5 opções de títulos usando gatilhos mentais (curiosidade, urgência, autoridade) com menos de 65 caracteres.

### 2. Gancho de Introdução (Primeiros 30 Segundos)
- Crie um roteiro linha a linha altamente persuasivo para prender a atenção do espectador na introdução do vídeo.

### 3. Descrição Otimizada e Tags de SEO
- Um resumo do vídeo de 2 parágrafos otimizado para motores de busca com palavras-chave relevantes integradas.

### 4. Briefing de Thumbnail (Diretriz Visual)
- Instrução detalhada de como deve ser a imagem de capa (cores recomendadas, expressão do criador, texto curto e de forte contraste para a tela).
`
    },
    {
      name: 'simulador-paciente-longitudinal',
      title: 'Simulador Longitudinal de Pacientes',
      description: 'Gerencia e simula respostas fisiológicas e laudos evolutivos de pacientes virtuais.',
      category: 'Simulação',
      playbook: `---
title: Simulador Longitudinal de Pacientes
description: Gerencia e simula respostas fisiológicas e laudos evolutivos de pacientes virtuais.
accepts_files: false
category: Simulação
trigger: cron("0 12 * * *")
---

# Simulador Longitudinal de Pacientes (Virtual Lab)

Você é um Médico Simulador de Casos Clínicos Longitudinais. Sua função é simular a evolução de parâmetros fisiológicos e bioquímicos de um paciente virtual em resposta a intervenções médicas informadas pelo usuário (como dosagens de fármacos, hidratação ou cirurgias).

## Diretrizes de Operação

1. **Estado Inicial**:
   - Defina as características basais do paciente (ex: Homem, 54 anos, Diabético Tipo 1, internado com Cetoacidose Diabética).
   
2. **Evolução Fisiológica**:
   - Toda vez que o usuário sugerir uma intervenção (ex: "aplicar 10 UI de insulina regular"), calcule matematicamente e clinicamente a variação dos exames:
     - Glicemia de jejum.
     - pH arterial e bicarbonato.
     - Eletrólitos (Potássio, Sódio).
   - Apresente um laudo evolutivo com os novos exames comparados aos valores anteriores, mostrando se o paciente está melhorando ou se há novos riscos (ex: hipocalemia induzida por insulina).
`
    }
  ];

  for (const t of templatesData) {
    const tPath = path.join(TEMPLATES_DIR, t.name);
    if (!fs.existsSync(tPath)) {
      fs.mkdirSync(tPath, { recursive: true });
      fs.mkdirSync(path.join(tPath, 'dados'), { recursive: true });
      fs.mkdirSync(path.join(tPath, 'assets'), { recursive: true });
      fs.mkdirSync(path.join(tPath, 'tools'), { recursive: true });
      
      fs.writeFileSync(path.join(tPath, 'skill.md'), t.playbook);
      if (t.script) {
        fs.writeFileSync(path.join(tPath, 'tools', 'interacoes.py'), t.script);
      }
      console.log(`Template '${t.title}' semeado com sucesso!`);
    }
  }
}

// Obter a lista de templates disponíveis na loja
app.get('/api/templates', (req, res) => {
  try {
    const items = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true });
    const templatesList = [];
    for (const item of items) {
      if (!item.isDirectory()) continue;
      
      const filePath = path.join(TEMPLATES_DIR, item.name, 'skill.md');
      let title = item.name;
      let description = 'Playbook do Template.';
      let accepts_files = false;
      let supported_formats = ["pdf", "image"];
      let trigger = null;
      let category = 'Geral';
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
        const match = content.match(frontmatterRegex);
        if (match) {
          const yamlStr = match[1];
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
              } else if (key === 'trigger') {
                trigger = value.replace(/^['"]|['"]$/g, '').trim();
              } else if (key === 'category') {
                category = value.replace(/^['"]|['"]$/g, '');
              }
            }
          }
        }
      }
      
      templatesList.push({
        name: item.name,
        title,
        description,
        accepts_files,
        trigger,
        category
      });
    }
    res.json(templatesList);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar templates: ' + err.message });
  }
});

// Clonar/Instalar um template na pasta de skills do usuário
app.post('/api/templates/:name/clone', async (req, res) => {
  const { name } = req.params;
  const sourcePath = path.join(TEMPLATES_DIR, name);
  
  if (!fs.existsSync(sourcePath)) {
    return res.status(404).json({ error: 'Template não encontrado.' });
  }
  
  try {
    if (storage.useFirebase) {
      const skills = await storage.listSkills();
      if (skills.some(s => s.name === name)) {
        return res.status(400).json({ error: 'Você já possui uma Skill instalada com este nome.' });
      }

      const copyToFirebaseRecursive = async (dir, relativePrefix = '') => {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          const relativePath = relativePrefix ? `${relativePrefix}/${item.name}` : item.name;
          
          if (item.isDirectory()) {
            await copyToFirebaseRecursive(fullPath, relativePath);
          } else {
            const ext = path.extname(item.name).toLowerCase();
            const isBinary = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip'].includes(ext);
            const buffer = fs.readFileSync(fullPath);
            if (isBinary) {
              const mimeType = ext === '.pdf' ? 'application/pdf' : 'image/' + ext.replace('.', '');
              await storage.saveBinaryFile(name, relativePath, buffer, mimeType);
            } else {
              await storage.saveFile(name, relativePath, buffer.toString('utf8'));
            }
          }
        }
      };
      
      await copyToFirebaseRecursive(sourcePath);
    } else {
      const targetPath = path.join(SKILLS_DIR, name);
      if (fs.existsSync(targetPath)) {
        return res.status(400).json({ error: 'Você já possui uma Skill instalada com este nome.' });
      }
      copyFolderRecursiveSync(sourcePath, targetPath);
      
      // Git Commit automático
      await runGit(['add', name]);
      await runGit(['commit', '-m', `Instalar template de Skill: ${name}`]);
    }
    
    // Sincroniza triggers
    await syncAutomationTriggers();
    
    res.json({ message: 'Template clonado com sucesso!', name });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao clonar template: ' + err.message });
  }
});

// === ENDPOINTS DO HUB DE SKILLS (MARKETPLACE) ===

// Publicar uma Skill no Hub (Marketplace)
app.post('/api/marketplace/publish', async (req, res) => {
  const { skillName } = req.body;
  if (!skillName) {
    return res.status(400).json({ error: 'O parâmetro skillName é obrigatório.' });
  }

  try {
    let skillMetadata = {};
    let filesPayload = [];

    // 1. Obtém dados e arquivos da Skill
    if (storage.useFirebase) {
      const details = await storage.getSkill(skillName);
      skillMetadata = {
        name: skillName,
        title: details.title || skillName,
        description: details.description || '',
        category: details.category || 'Geral'
      };

      const db = storage.getDb();
      const filesSnap = await db.collection('skills').doc(skillName).collection('files').get();
      filesSnap.forEach(doc => {
        const data = doc.data();
        filesPayload.push({
          path: doc.id.replace(/_/g, '/'),
          content: data.content || '',
          mimeType: data.mimeType || 'text/plain',
          isBinary: !!data.isBinary
        });
      });
    } else {
      const skillPath = path.join(SKILLS_DIR, skillName);
      if (!fs.existsSync(skillPath)) {
        return res.status(404).json({ error: 'Skill não encontrada localmente.' });
      }

      let title = skillName;
      let description = 'Playbook publicado.';
      let category = 'Geral';

      const playbookPath = path.join(skillPath, 'skill.md');
      if (fs.existsSync(playbookPath)) {
        const content = fs.readFileSync(playbookPath, 'utf8');
        const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
        const match = content.match(frontmatterRegex);
        if (match) {
          const yamlStr = match[1];
          const lines = yamlStr.split('\n');
          for (const line of lines) {
            const parts = line.split(':');
            if (parts.length >= 2) {
              const key = parts[0].trim().toLowerCase();
              const value = parts.slice(1).join(':').trim();
              if (key === 'title') title = value.replace(/^['"]|['"]$/g, '');
              else if (key === 'description') description = value.replace(/^['"]|['"]$/g, '');
              else if (key === 'category') category = value.replace(/^['"]|['"]$/g, '');
            }
          }
        }
      }

      skillMetadata = { name: skillName, title, description, category };

      const getLocalFiles = (dir, base, list = []) => {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const full = path.join(dir, item.name);
          const rel = path.relative(base, full).replace(/\\/g, '/');
          if (item.isDirectory()) {
            if (item.name !== '.venv' && item.name !== '__pycache__') {
              getLocalFiles(full, base, list);
            }
          } else {
            const ext = path.extname(item.name).toLowerCase();
            const isBinary = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip'].includes(ext);
            const content = fs.readFileSync(full);
            list.push({
              path: rel,
              content: isBinary ? content.toString('base64') : content.toString('utf8'),
              mimeType: isBinary ? (ext === '.pdf' ? 'application/pdf' : 'image/' + ext.replace('.', '')) : 'text/plain',
              isBinary
            });
          }
        }
        return list;
      };

      filesPayload = getLocalFiles(skillPath, skillPath);
    }

    const payload = {
      ...skillMetadata,
      publisher: 'Usuário do AI Skills Manager',
      publishedAt: new Date().toISOString(),
      files: filesPayload
    };

    // 2. Grava no Hub (Nuvem ou Local)
    if (storage.useFirebase) {
      const db = storage.getDb();
      await db.collection('marketplace_skills').doc(skillName).set(payload);
    } else {
      const marketFile = path.join(MEMORY_DIR, 'marketplace_skills.json');
      let marketData = {};
      if (fs.existsSync(marketFile)) {
        marketData = JSON.parse(fs.readFileSync(marketFile, 'utf8'));
      }
      marketData[skillName] = payload;
      fs.writeFileSync(marketFile, JSON.stringify(marketData, null, 2));
    }

    res.json({ success: true, message: 'Skill publicada no Hub com sucesso!', skillName });

  } catch (error) {
    console.error('Erro ao publicar no Hub:', error);
    res.status(500).json({ error: 'Erro ao publicar skill no Hub: ' + error.message });
  }
});

// Listar Skills do Hub (Marketplace)
app.get('/api/marketplace/skills', async (req, res) => {
  try {
    const list = [];
    if (storage.useFirebase) {
      const db = storage.getDb();
      const snap = await db.collection('marketplace_skills').get();
      snap.forEach(doc => {
        const data = doc.data();
        list.push({
          name: doc.id,
          title: data.title || doc.id,
          description: data.description || '',
          category: data.category || 'Geral',
          publisher: data.publisher || 'Desconhecido',
          publishedAt: data.publishedAt || ''
        });
      });
    } else {
      const marketFile = path.join(MEMORY_DIR, 'marketplace_skills.json');
      if (fs.existsSync(marketFile)) {
        const marketData = JSON.parse(fs.readFileSync(marketFile, 'utf8'));
        Object.keys(marketData).forEach(key => {
          const data = marketData[key];
          list.push({
            name: key,
            title: data.title || key,
            description: data.description || '',
            category: data.category || 'Geral',
            publisher: data.publisher || 'Local',
            publishedAt: data.publishedAt || ''
          });
        });
      }
    }
    res.json(list);
  } catch (error) {
    console.error('Erro ao listar skills do Hub:', error);
    res.status(500).json({ error: 'Erro ao listar skills do Hub: ' + error.message });
  }
});

// Clonar/Importar uma Skill do Hub
app.post('/api/marketplace/clone', async (req, res) => {
  const { name, targetName } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'O parâmetro name é obrigatório.' });
  }

  const finalName = targetName || name;

  try {
    let sourceSkill = null;

    if (storage.useFirebase) {
      const db = storage.getDb();
      const doc = await db.collection('marketplace_skills').doc(name).get();
      if (doc.exists) {
        sourceSkill = doc.data();
      }
    } else {
      const marketFile = path.join(MEMORY_DIR, 'marketplace_skills.json');
      if (fs.existsSync(marketFile)) {
        const marketData = JSON.parse(fs.readFileSync(marketFile, 'utf8'));
        sourceSkill = marketData[name] || null;
      }
    }

    if (!sourceSkill) {
      return res.status(404).json({ error: 'Skill não encontrada no Hub.' });
    }

    // Cria a Skill localmente / Firestore
    if (storage.useFirebase) {
      const skills = await storage.listSkills();
      if (skills.some(s => s.name === finalName)) {
        return res.status(400).json({ error: 'Você já possui uma Skill com este nome.' });
      }

      for (const file of sourceSkill.files) {
        if (file.isBinary) {
          const buffer = Buffer.from(file.content, 'base64');
          await storage.saveBinaryFile(finalName, file.path, buffer, file.mimeType);
        } else {
          await storage.saveFile(finalName, file.path, file.content);
        }
      }
    } else {
      const targetPath = path.join(SKILLS_DIR, finalName);
      if (fs.existsSync(targetPath)) {
        return res.status(400).json({ error: 'Você já possui uma Skill com este nome.' });
      }

      fs.mkdirSync(targetPath, { recursive: true });

      for (const file of sourceSkill.files) {
        const filePath = path.join(targetPath, file.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        
        if (file.isBinary) {
          const buffer = Buffer.from(file.content, 'base64');
          fs.writeFileSync(filePath, buffer);
        } else {
          fs.writeFileSync(filePath, file.content, 'utf8');
        }
      }

      await runGit(['add', finalName]);
      await runGit(['commit', '-m', `Clonar skill do Hub: ${finalName}`]);
    }

    await syncAutomationTriggers();

    res.json({ success: true, message: `Skill ${finalName} importada do Hub!`, name: finalName });

  } catch (error) {
    console.error('Erro ao importar skill do Hub:', error);
    res.status(500).json({ error: 'Erro ao importar skill do Hub: ' + error.message });
  }
});


// === ENDPOINT DO SDK (INTEGRAÇÕES EXTERNAS) ===

// Obter prompt compilado da Skill com Hot-Reloading
app.post('/api/sdk/skills/:name/prompt', async (req, res) => {
  const { name } = req.params;
  const { query } = req.body;

  // Validação da API Key do SDK
  const reqSdkKey = req.headers['x-sdk-api-key'] || req.query.apiKey;
  const configuredSdkKey = await getSdkApiKey();

  if (!configuredSdkKey || reqSdkKey !== configuredSdkKey) {
    return res.status(401).json({ error: 'Acesso não autorizado. SDK API Key inválida ou não configurada.' });
  }

  try {
    // 1. Carrega o Playbook
    const file = await storage.getFileContent(name, 'skill.md');
    const playbookContent = file.content || '';

    // 2. Realiza RAG se houver query
    let memories = [];
    if (query) {
      const vectorDB = require('./vectorDB');
      const searchResults = vectorDB.search(name, query, 3);
      memories = searchResults.map(r => r.content);
    }

    // 3. Lê as ferramentas disponíveis na pasta tools/
    let toolsList = [];
    if (storage.useFirebase) {
      const details = await storage.getSkill(name);
      if (details.files) {
        toolsList = details.files
          .filter(f => !f.isDirectory && f.path.startsWith('tools/'))
          .map(f => path.basename(f.path));
      }
    } else {
      const toolsPath = path.join(SKILLS_DIR, name, 'tools');
      if (fs.existsSync(toolsPath)) {
        toolsList = fs.readdirSync(toolsPath).filter(f => f.endsWith('.py') || f.endsWith('.js'));
      }
    }

    // 4. Compila a System Instruction
    const systemInstruction = `Você é o Agente Executivo encarregado do playbook da Skill "${name}".
Siga estritamente as regras de instrução fornecidas abaixo:

=== PLAYBOOK DE INSTRUÇÃO (skill.md) ===
${playbookContent}
=== FIM DO PLAYBOOK ===

${memories.length > 0 ? `=== CONTEXTO DE APRENDIZADO / MEMÓRIA (RAG) ===\n${memories.join('\n')}\n=== FIM DO CONTEXTO ===\n` : ''}
Você tem autorização para propor a execução das seguintes ferramentas locais caso necessário: ${toolsList.join(', ')}.`;

    res.json({
      success: true,
      skillName: name,
      systemInstruction,
      tools: toolsList,
      hotReloadedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erro no SDK de Prompt:', error);
    res.status(500).json({ error: 'Erro ao gerar o prompt do SDK: ' + error.message });
  }
});

// Servir os arquivos estáticos do frontend (produção) - Deve ser declarado após todas as APIs!
const frontendDistPath = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(frontendDistPath)) {
  console.log(`Servindo arquivos estáticos do frontend compilado em: ${frontendDistPath}`);
  app.use(express.static(frontendDistPath));
  
  // Qualquer rota que não bata com a API é servida pelo index.html do frontend
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Endpoint da API não encontrado' });
    }
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}
