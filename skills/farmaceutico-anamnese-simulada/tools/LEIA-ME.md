# ⚙️ Scripts de Automação e Análise (/tools)

Esta pasta armazena os scripts Python executáveis (`.py`) que servem como ferramentas (tools) lógicas para a Skill **"Farmacêutico especialista em anamnese"**.

## 🎯 O que colocar aqui (Recomendado para esta Skill)?
* Scripts Python de suporte clínico ou técnico, especificamente voltados para: scripts de cálculo de dosagem farmacêutica, calculadoras de clearance de creatinina, scores de risco ou integradores de exames clínicos.

## ⚙️ Exemplo de Script Estruturado (salve como `tools/calculadora.py`):
```python
# coding: utf-8
import sys
import json

def executar(args):
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
    }

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
