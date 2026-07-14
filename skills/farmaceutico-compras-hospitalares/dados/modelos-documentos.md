# Estrutura dos documentos por esteira

Todos os documentos são gerados em `.docx` seguindo a skill `docx` (`/mnt/skills/public/docx/SKILL.md`). Use cabeçalho institucional simples (nome do hospital/setor, se informado pelo usuário — senão deixe `[NOME DO HOSPITAL]` como placeholder), numeração de página, e fonte/formatação sóbria de documento administrativo (Times New Roman ou Calibri 11-12pt, espaçamento 1,5).

Campos entre colchetes como `[A PREENCHER: ...]` devem permanecer no documento final sempre que a informação não constar na planilha ou não tiver sido fornecida pelo usuário — nunca substitua por um valor inventado.

---

## Esteira A — Registro de Preço (RP)

### 1. Memorando
- Destinatário (setor/gestor competente) — `[A PREENCHER]` se não informado
- Assunto: solicitação de aquisição via Ata de Registro de Preço nº `[A PREENCHER]`
- Corpo: referência sucinta à necessidade de reposição de estoque, remetendo à Justificativa e à Relação de Materiais em anexo
- Fecho com identificação do farmacêutico solicitante (nome/CRF — perguntar se não vier na conversa) e data

### 2. Justificativa
- Contexto: motivo da compra (reposição programada de estoque / atendimento a ruptura ativa)
- Para cada item: nome, apresentação, quantidade solicitada (= gap calculado), CMM de referência, estoque atual no momento da solicitação
- Base para uso do RP: número da Ata, órgão gerenciador, vigência, e confirmação de que a quantidade está dentro do saldo disponível (usar o dado informado pelo usuário; se não informado, `[A PREENCHER: saldo do RP]`)

### 3. Relação de Materiais / Relatório de Consumo
- Tabela com colunas: item, apresentação, unidade, CMM, estoque atual, quantidade solicitada, valor unitário de referência (se disponível), valor total estimado
- Uma linha por item da esteira A; total geral ao final

---

## Esteira B — Inexigibilidade

### 1. DFD (Documento de Formalização de Demanda)
- Setor demandante, data, responsável
- Descrição da necessidade (item, quantidade, prazo desejado de entrega)
- Vinculação ao planejamento de contratações do hospital, se houver informação sobre isso — senão `[A PREENCHER]`

### 2. Justificativa
- Descrição do item e da necessidade clínica/operacional
- **Fundamentação da inexigibilidade**: declaração de fornecedor exclusivo — indicar a fonte dessa informação (ex.: declaração de exclusividade emitida por sindicato/federação/entidade de classe, ou pelo próprio fabricante). Se essa fonte não foi informada, deixar `[A PREENCHER: fonte da comprovação de exclusividade]` — este é um ponto de risco jurídico, não preencher com suposição.
- Referência à proposta/carta comercial do fornecedor (ver Passo 4 do SKILL.md — normalmente pendente, externo ao Claude)

### 3. ETP (Estudo Técnico Preliminar)
- Necessidade da contratação
- Requisitos da solução (especificação técnica/farmacêutica do item)
- Levantamento de mercado (aqui, resumido: por que não há alternativa de mercado — reforça a inexigibilidade)
- Estimativa de quantidade e valor (baseado na proposta do fornecedor, se já houver; senão `[A PREENCHER]`)
- Justificativa de inexigibilidade (remeter ao documento de Justificativa)

### 4. TR (Termo de Referência)
- Objeto (item e quantidade)
- Especificação técnica detalhada
- Condições de entrega e prazo
- Obrigações do fornecedor e do hospital
- Critério de aceitação/recebimento
- Vigência, se aplicável

---

## Esteira C — Pregão

Mesma composição de documentos da Esteira B (DFD, Justificativa, ETP, TR), com diferenças de conteúdo:

### Justificativa
- Não há fundamentação de exclusividade; a justificativa foca na necessidade de reposição/consumo e na adequação da modalidade pregão (bem/serviço comum, critério de julgamento por menor preço, conforme aplicável)

### ETP
- Levantamento de mercado real: incluir cotação preliminar/pesquisa de preços (banco de preços). Se o usuário forneceu valores de referência de mais de um fornecedor, monte a tabela comparativa; se não, deixar a seção como `[A PREENCHER: pesquisa de preços — pendente]` e avisar no Passo 5 do fluxo principal.
- Estimativa de valor total com base na pesquisa de preços disponível

### TR
- Mesma estrutura da Esteira B, mas com critério de julgamento explícito (ex.: menor preço por item/lote) e, se aplicável, exigência de amostra/registro Anvisa como critério de habilitação técnica

---

## Convenção de nomes de arquivo

`Esteira[A|B|C]_[TipoDocumento]_[DataAAAAMMDD].docx`

Exemplo: `EsteiraA_Memorando_20260714.docx`, `EsteiraB_TR_20260714.docx`.