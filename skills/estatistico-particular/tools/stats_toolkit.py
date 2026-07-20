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
import io
import json
import argparse
from datetime import datetime
import numpy as np
import pandas as pd
from scipy import stats

# Em alguns terminais Windows o stdout não é UTF-8 por padrão, o que derruba a
# impressão de qualquer resultado com caracteres como η, ε, χ ou ≥.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

# Gráficos são opcionais: se matplotlib não estiver instalado, o relatório
# ainda é gerado (só sem as figuras) em vez de quebrar tudo.
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    MATPLOTLIB_OK = True
except ImportError:
    MATPLOTLIB_OK = False


# --------------------------------------------------------------------------- #
# Utilitários gerais
# --------------------------------------------------------------------------- #

def carregar_dados_com_caminho(path, sheet=None):
    real_path = path
    if not os.path.exists(real_path):
        filename = os.path.basename(path)
        candidatos = [
            os.path.join("dados", filename),
            os.path.join("dados", path),
            filename
        ]
        for c in candidatos:
            if os.path.exists(c):
                real_path = c
                break

    if real_path.lower().endswith((".xlsx", ".xls")):
        df = pd.read_excel(real_path, sheet_name=sheet if sheet else 0)
    elif real_path.lower().endswith(".csv"):
        try:
            df = pd.read_csv(real_path, sep=None, engine="python")
        except Exception:
            df = pd.read_csv(real_path)
    elif real_path.lower().endswith(".tsv"):
        df = pd.read_csv(real_path, sep="\t")
    else:
        raise ValueError(f"Extensão de arquivo não suportada: {path}")

    return df, real_path


def salvar_dados(df, path):
    if path.lower().endswith((".xlsx", ".xls")):
        df.to_excel(path, index=False)
    elif path.lower().endswith(".csv"):
        df.to_csv(path, index=False)
    elif path.lower().endswith(".tsv"):
        df.to_csv(path, sep="\t", index=False)


def carregar_dados(path, sheet=None, args=None):
    df, real_path = carregar_dados_com_caminho(path, sheet)
    if args:
        df, alterado = resolver_e_criar_colunas(df, args)
        if alterado:
            try:
                salvar_dados(df, real_path)
            except Exception:
                pass
    return df


def resolver_e_criar_colunas(df, args):
    alterado = False
    var1 = getattr(args, 'var1', None) or getattr(args, 'col1', None) or getattr(args, 'coluna1', None)
    var2 = getattr(args, 'var2', None) or getattr(args, 'col2', None) or getattr(args, 'coluna2', None)
    nova_col = getattr(args, 'nova_coluna', None) or getattr(args, 'out', None) or getattr(args, 'var', None)

    if var1 and var2:
        col1_real = next((c for c in df.columns if c.strip().lower() == str(var1).strip().lower()), None)
        col2_real = next((c for c in df.columns if c.strip().lower() == str(var2).strip().lower()), None)
        if col1_real and col2_real:
            target_name = nova_col or f"Delta_{col1_real}_{col2_real}"
            if target_name not in df.columns:
                val1 = pd.to_numeric(df[col1_real], errors='coerce')
                val2 = pd.to_numeric(df[col2_real], errors='coerce')
                df[target_name] = val1 - val2
                alterado = True
                if hasattr(args, 'var') and getattr(args, 'var') is None:
                    setattr(args, 'var', target_name)

    var_alvo = getattr(args, 'var', None) or getattr(args, 'y', None)
    if var_alvo and isinstance(var_alvo, str) and var_alvo not in df.columns:
        cols_lower = {c.lower(): c for c in df.columns}
        col_pos = next((cols_lower[c] for c in cols_lower if any(w in c for w in ['6meses', 'final', 'pos', 'pós', 'depois', '12meses', '3meses', 'fim'])), None)
        col_pre = next((cols_lower[c] for c in cols_lower if any(w in c for w in ['basal', 'inicial', 'pre', 'pré', 'antes', 'zero', '0'])), None)
        if col_pos and col_pre:
            val_pos = pd.to_numeric(df[col_pos], errors='coerce')
            val_pre = pd.to_numeric(df[col_pre], errors='coerce')
            df[var_alvo] = val_pos - val_pre
            alterado = True

    return df, alterado


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


MANIFESTO_PATH = os.path.join("dados", "_analises_sessao.jsonl")

# Comandos que não representam um teste/análise a ser citado no relatório final
# (são utilitários, exploratórios ou o próprio gerador de relatório).
_COMANDOS_FORA_DO_MANIFESTO = {"explorar", "gerar_pdf", "resetar_sessao", "calcular_diferenca"}

# Contexto do comando em execução, preenchido por main() antes de chamar args.func(args).
# É um dict mutável (não uma variável module-level reatribuída) para não exigir `global`.
_SESSAO_CTX = {"comando": None, "args": None}


def registrar_manifesto(resultado_arredondado):
    """Acrescenta o resultado desta chamada ao manifesto da sessão (dados/_analises_sessao.jsonl),
    para que `gerar_pdf` monte o relatório final a partir dos números realmente calculados e
    mostrados ao usuário durante a conversa — nunca recalculando por conta própria."""
    comando = _SESSAO_CTX.get("comando")
    if not comando or comando in _COMANDOS_FORA_DO_MANIFESTO:
        return
    try:
        args_atual = _SESSAO_CTX.get("args")
        params = {}
        if args_atual is not None:
            params = {k: v for k, v in vars(args_atual).items() if k != "func" and v is not None}
        pasta = os.path.dirname(MANIFESTO_PATH)
        if pasta and not os.path.exists(pasta):
            os.makedirs(pasta, exist_ok=True)
        entrada = {
            "comando": comando,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "params": params,
            "resultado": resultado_arredondado,
        }
        with open(MANIFESTO_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entrada, ensure_ascii=False) + "\n")
    except Exception:
        pass  # o manifesto é um registro auxiliar — nunca deve derrubar o comando principal


def ler_manifesto():
    """Lê todas as entradas já registradas na sessão atual (mais antiga primeiro)."""
    if not os.path.exists(MANIFESTO_PATH):
        return []
    entradas = []
    with open(MANIFESTO_PATH, "r", encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()
            if not linha:
                continue
            try:
                entradas.append(json.loads(linha))
            except json.JSONDecodeError:
                continue
    return entradas


def cmd_resetar_sessao(args):
    existia = os.path.exists(MANIFESTO_PATH)
    if existia:
        os.remove(MANIFESTO_PATH)
    saida({"sucesso": True, "manifesto_removido": existia, "mensagem": "Sessão de análises reiniciada — o próximo gerar_pdf partirá de um histórico vazio."})


def saida(dados):
    arred = arredondar(dados)
    registrar_manifesto(arred)
    print(json.dumps(arred, ensure_ascii=False, indent=2))


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
# Comando: calcular_diferenca
# --------------------------------------------------------------------------- #

def cmd_calcular_diferenca(args):
    df, real_path = carregar_dados_com_caminho(args.input, args.sheet)

    var1 = getattr(args, 'var1', None) or getattr(args, 'col1', None) or getattr(args, 'coluna1', None)
    var2 = getattr(args, 'var2', None) or getattr(args, 'col2', None) or getattr(args, 'coluna2', None)
    nova_coluna = getattr(args, 'nova_coluna', None) or getattr(args, 'col_nova', None) or getattr(args, 'coluna_nova', None) or getattr(args, 'var', None) or 'Variacao_PAS'
    operacao = str(getattr(args, 'operacao', 'subtracao')).lower()
    out_file = getattr(args, 'out', None) or getattr(args, 'output', None)

    if not var1 or not var2:
        cols_lower = {c.lower(): c for c in df.columns}
        col1_real = next((cols_lower[c] for c in cols_lower if any(w in c for w in ['6meses', 'final', 'pos', 'pós', 'depois', '12meses', '3meses', 'fim'])), None)
        col2_real = next((cols_lower[c] for c in cols_lower if any(w in c for w in ['basal', 'inicial', 'pre', 'pré', 'antes', 'zero', '0'])), None)
    else:
        col1_real = next((c for c in df.columns if c.strip().lower() == str(var1).strip().lower()), None)
        col2_real = next((c for c in df.columns if c.strip().lower() == str(var2).strip().lower()), None)

    if not col1_real or not col2_real:
        erro(f"Não foi possível identificar as duas colunas para o cálculo da diferença. Colunas disponíveis na planilha: {list(df.columns)}")

    val1 = pd.to_numeric(df[col1_real], errors='coerce')
    val2 = pd.to_numeric(df[col2_real], errors='coerce')

    if 'soma' in operacao or operacao == '+':
        res = val1 + val2
    elif 'divis' in operacao or operacao == '/':
        res = val1 / val2
    elif 'mult' in operacao or operacao == '*':
        res = val1 * val2
    else:
        res = val1 - val2

    df[nova_coluna] = res
    salvar_dados(df, real_path)

    if out_file:
        try:
            salvar_dados(df, out_file)
        except Exception:
            pass

    arr, n_total, n_validos = limpar_numerico(res)
    ret = {
        "sucesso": True,
        "mensagem": f"Coluna '{nova_coluna}' calculada com sucesso ({col1_real} - {col2_real}) e salva em '{os.path.basename(real_path)}'.",
        "nova_coluna": nova_coluna,
        "n_total": n_total,
        "n_validos": n_validos,
        "resumo": {
            "media": float(np.mean(arr)) if len(arr) > 0 else None,
            "desvio_padrao": float(np.std(arr, ddof=1)) if len(arr) > 1 else None,
            "mediana": float(np.median(arr)) if len(arr) > 0 else None,
            "minimo": float(np.min(arr)) if len(arr) > 0 else None,
            "maximo": float(np.max(arr)) if len(arr) > 0 else None,
        }
    }
    saida(ret)


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
# Comando: gerar_pdf (Relatório Estatístico em PDF Premium)
# --------------------------------------------------------------------------- #

def _br(v, casas=2):
    """Formata número com vírgula decimal (convenção PT-BR); None/NaN vira 'NC'."""
    if v is None:
        return "NC"
    try:
        v = float(v)
    except (TypeError, ValueError):
        return str(v)
    if np.isnan(v):
        return "NC"
    return f"{v:.{casas}f}".replace('.', ',')


def _pv(p):
    if p is None:
        return "não calculável"
    try:
        p = float(p)
    except (TypeError, ValueError):
        return "não calculável"
    if np.isnan(p):
        return "não calculável"
    return "p < 0,001" if p < 0.001 else f"p = {_br(p, 3)}"


def welch_gl(a, b):
    va, vb = np.var(a, ddof=1), np.var(b, ddof=1)
    na, nb = len(a), len(b)
    return (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))


