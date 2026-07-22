# Fórmulas e parâmetros de referência

> Fonte de verdade numérica da skill `auditor-prescricoes-antineoplasicas`. Os valores abaixo refletem consensos amplamente citados na literatura oncológica, mas **protocolos institucionais podem variar** — sinalize isso no relatório sempre que houver divergência relevante, e trate estes números como ponto de partida para a triagem, não como norma legal.

## 1. Área de Superfície Corporal (ASC / BSA)

**Mosteller (padrão desta skill):**
```
ASC (m²) = √( (altura_cm × peso_kg) / 3600 )
```

**DuBois & DuBois:**
```
ASC (m²) = 0.007184 × altura_cm^0.725 × peso_kg^0.425
```

**Gehan & George:**
```
ASC (m²) = 0.0235 × altura_cm^0.42246 × peso_kg^0.51456
```

As três fórmulas geram valores próximos (tipicamente <3-4% de diferença); Mosteller é a mais usada operacionalmente por sua simplicidade e boa concordância nos extremos de peso. Alguns serviços fazem "capping" de ASC em ~2,0-2,2 m² para pacientes com sobrepeso significativo, por política institucional — pergunte ou sinalize se a prescrição parecer usar um teto de ASC.

## 2. Clearance de creatinina (Cockcroft-Gault) — necessário para Calvert

```
ClCr (mL/min) = [(140 − idade) × peso_kg × (0.85 se sexo feminino)] / (72 × creatinina_sérica_mg/dL)
```

Em oncologia, a TFG usada na fórmula de Calvert costuma ser **limitada a um teto de 125 mL/min**, mesmo que o ClCr calculado seja maior, para evitar subdosagem por superestimação da função renal. Sinalize se a prescrição parecer não aplicar esse teto quando o ClCr calculado ultrapassa 125.

## 3. Fórmula de Calvert (Carboplatina)

```
Dose (mg) = AUC_alvo × (TFG_estimada + 25)
```

- AUC alvo típica: 4-7 (varia por indicação/combinação, sempre confirmar com o protocolo citado na prescrição).
- Nunca calcule a dose de carboplatina por mg/m² — isso é um erro comum e grave de prescrição. Se a prescrição expressar carboplatina em mg/m² em vez de AUC, isso por si só é um alerta crítico a reportar.

## 4. Limites de dose cumulativa de antraciclinas (cardiotoxicidade)

Limites vitalícios cumulativos amplamente citados (variam por diretriz/instituição — tratar como referência de alerta, não como corte absoluto):

| Fármaco | Limite cumulativo usual |
|---|---|
| Doxorrubicina | ~450-550 mg/m² |
| Epirrubicina | ~900-1000 mg/m² |
| Daunorrubicina | ~550-800 mg/m² (menor se radioterapia mediastinal prévia) |
| Idarrubicina | ~150 mg/m² |
| Mitoxantrona | ~140-160 mg/m² |

**Fatores de equivalência de cardiotoxicidade (aproximados, para somar diferentes antraciclinas na mesma "conta" cumulativa):** referência: doxorrubicina = 1.
- Epirrubicina ≈ 0.5-0.6 × dose equivalente de doxorrubicina
- Daunorrubicina ≈ 0.5 × dose equivalente de doxorrubicina
- Idarrubicina ≈ 3 × dose equivalente de doxorrubicina (mais cardiotóxica por mg)
- Mitoxantrona ≈ 4-5 × dose equivalente de doxorrubicina

Fatores de risco que reduzem o limite seguro: radioterapia torácica/mediastinal prévia, cardiopatia preexistente, uso concomitante de trastuzumabe ou outros agentes cardiotóxicos, idade avançada, uso pediátrico. Se algum desses fatores for mencionado na prescrição ou pelo usuário, sinalize que o limite "padrão" pode não se aplicar e recomenda avaliação cardiológica/farmacêutica dedicada.

## 5. Tempos e cuidados de infusão usuais (agentes comuns)

| Fármaco | Tempo de infusão usual | Observações |
|---|---|---|
| Paclitaxel | 1h (esquema semanal) ou 3h (esquema trissemanal clássico) | Requer pré-medicação (corticoide, anti-histamínico) por risco de hipersensibilidade; infusão rápida demais é um alerta crítico |
| Docetaxel | ~1h | Requer pré-medicação com corticoide |
| Doxorrubicina (bolus/curta) | Push lento (poucos minutos) em acesso venoso central funcionante, ou infusão curta conforme protocolo | Vesicante — extravasamento é emergência; checar se via/acesso está explicitado |
| Vincristina | Push IV rápido, NUNCA intratecal | Erro de via (intratecal) é fatal e um dos erros mais documentados em quimioterapia — sempre checar a via com atenção máxima |
| Oxaliplatina | ~2h | Evitar exposição ao frio durante e após infusão (neurotoxicidade) |
| 5-Fluorouracila (infusional) | Bolus + infusão contínua (ex.: 46h em FOLFOX/FOLFIRI) conforme protocolo | Checar se o tempo bate com o protocolo citado |
| Ciclofosfamida | 30min-1h (dose padrão) | Hidratação adequada esperada em doses altas |
| Carboplatina | ~30min-1h | — |
| Rituximabe (1ª infusão) | Início lento com escalonamento de velocidade | Infusões subsequentes podem ser mais rápidas conforme tolerância prévia documentada |

Regra geral de ordem: agentes que exigem pré-medicação (taxanos, rituximabe) geralmente entram após a pré-medicação ter feito efeito; quando há vesicante e não-vesicante no mesmo ciclo, a ordem e o tipo de acesso importam — sinalize qualquer prescrição que não deixe isso explícito.

## 6. Doses-teto absolutas conhecidas

| Fármaco | Teto usual |
|---|---|
| Vincristina | Frequentemente limitada a um teto absoluto (comumente citado como 2 mg/dose) independentemente da ASC calculada, em muitas instituições — checar se a prescrição respeita isso quando ASC × dose/m² ultrapassaria o teto |

Este item também serve como lembrete geral: sempre que a dose calculada por ASC/peso ultrapassar valores usados na prática clínica corrente para aquele fármaco, tratar como alerta mesmo que a conta matemática "bata" com o protocolo informado — o teto absoluto existe justamente para pacientes com ASC atípica.