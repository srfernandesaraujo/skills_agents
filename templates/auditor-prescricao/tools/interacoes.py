import sys
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