# --------------------------------------------------------------------------- #
# Formatadores genéricos de resultado -> seção de relatório (título + parágrafo
# estilo Vancouver + tabela), um por comando. Usados por gerar_pdf para renderizar
# QUALQUER análise já registrada no manifesto da sessão, sem recalcular nada e sem
# nenhum texto fixo — cada frase é montada a partir dos números reais do JSON.
# --------------------------------------------------------------------------- #

def _fmt_ttest_independente(r, p):
    var, grp = p.get('var', 'variável'), p.get('group', 'grupo')
    g1, g2 = r['grupo_1'], r['grupo_2']
    verbo = "não diferiu significativamente" if 'não' in r['significativo_5pct'] else "diferiu significativamente"
    narrativa = (
        f"A variável \"{var}\" {verbo} entre {g1['nome']} (M={_br(g1['media'])}, DP={_br(g1['dp'])}, n={g1['n']}) "
        f"e {g2['nome']} (M={_br(g2['media'])}, DP={_br(g2['dp'])}, n={g2['n']}); "
        f"t({_br(r['graus_liberdade'], 1)}) = {_br(r['estatistica_t'])}, {_pv(r['p_valor'])}, "
        f"diferença de médias = {_br(r['diferenca_medias'])} (IC95% {_br(r['ic95_diferenca'][0])} a {_br(r['ic95_diferenca'][1])}), "
        f"d de Cohen = {_br(r['tamanho_efeito_cohen_d'], 3)} ({r['interpretacao_efeito']})."
    )
    tabela = (["Estatística", "Valor"], [
        ["Teste", r['teste']],
        [f"{g1['nome']} (n={g1['n']})", f"M={_br(g1['media'])}; DP={_br(g1['dp'])}"],
        [f"{g2['nome']} (n={g2['n']})", f"M={_br(g2['media'])}; DP={_br(g2['dp'])}"],
        ["t (gl)", f"{_br(r['estatistica_t'])} ({_br(r['graus_liberdade'], 1)})"],
        ["p-valor", _pv(r['p_valor'])],
        ["Diferença de médias (IC95%)", f"{_br(r['diferenca_medias'])} ({_br(r['ic95_diferenca'][0])} a {_br(r['ic95_diferenca'][1])})"],
        ["d de Cohen", f"{_br(r['tamanho_efeito_cohen_d'], 3)} ({r['interpretacao_efeito']})"],
    ])
    return {"titulo": f"Teste t independente — {var} por {grp}", "narrativa": narrativa, "tabela": tabela}


def _fmt_ttest_pareado(r, p):
    v1, v2 = p.get('var1', 'momento 1'), p.get('var2', 'momento 2')
    verbo = "não houve alteração significativa" if 'não' in r['significativo_5pct'] else "houve alteração significativa"
    narrativa = (
        f"Entre {v1} (M={_br(r['media_1'])}) e {v2} (M={_br(r['media_2'])}), {verbo} "
        f"(diferença média = {_br(r['diferenca_media'])}, IC95% {_br(r['ic95_diferenca'][0])} a {_br(r['ic95_diferenca'][1])}); "
        f"t({r['graus_liberdade']}) = {_br(r['estatistica_t'])}, {_pv(r['p_valor'])}, "
        f"d de Cohen = {_br(r['tamanho_efeito_cohen_d'], 3)} ({r['interpretacao_efeito']})."
    )
    tabela = (["Estatística", "Valor"], [
        ["N pares", r['n_pares']],
        [f"Média {v1}", _br(r['media_1'])],
        [f"Média {v2}", _br(r['media_2'])],
        ["Diferença média (IC95%)", f"{_br(r['diferenca_media'])} ({_br(r['ic95_diferenca'][0])} a {_br(r['ic95_diferenca'][1])})"],
        ["t (gl)", f"{_br(r['estatistica_t'])} ({r['graus_liberdade']})"],
        ["p-valor", _pv(r['p_valor'])],
        ["d de Cohen", f"{_br(r['tamanho_efeito_cohen_d'], 3)} ({r['interpretacao_efeito']})"],
    ])
    return {"titulo": f"Teste t pareado — {v1} vs. {v2}", "narrativa": narrativa, "tabela": tabela}


def _fmt_mannwhitney(r, p):
    var, grp = p.get('var', 'variável'), p.get('group', 'grupo')
    g1, g2 = r['grupo_1'], r['grupo_2']
    verbo = "não diferiu significativamente" if 'não' in r['significativo_5pct'] else "diferiu significativamente"
    narrativa = (
        f"A mediana de \"{var}\" {verbo} entre {g1['nome']} (mediana={_br(g1['mediana'])}, n={g1['n']}) "
        f"e {g2['nome']} (mediana={_br(g2['mediana'])}, n={g2['n']}); "
        f"U = {_br(r['estatistica_U'])}, {_pv(r['p_valor'])}, r = {_br(r['tamanho_efeito_r_rank_biserial'], 3)}."
    )
    tabela = (["Estatística", "Valor"], [
        ["Teste", r['teste']],
        [f"{g1['nome']} (n={g1['n']})", f"mediana={_br(g1['mediana'])}"],
        [f"{g2['nome']} (n={g2['n']})", f"mediana={_br(g2['mediana'])}"],
        ["U", _br(r['estatistica_U'])],
        ["p-valor", _pv(r['p_valor'])],
        ["r (rank-biserial)", _br(r['tamanho_efeito_r_rank_biserial'], 3)],
    ])
    return {"titulo": f"Mann-Whitney U — {var} por {grp}", "narrativa": narrativa, "tabela": tabela}


def _fmt_wilcoxon(r, p):
    v1, v2 = p.get('var1', 'momento 1'), p.get('var2', 'momento 2')
    verbo = "não houve diferença significativa" if 'não' in r['significativo_5pct'] else "houve diferença significativa"
    narrativa = (
        f"Entre {v1} e {v2}, {verbo} (mediana das diferenças = {_br(r['mediana_diferenca'])}); "
        f"W = {_br(r['estatistica_W'])}, {_pv(r['p_valor'])} (n={r['n_pares']}, "
        f"{r['n_pares_com_diferenca_nao_nula']} pares com diferença não nula)."
    )
    tabela = (["Estatística", "Valor"], [
        ["N pares (com diferença não nula)", f"{r['n_pares']} ({r['n_pares_com_diferenca_nao_nula']})"],
        [f"Mediana {v1}", _br(r['mediana_1'])],
        [f"Mediana {v2}", _br(r['mediana_2'])],
        ["Mediana da diferença", _br(r['mediana_diferenca'])],
        ["W", _br(r['estatistica_W'])],
        ["p-valor", _pv(r['p_valor'])],
    ])
    return {"titulo": f"Wilcoxon pareado — {v1} vs. {v2}", "narrativa": narrativa, "tabela": tabela}


def _fmt_posthoc_pares(comparacoes, rotulo_estat, campo_estat, campo_p_ajust):
    linhas = []
    for c in comparacoes:
        linhas.append(
            f"{c['grupo_a']} vs. {c['grupo_b']} ({rotulo_estat}={_br(c[campo_estat])}, "
            f"p ajustado={_br(c[campo_p_ajust], 4)}, {c['significativo_5pct']})"
        )
    return "; ".join(linhas)


def _fmt_anova_oneway(r, p):
    var, grp = p.get('var', 'variável'), p.get('group', 'grupo')
    nomes = ", ".join(f"{g['nome']} (n={g['n']}, M={_br(g['media'])})" for g in r['grupos'])
    verbo = "não houve diferença significativa" if 'não' in r['significativo_5pct'] else "houve diferença significativa"
    narrativa = (
        f"Comparando {var} entre os grupos {nomes}, {verbo} "
        f"(F({r['graus_liberdade_entre']},{r['graus_liberdade_dentro']}) = {_br(r['estatistica_F'])}, {_pv(r['p_valor'])}, "
        f"η² = {_br(r['tamanho_efeito_eta_quadrado'], 4)}, {r['interpretacao_efeito']})."
    )
    ph = r.get('posthoc_tukey_hsd')
    if isinstance(ph, dict):
        narrativa += " Post-hoc de Tukey HSD: " + _fmt_posthoc_pares(ph['comparacoes_pareadas'], "diferença de médias", "diferenca_medias", "p_valor_ajustado") + "."
    tabela = (["Estatística", "Valor"], [
        ["Grupos", nomes],
        ["F (gl entre, gl dentro)", f"{_br(r['estatistica_F'])} ({r['graus_liberdade_entre']}, {r['graus_liberdade_dentro']})"],
        ["p-valor", _pv(r['p_valor'])],
        ["η² (magnitude)", f"{_br(r['tamanho_efeito_eta_quadrado'], 4)} ({r['interpretacao_efeito']})"],
    ])
    return {"titulo": f"ANOVA one-way — {var} por {grp}", "narrativa": narrativa, "tabela": tabela}


