#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stats_toolkit.py — Motor estatístico determinístico para a skill "estatístico-particular".

Todo cálculo estatístico usado na skill DEVE passar por este script (via linha de
comando). Ele nunca deve ser reescrito "de cabeça" pelo modelo — o objetivo é
eliminar erro de aritmética/fórmula em números que vão para um artigo.

Uso geral:
    python3 stats_toolkit.py <comando> --input dados.csv [--sheet Planilha1] [outros args]

Sempre retorna um JSON único no stdout. Em caso de erro, retorna
{"erro": "mensagem"} e sai com código 1.

Comandos disponíveis (rode --help em cada um):
    explorar, descritivas, normalidade, homogeneidade_variancia,
    ttest_independente, ttest_pareado, mannwhitney, wilcoxon,
    anova_oneway, kruskal, qui_quadrado, correlacao,
    regressao_linear, regressao_logistica,
    kaplan_meier, correcao_multiplas
"""

import os
import sys
import json
import argparse
import numpy as np
import pandas as pd
from scipy import stats


# --------------------------------------------------------------------------- #
# Utilitários gerais
# --------------------------------------------------------------------------- #

def carregar_dados(path, sheet=None):
    if not os.path.exists(path):
        filename = os.path.basename(path)
        candidatos = [
            os.path.join("dados", filename),
            os.path.join("dados", path),
            filename
        ]
        for c in candidatos:
            if os.path.exists(c):
                path = c
                break

    if path.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(path, sheet_name=sheet if sheet else 0)
    elif path.lower().endswith(".csv"):
        # tenta detectar separador automaticamente (vírgula ou ponto-e-vírgula, comum em BR)
        try:
            return pd.read_csv(path, sep=None, engine="python")
        except Exception:
            return pd.read_csv(path)
    elif path.lower().endswith(".tsv"):
        return pd.read_csv(path, sep="\t")
    else:
        raise ValueError(f"Extensão de arquivo não suportada: {path}")


def limpar_numerico(serie):
    """Converte para numérico e remove NaN, preservando contagem de removidos."""
    s = pd.to_numeric(serie, errors="coerce")
    n_total = len(s)
    n_validos = s.notna().sum()
    return s.dropna().to_numpy(dtype=float), n_total, int(n_validos)


def arredondar(obj, casas=4):
    """Arredonda recursivamente floats dentro de estruturas (dict/list) para saída limpa."""
    if isinstance(obj, dict):
        return {k: arredondar(v, casas) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [arredondar(v, casas) for v in obj]
    if isinstance(obj, (np.floating, float)):
        if np.isnan(obj):
            return None
        if np.isinf(obj):
            return "inf" if obj > 0 else "-inf"
        return round(float(obj), casas)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    return obj


def interpretar_p(p, alpha=0.05):
    if p is None or (isinstance(p, float) and np.isnan(p)):
        return "não calculável"
    return "estatisticamente significativo" if p < alpha else "não estatisticamente significativo"


def saida(dados):
    print(json.dumps(arredondar(dados), ensure_ascii=False, indent=2))


def erro(msg):
    print(json.dumps({"erro": msg}, ensure_ascii=False, indent=2))
    sys.exit(1)


# --------------------------------------------------------------------------- #
# Effect sizes auxiliares
# --------------------------------------------------------------------------- #

def cohen_d_independente(a, b):
    na, nb = len(a), len(b)
    var_pooled = (((na - 1) * np.var(a, ddof=1)) + ((nb - 1) * np.var(b, ddof=1))) / (na + nb - 2)
    return (np.mean(a) - np.mean(b)) / np.sqrt(var_pooled)


def cohen_d_pareado(a, b):
    dif = a - b
    return np.mean(dif) / np.std(dif, ddof=1)


def hedges_g(d, n1, n2):
    """Correção de Hedges para amostras pequenas."""
    gl = n1 + n2 - 2
    fator = 1 - (3 / (4 * gl - 1)) if gl > 1 else 1
    return d * fator


def eta_quadrado_anova(grupos):
    todos = np.concatenate(grupos)
    grand_mean = np.mean(todos)
    ss_between = sum(len(g) * (np.mean(g) - grand_mean) ** 2 for g in grupos)
    ss_total = sum((todos - grand_mean) ** 2)
    return ss_between / ss_total if ss_total > 0 else np.nan


def cramer_v(chi2, n, r, c):
    k = min(r - 1, c - 1)
    if k <= 0 or n <= 0:
        return np.nan
    return np.sqrt(chi2 / (n * k))


def rank_biserial_mannwhitney(u, n1, n2):
    """Correlação rank-biserial (effect size para Mann-Whitney), r = 1 - 2U/(n1*n2)."""
    return 1 - (2 * u) / (n1 * n2)


# --------------------------------------------------------------------------- #
# Comando: explorar
# --------------------------------------------------------------------------- #

def cmd_explorar(args):
    df = carregar_dados(args.input, args.sheet)
    resultado = {
        "n_linhas": int(df.shape[0]),
        "n_colunas": int(df.shape[1]),
        "colunas": []
    }
    for col in df.columns:
        s = df[col]
        info = {
            "nome": str(col),
            "tipo_pandas": str(s.dtype),
            "n_ausentes": int(s.isna().sum()),
            "n_validos": int(s.notna().sum()),
            "n_unicos": int(s.nunique(dropna=True)),
        }
        s_num = pd.to_numeric(s, errors="coerce")
        proporcao_numerica = s_num.notna().sum() / max(s.notna().sum(), 1)
        if proporcao_numerica > 0.9 and s.notna().sum() > 0:
            info["provavel_tipo"] = "numérica"
            valid = s_num.dropna()
            if len(valid) > 0:
                info["min"] = float(valid.min())
                info["max"] = float(valid.max())
                info["media"] = float(valid.mean())
        else:
            info["provavel_tipo"] = "categórica"
            contagens = s.value_counts(dropna=True).head(10)
            info["categorias_frequentes"] = {str(k): int(v) for k, v in contagens.items()}
        resultado["colunas"].append(info)
    saida(resultado)


# --------------------------------------------------------------------------- #
# Comando: descritivas
# --------------------------------------------------------------------------- #

def cmd_descritivas(args):
    df = carregar_dados(args.input, args.sheet)
    variaveis = [v.strip() for v in args.vars.split(",")]
    resultado = {"variaveis": {}}

    grupos_df = None
    if args.group:
        if args.group not in df.columns:
            erro(f"Coluna de grupo '{args.group}' não encontrada.")
        grupos_df = df.groupby(args.group)

    for var in variaveis:
        if var not in df.columns:
            erro(f"Variável '{var}' não encontrada nas colunas da planilha.")

        def resumo(vetor):
            vetor = np.asarray(vetor, dtype=float)
            vetor = vetor[~np.isnan(vetor)]
            n = len(vetor)
            if n == 0:
                return {"n": 0}
            q1, med, q3 = np.percentile(vetor, [25, 50, 75])
            sem = stats.sem(vetor) if n > 1 else np.nan
            ic95 = stats.t.interval(0.95, n - 1, loc=np.mean(vetor), scale=sem) if n > 1 else (np.nan, np.nan)
            return {
                "n": n,
                "media": float(np.mean(vetor)),
                "desvio_padrao": float(np.std(vetor, ddof=1)) if n > 1 else None,
                "erro_padrao": float(sem) if n > 1 else None,
                "ic95_media": [float(ic95[0]), float(ic95[1])] if n > 1 else None,
                "mediana": float(med),
                "q1": float(q1),
                "q3": float(q3),
                "min": float(np.min(vetor)),
                "max": float(np.max(vetor)),
                "cv_percent": float(100 * np.std(vetor, ddof=1) / np.mean(vetor)) if n > 1 and np.mean(vetor) != 0 else None,
            }

        if grupos_df is not None:
            por_grupo = {}
            for nome_grupo, sub in grupos_df:
                vetor, _, _ = limpar_numerico(sub[var])
                por_grupo[str(nome_grupo)] = resumo(vetor)
            resultado["variaveis"][var] = {"por_grupo": por_grupo}
        else:
            vetor, n_total, n_validos = limpar_numerico(df[var])
            resultado["variaveis"][var] = resumo(vetor)
            resultado["variaveis"][var]["n_ausentes"] = n_total - n_validos

    saida(resultado)


# --------------------------------------------------------------------------- #
# Comando: normalidade
# --------------------------------------------------------------------------- #

def cmd_normalidade(args):
    df = carregar_dados(args.input, args.sheet)
    variaveis = [v.strip() for v in args.vars.split(",")]
    resultado = {"alpha": args.alpha, "variaveis": {}}

    grupos_df = None
    if args.group:
        if args.group not in df.columns:
            erro(f"Coluna de grupo '{args.group}' não encontrada.")
        grupos_df = df.groupby(args.group)

    def testar(vetor):
        n = len(vetor)
        if n < 3:
            return {"n": n, "aviso": "N insuficiente (<3) para teste de normalidade"}
        if n > 5000:
            stat, p = stats.kstest((vetor - np.mean(vetor)) / np.std(vetor, ddof=1), "norm")
            teste = "Kolmogorov-Smirnov (N>5000, Shapiro-Wilk não recomendado)"
        else:
            stat, p = stats.shapiro(vetor)
            teste = "Shapiro-Wilk"
        skew = float(stats.skew(vetor))
        kurt = float(stats.kurtosis(vetor))
        return {
            "n": n,
            "teste": teste,
            "estatistica": float(stat),
            "p_valor": float(p),
            "distribuicao_normal": bool(p >= args.alpha),
            "interpretacao": (
                f"Não há evidência para rejeitar normalidade (p={p:.4f} ≥ {args.alpha}) — "
                "compatível com distribuição normal."
                if p >= args.alpha else
                f"Rejeita-se a hipótese de normalidade (p={p:.4f} < {args.alpha}) — "
                "considerar teste não paramétrico ou transformação de dados."
            ),
            "assimetria_skewness": skew,
            "curtose_excesso": kurt,
        }

    for var in variaveis:
        if var not in df.columns:
            erro(f"Variável '{var}' não encontrada.")
        if grupos_df is not None:
            por_grupo = {}
            for nome_grupo, sub in grupos_df:
                vetor, _, _ = limpar_numerico(sub[var])
                por_grupo[str(nome_grupo)] = testar(vetor)
            resultado["variaveis"][var] = {"por_grupo": por_grupo}
        else:
            vetor, _, _ = limpar_numerico(df[var])
            resultado["variaveis"][var] = testar(vetor)

    saida(resultado)


# --------------------------------------------------------------------------- #
# Comando: ttest_independente
# --------------------------------------------------------------------------- #

def cmd_ttest_independente(args):
    df = carregar_dados(args.input, args.sheet)
    if args.var not in df.columns or args.group not in df.columns:
        erro("Variável ou coluna de grupo não encontrada.")

    niveis = df[args.group].dropna().unique().tolist()
    if len(niveis) != 2:
        erro(f"A coluna de grupo precisa ter exatamente 2 níveis. Encontrados: {niveis}")

    a, _, _ = limpar_numerico(df.loc[df[args.group] == niveis[0], args.var])
    b, _, _ = limpar_numerico(df.loc[df[args.group] == niveis[1], args.var])

    if len(a) < 2 or len(b) < 2:
        erro("Cada grupo precisa de pelo menos 2 observações válidas.")

    welch = args.welch
    stat, p = stats.ttest_ind(a, b, equal_var=not welch)
    d = cohen_d_independente(a, b)
    g = hedges_g(d, len(a), len(b))

    diff_medias = float(np.mean(a) - np.mean(b))
    se_diff = np.sqrt(np.var(a, ddof=1) / len(a) + np.var(b, ddof=1) / len(b))
    gl = (len(a) + len(b) - 2) if not welch else (
        (np.var(a, ddof=1) / len(a) + np.var(b, ddof=1) / len(b)) ** 2 /
        ((np.var(a, ddof=1) / len(a)) ** 2 / (len(a) - 1) + (np.var(b, ddof=1) / len(b)) ** 2 / (len(b) - 1))
    )
    tcrit = stats.t.ppf(0.975, gl)
    ic95 = [diff_medias - tcrit * se_diff, diff_medias + tcrit * se_diff]

    resultado = {
        "teste": "Teste t de Welch (variâncias desiguais)" if welch else "Teste t de Student (variâncias iguais)",
        "grupo_1": {"nome": str(niveis[0]), "n": len(a), "media": float(np.mean(a)), "dp": float(np.std(a, ddof=1))},
        "grupo_2": {"nome": str(niveis[1]), "n": len(b), "media": float(np.mean(b)), "dp": float(np.std(b, ddof=1))},
        "diferenca_medias": diff_medias,
        "ic95_diferenca": ic95,
        "graus_liberdade": float(gl),
        "estatistica_t": float(stat),
        "p_valor": float(p),
        "significativo_5pct": interpretar_p(p, 0.05),
        "tamanho_efeito_cohen_d": float(d),
        "tamanho_efeito_hedges_g": float(g),
        "interpretacao_efeito": interpretar_cohen_d(abs(g)),
    }
    saida(resultado)


def interpretar_cohen_d(d_abs):
    if d_abs < 0.2:
        return "efeito muito pequeno/negligível"
    elif d_abs < 0.5:
        return "efeito pequeno"
    elif d_abs < 0.8:
        return "efeito médio"
    else:
        return "efeito grande"


# --------------------------------------------------------------------------- #
# Comando: ttest_pareado
# --------------------------------------------------------------------------- #

def cmd_ttest_pareado(args):
    df = carregar_dados(args.input, args.sheet)
    for v in (args.var1, args.var2):
        if v not in df.columns:
            erro(f"Variável '{v}' não encontrada.")

    sub = df[[args.var1, args.var2]].apply(pd.to_numeric, errors="coerce").dropna()
    a = sub[args.var1].to_numpy(dtype=float)
    b = sub[args.var2].to_numpy(dtype=float)
    n = len(a)
    if n < 2:
        erro("São necessários pelo menos 2 pares completos de observações.")

    stat, p = stats.ttest_rel(a, b)
    dif = a - b
    d = cohen_d_pareado(a, b)
    se_dif = stats.sem(dif)
    tcrit = stats.t.ppf(0.975, n - 1)
    ic95 = [float(np.mean(dif) - tcrit * se_dif), float(np.mean(dif) + tcrit * se_dif)]

    resultado = {
        "teste": "Teste t pareado (amostras dependentes)",
        "n_pares": n,
        "media_1": float(np.mean(a)),
        "media_2": float(np.mean(b)),
        "diferenca_media": float(np.mean(dif)),
        "ic95_diferenca": ic95,
        "graus_liberdade": n - 1,
        "estatistica_t": float(stat),
        "p_valor": float(p),
        "significativo_5pct": interpretar_p(p, 0.05),
        "tamanho_efeito_cohen_d": float(d),
        "interpretacao_efeito": interpretar_cohen_d(abs(d)),
    }
    saida(resultado)


# --------------------------------------------------------------------------- #
# Comando: mannwhitney
# --------------------------------------------------------------------------- #

def cmd_mannwhitney(args):
    df = carregar_dados(args.input, args.sheet)
    if args.var not in df.columns or args.group not in df.columns:
        erro("Variável ou coluna de grupo não encontrada.")

    niveis = df[args.group].dropna().unique().tolist()
    if len(niveis) != 2:
        erro(f"A coluna de grupo precisa ter exatamente 2 níveis. Encontrados: {niveis}")

    a, _, _ = limpar_numerico(df.loc[df[args.group] == niveis[0], args.var])
    b, _, _ = limpar_numerico(df.loc[df[args.group] == niveis[1], args.var])
    if len(a) < 1 or len(b) < 1:
        erro("Cada grupo precisa de pelo menos 1 observação válida.")

    stat, p = stats.mannwhitneyu(a, b, alternative="two-sided")
    r_rb = rank_biserial_mannwhitney(stat, len(a), len(b))

    resultado = {
        "teste": "Mann-Whitney U (Wilcoxon rank-sum) — alternativa não paramétrica ao teste t independente",
        "grupo_1": {"nome": str(niveis[0]), "n": len(a), "mediana": float(np.median(a))},
        "grupo_2": {"nome": str(niveis[1]), "n": len(b), "mediana": float(np.median(b))},
        "estatistica_U": float(stat),
        "p_valor": float(p),
        "significativo_5pct": interpretar_p(p, 0.05),
        "tamanho_efeito_r_rank_biserial": float(r_rb),
    }
    saida(resultado)


# --------------------------------------------------------------------------- #
# Comando: wilcoxon (pareado / postos sinalizados)
# --------------------------------------------------------------------------- #

def cmd_wilcoxon(args):
    df = carregar_dados(args.input, args.sheet)
    for v in (args.var1, args.var2):
        if v not in df.columns:
            erro(f"Variável '{v}' não encontrada.")

    sub = df[[args.var1, args.var2]].apply(pd.to_numeric, errors="coerce").dropna()
    a = sub[args.var1].to_numpy(dtype=float)
    b = sub[args.var2].to_numpy(dtype=float)
    n = len(a)
    if n < 1:
        erro("São necessários pares completos de observações.")

    stat, p = stats.wilcoxon(a, b)
    dif = a - b
    n_efetivo = int(np.sum(dif != 0))

    resultado = {
        "teste": "Wilcoxon de postos sinalizados — alternativa não paramétrica ao teste t pareado",
        "n_pares": n,
        "n_pares_com_diferenca_nao_nula": n_efetivo,
        "mediana_1": float(np.median(a)),
        "mediana_2": float(np.median(b)),
        "mediana_diferenca": float(np.median(dif)),
        "estatistica_W": float(stat),
        "p_valor": float(p),
        "significativo_5pct": interpretar_p(p, 0.05),
    }
    saida(resultado)


# --------------------------------------------------------------------------- #
# Comando: anova_oneway (com post-hoc Tukey HSD)
# --------------------------------------------------------------------------- #

def cmd_anova_oneway(args):
    df = carregar_dados(args.input, args.sheet)
    if args.var not in df.columns or args.group not in df.columns:
        erro("Variável ou coluna de grupo não encontrada.")

    grupos, nomes = [], []
    for nome_grupo, sub in df.groupby(args.group):
        vetor, _, _ = limpar_numerico(sub[args.var])
        if len(vetor) > 0:
            grupos.append(vetor)
            nomes.append(str(nome_grupo))

    if len(grupos) < 3:
        erro("ANOVA one-way requer pelo menos 3 grupos. Para 2 grupos, use ttest_independente.")

    stat, p = stats.f_oneway(*grupos)
    eta2 = eta_quadrado_anova(grupos)
    gl_entre = len(grupos) - 1
    n_total = sum(len(g) for g in grupos)
    gl_dentro = n_total - len(grupos)

    resultado = {
        "teste": "ANOVA one-way (paramétrica, 3+ grupos independentes)",
        "grupos": [{"nome": n, "n": len(g), "media": float(np.mean(g)), "dp": float(np.std(g, ddof=1))}
                   for n, g in zip(nomes, grupos)],
        "graus_liberdade_entre": gl_entre,
        "graus_liberdade_dentro": gl_dentro,
        "estatistica_F": float(stat),
        "p_valor": float(p),
        "significativo_5pct": interpretar_p(p, 0.05),
        "tamanho_efeito_eta_quadrado": float(eta2),
        "interpretacao_efeito": interpretar_eta2(eta2),
    }

    if p < args.alpha:
        tukey = stats.tukey_hsd(*grupos)
        comparacoes = []
        for i in range(len(grupos)):
            for j in range(i + 1, len(grupos)):
                comparacoes.append({
                    "grupo_a": nomes[i],
                    "grupo_b": nomes[j],
                    "diferenca_medias": float(np.mean(grupos[i]) - np.mean(grupos[j])),
                    "p_valor_ajustado": float(tukey.pvalue[i, j]),
                    "significativo_5pct": interpretar_p(float(tukey.pvalue[i, j]), 0.05),
                })
        resultado["posthoc_tukey_hsd"] = {
            "aviso": "Post-hoc calculado pois a ANOVA global foi significativa.",
            "comparacoes_pareadas": comparacoes,
        }
    else:
        resultado["posthoc_tukey_hsd"] = "Não calculado — ANOVA global não significativa (não há diferença global a ser localizada)."

    saida(resultado)


def interpretar_eta2(eta2):
    if eta2 < 0.01:
        return "efeito muito pequeno/negligível"
    elif eta2 < 0.06:
        return "efeito pequeno"
    elif eta2 < 0.14:
        return "efeito médio"
    else:
        return "efeito grande"


# --------------------------------------------------------------------------- #
# Comando: kruskal (com post-hoc de Dunn, correção de Bonferroni)
# --------------------------------------------------------------------------- #

def cmd_kruskal(args):
    df = carregar_dados(args.input, args.sheet)
    if args.var not in df.columns or args.group not in df.columns:
        erro("Variável ou coluna de grupo não encontrada.")

    grupos, nomes = [], []
    for nome_grupo, sub in df.groupby(args.group):
        vetor, _, _ = limpar_numerico(sub[args.var])
        if len(vetor) > 0:
            grupos.append(vetor)
            nomes.append(str(nome_grupo))

    if len(grupos) < 3:
        erro("Kruskal-Wallis requer pelo menos 3 grupos. Para 2 grupos, use mannwhitney.")

    stat, p = stats.kruskal(*grupos)
    n_total = sum(len(g) for g in grupos)
    eta2_h = (stat - len(grupos) + 1) / (n_total - len(grupos))  # eta² baseado em H (epsilon-quadrado)

    resultado = {
        "teste": "Kruskal-Wallis (não paramétrica, 3+ grupos independentes)",
        "grupos": [{"nome": n, "n": len(g), "mediana": float(np.median(g))} for n, g in zip(nomes, grupos)],
        "graus_liberdade": len(grupos) - 1,
        "estatistica_H": float(stat),
        "p_valor": float(p),
        "significativo_5pct": interpretar_p(p, 0.05),
        "tamanho_efeito_epsilon_quadrado": float(eta2_h),
    }

    if p < args.alpha:
        resultado["posthoc_dunn_bonferroni"] = {
            "aviso": "Post-hoc de Dunn com correção de Bonferroni, calculado pois o Kruskal-Wallis global foi significativo.",
            "comparacoes_pareadas": dunn_test(grupos, nomes),
        }
    else:
        resultado["posthoc_dunn_bonferroni"] = "Não calculado — Kruskal-Wallis global não significativo."

    saida(resultado)


def dunn_test(grupos, nomes):
    """Teste de Dunn (post-hoc para Kruskal-Wallis) com correção de Bonferroni.
    Implementação padrão baseada em postos conjuntos (Dunn, 1964)."""
    todos = np.concatenate(grupos)
    n_total = len(todos)
    postos = stats.rankdata(todos)

    # separar postos de volta por grupo
    postos_por_grupo = []
    idx = 0
    for g in grupos:
        postos_por_grupo.append(postos[idx: idx + len(g)])
        idx += len(g)

    # correção para empates (ties) na variância
    _, contagens = np.unique(todos, return_counts=True)
    correcao_ties = np.sum(contagens ** 3 - contagens) / (12 * (n_total - 1))

    k = len(grupos)
    n_comparacoes = k * (k - 1) // 2
    resultados = []
    for i in range(k):
        for j in range(i + 1, k):
            ni, nj = len(grupos[i]), len(grupos[j])
            media_posto_i = np.mean(postos_por_grupo[i])
            media_posto_j = np.mean(postos_por_grupo[j])
            se = np.sqrt(((n_total * (n_total + 1) / 12) - correcao_ties) * (1 / ni + 1 / nj))
            z = (media_posto_i - media_posto_j) / se if se > 0 else 0.0
            p_bilateral = 2 * (1 - stats.norm.cdf(abs(z)))
            p_ajustado = min(p_bilateral * n_comparacoes, 1.0)
            resultados.append({
                "grupo_a": nomes[i],
                "grupo_b": nomes[j],
                "estatistica_z": float(z),
                "p_valor_bruto": float(p_bilateral),
                "p_valor_ajustado_bonferroni": float(p_ajustado),
                "significativo_5pct": interpretar_p(p_ajustado, 0.05),
            })
    return resultados


# --------------------------------------------------------------------------- #
# Comando: homogeneidade_variancia (Levene)
# --------------------------------------------------------------------------- #

def cmd_homogeneidade_variancia(args):
    df = carregar_dados(args.input, args.sheet)
    if args.var not in df.columns or args.group not in df.columns:
        erro("Variável ou coluna de grupo não encontrada.")

    grupos = []
    nomes = []
    for nome_grupo, sub in df.groupby(args.group):
        vetor, _, _ = limpar_numerico(sub[args.var])
        if len(vetor) > 0:
            grupos.append(vetor)
            nomes.append(str(nome_grupo))

    if len(grupos) < 2:
        erro("São necessários pelo menos 2 grupos com dados válidos.")

    stat, p = stats.levene(*grupos, center="median")
    resultado = {
        "teste": "Levene (centrado na mediana)",
        "grupos": nomes,
        "n_por_grupo": [len(g) for g in grupos],
        "variancia_por_grupo": [float(np.var(g, ddof=1)) for g in grupos],
        "estatistica": float(stat),
        "p_valor": float(p),
        "variancias_homogeneas": bool(p >= args.alpha),
        "interpretacao": (
            f"Variâncias homogêneas entre grupos (p={p:.4f} ≥ {args.alpha}) — "
            "pressuposto atendido para testes paramétricos que assumem igualdade de variâncias."
            if p >= args.alpha else
            f"Variâncias heterogêneas entre grupos (p={p:.4f} < {args.alpha}) — "
            "considerar correção de Welch (t-test) ou teste não paramétrico."
        ),
    }
    saida(resultado)


# --------------------------------------------------------------------------- #
# Comando: qui_quadrado (associação entre 2 variáveis categóricas)
# --------------------------------------------------------------------------- #

def cmd_qui_quadrado(args):
    df = carregar_dados(args.input, args.sheet)
    for v in (args.var1, args.var2):
        if v not in df.columns:
            erro(f"Variável '{v}' não encontrada.")

    sub = df[[args.var1, args.var2]].dropna()
    tabela = pd.crosstab(sub[args.var1], sub[args.var2])
    n = int(tabela.values.sum())
    r, c = tabela.shape

    chi2, p, gl, esperado = stats.chi2_contingency(tabela)
    v_cramer = cramer_v(chi2, n, r, c)
    pct_esperado_baixo = float(np.mean(esperado < 5) * 100)

    resultado = {
        "tabela_contingencia": {str(idx): {str(col): int(val) for col, val in row.items()}
                                 for idx, row in tabela.iterrows()},
        "n_total": n,
        "teste_qui_quadrado": {
            "estatistica": float(chi2),
            "graus_liberdade": int(gl),
            "p_valor": float(p),
            "significativo_5pct": interpretar_p(p, 0.05),
            "percentual_celulas_esperado_menor_que_5": pct_esperado_baixo,
            "aviso": (
                "Mais de 20% das células têm frequência esperada < 5 — a aproximação qui-quadrado pode "
                "não ser confiável; prefira o teste exato de Fisher (se tabela 2x2) ou reagrupe categorias."
                if pct_esperado_baixo > 20 else
                "Pressuposto de frequência esperada adequado (poucas células < 5)."
            ),
        },
        "tamanho_efeito_V_de_Cramer": float(v_cramer),
        "interpretacao_efeito": interpretar_cramer_v(v_cramer),
    }

    if r == 2 and c == 2:
        odds_ratio, p_fisher = stats.fisher_exact(tabela.to_numpy())
        resultado["teste_exato_fisher"] = {
            "razao_de_chances_odds_ratio": float(odds_ratio),
            "p_valor": float(p_fisher),
            "significativo_5pct": interpretar_p(p_fisher, 0.05),
            "recomendacao": "Para tabelas 2x2, especialmente com N pequeno ou células esperadas < 5, reporte preferencialmente o teste exato de Fisher.",
        }

    saida(resultado)


def interpretar_cramer_v(v):
    if v < 0.1:
        return "associação muito pequena/negligível"
    elif v < 0.3:
        return "associação pequena"
    elif v < 0.5:
        return "associação moderada"
    else:
        return "associação grande"


# --------------------------------------------------------------------------- #
# Comando: correlacao (Pearson ou Spearman)
# --------------------------------------------------------------------------- #

def cmd_correlacao(args):
    df = carregar_dados(args.input, args.sheet)
    for v in (args.var1, args.var2):
        if v not in df.columns:
            erro(f"Variável '{v}' não encontrada.")

    sub = df[[args.var1, args.var2]].apply(pd.to_numeric, errors="coerce").dropna()
    a = sub[args.var1].to_numpy(dtype=float)
    b = sub[args.var2].to_numpy(dtype=float)
    n = len(a)
    if n < 3:
        erro("São necessários pelo menos 3 pares de observações válidas.")

    metodo = args.metodo.lower()
    if metodo == "pearson":
        r, p = stats.pearsonr(a, b)
        nome_teste = "Correlação de Pearson (linear, dados paramétricos)"
    elif metodo == "spearman":
        r, p = stats.spearmanr(a, b)
        nome_teste = "Correlação de Spearman (monotônica, baseada em postos, não paramétrica)"
    else:
        erro("Método deve ser 'pearson' ou 'spearman'.")

    # IC 95% via transformação Z de Fisher (válida para ambos como aproximação)
    z = np.arctanh(r)
    se = 1 / np.sqrt(n - 3)
    z_ic = [z - 1.96 * se, z + 1.96 * se]
    ic95 = [float(np.tanh(z_ic[0])), float(np.tanh(z_ic[1]))]

    resultado = {
        "teste": nome_teste,
        "n": n,
        "coeficiente_r": float(r),
        "r_quadrado": float(r ** 2),
        "ic95_r": ic95,
        "p_valor": float(p),
        "significativo_5pct": interpretar_p(p, 0.05),
        "interpretacao_forca": interpretar_correlacao(abs(r)),
    }
    saida(resultado)


def interpretar_correlacao(r_abs):
    if r_abs < 0.1:
        return "correlação negligível"
    elif r_abs < 0.3:
        return "correlação fraca"
    elif r_abs < 0.5:
        return "correlação moderada"
    elif r_abs < 0.7:
        return "correlação forte"
    else:
        return "correlação muito forte"


# --------------------------------------------------------------------------- #
# Comando: regressao_linear (OLS múltipla, com inferência via álgebra matricial)
# --------------------------------------------------------------------------- #

def cmd_regressao_linear(args):
    df = carregar_dados(args.input, args.sheet)
    xs = [v.strip() for v in args.x.split(",")]
    for v in [args.y] + xs:
        if v not in df.columns:
            erro(f"Variável '{v}' não encontrada.")

    sub = df[[args.y] + xs].apply(pd.to_numeric, errors="coerce").dropna()
    n = len(sub)
    k = len(xs)  # número de preditores (sem intercepto)
    if n <= k + 1:
        erro(f"N insuficiente ({n}) para {k} preditores + intercepto.")

    y = sub[args.y].to_numpy(dtype=float)
    X_preditores = sub[xs].to_numpy(dtype=float)
    X = np.column_stack([np.ones(n), X_preditores])  # intercepto + preditores

    # OLS via mínimos quadrados
    XtX_inv = np.linalg.inv(X.T @ X)
    beta = XtX_inv @ X.T @ y
    y_pred = X @ beta
    residuos = y - y_pred
    gl_residual = n - (k + 1)
    sigma2 = np.sum(residuos ** 2) / gl_residual
    se_beta = np.sqrt(np.diag(sigma2 * XtX_inv))
    t_stats = beta / se_beta
    p_valores = [2 * (1 - stats.t.cdf(abs(t), gl_residual)) for t in t_stats]
    tcrit = stats.t.ppf(0.975, gl_residual)
    ic95 = [[float(b - tcrit * s), float(b + tcrit * s)] for b, s in zip(beta, se_beta)]

    ss_total = np.sum((y - np.mean(y)) ** 2)
    ss_residual = np.sum(residuos ** 2)
    r2 = 1 - ss_residual / ss_total
    r2_ajustado = 1 - (1 - r2) * (n - 1) / gl_residual
    f_stat = ((ss_total - ss_residual) / k) / (ss_residual / gl_residual)
    p_f = 1 - stats.f.cdf(f_stat, k, gl_residual)

    nomes_coef = ["Intercepto"] + xs
    coeficientes = []
    for i, nome in enumerate(nomes_coef):
        coeficientes.append({
            "variavel": nome,
            "coeficiente_beta": float(beta[i]),
            "erro_padrao": float(se_beta[i]),
            "estatistica_t": float(t_stats[i]),
            "p_valor": float(p_valores[i]),
            "ic95": ic95[i],
            "significativo_5pct": interpretar_p(p_valores[i], 0.05),
        })

    # multicolinearidade (VIF) se houver mais de 1 preditor
    vif = None
    if k > 1:
        vif = []
        for i in range(k):
            outros = [j for j in range(k) if j != i]
            Xi = X_preditores[:, i]
            Xo = np.column_stack([np.ones(n), X_preditores[:, outros]])
            beta_aux = np.linalg.inv(Xo.T @ Xo) @ Xo.T @ Xi
            pred_aux = Xo @ beta_aux
            r2_aux = 1 - np.sum((Xi - pred_aux) ** 2) / np.sum((Xi - np.mean(Xi)) ** 2)
            vif_val = 1 / (1 - r2_aux) if r2_aux < 1 else float("inf")
            vif.append({"variavel": xs[i], "VIF": float(vif_val),
                        "aviso": "VIF > 10 sugere multicolinearidade relevante" if vif_val > 10 else "aceitável"})

    resultado = {
        "teste": "Regressão linear múltipla (mínimos quadrados ordinários - OLS)",
        "n": n,
        "r_quadrado": float(r2),
        "r_quadrado_ajustado": float(r2_ajustado),
        "estatistica_F": float(f_stat),
        "graus_liberdade_modelo": k,
        "graus_liberdade_residual": int(gl_residual),
        "p_valor_modelo_global": float(p_f),
        "significancia_modelo_global": interpretar_p(p_f, 0.05),
        "coeficientes": coeficientes,
        "multicolinearidade_VIF": vif,
        "nota_pressupostos": "Verifique separadamente: normalidade dos resíduos (ex.: Shapiro-Wilk nos resíduos), homocedasticidade e independência das observações antes de reportar este modelo como definitivo.",
    }
    saida(resultado)


# --------------------------------------------------------------------------- #
# Comando: regressao_logistica (binária, via máxima verossimilhança - Newton-Raphson)
# --------------------------------------------------------------------------- #

def cmd_regressao_logistica(args):
    df = carregar_dados(args.input, args.sheet)
    xs = [v.strip() for v in args.x.split(",")]
    for v in [args.y] + xs:
        if v not in df.columns:
            erro(f"Variável '{v}' não encontrada.")

    sub = df[[args.y] + xs].apply(pd.to_numeric, errors="coerce").dropna()
    n = len(sub)
    k = len(xs)

    y = sub[args.y].to_numpy(dtype=float)
    valores_unicos = np.unique(y)
    if not np.all(np.isin(valores_unicos, [0, 1])) or len(valores_unicos) != 2:
        erro(f"A variável dependente '{args.y}' precisa ser binária codificada como 0/1. Valores encontrados: {valores_unicos.tolist()}")

    X_preditores = sub[xs].to_numpy(dtype=float)
    X = np.column_stack([np.ones(n), X_preditores])

    # Newton-Raphson (IRLS) para máxima verossimilhança da regressão logística
    beta = np.zeros(X.shape[1])
    for iteracao in range(100):
        eta = X @ beta
        p_hat = 1 / (1 + np.exp(-eta))
        W = p_hat * (1 - p_hat)
        W = np.clip(W, 1e-8, None)
        gradiente = X.T @ (y - p_hat)
        H = -(X.T * W) @ X
        try:
            delta = np.linalg.solve(H, gradiente)
        except np.linalg.LinAlgError:
            erro("Falha de convergência (matriz singular) — possível separação perfeita ou colinearidade entre preditores.")
        beta_novo = beta - delta
        if np.max(np.abs(beta_novo - beta)) < 1e-8:
            beta = beta_novo
            break
        beta = beta_novo

    eta = X @ beta
    p_hat = 1 / (1 + np.exp(-eta))
    W = np.clip(p_hat * (1 - p_hat), 1e-8, None)
    info_fisher = (X.T * W) @ X
    cov_beta = np.linalg.inv(info_fisher)
    se_beta = np.sqrt(np.diag(cov_beta))
    z_stats = beta / se_beta
    p_valores = [2 * (1 - stats.norm.cdf(abs(z))) for z in z_stats]
    odds_ratios = np.exp(beta)
    ic95_or = [[float(np.exp(b - 1.96 * s)), float(np.exp(b + 1.96 * s))] for b, s in zip(beta, se_beta)]

    # pseudo-R² de McFadden
    ll_modelo = np.sum(y * np.log(np.clip(p_hat, 1e-10, 1)) + (1 - y) * np.log(np.clip(1 - p_hat, 1e-10, 1)))
    p_nula = np.mean(y)
    ll_nulo = np.sum(y * np.log(p_nula) + (1 - y) * np.log(1 - p_nula))
    pseudo_r2 = 1 - ll_modelo / ll_nulo

    # acurácia simples com corte 0.5
    pred_classe = (p_hat >= 0.5).astype(int)
    acuracia = float(np.mean(pred_classe == y))

    nomes_coef = ["Intercepto"] + xs
    coeficientes = []
    for i, nome in enumerate(nomes_coef):
        coeficientes.append({
            "variavel": nome,
            "coeficiente_beta": float(beta[i]),
            "erro_padrao": float(se_beta[i]),
            "estatistica_z": float(z_stats[i]),
            "p_valor": float(p_valores[i]),
            "razao_de_chances_OR": float(odds_ratios[i]) if nome != "Intercepto" else None,
            "ic95_OR": ic95_or[i] if nome != "Intercepto" else None,
            "significativo_5pct": interpretar_p(p_valores[i], 0.05),
        })

    resultado = {
        "teste": "Regressão logística binária (máxima verossimilhança)",
        "n": n,
        "variavel_dependente": args.y,
        "prevalencia_evento_y1": float(p_nula),
        "log_verossimilhanca": float(ll_modelo),
        "pseudo_r2_mcfadden": float(pseudo_r2),
        "acuracia_corte_05": acuracia,
        "coeficientes": coeficientes,
        "nota": "OR e IC95%(OR) não se aplicam ao intercepto. Verifique separação perfeita/quase-perfeita se algum OR ou IC for extremo.",
    }
    saida(resultado)


# --------------------------------------------------------------------------- #
# Comando: kaplan_meier (curva de sobrevida + log-rank se houver grupos)
# --------------------------------------------------------------------------- #

def km_estimador(tempos, eventos):
    """Estimador de Kaplan-Meier com variância de Greenwood. eventos: 1=evento, 0=censura."""
    ordem = np.argsort(tempos)
    t = tempos[ordem]
    e = eventos[ordem]
    tempos_unicos = np.unique(t)

    s = 1.0
    var_soma = 0.0
    curva = []
    n_risco = len(t)
    for tu in tempos_unicos:
        mask = t == tu
        d = int(np.sum(e[mask] == 1))  # eventos neste tempo
        n_naquele_tempo = int(np.sum(t >= tu))
        if d > 0:
            s *= (1 - d / n_naquele_tempo)
            if n_naquele_tempo > d:
                var_soma += d / (n_naquele_tempo * (n_naquele_tempo - d))
        var_greenwood = (s ** 2) * var_soma
        curva.append({
            "tempo": float(tu),
            "em_risco": n_naquele_tempo,
            "eventos": d,
            "sobrevida_acumulada": float(s),
            "erro_padrao": float(np.sqrt(var_greenwood)),
        })
    return curva


def mediana_sobrevida(curva):
    for ponto in curva:
        if ponto["sobrevida_acumulada"] <= 0.5:
            return ponto["tempo"]
    return None  # mediana não alcançada (sobrevida nunca cai a 50%)


def logrank_test(tempos, eventos, grupos):
    """Teste de log-rank (Mantel-Cox) para 2+ grupos."""
    niveis = np.unique(grupos)
    todos_tempos_evento = np.unique(tempos[eventos == 1])

    O = {g: 0.0 for g in niveis}
    E = {g: 0.0 for g in niveis}
    V_soma = 0.0
    # matriz de covariância para k grupos (necessária apenas se k>2); para 2 grupos usamos forma simplificada
    k = len(niveis)
    Vmat = np.zeros((k, k))

    for tu in todos_tempos_evento:
        em_risco_total = int(np.sum(tempos >= tu))
        d_total = int(np.sum((tempos == tu) & (eventos == 1)))
        if em_risco_total <= 1 or d_total == 0:
            continue
        for gi, g in enumerate(niveis):
            mask_g = grupos == g
            n_g = int(np.sum(tempos[mask_g] >= tu))
            d_g = int(np.sum((tempos[mask_g] == tu) & (eventos[mask_g] == 1)))
            O[g] += d_g
            e_g = d_total * n_g / em_risco_total
            E[g] += e_g
        for gi, gi_name in enumerate(niveis):
            n_gi = int(np.sum(tempos[grupos == gi_name] >= tu))
            for gj, gj_name in enumerate(niveis):
                n_gj = int(np.sum(tempos[grupos == gj_name] >= tu))
                if em_risco_total > 1:
                    termo = d_total * (em_risco_total - d_total) / (em_risco_total - 1) / (em_risco_total ** 2)
                    if gi == gj:
                        Vmat[gi, gj] += termo * n_gi * (em_risco_total - n_gi)
                    else:
                        Vmat[gi, gj] -= termo * n_gi * n_gj

    O_vec = np.array([O[g] for g in niveis])
    E_vec = np.array([E[g] for g in niveis])
    diff = (O_vec - E_vec)[:-1]  # remove último grupo (redundância, matriz singular senão)
    V_reduzida = Vmat[:-1, :-1]
    try:
        chi2_stat = float(diff @ np.linalg.inv(V_reduzida) @ diff)
    except np.linalg.LinAlgError:
        chi2_stat = float("nan")
    gl = k - 1
    p = float(1 - stats.chi2.cdf(chi2_stat, gl)) if not np.isnan(chi2_stat) else None

    return {
        "estatistica_qui_quadrado": chi2_stat,
        "graus_liberdade": gl,
        "p_valor": p,
        "observado_por_grupo": {str(g): float(O[g]) for g in niveis},
        "esperado_por_grupo": {str(g): float(E[g]) for g in niveis},
        "significativo_5pct": interpretar_p(p, 0.05) if p is not None else "não calculável",
    }


def cmd_kaplan_meier(args):
    df = carregar_dados(args.input, args.sheet)
    for v in [args.tempo, args.evento]:
        if v not in df.columns:
            erro(f"Variável '{v}' não encontrada.")

    cols = [args.tempo, args.evento] + ([args.group] if args.group else [])
    sub = df[cols].copy()
    sub[args.tempo] = pd.to_numeric(sub[args.tempo], errors="coerce")
    sub[args.evento] = pd.to_numeric(sub[args.evento], errors="coerce")
    sub = sub.dropna(subset=[args.tempo, args.evento])

    valores_evento = sub[args.evento].unique()
    if not np.all(np.isin(valores_evento, [0, 1])):
        erro(f"A coluna de evento precisa ser 0/1 (1=evento/óbito/falha, 0=censura). Valores encontrados: {valores_evento.tolist()}")

    tempos = sub[args.tempo].to_numpy(dtype=float)
    eventos = sub[args.evento].to_numpy(dtype=float)

    resultado = {"n_total": len(sub), "n_eventos": int(np.sum(eventos == 1)), "n_censuras": int(np.sum(eventos == 0))}

    if args.group:
        if args.group not in df.columns:
            erro(f"Coluna de grupo '{args.group}' não encontrada.")
        grupos_vals = sub[args.group].to_numpy()
        resultado["curvas_por_grupo"] = {}
        for g in pd.unique(sub[args.group]):
            mask = grupos_vals == g
            curva = km_estimador(tempos[mask], eventos[mask])
            resultado["curvas_por_grupo"][str(g)] = {
                "n": int(np.sum(mask)),
                "n_eventos": int(np.sum(eventos[mask] == 1)),
                "mediana_sobrevida": mediana_sobrevida(curva),
                "pontos_curva": curva,
            }
        if len(pd.unique(sub[args.group])) >= 2:
            resultado["teste_logrank"] = logrank_test(tempos, eventos, grupos_vals)
    else:
        curva = km_estimador(tempos, eventos)
        resultado["mediana_sobrevida"] = mediana_sobrevida(curva)
        resultado["pontos_curva"] = curva

    saida(resultado)


# --------------------------------------------------------------------------- #
# Comando: correcao_multiplas (Bonferroni / FDR de Benjamini-Hochberg)
# --------------------------------------------------------------------------- #

def cmd_correcao_multiplas(args):
    p_valores = [float(x.strip()) for x in args.pvalores.split(",")]
    metodo = args.metodo.lower()

    if metodo == "bonferroni":
        n = len(p_valores)
        ajustados = [min(p * n, 1.0) for p in p_valores]
        nome = "Bonferroni"
    elif metodo == "fdr_bh":
        from scipy.stats import false_discovery_control
        ajustados = false_discovery_control(np.array(p_valores), method="bh").tolist()
        nome = "Benjamini-Hochberg (FDR)"
    else:
        erro("Método deve ser 'bonferroni' ou 'fdr_bh'.")

    resultado = {
        "metodo": nome,
        "comparacoes": [
            {"indice": i + 1, "p_bruto": p, "p_ajustado": pa, "significativo_5pct": interpretar_p(pa, 0.05)}
            for i, (p, pa) in enumerate(zip(p_valores, ajustados))
        ],
    }
    saida(resultado)


# --------------------------------------------------------------------------- #
# CLI principal
# --------------------------------------------------------------------------- #

def main():
    parser = argparse.ArgumentParser(description="Motor estatístico determinístico")
    sub = parser.add_subparsers(dest="comando", required=True)

    def add_input_args(p):
        p.add_argument("--input", required=True, help="Caminho do arquivo .csv/.xlsx/.tsv")
        p.add_argument("--sheet", default=None, help="Nome da planilha (apenas .xlsx)")

    p = sub.add_parser("explorar")
    add_input_args(p)
    p.set_defaults(func=cmd_explorar)

    p = sub.add_parser("descritivas")
    add_input_args(p)
    p.add_argument("--vars", required=True, help="Variáveis separadas por vírgula")
    p.add_argument("--group", default=None, help="Coluna de agrupamento (opcional)")
    p.set_defaults(func=cmd_descritivas)

    p = sub.add_parser("normalidade")
    add_input_args(p)
    p.add_argument("--vars", required=True)
    p.add_argument("--group", default=None)
    p.add_argument("--alpha", type=float, default=0.05)
    p.set_defaults(func=cmd_normalidade)

    p = sub.add_parser("homogeneidade_variancia")
    add_input_args(p)
    p.add_argument("--var", required=True)
    p.add_argument("--group", required=True)
    p.add_argument("--alpha", type=float, default=0.05)
    p.set_defaults(func=cmd_homogeneidade_variancia)

    p = sub.add_parser("ttest_independente")
    add_input_args(p)
    p.add_argument("--var", required=True)
    p.add_argument("--group", required=True)
    p.add_argument("--welch", action="store_true", help="Usar correção de Welch (variâncias desiguais)")
    p.set_defaults(func=cmd_ttest_independente)

    p = sub.add_parser("ttest_pareado")
    add_input_args(p)
    p.add_argument("--var1", required=True)
    p.add_argument("--var2", required=True)
    p.set_defaults(func=cmd_ttest_pareado)

    p = sub.add_parser("mannwhitney")
    add_input_args(p)
    p.add_argument("--var", required=True)
    p.add_argument("--group", required=True)
    p.set_defaults(func=cmd_mannwhitney)

    p = sub.add_parser("wilcoxon")
    add_input_args(p)
    p.add_argument("--var1", required=True)
    p.add_argument("--var2", required=True)
    p.set_defaults(func=cmd_wilcoxon)

    p = sub.add_parser("anova_oneway")
    add_input_args(p)
    p.add_argument("--var", required=True)
    p.add_argument("--group", required=True)
    p.add_argument("--alpha", type=float, default=0.05)
    p.set_defaults(func=cmd_anova_oneway)

    p = sub.add_parser("kruskal")
    add_input_args(p)
    p.add_argument("--var", required=True)
    p.add_argument("--group", required=True)
    p.add_argument("--alpha", type=float, default=0.05)
    p.set_defaults(func=cmd_kruskal)

    p = sub.add_parser("qui_quadrado")
    add_input_args(p)
    p.add_argument("--var1", required=True)
    p.add_argument("--var2", required=True)
    p.set_defaults(func=cmd_qui_quadrado)

    p = sub.add_parser("correlacao")
    add_input_args(p)
    p.add_argument("--var1", required=True)
    p.add_argument("--var2", required=True)
    p.add_argument("--metodo", default="pearson", choices=["pearson", "spearman"])
    p.set_defaults(func=cmd_correlacao)

    p = sub.add_parser("regressao_linear")
    add_input_args(p)
    p.add_argument("--y", required=True)
    p.add_argument("--x", required=True, help="Preditores separados por vírgula")
    p.set_defaults(func=cmd_regressao_linear)

    p = sub.add_parser("regressao_logistica")
    add_input_args(p)
    p.add_argument("--y", required=True, help="Variável dependente binária (0/1)")
    p.add_argument("--x", required=True, help="Preditores separados por vírgula")
    p.set_defaults(func=cmd_regressao_logistica)

    p = sub.add_parser("kaplan_meier")
    add_input_args(p)
    p.add_argument("--tempo", required=True)
    p.add_argument("--evento", required=True, help="Coluna 0/1 (1=evento, 0=censura)")
    p.add_argument("--group", default=None)
    p.set_defaults(func=cmd_kaplan_meier)

    p = sub.add_parser("correcao_multiplas")
    p.add_argument("--pvalores", required=True, help="Lista de p-valores separados por vírgula")
    p.add_argument("--metodo", default="fdr_bh", choices=["bonferroni", "fdr_bh"])
    p.set_defaults(func=cmd_correcao_multiplas)

    # Se o argumento for um arquivo JSON, converte para flags CLI de argparse
    if len(sys.argv) > 1 and sys.argv[1].endswith('.json'):
        try:
            with open(sys.argv[1], 'r', encoding='utf-8') as f:
                json_args = json.load(f)
            
            new_argv = [sys.argv[0]]
            
            PARAM_MAP = {
                'arquivo': 'input',
                'file': 'input',
                'path': 'input',
                'filepath': 'input',
                'filename': 'input',
                'planilha': 'sheet',
                'sheet_name': 'sheet',
                'sheetname': 'sheet',
                'grupo': 'group',
                'grupos': 'group',
                'variaveis': 'vars',
                'variáveis': 'vars',
                'colunas': 'vars',
                'columns': 'vars',
                'variavel': 'var',
                'variável': 'var',
                'coluna': 'var',
                'column': 'var'
            }

            if isinstance(json_args, list):
                # Se for uma lista direta de argumentos, ex: ["explorar", "--input", "dados.csv"]
                new_argv.extend([str(item) for item in json_args])
            elif isinstance(json_args, dict):
                # Se for um objeto dicionário
                comando = json_args.get('comando') or json_args.get('command') or json_args.get('action')
                if comando:
                    new_argv.append(str(comando))
                
                for k, v in json_args.items():
                    if k in ('comando', 'command', 'action', 'skill_name'):
                        continue
                    
                    clean_k = k.lstrip('-').lower()
                    real_k = PARAM_MAP.get(clean_k, clean_k)
                    flag = f"--{real_k}"

                    if isinstance(v, bool):
                        if v:
                            new_argv.append(flag)
                    elif v is not None:
                        new_argv.append(flag)
                        new_argv.append(str(v))
            else:
                raise ValueError("JSON de argumentos deve ser uma lista ou um objeto.")
            
            sys.argv = new_argv
        except Exception as e:
            erro(f"Erro ao processar arquivo JSON de argumentos: {e}")

    args = parser.parse_args()
    try:
        args.func(args)
    except Exception as ex:
        erro(f"Erro inesperado ao executar '{args.comando}': {ex}")


if __name__ == "__main__":
    main()