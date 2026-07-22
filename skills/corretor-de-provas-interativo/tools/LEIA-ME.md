# ⚙️ Scripts de Automação e Análise (/tools)

Esta pasta armazena os scripts Python executáveis (`.py`) que servem como ferramentas (tools) lógicas para a Skill **"Professor corretor de provas"**.

## 🎯 O que há aqui
* `consolidar_notas.py` — recebe o JSON com as notas já julgadas questão por questão pela IA ao longo da conversa (Etapas 1-5 da skill) e gera uma planilha `.xlsx` com três abas: **Notas** (aluno × questão, total, % e status indicativo), **Análise de Itens** (dificuldade e índice de discriminação por questão) e **Resumo da Turma** (média, mediana, desvio padrão e gráfico de distribuição). Nunca julga ou reavalia uma resposta — só soma e organiza o que já foi decidido no chat.

## ⚙️ Como o Agente usa essa pasta?
O motor lista todos os scripts `.py` nesta pasta. O Agente invoca o script na Etapa 6 do fluxo enviando o caminho do JSON de entrada e do `.xlsx` de saída (ex: `{"callTool": "consolidar_notas.py", "args": {"entrada": "dados/notas.json", "saida": "dados/planilha_final.xlsx"}}`) e processa o retorno. Rode `python consolidar_notas.py --help` para conferir os parâmetros exatos, e veja o cabeçalho do próprio script para o formato exato do JSON esperado.

## 📦 Dependências
Instale com `pip install -r requirements.txt` (apenas `openpyxl`).