def _fmt_kruskal(r, p):
    var, grp = p.get('var', 'variável'), p.get('group', 'grupo')
    nomes = ", ".join(f"{g['nome']} (n={g['n']}, mediana={_br(g['mediana'])})" for g in r['grupos'])
    verbo = "não houve diferença significativa" if 'não' in r['significativo_5pct'] else "houve diferença significativa"
    narrativa = (
        f"Comparando {var} entre os grupos {nomes}, {verbo} "
        f"(H({r['graus_liberdade']}) = {_br(r['estatistica_H'])}, {_pv(r['p_valor'])}, "
        f"ε² = {_br(r['tamanho_efeito_epsilon_quadrado'], 4)})."
    )
    ph = r.get('posthoc_dunn_bonferroni')
    if isinstance(ph, dict):
        narrativa += " Post-hoc de Dunn (Bonferroni): " + _fmt_posthoc_pares(ph['comparacoes_pareadas'], "Z", "estatistica_z", "p_valor_ajustado_bonferroni") + "."
    tabela = (["Estatística", "Valor"], [
        ["Grupos", nomes],
        ["H (gl)", f"{_br(r['estatistica_H'])} ({r['graus_liberdade']})"],
        ["p-valor", _pv(r['p_valor'])],
        ["ε² (epsilon-quadrado)", _br(r['tamanho_efeito_epsilon_quadrado'], 4)],
    ])
    return {"titulo": f"Kruskal-Wallis — {var} por {grp}", "narrativa": narrativa, "tabela": tabela}


def _fmt_qui_quadrado(r, p):
    v1, v2 = p.get('var1', 'variável 1'), p.get('var2', 'variável 2')
    tq = r['teste_qui_quadrado']
    verbo = "não houve associação estatisticamente significativa" if 'não' in tq['significativo_5pct'] else "houve associação estatisticamente significativa"
    narrativa = (
        f"Entre \"{v1}\" e \"{v2}\" (N={r['n_total']}), {verbo} "
        f"(χ²({tq['graus_liberdade']}) = {_br(tq['estatistica'])}, {_pv(tq['p_valor'])}, "
        f"V de Cramér = {_br(r['tamanho_efeito_V_de_Cramer'], 3)}, {r['interpretacao_efeito']})."
    )
    tabela = (["Estatística", "Valor"], [
        ["Tabela de contingência", f"N={r['n_total']}"],
        ["χ² (gl)", f"{_br(tq['estatistica'])} ({tq['graus_liberdade']})"],
        ["p-valor", _pv(tq['p_valor'])],
        ["V de Cramér", f"{_br(r['tamanho_efeito_V_de_Cramer'], 3)} ({r['interpretacao_efeito']})"],
        ["Células com esperado < 5", f"{_br(tq['percentual_celulas_esperado_menor_que_5'], 1)}%"],
    ])
    fisher = r.get('teste_exato_fisher')
    if fisher:
        narrativa += (
            f" Por se tratar de tabela 2×2, também foi calculado o teste exato de Fisher "
            f"({_pv(fisher['p_valor'])}; odds ratio = {_br(fisher['razao_de_chances_odds_ratio'], 3)})."
        )
        if tq['percentual_celulas_esperado_menor_que_5'] > 20:
            narrativa += " Dado que mais de 20% das células têm frequência esperada < 5, prefira o resultado do teste exato de Fisher ao qui-quadrado."
    return {"titulo": f"Associação categórica — {v1} × {v2}", "narrativa": narrativa, "tabela": tabela}


def _fmt_correlacao(r, p):
    v1, v2 = p.get('var1', 'variável 1'), p.get('var2', 'variável 2')
    verbo = "não apresentaram correlação estatisticamente significativa" if 'não' in r['significativo_5pct'] else f"apresentaram correlação {r['interpretacao_forca']}"
    simbolo = "ρ" if "Spearman" in r['teste'] else "r"
    narrativa = (
        f"\"{v1}\" e \"{v2}\" (n={r['n']}) {verbo} "
        f"({simbolo} = {_br(r['coeficiente_r'], 3)}, IC95% {_br(r['ic95_r'][0], 3)} a {_br(r['ic95_r'][1], 3)}, {_pv(r['p_valor'])}). "
        "Correlação não implica causalidade."
    )
    tabela = (["Estatística", "Valor"], [
        ["Método", r['teste']],
        ["n", r['n']],
        [f"{simbolo}", _br(r['coeficiente_r'], 3)],
        ["r²", _br(r['r_quadrado'], 3)],
        ["IC95%", f"{_br(r['ic95_r'][0], 3)} a {_br(r['ic95_r'][1], 3)}"],
        ["p-valor", _pv(r['p_valor'])],
    ])
    return {"titulo": f"Correlação — {v1} × {v2}", "narrativa": narrativa, "tabela": tabela}


def _fmt_regressao_linear(r, p):
    y, x = p.get('y', 'desfecho'), p.get('x', 'preditores')
    verbo = "não foi estatisticamente significativo" if 'não' in r['significancia_modelo_global'] else "foi estatisticamente significativo"
    narrativa = (
        f"O modelo de regressão linear múltipla para \"{y}\" (preditores: {x}; n={r['n']}) explicou "
        f"{_br(r['r_quadrado_ajustado'] * 100, 1)}% da variância (R² ajustado = {_br(r['r_quadrado_ajustado'], 3)}); "
        f"o modelo global {verbo} (F({r['graus_liberdade_modelo']},{r['graus_liberdade_residual']}) = {_br(r['estatistica_F'])}, {_pv(r['p_valor_modelo_global'])}). "
    )
    sig_coefs = [c for c in r['coeficientes'] if c['variavel'] != 'Intercepto' and 'não' not in c['significativo_5pct']]
    if sig_coefs:
        narrativa += "Preditores independentes significativos: " + "; ".join(
            f"{c['variavel']} (β={_br(c['coeficiente_beta'], 3)}, IC95% {_br(c['ic95'][0], 3)} a {_br(c['ic95'][1], 3)}, {_pv(c['p_valor'])})"
            for c in sig_coefs
        ) + "."
    else:
        narrativa += "Nenhum preditor individual atingiu significância estatística a 5%."
    if r.get('multicolinearidade_VIF'):
        vif_altos = [v for v in r['multicolinearidade_VIF'] if v['VIF'] > 10]
        if vif_altos:
            narrativa += " Atenção: VIF > 10 sugere multicolinearidade relevante para " + ", ".join(v['variavel'] for v in vif_altos) + "."
    headers = ["Variável", "β (ou OR)", "IC95%", "p-valor"]
    rows = [[c['variavel'], _br(c['coeficiente_beta'], 3), f"{_br(c['ic95'][0], 3)} a {_br(c['ic95'][1], 3)}", _pv(c['p_valor'])] for c in r['coeficientes']]
    return {"titulo": f"Regressão linear múltipla — {y}", "narrativa": narrativa, "tabela": (headers, rows)}


def _fmt_regressao_logistica(r, p):
    y, x = p.get('y', r.get('variavel_dependente', 'desfecho')), p.get('x', 'preditores')
    sig_coefs = [c for c in r['coeficientes'] if c['variavel'] != 'Intercepto' and 'não' not in c['significativo_5pct']]
    narrativa = (
        f"No modelo de regressão logística para \"{y}\" (preditores: {x}; n={r['n']}, prevalência do desfecho = "
        f"{_br(r['prevalencia_evento_y1'] * 100, 1)}%; pseudo-R² de McFadden = {_br(r['pseudo_r2_mcfadden'], 3)}), "
    )
    if sig_coefs:
        narrativa += "associaram-se de forma independente com o desfecho: " + "; ".join(
            f"{c['variavel']} (OR={_br(c['razao_de_chances_OR'], 3)}, IC95% {_br(c['ic95_OR'][0], 3)} a {_br(c['ic95_OR'][1], 3)}, {_pv(c['p_valor'])})"
            for c in sig_coefs
        ) + "."
    else:
        narrativa += "nenhum preditor individual atingiu significância estatística a 5%."
    headers = ["Variável", "OR", "IC95% (OR)", "p-valor"]
    rows = [[c['variavel'], _br(c['razao_de_chances_OR'], 3) if c['razao_de_chances_OR'] is not None else "—",
             f"{_br(c['ic95_OR'][0], 3)} a {_br(c['ic95_OR'][1], 3)}" if c['ic95_OR'] else "—", _pv(c['p_valor'])] for c in r['coeficientes']]
    return {"titulo": f"Regressão logística binária — {y}", "narrativa": narrativa, "tabela": (headers, rows)}


def _fmt_kaplan_meier(r, p):
    tempo, evento, grp = p.get('tempo', 'tempo'), p.get('evento', 'evento'), p.get('group')
    narrativa = f"Análise de sobrevida (Kaplan-Meier) para \"{tempo}\"/\"{evento}\" (N={r['n_total']}, {r['n_eventos']} eventos, {r['n_censuras']} censuras). "
    rows = []
    if grp and r.get('curvas_por_grupo'):
        for nome, c in r['curvas_por_grupo'].items():
            med = _br(c['mediana_sobrevida'], 1) if c['mediana_sobrevida'] is not None else "não alcançada"
            rows.append([nome, c['n'], c['n_eventos'], med])
        lr = r.get('teste_logrank')
        if lr:
            verbo = "sem diferença estatisticamente significativa" if 'não' in lr['significativo_5pct'] else "com diferença estatisticamente significativa"
            narrativa += f"As curvas por grupo ({grp}) foram comparadas por log-rank, {verbo} (χ²({lr['graus_liberdade']}) = {_br(lr['estatistica_qui_quadrado'])}, {_pv(lr['p_valor'])})."
        headers = ["Grupo", "N", "Eventos", "Sobrevida mediana"]
    else:
        med = _br(r.get('mediana_sobrevida'), 1) if r.get('mediana_sobrevida') is not None else "não alcançada"
        narrativa += f"Sobrevida mediana = {med}."
        headers, rows = ["N", "Eventos", "Censuras", "Sobrevida mediana"], [[r['n_total'], r['n_eventos'], r['n_censuras'], med]]
    return {"titulo": f"Kaplan-Meier — {tempo}" + (f" por {grp}" if grp else ""), "narrativa": narrativa, "tabela": (headers, rows)}


def _fmt_correcao_multiplas(r, p):
    narrativa = f"Correção para múltiplas comparações ({r['metodo']}) aplicada a {len(r['comparacoes'])} p-valores: " + "; ".join(
        f"#{c['indice']} {_pv(c['p_bruto'])} → p ajustado={_br(c['p_ajustado'], 4)} ({c['significativo_5pct']})" for c in r['comparacoes']
    ) + "."
    headers = ["#", "p bruto", "p ajustado", "Conclusão"]
    rows = [[c['indice'], _pv(c['p_bruto']), _br(c['p_ajustado'], 4), c['significativo_5pct']] for c in r['comparacoes']]
    return {"titulo": f"Correção de múltiplas comparações ({r['metodo']})", "narrativa": narrativa, "tabela": (headers, rows)}


