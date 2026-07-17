# ⚙️ Scripts de Automação e Análise (/tools)

Esta pasta armazena os scripts Python executáveis (`.py`) que servem como ferramentas (tools) lógicas para a Skill **"Estatístico Particular"**.

## 🎯 O que colocar aqui (Recomendado para esta Skill)?
* Scripts Python de suporte clínico ou técnico, especificamente voltados para: scripts de cálculo matemático ou conectores locais de integração.

## ⚙️ Exemplo de Script Estruturado (salve como `tools/calculadora.py`):
```python
# coding: utf-8
import sys
import json

def executar(args):
    # Insira a lógica de cálculo ou automação do script
    return {"sucesso": True, "resultado": "Executado"}

if __name__ == "__main__":
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            args = json.load(f)
        resultado = executar(args)
        print(json.dumps(resultado, ensure_ascii=False))
    else:
        print(json.dumps({"error": "Nenhum argumento fornecido"}))
```

## ⚙️ Como o Agente usa essa pasta?
O motor lista todos os scripts `.py` nesta pasta. O Agente invocará o script enviando os parâmetros correspondentes no formato JSON (ex: `{"callTool": "calculadora.py", "args": {"peso": 80}}`) e processará o retorno.
