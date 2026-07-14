# coding: utf-8
# Script para formatar o texto final do roteiro

def formatar_roteiro(titulo, blocos):
    print(f"--- FORMATANDO TELEPROMPTER: {titulo.upper()} ---")
    for i, bloco in enumerate(blocos):
        print(f"\n[BLOCO {i+1}] {bloco['nome']}\n{bloco['texto']}")
    print("\n--- FIM DA FORMATAÇÃO ---")

if __name__ == "__main__":
    exemplo_blocos = [
        {"nome": "Gancho Inicial", "texto": "Hoje você vai ver como versionar playbooks de agentes locais com Git sem dor de cabeça!"},
        {"nome": "CTA", "texto": "Curtiu? Se inscreve no canal Posologia Tech para mais sacadas de IA!"}
    ]
    formatar_roteiro("Demo de AI Skills", exemplo_blocos)