COMANDO_FORMATADORES = {
    'ttest_independente': _fmt_ttest_independente,
    'ttest_pareado': _fmt_ttest_pareado,
    'mannwhitney': _fmt_mannwhitney,
    'wilcoxon': _fmt_wilcoxon,
    'anova_oneway': _fmt_anova_oneway,
    'kruskal': _fmt_kruskal,
    'qui_quadrado': _fmt_qui_quadrado,
    'correlacao': _fmt_correlacao,
    'regressao_linear': _fmt_regressao_linear,
    'regressao_logistica': _fmt_regressao_logistica,
    'kaplan_meier': _fmt_kaplan_meier,
    'correcao_multiplas': _fmt_correcao_multiplas,
}

# Comandos de comparação de grupos que também podem aparecer como "comparação
# principal" (seção 1-3, guiada por --var/--group) — para não duplicar a mesma
# análise na seção de "demais análises da sessão".
_COMPARACAO_GRUPOS_COMANDOS = {'ttest_independente', 'mannwhitney', 'anova_oneway', 'kruskal'}


# --------------------------------------------------------------------------- #
# Tabela 1 (características basais) — comparação de balanceamento entre braços,
# independente da comparação principal de desfecho.
# --------------------------------------------------------------------------- #

def _detectar_tipo_coluna(serie):
    s_num = pd.to_numeric(serie, errors="coerce")
    n_validos = serie.notna().sum()
    prop_num = s_num.notna().sum() / max(n_validos, 1)
    return "numerica" if prop_num > 0.9 and n_validos > 0 else "categorica"


def _comparar_grupos_numerico(grupos_dados):
    """Escolhe automaticamente teste paramétrico/não paramétrico (mesma lógica da
    comparação principal) e devolve (nome_teste, p_valor) — usado para a coluna
    de p-valor de balanceamento na Tabela 1, sem post-hoc/effect size (não é o
    desfecho, só uma checagem de equilíbrio entre braços)."""
    validos = [g for g in grupos_dados if len(g) > 0]
    if len(validos) < 2:
        return None, None
    norm_ok = all(len(g) < 3 or stats.shapiro(g)[1] >= 0.05 for g in validos)
    try:
        _, lev_p = stats.levene(*validos)
    except Exception:
        lev_p = 1.0
    if len(validos) == 2:
        a, b = validos
        if len(a) < 2 or len(b) < 2:
            return None, None
        if norm_ok and lev_p >= 0.05:
            return "Teste t", stats.ttest_ind(a, b, equal_var=True)[1]
        if norm_ok:
            return "Teste t de Welch", stats.ttest_ind(a, b, equal_var=False)[1]
        return "Mann-Whitney U", stats.mannwhitneyu(a, b, alternative='two-sided')[1]
    if norm_ok and lev_p >= 0.05:
        return "ANOVA", stats.f_oneway(*validos)[1]
    return "Kruskal-Wallis", stats.kruskal(*validos)[1]


def _comparar_grupos_categorico(df, col_var, col_group):
    sub = df[[col_var, col_group]].dropna()
    tabela = pd.crosstab(sub[col_var], sub[col_group])
    if tabela.shape[0] < 2 or tabela.shape[1] < 2:
        return None, None
    chi2, p, gl, esperado = stats.chi2_contingency(tabela)
    if tabela.shape == (2, 2):
        return "Fisher exato", stats.fisher_exact(tabela.to_numpy())[1]
    return "Qui-quadrado", p


def construir_tabela1_basais(df, col_group, baseline_vars):
    """Monta a Tabela 1 clássica de artigo (características basais por braço +
    p-valor de balanceamento), a partir de uma lista de colunas indicadas por
    quem conduziu a entrevista (Etapa 1/3) — não adivinha sozinho quais colunas
    são covariáveis basais."""
    if not col_group or not baseline_vars:
        return None
    nomes_grupos = [str(g) for g in df[col_group].dropna().unique()]
    linhas = []
    for var in baseline_vars:
        var = var.strip()
        if not var or var not in df.columns:
            continue
        tipo = _detectar_tipo_coluna(df[var])
        if tipo == "numerica":
            grupos_dados = [limpar_numerico(df[df[col_group] == g][var])[0] for g in df[col_group].dropna().unique()]
            valores = []
            for g in grupos_dados:
                if len(g) == 0:
                    valores.append("—")
                elif len(g) > 1:
                    valores.append(f"{_br(np.mean(g))} ± {_br(np.std(g, ddof=1))}")
                else:
                    valores.append(_br(np.mean(g)))
            teste, p = _comparar_grupos_numerico(grupos_dados)
            linhas.append([var, *valores, _pv(p) if p is not None else "NC", teste or "—"])
        else:
            sub = df[[var, col_group]].dropna()
            categorias = sub[var].value_counts().index.tolist()[:6]
            teste, p = _comparar_grupos_categorico(df, var, col_group)
            for cat in categorias:
                valores = []
                for g in df[col_group].dropna().unique():
                    sub_g = sub[sub[col_group] == g]
                    n_g = len(sub_g)
                    n_cat = int((sub_g[var] == cat).sum())
                    pct = 100 * n_cat / n_g if n_g else 0
                    valores.append(f"{n_cat} ({_br(pct, 1)}%)")
                linhas.append([f"{var} = {cat}", *valores, _pv(p) if p is not None else "NC", teste or "—"])
    if not linhas:
        return None
    return {"headers": ["Característica", *nomes_grupos, "p-valor", "Teste"], "linhas": linhas}


# --------------------------------------------------------------------------- #
# Gráficos (matplotlib) — cada função devolve uma Figure ou None; a inserção no
# PDF (conversão para Image do reportlab) é feita por um helper local dentro de
# cmd_gerar_pdf, onde Image/ImageReader já estão importados.
# --------------------------------------------------------------------------- #

def _fig_boxplot(grupos_dados, grupos_nomes, var_nome):
    validos = [(n, g) for n, g in zip(grupos_nomes, grupos_dados) if len(g) > 0]
    if not validos:
        return None
    nomes, dados = zip(*validos)
    fig, ax = plt.subplots(figsize=(5.2, 3.2))
    bp = ax.boxplot(dados, patch_artist=True, showmeans=True)
    ax.set_xticks(range(1, len(nomes) + 1))
    ax.set_xticklabels(nomes)
    for patch in bp['boxes']:
        patch.set_facecolor('#DBEAFE')
        patch.set_edgecolor('#1D4ED8')
    rng = np.random.default_rng(0)
    for i, g in enumerate(dados):
        x = rng.normal(i + 1, 0.04, size=len(g))
        ax.scatter(x, g, alpha=0.5, s=12, color='#0F172A', zorder=3)
    ax.set_ylabel(var_nome)
    ax.set_title(f"Distribuição de {var_nome} por grupo", fontsize=10)
    ax.spines[['top', 'right']].set_visible(False)
    fig.tight_layout()
    return fig


def _fig_qqplot(grupos_dados, grupos_nomes, var_nome):
    validos = [(n, g) for n, g in zip(grupos_nomes, grupos_dados) if len(g) >= 3]
    if not validos:
        return None
    fig, axes = plt.subplots(1, len(validos), figsize=(3.0 * len(validos), 3.0), squeeze=False)
    for ax, (nome, g) in zip(axes[0], validos):
        stats.probplot(g, dist="norm", plot=ax)
        ax.set_title(f"Q-Q: {nome}", fontsize=9)
        ax.get_lines()[0].set_markerfacecolor('#1D4ED8')
        ax.get_lines()[0].set_markeredgecolor('#1D4ED8')
        ax.get_lines()[0].set_markersize(4)
        ax.get_lines()[1].set_color('#DC2626')
        ax.spines[['top', 'right']].set_visible(False)
    fig.suptitle(f"Avaliação visual de normalidade — {var_nome}", fontsize=10)
    fig.tight_layout()
    return fig


def _fig_forest(coeficientes, usa_or, titulo):
    coefs = [c for c in coeficientes if c['variavel'] != 'Intercepto']
    campo_valor = 'razao_de_chances_OR' if usa_or else 'coeficiente_beta'
    campo_ic = 'ic95_OR' if usa_or else 'ic95'
    coefs = [c for c in coefs if c.get(campo_valor) is not None and c.get(campo_ic)]
    if not coefs:
        return None
    coefs = coefs[::-1]
    fig, ax = plt.subplots(figsize=(5.2, max(1.6, 0.5 * len(coefs) + 1)))
    for i, c in enumerate(coefs):
        v, ic = c[campo_valor], c[campo_ic]
        ax.plot([ic[0], ic[1]], [i, i], color='#1D4ED8', lw=1.5, zorder=2)
        ax.plot(v, i, 'o', color='#0F172A', ms=6, zorder=3)
    ax.axvline(1.0 if usa_or else 0.0, color='#DC2626', linestyle='--', lw=1)
    ax.set_yticks(range(len(coefs)))
    ax.set_yticklabels([c['variavel'] for c in coefs])
    ax.set_xlabel("Odds ratio (IC95%)" if usa_or else "Coeficiente β (IC95%)")
    ax.set_title(titulo, fontsize=10)
    ax.spines[['top', 'right']].set_visible(False)
    fig.tight_layout()
    return fig


def _fig_km(resultado, tempo_label):
    curvas = resultado.get('curvas_por_grupo')
    fig, ax = plt.subplots(figsize=(5.2, 3.4))
    if curvas:
        cores = plt.get_cmap('tab10').colors
        for i, (nome, c) in enumerate(curvas.items()):
            pontos = c.get('pontos_curva') or []
            if not pontos:
                continue
            xs = [0] + [p['tempo'] for p in pontos]
            ys = [1.0] + [p['sobrevida_acumulada'] for p in pontos]
            ax.step(xs, ys, where='post', label=f"{nome} (n={c['n']})", color=cores[i % len(cores)])
        ax.legend(fontsize=7)
    else:
        pontos = resultado.get('pontos_curva') or []
        if not pontos:
            plt.close(fig)
            return None
        xs = [0] + [p['tempo'] for p in pontos]
        ys = [1.0] + [p['sobrevida_acumulada'] for p in pontos]
        ax.step(xs, ys, where='post', color='#1D4ED8')
    ax.set_ylim(0, 1.05)
    ax.set_xlabel(tempo_label)
    ax.set_ylabel("Sobrevida acumulada")
    ax.set_title("Curva de Kaplan-Meier", fontsize=10)
    ax.spines[['top', 'right']].set_visible(False)
    fig.tight_layout()
    return fig


