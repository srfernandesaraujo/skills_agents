import sys
import json

def executar(args):
    idade = int(args.get("idade", 65))
    sexo = args.get("sexo", "masculino")
    
    icc = int(args.get("icc", 0))
    hipertensao = int(args.get("hipertensao", 0))
    dm = int(args.get("diabetes", 0))
    avc_previo = int(args.get("avc_previo", 0)) * 2 # AVC/AIT pesa 2 pontos
    doenca_vascular = int(args.get("doenca_vascular", 0))

    pontos_idade = 2 if idade >= 75 else (1 if idade >= 65 else 0)
    pontos_sexo = 1 if sexo.lower() == "feminino" else 0

    score_total = icc + hipertensao + pontos_idade + dm + avc_previo + doenca_vascular + pontos_sexo
    
    conduta = "Anticoagulação oral recomendada" if score_total >= 2 else "Avaliar risco-benefício individual (Score baixo/intermediário)"
    
    return {
        "ferramenta": "Score CHA2DS2-VASc",
        "pontuacao_total": score_total,
        "conduta_sugerida": conduta,
        "sucesso": True
    }

if __name__ == "__main__":
    if len(sys.argv) > 1:
        try:
            with open(sys.argv[1], "r", encoding="utf-8") as f:
                args = json.load(f)
            resultado = executar(args)
            print(json.dumps(resultado, ensure_ascii=False, indent=4))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
    else:
        print(json.dumps({"error": "Nenhum arquivo JSON fornecido. Uso: python score_risco.py dados.json"}))