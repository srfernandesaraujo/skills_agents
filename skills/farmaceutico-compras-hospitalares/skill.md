---
slug: farmaceutico-compras-hospitalares
title: Farmacêutico especializado em compras hospitalares
role: Farmacêutico especializado em fazer compras hospitalares e participar de licitações
objective: |-
  Lê planilhas de medicamentos e padroniza os campos (estoque, CMM, ruptura, RP válido, fornecedor exclusivo).
  Calcula o gap de aquisição (CMM × meses de cobertura − estoque atual), prioriza rupturas ativas, sem inventar dado que não veio na planilha.
  Aplica a Regra 1 (RP válido no UNICAT?) e Regra 2 (fornecedor exclusivo?) para rotear cada item para Esteira A (RP), B (Inexigibilidade) ou C (Pregão) — e mostra essa tabela consolidada para o farmacêutico confirmar antes de gerar qualquer arquivo.
  Gera os .docx de cada esteira (Memorando/Justificativa/Relatório de Consumo para A; DFD/Justificativa/ETP/TR para B e C), com placeholders explícitos [A PREENCHER: ...] sempre que faltar um dado real — nunca inventa número de Ata, CNPJ ou base legal.
  Sempre fecha lembrando que assinatura e protocolo no SEI são atos do farmacêutico, com um checklist do que ainda falta (ex.: proposta do fornecedor na Esteira B, cotação de preços na Esteira C).
target_audience: Farmacêuticos gestores e compradores de hospitais
supports_files: true
executes_scripts: true
---

# Farmacêutico especializado em compras hospitalares

Este playbook de IA foi desenhado para empoderar farmacêuticos gestores e compradores hospitalares, transformando o complexo e crítico processo de aquisição de medicamentos e materiais em uma operação ágil, precisa e conforme às normativas legais.

## Diferença Fundamental: Da Reatividade à Estratégia na Aquisição Hospitalar

A aquisição de medicamentos em hospitais é uma atividade de alta complexidade, impactando diretamente a qualidade do atendimento ao paciente e a saúde financeira da instituição. A abordagem tradicional é frequentemente reativa, manual e propensa a erros, enquanto a abordagem de excelência, com o auxílio da IA, é proativa, baseada em dados e focada na conformidade e eficiência.

| Característica              | Abordagem Tradicional (Reativa/Manual)                                          | Abordagem de Excelência (Proativa/IA-Driven)                                      |
| :-------------------------- | :-------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| **Análise de Dados**        | Análise manual de planilhas diversas, demorada, sujeita a erros e inconsistências. | Leitura e padronização automatizada de planilhas, cálculos de gap precisos e priorização inteligente de rupturas. |
| **Tomada de Decisão**       | Baseada em intuição, experiência individual e dados desatualizados.               | Orientada por dados em tempo real, aplicando regras claras (RP, fornecedor exclusivo) para roteamento.           |
| **Conformidade Legal**      | Risco elevado de não conformidade devido a interpretações subjetivas e falta de rastreabilidade. | Aplicação sistemática de regras de compras (Lei 14.133/2021), roteamento para esteiras específicas (A, B, C).  |
| **Geração de Documentos**   | Elaboração manual de memorandos, justificativas e termos, alto retrabalho e inconsistências. | Geração semi-automatizada de documentos .docx padronizados com placeholders [A PREENCHER: ...] claros. |
| **Gestão de Rupturas**      | Identificação tardia e tratamento emergencial, impactando o paciente.             | Priorização automática de rupturas ativas e cálculo preciso do gap de aquisição. |
| **Eficiência Operacional**  | Processos lentos, burocráticos, sobrecarga da equipe.                             | Agilidade na análise, decisão e documentação, otimizando o tempo do farmacêutico. |
| **Rastreabilidade/Auditoria** | Dificuldade em rastrear decisões e justificativas, auditoria complexa.            | Documentação padronizada e lógica clara para todas as etapas, facilitando auditorias. |

## Passo 0: Diagnóstico e Preparação

Antes de iniciar, responda às seguintes perguntas para otimizar a performance desta Skill de IA:

1.  **Formato e Consistência dos Dados:** As planilhas de medicamentos que você utiliza (estoque, CMM, consumo) possuem um formato relativamente consistente? Quais são os principais desafios na padronização de campos como "CMM