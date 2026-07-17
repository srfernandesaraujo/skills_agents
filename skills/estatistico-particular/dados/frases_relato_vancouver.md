# Modelos de relato — estilo Vancouver (seção de Métodos e Resultados)

Vancouver, no que diz respeito ao texto estatístico, não prescreve uma frase
fixa (isso é mais uma convenção de journals biomédicos seguindo as normas do
ICMJE) — mas exige: identificar claramente os métodos estatísticos usados,
o software (aqui: Python/SciPy), o nível de significância adotado, e reportar
sempre estatística de teste + graus de liberdade (quando aplicável) + p-valor
+ medida de efeito/IC95%, nunca só o p-valor isolado. Os modelos abaixo seguem
essa convenção e usam **numerais arábicos** e ponto decimal (padrão de artigo
em inglês) ou vírgula decimal (padrão em português) — ajuste conforme o idioma
final do artigo.

Preencha sempre os campos entre colchetes com os números exatos vindos do
JSON do script — nunca aproxime ou "arredonde de cabeça".

## Parágrafo padrão de Métodos estatísticos (adaptar aos testes realmente usados)

> "As variáveis numéricas foram testadas quanto à normalidade pelo teste de
> Shapiro-Wilk. Variáveis com distribuição normal foram comparadas por
> teste t de Student (2 grupos independentes) ou ANOVA one-way seguida de
> post-hoc de Tukey (3+ grupos independentes); variáveis sem distribuição
> normal foram comparadas por teste de Mann-Whitney (2 grupos) ou
> Kruskal-Wallis seguido de post-hoc de Dunn com correção de Bonferroni
> (3+ grupos). Comparações pareadas usaram teste t pareado ou Wilcoxon,
> conforme a normalidade das diferenças. Associações entre variáveis
> categóricas foram avaliadas por teste qui-quadrado ou teste exato de
> Fisher, conforme a frequência esperada nas células. [Incluir aqui
> regressão/sobrevida se aplicável]. Considerou-se estatisticamente
> significativo p < 0,05. As análises foram realizadas em Python (SciPy
> [versão])."

## Teste t independente

> "A [variável] foi significativamente maior/menor no grupo [X]
> (M=[média], DP=[dp]) comparado ao grupo [Y] (M=[média], DP=[dp]);
> t([gl])=[estatística_t], p=[p_valor], IC95% da diferença [ic95_min; ic95_max],
> d de Cohen=[cohen_d] ([interpretação: pequeno/médio/grande])."

Se p ≥ 0,05: substituir "foi significativamente maior/menor" por "não diferiu
significativamente".

## Teste t pareado

> "Houve redução/aumento significativo de [variável] entre os momentos
> [1] (M=[média_1]) e [2] (M=[média_2]); t([gl])=[estatística_t], p=[p_valor],
> diferença média=[diferenca_media] (IC95% [ic95_min; ic95_max]),
> d de Cohen=[cohen_d]."

## Mann-Whitney

> "A [variável] apresentou mediana significativamente maior/menor no
> grupo [X] (mediana=[mediana]) em relação ao grupo [Y] (mediana=[mediana]);
> U=[estatistica_U], p=[p_valor], r=[tamanho_efeito_r_rank_biserial]."

## Wilcoxon (pareado)

> "Observou-se diferença significativa entre os momentos [1] e [2] para
> [variável] (mediana da diferença=[mediana_diferenca]); W=[estatistica_W],
> p=[p_valor]."

## ANOVA one-way + Tukey

> "Houve diferença significativa de [variável] entre os grupos
> (F([gl_entre],[gl_dentro])=[estatistica_F], p=[p_valor], η²=[eta_quadrado]).
> O post-hoc de Tukey indicou diferença significativa entre [grupo A] e
> [grupo B] (diferença de médias=[diferenca_medias], p ajustado=[p_valor_ajustado]) [repetir para cada par significativo]."

## Kruskal-Wallis + Dunn

> "Houve diferença significativa na distribuição de [variável] entre os
> grupos (H([gl])=[estatistica_H], p=[p_valor]). O post-hoc de Dunn com
> correção de Bonferroni indicou diferença significativa entre [grupo A]
> e [grupo B] (p ajustado=[p_valor_ajustado_bonferroni]) [repetir para cada par significativo]."

## Qui-quadrado / Fisher

> "Observou-se associação significativa entre [variável 1] e [variável 2]
> (χ²([gl], N=[n_total])=[estatistica], p=[p_valor], V de Cramér=[v_cramer])."

Para 2x2 com Fisher:
> "[Variável 1] esteve associada a [variável 2] (teste exato de Fisher,
> p=[p_valor]; odds ratio=[odds_ratio])."

## Correlação (Pearson/Spearman)

> "[Variável 1] e [variável 2] apresentaram correlação [força: fraca/moderada/forte]
> e [positiva/negativa] (r=[coeficiente_r] [ou ρ, se Spearman], IC95% [ic95_min; ic95_max],
> p=[p_valor], n=[n])."

## Regressão linear

> "O modelo de regressão linear múltipla explicou [r_quadrado_ajustado×100]% da
> variância de [Y] (R² ajustado=[r_quadrado_ajustado], F([gl_modelo],[gl_residual])=[estatistica_F],
> p=[p_valor_modelo_global]). [Variável X] foi preditor(a) independente e significativo(a)
> de [Y] (β=[coeficiente_beta], IC95% [ic95_min; ic95_max], p=[p_valor]) [repetir por variável significativa]."

## Regressão logística

> "[Variável X] associou-se de forma independente com [desfecho Y=1]
> (OR=[razao_de_chances_OR], IC95% [ic95_OR_min; ic95_OR_max], p=[p_valor])
> [repetir por variável significativa]. O modelo apresentou pseudo-R² de
> McFadden de [pseudo_r2_mcfadden]."

## Kaplan-Meier + log-rank

> "A sobrevida mediana foi de [mediana_sobrevida] [unidade de tempo] no
> grupo [X] e [mediana_sobrevida] [unidade] no grupo [Y], sem diferença
> estatisticamente significativa entre as curvas (log-rank χ²([gl])=[estatistica_qui_quadrado],
> p=[p_valor])."

Se significativo, trocar "sem diferença... entre as curvas" por "com diferença
estatisticamente significativa entre as curvas".

## Regra geral de honestidade estatística

- Nunca reportar "tendência à significância" para p entre 0,05 e 0,10 como se
  fosse achado positivo — reportar o valor exato e deixar a interpretação
  explícita ("não atingiu significância estatística ao nível de 5%").
- Sempre reportar o tamanho de efeito junto ao p-valor — p-valor sozinho não
  diz nada sobre magnitude/relevância prática.
- Se um pressuposto foi violado e mesmo assim se optou pelo teste paramétrico
  (por robustez com N grande, por exemplo), declarar isso explicitamente no
  texto de Métodos.