# --------------------------------------------------------------------------- #
# Checklist de aderência a diretriz de relato (CONSORT / STROBE / TRIPOD)
# --------------------------------------------------------------------------- #
# A entrevista de desenho do estudo (Etapa 1 do skill.md) acontece no chat,
# antes de qualquer dado ser carregado — não há como o script "adivinhar" se é
# um ensaio clínico ou um estudo de coorte a partir da planilha. Por isso quem
# conduziu a entrevista informa o desenho via --desenho ao chamar gerar_pdf.
# O checklist é montado de forma honesta: só marca como "coberto" o item que
# realmente foi produzido nesta sessão (via o manifesto), e é explícito sobre
# tudo que fica de fora do escopo de um relatório puramente estatístico
# (registro do ensaio, fluxograma, cegamento, tamanho amostral a priori etc.)
# — nunca declara aderência total à diretriz por conta própria.

_SINONIMOS_DESENHO = {
    "ensaio_clinico": ["ensaio", "ensaio_clinico", "ensaioclinico", "rct", "trial", "experimental", "clinical_trial"],
    "coorte": ["coorte", "cohort"],
    "caso_controle": ["caso_controle", "casocontrole", "case_control"],
    "transversal": ["transversal", "cross_sectional", "crosssectional", "corte_transversal"],
    "diagnostico_preditivo": ["diagnostico", "prognostico", "preditivo", "predicao", "tripod", "diagnostico_preditivo"],
}


def _remover_acentos(txt):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", txt) if not unicodedata.combining(c))


def _normalizar_desenho(txt):
    if not txt:
        return None
    chave = _remover_acentos(str(txt).strip().lower()).replace("-", "_").replace(" ", "_")
    for canonico, sinonimos in _SINONIMOS_DESENHO.items():
        if chave == canonico or chave in sinonimos:
            return canonico
    return None


DIRETRIZES_RELATO = {
    "ensaio_clinico": {
        "nome": "CONSORT 2010",
        "descricao": "ensaio clínico",
        "itens_sempre": [
            ("Métodos estatísticos", "Testes de hipótese, pressupostos verificados e medidas de efeito com IC95% reportados."),
            ("Desfechos com estimativa de precisão", "Reportados com estatística de teste, p-valor e IC95%/tamanho de efeito, nunca só p-valor."),
        ],
        "itens_condicionais": {
            "tabela1": ("Dados basais por grupo", "Tabela 1 com características basais e balanceamento entre braços."),
            "correcao_multiplas": ("Ajuste para múltiplas comparações", "Correção (Bonferroni/FDR) aplicada e reportada."),
            "posthoc": ("Comparações pareadas pós-teste global", "Post-hoc com correção reportado após teste global significativo."),
            "regressao_linear": ("Análise ajustada (covariáveis)", "Modelo de regressão multivariável reportado."),
            "regressao_logistica": ("Análise ajustada (covariáveis)", "Modelo de regressão multivariável reportado."),
            "kaplan_meier": ("Desfecho de tempo até evento", "Curva de sobrevida e teste log-rank reportados."),
        },
        "itens_fora_do_escopo": [
            "Registro do ensaio (nº de registro, ex. ClinicalTrials.gov) e protocolo",
            "Diagrama de fluxo CONSORT (triagem, alocação, seguimento, perdas/exclusões)",
            "Geração da sequência de randomização e ocultação de alocação",
            "Cegamento (quem foi cegado e como)",
            "Cálculo de tamanho amostral/poder a priori",
            "Critérios de elegibilidade, período e local de recrutamento",
            "Financiamento e conflitos de interesse",
        ],
    },
    "coorte": {
        "nome": "STROBE (estudo de coorte)",
        "descricao": "estudo observacional de coorte",
        "itens_sempre": [
            ("Métodos estatísticos", "Testes de hipótese, pressupostos verificados e medidas de efeito com IC95% reportados."),
            ("Variáveis e desfechos", "Definidos e descritos com estatística descritiva completa."),
        ],
        "itens_condicionais": {
            "tabela1": ("Características basais por grupo/exposição", "Tabela 1 com balanceamento entre grupos de exposição."),
            "correcao_multiplas": ("Ajuste para múltiplas comparações", "Correção (Bonferroni/FDR) aplicada e reportada."),
            "regressao_linear": ("Controle de confundidores", "Modelo multivariável ajustado reportado."),
            "regressao_logistica": ("Controle de confundidores", "Modelo multivariável ajustado reportado."),
            "kaplan_meier": ("Desfecho de tempo até evento e perdas de seguimento", "Curva de sobrevida e teste log-rank reportados."),
        },
        "itens_fora_do_escopo": [
            "Fonte da coorte, período e critérios de elegibilidade",
            "Métodos de recrutamento e de acompanhamento (perdas, tempo de seguimento)",
            "Estratégias de controle de viés além do ajuste estatístico (ex. matching)",
            "Justificativa do tamanho amostral disponível",
            "Financiamento e conflitos de interesse",
        ],
    },
    "caso_controle": {
        "nome": "STROBE (caso-controle)",
        "descricao": "estudo observacional caso-controle",
        "itens_sempre": [
            ("Métodos estatísticos", "Testes de hipótese, pressupostos verificados e medidas de efeito (OR) com IC95% reportados."),
            ("Variáveis e desfechos", "Definidos e descritos com estatística descritiva completa."),
        ],
        "itens_condicionais": {
            "tabela1": ("Características basais casos vs. controles", "Tabela 1 com balanceamento entre casos e controles."),
            "correcao_multiplas": ("Ajuste para múltiplas comparações", "Correção (Bonferroni/FDR) aplicada e reportada."),
            "regressao_logistica": ("Controle de confundidores (OR ajustado)", "Modelo de regressão logística multivariável reportado."),
        },
        "itens_fora_do_escopo": [
            "Critérios de definição e seleção de casos e controles",
            "Método de pareamento (matching), se houver",
            "Fonte de exposição e possíveis vieses de recordação/seleção",
            "Justificativa da razão caso:controle e do tamanho amostral",
            "Financiamento e conflitos de interesse",
        ],
    },
    "transversal": {
        "nome": "STROBE (transversal)",
        "descricao": "estudo observacional transversal",
        "itens_sempre": [
            ("Métodos estatísticos", "Testes de hipótese, pressupostos verificados e medidas de efeito com IC95% reportados."),
            ("Variáveis e desfechos", "Definidos e descritos com estatística descritiva completa."),
        ],
        "itens_condicionais": {
            "tabela1": ("Características basais por grupo", "Tabela 1 com balanceamento entre grupos comparados."),
            "correcao_multiplas": ("Ajuste para múltiplas comparações", "Correção (Bonferroni/FDR) aplicada e reportada."),
            "regressao_linear": ("Controle de confundidores", "Modelo multivariável ajustado reportado."),
            "regressao_logistica": ("Controle de confundidores", "Modelo multivariável ajustado reportado."),
        },
        "itens_fora_do_escopo": [
            "Contexto, local e período em que os dados foram coletados",
            "Critérios de elegibilidade e estratégia de amostragem",
            "Possíveis vieses de seleção/informação",
            "Justificativa do tamanho amostral disponível",
            "Financiamento e conflitos de interesse",
        ],
    },
    "diagnostico_preditivo": {
        "nome": "TRIPOD",
        "descricao": "estudo de predição/diagnóstico",
        "itens_sempre": [
            ("Especificação do modelo", "Preditores, desfecho e forma do modelo (linear/logístico) descritos."),
            ("Desempenho do modelo", "Medidas de ajuste (R², pseudo-R², acurácia) reportadas."),
        ],
        "itens_condicionais": {
            "regressao_linear": ("Coeficientes do modelo com IC95%", "Reportados com erro padrão, IC95% e p-valor por preditor."),
            "regressao_logistica": ("Odds ratio por preditor com IC95%", "Reportados com IC95% e p-valor por preditor."),
        },
        "itens_fora_do_escopo": [
            "Validação interna (bootstrap/cross-validation) ou externa do modelo",
            "Tratamento de dados ausentes no desenvolvimento do modelo",
            "Forma funcional testada para preditores contínuos e possíveis interações",
            "Aplicabilidade clínica e população-alvo do modelo",
        ],
    },
}


def montar_checklist_diretriz(desenho_key, flags):
    """flags: dict com chaves tabela1/correcao_multiplas/posthoc/regressao_linear/
    regressao_logistica/kaplan_meier -> bool, conforme o que foi de fato produzido
    nesta sessão (nunca marca um item como coberto só porque o desenho combina
    com ele — só se o comando/seção correspondente realmente rodou)."""
    cfg = DIRETRIZES_RELATO.get(desenho_key)
    if not cfg:
        return None
    linhas = []
    for item, obs in cfg["itens_sempre"]:
        linhas.append([item, "Coberto neste relatório", obs])
    for chave_flag, (item, obs) in cfg["itens_condicionais"].items():
        if flags.get(chave_flag):
            linhas.append([item, "Coberto neste relatório", obs])
    for item in cfg["itens_fora_do_escopo"]:
        linhas.append([item, "Fora do escopo deste relatório", "A descrever pelo(a) pesquisador(a) no manuscrito."])
    return {"nome": cfg["nome"], "descricao": cfg["descricao"], "linhas": linhas}


