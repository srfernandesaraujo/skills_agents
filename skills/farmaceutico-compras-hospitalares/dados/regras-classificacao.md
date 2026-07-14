# Regras de classificação e cálculo de demanda

## Gap de aquisição

```
gap = (CMM × meses_cobertura) − estoque_atual − (pedidos_em_transito, se houver essa coluna)
```

- `CMM` = consumo médio mensal, idealmente calculado sobre os últimos 6–12 meses de histórico. Se a planilha trouxer consumo mês a mês em vez de uma média pronta, calcule a média você mesmo e mostre o cálculo (não apenas o resultado) para o farmacêutico poder auditar.
- `meses_cobertura` = padrão 3 meses. Hospitais variam (alguns usam 2, outros 4-6 para itens críticos de baixo giro/alto lead time de importação). Pergunte se não estiver explícito, especialmente para itens da classe "A" da curva ABC (ver abaixo) ou medicamentos importados/controlados, onde o lead time de compra costuma ser mais longo.
- Se `gap ≤ 0`, o item não precisa entrar no processo agora. Liste-o à parte como "sem necessidade de compra" — não omita da resposta, só não some documentos para ele.
- Itens com **ruptura ativa** (coluna de ruptura preenchida ou estoque atual = 0) entram sempre na lista de compra, mesmo que o gap calculado seja pequeno ou negativo por conta de pedido já em trânsito — a urgência clínica de uma ruptura ativa não é capturada só pela fórmula.

## Curva ABC de criticidade (não confundir com "Esteira A/B/C")

Esse é um segundo eixo de classificação, opcional, útil para priorizar a ordem de processamento e o rigor da revisão — não decide a esteira (RP/Inexigibilidade/Pregão), que segue apenas as Regras 1 e 2 do fluxo principal.

- **Classe A**: alto valor/impacto clínico ou baixo giro com risco de desabastecimento crítico (ex.: antineoplásicos, antídotos, medicamentos de terapia intensiva). Merece dupla checagem antes de fechar o roteamento.
- **Classe B**: consumo intermediário, criticidade moderada.
- **Classe C**: alto giro, baixo risco, geralmente commodities (ex.: analgésicos comuns, soros).

Se o usuário pedir para "priorizar por criticidade" ou "por curva ABC", use esse critério para ordenar a tabela consolidada — itens classe A aparecem primeiro dentro de cada esteira.

## Casos-limite do roteamento

- **RP existente mas prestes a vencer ou com saldo insuficiente para o gap calculado**: não é "RP válido = sim" simplesmente porque existe um registro — verifique (pergunte ao usuário) se o saldo/vigência cobre a quantidade necessária. Se não cobrir integralmente, sinalize como "RP parcial" e pergunte como o hospital trata isso localmente (comprar o saldo restante por outra esteira, ou aguardar novo RP) em vez de decidir sozinho.
- **Mais de um fornecedor, mas apenas um pratica o preço de referência**: isso não configura exclusividade/inexigibilidade — inexigibilidade é sobre não haver competição possível (fornecedor único do produto), não sobre preço. Se o usuário descrever essa situação, esclareça a diferença e sugira Esteira C (Pregão) com esse fornecedor participando normalmente.
- **Item novo, sem histórico de consumo (CMM = 0 ou indisponível)**: não estime CMM arbitrariamente. Peça ao farmacêutico uma estimativa (ex.: baseada em protocolo clínico novo, ou consumo de hospital similar) e registre a fonte da estimativa no documento gerado, para rastreabilidade.
- **Planilha com itens já em processo de compra aberto** (se houver coluna indicando isso): exclua esses itens da nova rodada e avise o usuário — é justamente o tipo de duplicidade que o hospital está tentando reduzir (ver métrica "taxa de duplicidade de pedidos").

## Comunicando o resultado ao farmacêutico

Sempre que apresentar a tabela consolidada, deixe explícitas as premissas usadas (meses de cobertura, se algum dado foi tratado como pendente, quais itens foram excluídos por já terem processo aberto). O objetivo é que o farmacêutico consiga auditar a decisão em poucos segundos, não que ele precise confiar cegamente no cálculo.