import sys
import json

def executar(args):
    peso = float(args.get("peso", 70))
    # Exemplo: dose em mg/kg (ex: Vancomicina, ou antineoplásicos se ajustado para ASC)
    dose_mg_kg = float(args.get("dose_mg_kg", 15)) 
    
    dose_total = peso * dose_mg_kg
    
    return {
        "ferramenta": "Dosagem Baseada em Peso",
        "dose_recomendada_mg": round(dose_total, 2),
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
        print(json.dumps({"error": "Nenhum arquivo JSON fornecido. Uso: python dosagem_farmaceutica.py dados.json"}))