def cmd_gerar_pdf(args):
    df, real_path = carregar_dados_com_caminho(args.input, args.sheet)
    if args:
        df, _ = resolver_e_criar_colunas(df, args)

    var_alvo = getattr(args, 'var', None)
    grupo_alvo = getattr(args, 'group', None)
    baseline_vars = [v for v in (getattr(args, 'baseline_vars', None) or '').split(',') if v.strip()]
    desenho_key = _normalizar_desenho(getattr(args, 'desenho', None))
    randomizado = bool(getattr(args, 'randomizado', False))
    out_name = getattr(args, 'out', None) or getattr(args, 'output', None) or 'Relatorio_Estatistico_HighImpact.pdf'

    if not out_name.endswith('.pdf'):
        out_name += '.pdf'

    if not out_name.startswith('dados/'):
        out_path = os.path.join('dados', os.path.basename(out_name))
    else:
        out_path = out_name

    out_dir = os.path.dirname(out_path)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    col_var = None
    if var_alvo:
        col_var = next((c for c in df.columns if c.strip().lower() == var_alvo.strip().lower()), None)
        if not col_var:
            erro(f"Coluna '{var_alvo}' não encontrada na planilha. Colunas disponíveis: {list(df.columns)}")

    col_group = None
    if grupo_alvo:
        col_group = next((c for c in df.columns if c.strip().lower() == grupo_alvo.strip().lower()), None)
        if not col_group:
            erro(f"Coluna de grupo '{grupo_alvo}' não encontrada na planilha. Colunas disponíveis: {list(df.columns)}")

    tabela1_basais = construir_tabela1_basais(df, col_group, baseline_vars)

    desc_rows = []
    grupos_unicos = []
    grupos_dados = []
    norm_res = []
    norm_violada = False
    lev_stat, lev_pval = None, None
    comp_titulo, comp_detalhe, posthoc_rows = None, None, []

    if col_var:
        grupos_unicos = list(df[col_group].dropna().unique()) if col_group else ['Geral']

        for g in grupos_unicos:
            sub = df[df[col_group] == g][col_var] if col_group else df[col_var]
            arr, n_tot, n_val = limpar_numerico(sub)
            if len(arr) > 0:
                m = np.mean(arr)
                sd = np.std(arr, ddof=1) if len(arr) > 1 else 0
                med = np.median(arr)
                q25, q75 = np.percentile(arr, 25), np.percentile(arr, 75)
                iqr = q75 - q25
                mn, mx = np.min(arr), np.max(arr)
                se = sd / np.sqrt(len(arr)) if len(arr) > 1 else 0
                tcrit = stats.t.ppf(0.975, df=len(arr) - 1) if len(arr) > 1 else 1.96
                ic_low, ic_high = m - tcrit * se, m + tcrit * se
                skew_val = stats.skew(arr) if len(arr) >= 3 else 0.0

                desc_rows.append({
                    'grupo': str(g),
                    'n': n_val,
                    'media_ic': f"{_br(m)} ({_br(ic_low)} a {_br(ic_high)})",
                    'sd': _br(sd),
                    'mediana': _br(med),
                    'iqr': f"{_br(iqr)} ({_br(q25)} a {_br(q75)})",
                    'min_max': f"{_br(mn)} a {_br(mx)}",
                    'skew': _br(skew_val)
                })

        for g in grupos_unicos:
            sub = df[df[col_group] == g][col_var] if col_group else df[col_var]
            arr, _, _ = limpar_numerico(sub)
            if len(arr) >= 3:
                stat, pval = stats.shapiro(arr)
                if pval < 0.05:
                    norm_violada = True
                status_str = "compatível com normal" if pval >= 0.05 else "assimétrica, não normal"
                norm_res.append(f"{g}: W={_br(stat, 3)}, {_pv(pval)} ({status_str})")

        grupos_dados = [limpar_numerico(df[df[col_group] == g][col_var] if col_group else df[col_var])[0] for g in grupos_unicos]

        # Comparação entre grupos: só faz sentido com coluna de grupo e 2+ grupos com dados.
        if col_group and len([g for g in grupos_dados if len(g) > 0]) >= 2:
            lev_stat, lev_pval = stats.levene(*grupos_dados)

            if len(grupos_unicos) == 2:
                a, b = grupos_dados[0], grupos_dados[1]
                if not norm_violada and lev_pval >= 0.05 and len(a) >= 2 and len(b) >= 2:
                    stat, pv = stats.ttest_ind(a, b, equal_var=True)
                    comp_titulo = "Teste t de Student (paramétrico)"
                    d = cohen_d_independente(a, b)
                    comp_detalhe = f"t({len(a) + len(b) - 2}) = {_br(stat)}, {_pv(pv)}; d de Cohen = {_br(d, 3)} ({interpretar_cohen_d(abs(d))})"
                elif not norm_violada and len(a) >= 2 and len(b) >= 2:
                    stat, pv = stats.ttest_ind(a, b, equal_var=False)
                    comp_titulo = "Teste t de Welch (paramétrico, variâncias desiguais)"
                    d = cohen_d_independente(a, b)
                    comp_detalhe = f"t({_br(welch_gl(a, b), 1)}) = {_br(stat)}, {_pv(pv)}; d de Cohen = {_br(d, 3)} ({interpretar_cohen_d(abs(d))})"
                else:
                    comp_titulo = "Mann-Whitney U (não paramétrico)"
                    u_stat, pv = stats.mannwhitneyu(a, b, alternative='two-sided')
                    r_rb = rank_biserial_mannwhitney(u_stat, len(a), len(b))
                    comp_detalhe = f"U = {_br(u_stat)}, {_pv(pv)}; r = {_br(r_rb, 3)}"
            else:
                if norm_violada or lev_pval < 0.05 or any(len(g) < 3 for g in grupos_dados):
                    h_stat, p_val = stats.kruskal(*grupos_dados)
                    comp_titulo = "Kruskal-Wallis (não paramétrico)"
                    n_tot = sum(len(g) for g in grupos_dados)
                    eps_sq = (h_stat - len(grupos_unicos) + 1) / (n_tot - len(grupos_unicos)) if n_tot > len(grupos_unicos) else 0
                    comp_detalhe = f"H({len(grupos_unicos) - 1}) = {_br(h_stat)}, {_pv(p_val)}; ε² = {_br(eps_sq, 4)}"

                    num_comp = len(grupos_unicos) * (len(grupos_unicos) - 1) / 2
                    for i in range(len(grupos_unicos)):
                        for j in range(i + 1, len(grupos_unicos)):
                            g1n, g2n = str(grupos_unicos[i]), str(grupos_unicos[j])
                            d1, d2 = grupos_dados[i], grupos_dados[j]
                            u_stat, p_pair = stats.mannwhitneyu(d1, d2, alternative='two-sided')
                            n1, n2 = len(d1), len(d2)
                            sigma_u = np.sqrt(n1 * n2 * (n1 + n2 + 1) / 12.0)
                            z_val = (u_stat - (n1 * n2) / 2.0) / sigma_u if sigma_u > 0 else 0.0
                            r_eff = abs(z_val) / np.sqrt(n1 + n2) if (n1 + n2) > 0 else 0.0
                            p_adj = min(p_pair * num_comp, 1.0)
                            posthoc_rows.append([f"{g1n} vs. {g2n}", f"Z = {_br(z_val)}", _pv(p_pair), _br(p_adj, 4), _br(r_eff, 3),
                                                  "não estatisticamente significativo" if p_adj >= 0.05 else "estatisticamente significativo"])
                else:
                    f_stat, p_val = stats.f_oneway(*grupos_dados)
                    comp_titulo = "ANOVA one-way (paramétrico)"
                    comp_detalhe = f"F({len(grupos_unicos) - 1}, {sum(len(g) for g in grupos_dados) - len(grupos_unicos)}) = {_br(f_stat)}, {_pv(p_val)}"

    # Demais análises registradas na sessão (dados/_analises_sessao.jsonl) — cada uma foi
    # calculada e mostrada ao usuário durante a conversa; aqui apenas renderizamos, sem
    # recalcular nada nem inventar conclusão.
    secoes_extra = []
    comandos_extra_unicos = []
    for entrada in ler_manifesto():
        comando = entrada.get('comando')
        formatador = COMANDO_FORMATADORES.get(comando)
        if not formatador:
            continue
        par = entrada.get('params', {})
        if col_var and col_group and comando in _COMPARACAO_GRUPOS_COMANDOS:
            if str(par.get('var', '')).strip().lower() == col_var.strip().lower() and \
               str(par.get('group', '')).strip().lower() == col_group.strip().lower():
                continue  # já coberto na comparação principal (seções 1-3)
        try:
            secao = formatador(entrada.get('resultado', {}), par)
        except (KeyError, TypeError):
            continue  # entrada malformada/incompleta não deve derrubar o relatório inteiro
        secao['comando'] = comando
        secao['resultado'] = entrada.get('resultado', {})
        secao['params'] = par
        secoes_extra.append(secao)
        if comando not in comandos_extra_unicos:
            comandos_extra_unicos.append(comando)

    checklist_diretriz = None
    if desenho_key:
        flags_checklist = {
            "tabela1": bool(tabela1_basais),
            "correcao_multiplas": "correcao_multiplas" in comandos_extra_unicos,
            "posthoc": bool(posthoc_rows),
            "regressao_linear": "regressao_linear" in comandos_extra_unicos,
            "regressao_logistica": "regressao_logistica" in comandos_extra_unicos,
            "kaplan_meier": "kaplan_meier" in comandos_extra_unicos,
        }
        checklist_diretriz = montar_checklist_diretriz(desenho_key, flags_checklist)

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, Image
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.utils import ImageReader
        from reportlab.lib import colors

        doc = SimpleDocTemplate(out_path, pagesize=A4, leftMargin=32, rightMargin=32, topMargin=32, bottomMargin=32)
        styles = getSampleStyleSheet()

        title_style = ParagraphStyle('DocTitle', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=17, leading=21, textColor=colors.HexColor('#0F172A'), spaceAfter=2)
        subtitle_style = ParagraphStyle('DocSubtitle', parent=styles['Normal'], fontName='Helvetica', fontSize=9, leading=12, textColor=colors.HexColor('#475569'), spaceAfter=6)
        meta_label = ParagraphStyle('MetaLabel', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=colors.HexColor('#0F172A'))
        meta_val = ParagraphStyle('MetaVal', parent=styles['Normal'], fontName='Helvetica', fontSize=8, leading=10, textColor=colors.HexColor('#334155'))
        h2_style = ParagraphStyle('SectionHeading', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=11, leading=14, textColor=colors.HexColor('#0F172A'), spaceBefore=8, spaceAfter=4)
        body_style = ParagraphStyle('BodyTextCustom', parent=styles['Normal'], fontName='Helvetica', fontSize=8.2, leading=11.5, textColor=colors.HexColor('#1E293B'), spaceAfter=4)
        quote_style = ParagraphStyle('QuoteCustom', parent=styles['Normal'], fontName='Helvetica-Oblique', fontSize=8.2, leading=11.8, textColor=colors.HexColor('#0F172A'), backColor=colors.HexColor('#F8FAFC'), borderColor=colors.HexColor('#CBD5E1'), borderWidth=0.5, borderPadding=5, spaceBefore=3, spaceAfter=5)
        th_style = ParagraphStyle('TableHeader', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=7.5, leading=9.5, textColor=colors.white, alignment=1)
        tb_style = ParagraphStyle('TableCell', parent=styles['Normal'], fontName='Helvetica', fontSize=7.5, leading=9.5, textColor=colors.HexColor('#1E293B'), alignment=1)

        elements = []
        sec_num = [1]  # lista para poder incrementar dentro dos helpers abaixo

        def titulo_secao(texto):
            elements.append(Paragraph(f"{sec_num[0]}. {texto}", h2_style))
            sec_num[0] += 1

        def tabela_generica(headers, rows, col_widths=None):
            t_headers = [Paragraph(str(h), th_style) for h in headers]
            t_rows = [t_headers] + [[Paragraph(str(c), tb_style) for c in row] for row in rows]
            if col_widths is None:
                largura = 530 / len(headers)
                col_widths = [largura] * len(headers)
            t = Table(t_rows, colWidths=col_widths)
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0F172A')),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F8FAFC')]),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
                ('TOPPADDING', (0, 0), (-1, -1), 3),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ]))
            elements.append(t)

        def inserir_figura(fig, largura=340):
            if fig is None:
                return
            try:
                buf = io.BytesIO()
                fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
                plt.close(fig)
                buf.seek(0)
                iw, ih = ImageReader(buf).getSize()
                buf.seek(0)
                elements.append(Image(buf, width=largura, height=largura * ih / iw))
                elements.append(Spacer(1, 4))
            except Exception:
                plt.close(fig)  # nunca deixar uma figura com problema derrubar o relatório inteiro

        elements.append(Paragraph("RELATÓRIO DE ANÁLISE ESTATÍSTICA", title_style))
        elements.append(Paragraph("Seções de Métodos/Resultados no padrão ICMJE / Vancouver, montadas a partir dos resultados calculados durante a sessão", subtitle_style))
        elements.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#1D4ED8'), spaceAfter=6))

        meta_table_data = [
            [Paragraph("Variável Alvo:", meta_label), Paragraph(col_var or "—", meta_val), Paragraph("Data da Análise:", meta_label), Paragraph(datetime.now().strftime('%d/%m/%Y'), meta_val)],
            [Paragraph("Coluna de Grupo:", meta_label), Paragraph(col_group or "—", meta_val), Paragraph("Tamanho da Amostra:", meta_label), Paragraph(f"N = {len(df)}" + (f" ({len(grupos_unicos)} grupos)" if col_group else ""), meta_val)],
            [Paragraph("Arquivo Fonte:", meta_label), Paragraph(os.path.basename(real_path), meta_val), Paragraph("Padrão Publicação:", meta_label), Paragraph("ICMJE / Vancouver", meta_val)]
        ]
        t_meta = Table(meta_table_data, colWidths=[85, 230, 85, 130])
        t_meta.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
            ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
            ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#F1F5F9')),
            ('TOPPADDING', (0,0), (-1,-1), 2.5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2.5),
        ]))
        elements.append(t_meta)
        elements.append(Spacer(1, 6))

        # Síntese objetiva — nada além do que os números realmente mostram (sem
        # interpretação clínica e sem afirmação que os dados não sustentem).
        bullets = []
        if comp_titulo:
            bullets.append(f"• <b>Comparação principal ({col_var} por {col_group}):</b> {comp_titulo} — {comp_detalhe}.")
        if posthoc_rows:
            n_sig = sum(1 for pr in posthoc_rows if pr[5] == "estatisticamente significativo")
            bullets.append(f"• <b>Post-hoc:</b> {n_sig} de {len(posthoc_rows)} comparações pareadas foram estatisticamente significativas (ver tabela na seção de comparação de hipóteses).")
        for secao in secoes_extra:
            bullets.append(f"• <b>{secao['titulo']}:</b> {secao['narrativa']}")
        if not bullets:
            bullets.append("• Nenhuma análise foi registrada na sessão até o momento — rode os comandos do toolkit antes de gerar o relatório.")
        resumo_texto = "<b>SÍNTESE OBJETIVA DOS ACHADOS:</b><br/>" + "<br/>".join(bullets)
        t_summary = Table([[Paragraph(resumo_texto, body_style)]], colWidths=[530])
        t_summary.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F0F9FF')),
            ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#B9E6FE')),
            ('TOPPADDING', (0,0), (-1,-1), 5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 5),
            ('LEFTPADDING', (0,0), (-1,-1), 7),
            ('RIGHTPADDING', (0,0), (-1,-1), 7),
        ]))
        elements.append(t_summary)
        elements.append(Spacer(1, 6))

        metodos_clausulas = []

        if tabela1_basais:
            titulo_secao("Tabela 1 — Características Basais por Grupo")
            tabela_generica(tabela1_basais["headers"], tabela1_basais["linhas"])
            elements.append(Spacer(1, 4))
            elements.append(Paragraph(
                "Variáveis numéricas: média ± DP, comparadas por teste t/Welch/Mann-Whitney (2 grupos) ou ANOVA/Kruskal-Wallis "
                "(3+ grupos), conforme normalidade (Shapiro-Wilk) e homogeneidade de variâncias (Levene). Categóricas: n (%), "
                "comparadas por qui-quadrado ou Fisher exato (tabelas 2×2). p-valor apenas para checagem de balanceamento entre "
                "os braços — não é o desfecho do estudo.",
                body_style,
            ))
            elements.append(Spacer(1, 6))
            metodos_clausulas.append(
                "O balanceamento basal entre os grupos foi verificado por teste t/Mann-Whitney/ANOVA/Kruskal-Wallis "
                "(variáveis numéricas) ou qui-quadrado/Fisher (categóricas)."
            )

        if desc_rows:
            titulo_secao(f"Estatísticas Descritivas do Desfecho ({col_var})")
            tabela_generica(
                ["Grupo", "N", "Média (IC 95%)", "DP", "Mediana", "IQR (Q1 - Q3)", "Mín - Máx", "Assimetria"],
                [[r['grupo'], r['n'], r['media_ic'], r['sd'], r['mediana'], r['iqr'], r['min_max'], r['skew']] for r in desc_rows],
                col_widths=[60, 20, 135, 35, 45, 115, 60, 60],
            )
            elements.append(Spacer(1, 6))
            if MATPLOTLIB_OK and len(grupos_unicos) >= 2:
                inserir_figura(_fig_boxplot(grupos_dados, [str(g) for g in grupos_unicos], col_var))
            metodos_clausulas.append(
                "Variáveis numéricas foram descritas por média, desvio-padrão e IC95% (se normais) e por mediana e IQR (Q1-Q3) caso contrário."
            )

        if norm_res:
            titulo_secao("Avaliação de Pressupostos Estatísticos")
            norm_txt = "<b>Normalidade (Shapiro-Wilk):</b> " + "; ".join(norm_res) + ".<br/>"
            if lev_pval is not None:
                norm_txt += f"<b>Homogeneidade de variâncias (Levene):</b> F={_br(lev_stat)}, {_pv(lev_pval)} ({'variâncias homogêneas' if lev_pval >= 0.05 else 'variâncias heterogêneas'}).<br/>"
            if comp_titulo:
                norm_txt += (
                    f"<b>Racional metodológico:</b> com base nesses resultados, a comparação de {col_var} entre os grupos "
                    f"foi conduzida via {comp_titulo}."
                )
            elements.append(Paragraph(norm_txt, body_style))
            elements.append(Spacer(1, 4))
            if MATPLOTLIB_OK:
                inserir_figura(_fig_qqplot(grupos_dados, [str(g) for g in grupos_unicos], col_var))
            metodos_clausulas.append("A normalidade foi avaliada por Shapiro-Wilk e a homogeneidade de variâncias por Levene, definindo a rota paramétrica ou não paramétrica de cada comparação.")

        if comp_titulo:
            titulo_secao("Comparação de Hipóteses" + (" & Post-Hoc" if posthoc_rows else ""))
            elements.append(Paragraph(f"<b>{comp_titulo}:</b> {comp_detalhe}", body_style))
            if posthoc_rows:
                elements.append(Spacer(1, 2))
                tabela_generica(
                    ["Comparação", "Estatística Z", "p-bruto", "p-ajustado", "Efeito (r)", "Conclusão"],
                    posthoc_rows,
                    col_widths=[120, 65, 60, 90, 85, 110],
                )
            elements.append(Spacer(1, 4))
            metodos_clausulas.append(f"A comparação entre os {len(grupos_unicos)} grupos usou {comp_titulo}" + (", com post-hoc para localizar os pares divergentes" if posthoc_rows else "") + ".")

        for secao in secoes_extra:
            titulo_secao(secao['titulo'])
            elements.append(Paragraph(secao['narrativa'], body_style))
            if secao.get('tabela'):
                elements.append(Spacer(1, 2))
                headers, rows = secao['tabela']
                tabela_generica(headers, rows)
            elements.append(Spacer(1, 4))
            if MATPLOTLIB_OK:
                if secao['comando'] in ('regressao_linear', 'regressao_logistica'):
                    inserir_figura(_fig_forest(
                        secao['resultado'].get('coeficientes', []),
                        usa_or=(secao['comando'] == 'regressao_logistica'),
                        titulo=secao['titulo'],
                    ))
                elif secao['comando'] == 'kaplan_meier':
                    inserir_figura(_fig_km(secao['resultado'], secao['params'].get('tempo', 'tempo')))

        nomes_legiveis = {
            'ttest_independente': 'teste t independente', 'ttest_pareado': 'teste t pareado',
            'mannwhitney': 'Mann-Whitney U', 'wilcoxon': 'Wilcoxon pareado',
            'anova_oneway': 'ANOVA one-way', 'kruskal': 'Kruskal-Wallis',
            'qui_quadrado': 'qui-quadrado/Fisher', 'correlacao': 'correlação',
            'regressao_linear': 'regressão linear múltipla', 'regressao_logistica': 'regressão logística binária',
            'kaplan_meier': 'Kaplan-Meier com log-rank', 'correcao_multiplas': 'correção de múltiplas comparações',
        }
        if comandos_extra_unicos:
            metodos_clausulas.append(
                "Também foram realizadas, ao longo da sessão: " + ", ".join(nomes_legiveis.get(c, c) for c in comandos_extra_unicos) + "."
            )

        titulo_secao("Seção de Métodos (para colar no manuscrito)")
        corpo_metodos = " ".join(metodos_clausulas) + " " if metodos_clausulas else ""
        methods_p = f"<i>\"{corpo_metodos}Considerou-se estatisticamente significativo p < 0,05. Análises realizadas em Python (SciPy/pandas), via motor determinístico stats_toolkit.py.\"</i>"
        elements.append(Paragraph(methods_p, quote_style))
        elements.append(Spacer(1, 4))

        if desc_rows and comp_titulo:
            titulo_secao("Seção de Resultados (para colar no manuscrito)")
            desc_txt = "; ".join(f"{r['grupo']} (n={r['n']}): média {r['media_ic']}, mediana {r['mediana']} (IQR {r['iqr']})" for r in desc_rows)
            results_p = f"<i>\"Foram analisados {len(df)} participantes. Para a variável {col_var}, por grupo: {desc_txt}. {comp_titulo} indicou {comp_detalhe}."
            if posthoc_rows:
                pares_txt = "; ".join(f"{pr[0]} ({pr[1]}; {pr[3]}; {pr[5]})" for pr in posthoc_rows)
                results_p += f" Nas comparações post-hoc: {pares_txt}."
            results_p += "\"</i>"
            elements.append(Paragraph(results_p, quote_style))

        if checklist_diretriz:
            titulo_secao(
                f"Checklist de Aderência — {checklist_diretriz['nome']} "
                "(uso interno do pesquisador, não é para colar no manuscrito)"
            )
            elements.append(Paragraph(
                f"Desenho informado: {checklist_diretriz['descricao']}"
                + (" (randomizado)." if desenho_key == "ensaio_clinico" and randomizado else
                   " (não randomizado)." if desenho_key == "ensaio_clinico" else "."),
                body_style,
            ))
            elements.append(Spacer(1, 2))
            tabela_generica(
                ["Item da diretriz", "Status", "Observação"],
                checklist_diretriz["linhas"],
                col_widths=[160, 130, 240],
            )
            elements.append(Spacer(1, 2))
            elements.append(Paragraph(
                "<i>Este relatório cobre apenas os itens estatísticos da diretriz. Itens marcados como "
                "\"Fora do escopo\" dependem de informação que não está na planilha analisada (protocolo, "
                "recrutamento, cegamento etc.) e precisam ser descritos pelo(a) pesquisador(a) no manuscrito "
                "para que o artigo atenda à diretriz por completo.</i>",
                body_style,
            ))

        doc.build(elements)
    except Exception as pdf_err:
        try:
            from fpdf import FPDF
            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Arial", 'B', 14)
            pdf.cell(0, 10, "RELATORIO DE ANALISE ESTATISTICA", ln=True, align='C')
            pdf.ln(4)
            pdf.set_font("Arial", '', 9)
            pdf.multi_cell(0, 5, f"Desfecho: {col_var or '-'}\nArquivo: {os.path.basename(real_path)}")
            pdf.ln(4)
            if desc_rows:
                pdf.set_font("Arial", 'B', 11)
                pdf.cell(0, 8, "1. Estatisticas Descritivas", ln=True)
                pdf.set_font("Arial", '', 9)
                for r in desc_rows:
                    pdf.cell(0, 5, f"{r['grupo']} (N={r['n']}): Media={r['media_ic']}, DP={r['sd']}, Mediana={r['mediana']}", ln=True)
                pdf.ln(4)
            if comp_titulo:
                pdf.set_font("Arial", 'B', 11)
                pdf.cell(0, 8, "2. Comparacao entre Grupos", ln=True)
                pdf.set_font("Arial", '', 9)
                pdf.multi_cell(0, 5, f"{comp_titulo}: {comp_detalhe}")
                pdf.ln(2)
            for secao in secoes_extra:
                pdf.set_font("Arial", 'B', 11)
                pdf.multi_cell(0, 8, secao['titulo'])
                pdf.set_font("Arial", '', 9)
                pdf.multi_cell(0, 5, secao['narrativa'].encode('latin-1', 'replace').decode('latin-1'))
                pdf.ln(2)
            if checklist_diretriz:
                pdf.set_font("Arial", 'B', 11)
                pdf.multi_cell(0, 8, f"Checklist de Aderencia - {checklist_diretriz['nome']}".encode('latin-1', 'replace').decode('latin-1'))
                pdf.set_font("Arial", '', 9)
                for item, status, obs in checklist_diretriz["linhas"]:
                    linha = f"[{status}] {item} - {obs}".encode('latin-1', 'replace').decode('latin-1')
                    pdf.multi_cell(0, 5, linha)
                pdf.ln(2)
            pdf.output(out_path)
        except Exception as fpdf_err:
            erro(f"Falha ao gerar PDF: {pdf_err} | {fpdf_err}")

    filename_out = os.path.basename(out_path)
    ret = {
        "sucesso": True,
        "mensagem": f"Relatório em PDF premium '{filename_out}' gerado com sucesso!",
        "caminho_saida": f"dados/{filename_out}",
        "download_url": f"/api/skills/{getattr(args, 'skill_name', 'estatistico-particular')}/media?path=dados/{filename_out}"
    }
    saida(ret)


