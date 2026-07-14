import sys
import json

def executar(args):
    # O JSON deve conter uma lista de dicionários chamada "exames"
    # Exemplo: [{"nome": "Glicemia", "valor": 120, "limite_inferior": 70, "limite_superior": 99}]
    exames = args.get("exames", [])
    alertas = []
    
    for exame in exames:
        nome = exame.get("nome", "Exame Desconhecido")
        valor = float(exame.get("valor", 0))
        limite_sup = float(exame.get("limite_superior", float('inf')))
        limite_inf = float(exame.get("limite_inferior", float('-inf')))
        
        if valor > limite_sup:
            alertas.append({
                "exame": nome,
                "status": "Elevado",
                "valor_atual": valor,
                "limite_esperado": f"Até {limite_sup}"
            })
        elif valor < limite_inf:
            alertas.append({
                "exame": nome,
                "status": "Reduzido",
                "valor_atual": valor,
                "limite_esperado": f"Mínimo de {limite_inf}"
            })

    return {
        "ferramenta": "Integrador e Alerta de Exames Clínicos",
        "total_exames_analisados": len(exames),
        "exames_alterados": len(alertas),
        "detalhes_alertas": alertas,
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
        print(json.dumps({"error": "Nenhum arquivo JSON fornecido. Uso: python integrador_exames.py dados.json"}))