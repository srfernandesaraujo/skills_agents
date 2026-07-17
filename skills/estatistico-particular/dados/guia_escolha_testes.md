# Guia de escolha de teste estatístico

Este guia orienta a escolha do teste **antes** de rodar `scripts/stats_toolkit.py`.
A lógica geral é sempre: **objetivo da pergunta → tipo de variável(is) → desenho
(pareado/independente, quantos grupos) → pressupostos (normalidade, homogeneidade
de variância) → teste paramétrico ou não paramétrico.**

Use este guia para montar o "plano de análise" que será apresentado ao usuário
de forma didática (o quê, por quê, o que o teste revela) **antes** de rodar
qualquer script.

## 1. Comparar 2 grupos em uma variável numérica

| Situação | Pressuposto atendido | Teste | Comando |
|---|---|---|---|
| Grupos independentes (ex.: tratamento vs. controle, homens vs. mulheres) | Normalidade OK (Shapiro-Wilk p≥0,05) e variâncias homogêneas (Levene p≥0,05) | Teste t de Student | `ttest_independente` |
| Grupos independentes | Normalidade OK, variâncias heterogêneas | Teste t de Welch | `ttest_independente --welch` |
| Grupos independentes | Normalidade violada, ou N pequeno (<30) e dúvida sobre normalidade, ou variável ordinal | Mann-Whitney U | `mannwhitney` |
| Mesmos indivíduos medidos 2x (antes/depois, olho D/E, etc.) | Diferenças com distribuição normal | Teste t pareado | `ttest_pareado` |
| Mesmos indivíduos medidos 2x | Diferenças não normais, ou variável ordinal | Wilcoxon (postos sinalizados) | `wilcoxon` |

**Por que checar normalidade e variância primeiro?** O teste t assume que os
dados (ou os resíduos) seguem distribuição aproximadamente normal e, na versão
clássica, que as variâncias dos grupos são parecidas. Violar isso infla o erro
tipo I/II — por isso sempre roda-se `normalidade` (Shapiro-Wilk) e, se aplicável,
`homogeneidade_variancia` (Levene) antes de decidir entre a versão paramétrica
e a não paramétrica.

## 2. Comparar 3 ou mais grupos em uma variável numérica

| Situação | Pressuposto | Teste global | Post-hoc (se global significativo) |
|---|---|---|---|
| Grupos independentes | Normalidade OK e variâncias homogêneas | ANOVA one-way (`anova_oneway`) | Tukey HSD (automático no mesmo comando) |
| Grupos independentes | Normalidade violada | Kruskal-Wallis (`kruskal`) | Dunn + Bonferroni (automático no mesmo comando) |
| Mesmos indivíduos em 3+ momentos | — | ANOVA de medidas repetidas / Friedman | **Não implementado neste toolkit** — sinalize e, se necessário, avalie alternativa (ex.: modelo misto) fora desta skill |

**Por que rodar post-hoc só se o teste global for significativo?** O teste
global (F da ANOVA, H do Kruskal-Wallis) só diz que existe *alguma* diferença
entre os grupos, não *qual* par difere. Rodar comparações pareadas sem
correção multiplica o risco de falso positivo — por isso o post-hoc já vem
com correção (Tukey já é ajustado; Dunn usa Bonferroni).

## 3. Associação entre duas variáveis categóricas

| Situação | Teste | Efeito |
|---|---|---|
| Tabela geral (RxC) | Qui-quadrado (`qui_quadrado`) | V de Cramér |
| Tabela 2x2, N pequeno ou >20% das células esperadas <5 | Teste exato de Fisher (calculado automaticamente dentro de `qui_quadrado` quando a tabela é 2x2) | Odds ratio |

O próprio comando `qui_quadrado` avisa quando a proporção de células com
frequência esperada <5 é alta — nesse caso, priorize o resultado do Fisher em
vez do qui-quadrado no relatório final.

## 4. Associação entre duas variáveis numéricas

| Situação | Teste | Comando |
|---|---|---|
| Relação linear, ambas aproximadamente normais | Correlação de Pearson (r) | `correlacao --metodo pearson` |
| Relação monotônica (não necessariamente linear), variável ordinal, outliers relevantes, ou normalidade violada | Correlação de Spearman (ρ) | `correlacao --metodo spearman` |

Correlação **não implica causalidade** — isso deve constar no relatório sempre
que uma correlação for reportada como achado relevante.

## 5. Predizer/explicar uma variável a partir de uma ou mais variáveis

| Desfecho (Y) | Modelo | Comando |
|---|---|---|
| Numérico contínuo | Regressão linear (simples se 1 preditor, múltipla se 2+) | `regressao_linear` |
| Binário (0/1) | Regressão logística | `regressao_logistica` |
| Tempo até evento (com censura) | Kaplan-Meier (descritivo) + log-rank (comparação entre grupos) | `kaplan_meier` |

Antes de reportar uma regressão múltipla, verifique multicolinearidade (VIF —
já incluído na saída de `regressao_linear`; VIF > 10 é sinal de alerta) e, se
possível, normalidade dos resíduos.

## 6. Correção para múltiplas comparações

Sempre que o mesmo desfecho for testado contra vários preditores/subgrupos
fora de um post-hoc já corrigido (ex.: 5 desfechos secundários testados
separadamente), aplique correção:
- **Bonferroni**: mais conservador, apropriado quando poucas comparações (≤10) e o custo de um falso positivo é alto.
- **FDR (Benjamini-Hochberg)**: menos conservador, mais indicado quando há muitas comparações (análises exploratórias, múltiplos desfechos secundários).

Comando: `correcao_multiplas --pvalores p1,p2,... --metodo bonferroni|fdr_bh`

## 7. Perguntas de entrevista que definem a escolha (usar antes de tudo)

1. Qual é a pergunta de pesquisa / hipótese principal?
2. O desenho é observacional (transversal, coorte, caso-controle) ou experimental (ensaio clínico/experimento)?
3. As observações são independentes entre grupos, ou os mesmos indivíduos foram medidos mais de uma vez (pareado/repetido)?
4. Qual é o tipo do desfecho principal: numérico contínuo, categórico (quantas categorias?), ou tempo até evento (há censura)?
5. Quantos grupos/braços de comparação existem?
6. Há variáveis de ajuste/confusão que devem entrar em um modelo multivariável?
7. Qual o nível de significância a adotar (padrão: α=0,05, salvo indicação em contrário do usuário)?
8. Há desfechos secundários/múltiplas comparações que vão exigir correção?

Essas respostas alimentam diretamente as seções 1–6 acima.