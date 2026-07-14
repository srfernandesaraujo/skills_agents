import sys
import json

def executar(args):
    idade = float(args.get("idade", 60))
    peso = float(args.get("peso", 70))
    creatinina = float(args.get("creatinina", 1.0))
    sexo = args.get("sexo", "masculino")

    # Fórmula de Cockcroft-Gault
    resultado = ((140 - idade) * peso) / (72 * creatinina)
    if sexo.lower() == "feminino":
        resultado *= 0.85

    # Estadiamento prático
    if resultado >= 90: estagio = "Normal ou Alto"
    elif resultado >= 60: estagio = "Levemente diminuído"
    elif resultado >= 30: estagio = "Moderadamente diminuído"
    elif resultado >= 15: estagio = "Gravemente diminuído"
    else: estagio = "Falência renal"

    return {
        "ferramenta": "Clearance de Creatinina (Cockcroft-Gault)",
        "clearance_ml_min": round(resultado, 2),
        "interpretacao": estagio,
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
        print(json.dumps({"error": "Nenhum arquivo JSON fornecido. Uso: python clearance_creatinina.py dados.json"}))