# --------------------------------------------------------------------------- #
# CLI principal
# --------------------------------------------------------------------------- #

def main():
    parser = argparse.ArgumentParser(description="Motor estatístico determinístico")
    sub = parser.add_subparsers(dest="comando", required=True)

    def add_input_args(p):
        p.add_argument("--input", required=True, help="Caminho do arquivo .csv/.xlsx/.tsv")
        p.add_argument("--sheet", default=None, help="Nome da planilha (apenas .xlsx)")

    p = sub.add_parser("calcular_diferenca")
    add_input_args(p)
    p.add_argument("--var1", default=None)
    p.add_argument("--var2", default=None)
    p.add_argument("--nova_coluna", default=None)
    p.add_argument("--operacao", default="subtracao")
    p.set_defaults(func=cmd_calcular_diferenca)

    p = sub.add_parser("gerar_pdf")
    add_input_args(p)
    p.add_argument("--var", default=None, help="Variável numérica da comparação principal (opcional)")
    p.add_argument("--group", default=None, help="Coluna de grupo da comparação principal (opcional)")
    p.add_argument("--baseline_vars", default=None, help="Colunas de características basais para a Tabela 1, separadas por vírgula (opcional)")
    p.add_argument("--desenho", default=None,
                    help="Desenho do estudo para o checklist de diretriz de relato (opcional): "
                         "ensaio_clinico (CONSORT) | coorte | caso_controle | transversal (STROBE) | diagnostico_preditivo (TRIPOD)")
    p.add_argument("--randomizado", action="store_true", help="Marca o ensaio clínico como randomizado (só afeta o texto do checklist)")
    p.add_argument("--out", default="Relatorio_Estatistico_Premium.pdf")
    p.set_defaults(func=cmd_gerar_pdf)

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

    p = sub.add_parser("resetar_sessao", help="Apaga o histórico de análises da sessão (dados/_analises_sessao.jsonl)")
    p.set_defaults(func=cmd_resetar_sessao)

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
                'column': 'var',
                'col_nova': 'nova_coluna',
                'coluna_nova': 'nova_coluna',
                'colunanova': 'nova_coluna',
                'nome_coluna': 'nova_coluna',
                'nome_da_coluna': 'nova_coluna',
                'output': 'out',
                'out': 'out',
                'saida': 'out',
                'saída': 'out',
                'output_file': 'out',
                'outfile': 'out'
            }

            if isinstance(json_args, list):
                # Se for uma lista direta de argumentos, ex: ["explorar", "--input", "dados.csv"]
                new_argv.extend([str(item) for item in json_args])
            elif isinstance(json_args, dict):
                # Se for um objeto dicionário
                comando = json_args.get('comando') or json_args.get('command') or json_args.get('action')
                CMD_MAP = {
                    'criar_coluna': 'calcular_diferenca',
                    'calcular_delta': 'calcular_diferenca',
                    'transformar': 'calcular_diferenca',
                    'diff': 'calcular_diferenca',
                    'diferenca': 'calcular_diferenca',
                    'diferença': 'calcular_diferenca',
                    'subtracao': 'calcular_diferenca',
                    'subtrair': 'calcular_diferenca',
                    'gerar_pdf': 'gerar_pdf',
                    'relatorio_pdf': 'gerar_pdf',
                    'pdf': 'gerar_pdf',
                    'exportar_pdf': 'gerar_pdf',
                    'gerar_relatorio': 'gerar_pdf',
                    'relatorio': 'gerar_pdf'
                }
                if comando:
                    comando = CMD_MAP.get(str(comando).lower(), str(comando))
                else:
                    comando = 'explorar'
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

    args, _ = parser.parse_known_args()
    _SESSAO_CTX["comando"] = args.comando
    _SESSAO_CTX["args"] = args
    try:
        args.func(args)
    except Exception as ex:
        erro(f"Erro inesperado ao executar '{args.comando}': {ex}")


if __name__ == "__main__":
    main()