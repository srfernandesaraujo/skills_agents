"""
Suíte de testes automatizada para tools/stats_toolkit.py.

Roda de forma isolada (cada teste ganha um diretório de trabalho temporário,
então nunca escreve em skills/estatistico-particular/dados/ de verdade) e
cobre: os comandos de linha de comando (via main(), não só as funções
internas — assim o hook do manifesto de sessão também é exercitado),
o manifesto de sessão (dados/_analises_sessao.jsonl), o gerar_pdf (Tabela 1,
comparação principal, deduplicação, degradação graciosa sem matplotlib) e as
funções auxiliares puras (formatação de número, effect sizes, etc.).

Como rodar:
    pip install -r requirements.txt -r tests/requirements-test.txt
    pytest skills/estatistico-particular/tests/ -v
"""
import io
import json
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import stats_toolkit as st  # noqa: E402


# --------------------------------------------------------------------------- #
# Infraestrutura comum
# --------------------------------------------------------------------------- #

@pytest.fixture
def workdir(tmp_path, monkeypatch):
    """Isola cada teste num diretório temporário com uma pasta dados/ vazia —
    o manifesto da sessão (dados/_analises_sessao.jsonl) e os PDFs gerados
    nunca tocam a pasta real da skill."""
    (tmp_path / "dados").mkdir()
    monkeypatch.chdir(tmp_path)
    return tmp_path


def run(monkeypatch, capsys, *cli_args):
    """Roda um comando via main() (exercitando argparse + o hook do manifesto)
    e devolve o JSON impresso em stdout já parseado."""
    monkeypatch.setattr(sys, "argv", ["stats_toolkit.py", *cli_args])
    st.main()
    return json.loads(capsys.readouterr().out)


def run_erro(monkeypatch, capsys, *cli_args):
    """Mesma coisa, mas para chamadas que devem falhar (erro() -> sys.exit(1))."""
    monkeypatch.setattr(sys, "argv", ["stats_toolkit.py", *cli_args])
    with pytest.raises(SystemExit):
        st.main()
    return json.loads(capsys.readouterr().out)


def ler_manifesto_disco():
    path = os.path.join("dados", "_analises_sessao.jsonl")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(linha) for linha in f if linha.strip()]


@pytest.fixture
def csv_3grupos(workdir):
    rng = np.random.default_rng(42)
    n = 25
    df = pd.DataFrame({
        "Grupo": ["Controle"] * n + ["Farmaco_X"] * n + ["Farmaco_Y"] * n,
        "Idade": rng.normal(60, 8, n * 3).round(0),
        "Sexo": rng.choice(["F", "M"], n * 3),
        "PAS_Basal": rng.normal(140, 10, n * 3).round(1),
        "PAS_Final": np.concatenate([
            rng.normal(138, 10, n),
            rng.normal(118, 9, n),   # bem separado do controle de propósito
            rng.normal(124, 10, n),
        ]).round(1),
        "Obito": rng.binomial(1, 0.25, n * 3),
        "Tempo_Acompanhamento": rng.exponential(20, n * 3).round(1),
    })
    path = os.path.join("dados", "ensaio3.csv")
    df.to_csv(path, index=False)
    return path


@pytest.fixture
def csv_2grupos(workdir):
    rng = np.random.default_rng(7)
    n = 30
    df = pd.DataFrame({
        "Braco": ["A"] * n + ["B"] * n,
        "IMC": rng.normal(27, 4, n * 2).round(1),
        "Desfecho_Bin": ["Sim"] * (n // 3) + ["Nao"] * (n - n // 3) + ["Sim"] * (n - n // 3) + ["Nao"] * (n // 3),
    })
    df["PAS_Antes"] = rng.normal(140, 10, n * 2).round(1)
    df["PAS_Depois"] = df["PAS_Antes"] - rng.normal(8, 6, n * 2)
    path = os.path.join("dados", "ensaio2.csv")
    df.to_csv(path, index=False)
    return path


# --------------------------------------------------------------------------- #
# explorar / calcular_diferenca — não devem tocar o manifesto
# --------------------------------------------------------------------------- #

def test_explorar_inventaria_colunas(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "explorar", "--input", csv_3grupos)
    assert out["n_linhas"] == 75
    nomes = {c["nome"] for c in out["colunas"]}
    assert {"Grupo", "Idade", "Sexo", "PAS_Basal", "PAS_Final"} <= nomes
    tipos = {c["nome"]: c["provavel_tipo"] for c in out["colunas"]}
    assert tipos["Idade"] == "numérica"
    assert tipos["Sexo"] == "categórica"


def test_explorar_nao_grava_manifesto(workdir, monkeypatch, capsys, csv_3grupos):
    run(monkeypatch, capsys, "explorar", "--input", csv_3grupos)
    assert ler_manifesto_disco() == []


def test_calcular_diferenca_cria_coluna_e_nao_grava_manifesto(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "calcular_diferenca", "--input", csv_3grupos,
               "--var1", "PAS_Final", "--var2", "PAS_Basal", "--nova_coluna", "Variacao_PAS")
    assert out["sucesso"] is True
    assert out["nova_coluna"] == "Variacao_PAS"
    df = pd.read_csv(csv_3grupos)
    assert "Variacao_PAS" in df.columns
    assert ler_manifesto_disco() == []


# --------------------------------------------------------------------------- #
# descritivas / normalidade / homogeneidade_variancia
# --------------------------------------------------------------------------- #

def test_descritivas_com_grupo(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "descritivas", "--input", csv_3grupos,
               "--vars", "PAS_Final", "--group", "Grupo")
    por_grupo = out["variaveis"]["PAS_Final"]["por_grupo"]
    assert set(por_grupo) == {"Controle", "Farmaco_X", "Farmaco_Y"}
    assert por_grupo["Controle"]["n"] == 25


def test_descritivas_sem_grupo(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "descritivas", "--input", csv_3grupos, "--vars", "PAS_Final")
    assert out["variaveis"]["PAS_Final"]["n"] == 75


def test_normalidade_grava_manifesto_e_estrutura_esperada(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "normalidade", "--input", csv_3grupos,
               "--vars", "PAS_Final", "--group", "Grupo")
    por_grupo = out["variaveis"]["PAS_Final"]["por_grupo"]
    for info in por_grupo.values():
        assert 0 <= info["p_valor"] <= 1
        assert isinstance(info["distribuicao_normal"], bool)

    manifesto = ler_manifesto_disco()
    assert len(manifesto) == 1
    assert manifesto[0]["comando"] == "normalidade"
    assert manifesto[0]["params"]["group"] == "Grupo"


def test_homogeneidade_variancia(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "homogeneidade_variancia", "--input", csv_3grupos,
               "--var", "PAS_Final", "--group", "Grupo")
    assert out["teste"].startswith("Levene")
    assert 0 <= out["p_valor"] <= 1
    assert isinstance(out["variancias_homogeneas"], bool)


# --------------------------------------------------------------------------- #
# Comparações de 2 grupos
# --------------------------------------------------------------------------- #

def test_ttest_independente_student_e_welch(workdir, monkeypatch, capsys, csv_2grupos):
    student = run(monkeypatch, capsys, "ttest_independente", "--input", csv_2grupos,
                    "--var", "IMC", "--group", "Braco")
    assert "Student" in student["teste"]
    assert student["p_valor"] >= 0

    welch = run(monkeypatch, capsys, "ttest_independente", "--input", csv_2grupos,
                 "--var", "IMC", "--group", "Braco", "--welch")
    assert "Welch" in welch["teste"]


def test_ttest_independente_exige_exatamente_2_grupos(workdir, monkeypatch, capsys, csv_3grupos):
    out = run_erro(monkeypatch, capsys, "ttest_independente", "--input", csv_3grupos,
                    "--var", "PAS_Final", "--group", "Grupo")
    assert "erro" in out


def test_mannwhitney(workdir, monkeypatch, capsys, csv_2grupos):
    out = run(monkeypatch, capsys, "mannwhitney", "--input", csv_2grupos, "--var", "IMC", "--group", "Braco")
    assert "Mann-Whitney" in out["teste"]
    assert -1 <= out["tamanho_efeito_r_rank_biserial"] <= 1


def test_ttest_pareado_detecta_reducao_real(workdir, monkeypatch, capsys, csv_2grupos):
    out = run(monkeypatch, capsys, "ttest_pareado", "--input", csv_2grupos,
               "--var1", "PAS_Antes", "--var2", "PAS_Depois")
    # construído por design: PAS_Depois = PAS_Antes - ~8, então tem que dar significativo
    assert out["p_valor"] < 0.05
    assert out["significativo_5pct"] == "estatisticamente significativo"
    assert out["diferenca_media"] > 0


def test_wilcoxon_pareado(workdir, monkeypatch, capsys, csv_2grupos):
    out = run(monkeypatch, capsys, "wilcoxon", "--input", csv_2grupos,
               "--var1", "PAS_Antes", "--var2", "PAS_Depois")
    assert out["p_valor"] < 0.05
    assert out["n_pares"] == 60


# --------------------------------------------------------------------------- #
# Comparações de 3+ grupos
# --------------------------------------------------------------------------- #

def test_anova_oneway_com_posthoc_quando_significativo(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "anova_oneway", "--input", csv_3grupos,
               "--var", "PAS_Final", "--group", "Grupo")
    assert len(out["grupos"]) == 3
    assert out["p_valor"] < 0.05  # grupos construídos propositalmente separados
    assert isinstance(out["posthoc_tukey_hsd"], dict)
    assert len(out["posthoc_tukey_hsd"]["comparacoes_pareadas"]) == 3


def test_anova_oneway_exige_3_grupos(workdir, monkeypatch, capsys, csv_2grupos):
    out = run_erro(monkeypatch, capsys, "anova_oneway", "--input", csv_2grupos, "--var", "IMC", "--group", "Braco")
    assert "erro" in out


def test_kruskal(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "kruskal", "--input", csv_3grupos, "--var", "PAS_Final", "--group", "Grupo")
    assert out["graus_liberdade"] == 2
    assert 0 <= out["p_valor"] <= 1


# --------------------------------------------------------------------------- #
# Categóricas, correlação, regressões, sobrevida, múltiplas comparações
# --------------------------------------------------------------------------- #

def test_qui_quadrado_2x2_inclui_fisher(workdir, monkeypatch, capsys, csv_2grupos):
    out = run(monkeypatch, capsys, "qui_quadrado", "--input", csv_2grupos, "--var1", "Braco", "--var2", "Desfecho_Bin")
    assert "teste_exato_fisher" in out


def test_qui_quadrado_3xN_nao_inclui_fisher(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "qui_quadrado", "--input", csv_3grupos, "--var1", "Grupo", "--var2", "Sexo")
    assert "teste_exato_fisher" not in out
    assert out["teste_qui_quadrado"]["graus_liberdade"] == 2


@pytest.mark.parametrize("metodo", ["pearson", "spearman"])
def test_correlacao(workdir, monkeypatch, capsys, csv_3grupos, metodo):
    out = run(monkeypatch, capsys, "correlacao", "--input", csv_3grupos,
               "--var1", "PAS_Basal", "--var2", "Idade", "--metodo", metodo)
    assert -1 <= out["coeficiente_r"] <= 1
    assert out["n"] == 75


def test_regressao_linear_com_vif(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "regressao_linear", "--input", csv_3grupos,
               "--y", "PAS_Final", "--x", "PAS_Basal,Idade")
    assert out["n"] == 75
    assert len(out["coeficientes"]) == 3  # intercepto + 2 preditores
    assert len(out["multicolinearidade_VIF"]) == 2


def test_regressao_logistica_ok(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "regressao_logistica", "--input", csv_3grupos,
               "--y", "Obito", "--x", "PAS_Basal,Idade")
    assert out["variavel_dependente"] == "Obito"
    assert len(out["coeficientes"]) == 3


def test_regressao_logistica_rejeita_y_nao_binario(workdir, monkeypatch, capsys, csv_3grupos):
    out = run_erro(monkeypatch, capsys, "regressao_logistica", "--input", csv_3grupos,
                    "--y", "Idade", "--x", "PAS_Basal")
    assert "erro" in out


def test_kaplan_meier_com_grupo_inclui_logrank(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "kaplan_meier", "--input", csv_3grupos,
               "--tempo", "Tempo_Acompanhamento", "--evento", "Obito", "--group", "Grupo")
    assert set(out["curvas_por_grupo"]) == {"Controle", "Farmaco_X", "Farmaco_Y"}
    assert "teste_logrank" in out


def test_kaplan_meier_sem_grupo(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "kaplan_meier", "--input", csv_3grupos,
               "--tempo", "Tempo_Acompanhamento", "--evento", "Obito")
    assert "curvas_por_grupo" not in out
    assert "pontos_curva" in out


def test_kaplan_meier_rejeita_evento_nao_binario(workdir, monkeypatch, capsys, csv_3grupos):
    out = run_erro(monkeypatch, capsys, "kaplan_meier", "--input", csv_3grupos,
                    "--tempo", "Tempo_Acompanhamento", "--evento", "Idade")
    assert "erro" in out


@pytest.mark.parametrize("metodo", ["bonferroni", "fdr_bh"])
def test_correcao_multiplas(workdir, monkeypatch, capsys, metodo):
    out = run(monkeypatch, capsys, "correcao_multiplas", "--pvalores", "0.01,0.03,0.04,0.20", "--metodo", metodo)
    assert len(out["comparacoes"]) == 4
    # correção nunca pode diminuir o p-valor
    for c in out["comparacoes"]:
        assert c["p_ajustado"] >= c["p_bruto"] - 1e-9


# --------------------------------------------------------------------------- #
# Manifesto de sessão
# --------------------------------------------------------------------------- #

def test_manifesto_acumula_entre_comandos(workdir, monkeypatch, capsys, csv_3grupos):
    run(monkeypatch, capsys, "normalidade", "--input", csv_3grupos, "--vars", "PAS_Final", "--group", "Grupo")
    run(monkeypatch, capsys, "anova_oneway", "--input", csv_3grupos, "--var", "PAS_Final", "--group", "Grupo")
    manifesto = ler_manifesto_disco()
    assert [e["comando"] for e in manifesto] == ["normalidade", "anova_oneway"]


def test_resetar_sessao_apaga_manifesto(workdir, monkeypatch, capsys, csv_3grupos):
    run(monkeypatch, capsys, "normalidade", "--input", csv_3grupos, "--vars", "PAS_Final", "--group", "Grupo")
    assert len(ler_manifesto_disco()) == 1

    out = run(monkeypatch, capsys, "resetar_sessao")
    assert out["sucesso"] is True
    assert out["manifesto_removido"] is True
    assert ler_manifesto_disco() == []


def test_resetar_sessao_quando_ja_vazio(workdir, monkeypatch, capsys):
    out = run(monkeypatch, capsys, "resetar_sessao")
    assert out["manifesto_removido"] is False


# --------------------------------------------------------------------------- #
# gerar_pdf
# --------------------------------------------------------------------------- #

def _pdf_valido(path):
    assert os.path.exists(path)
    with open(path, "rb") as f:
        assert f.read(5) == b"%PDF-"


def test_gerar_pdf_sem_var_group_e_sem_manifesto(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "gerar_pdf", "--input", csv_3grupos, "--out", "vazio.pdf")
    assert out["sucesso"] is True
    _pdf_valido(os.path.join("dados", "vazio.pdf"))


def test_gerar_pdf_2_grupos_usa_teste_t_ou_mannwhitney(workdir, monkeypatch, capsys, csv_2grupos):
    # sem nenhuma análise prévia no manifesto — só a comparação principal.
    out = run(monkeypatch, capsys, "gerar_pdf", "--input", csv_2grupos,
               "--var", "IMC", "--group", "Braco", "--out", "doisgrupos.pdf")
    assert out["sucesso"] is True
    _pdf_valido(os.path.join("dados", "doisgrupos.pdf"))


def test_gerar_pdf_3_grupos_e_baseline_vars(workdir, monkeypatch, capsys, csv_3grupos):
    out = run(monkeypatch, capsys, "gerar_pdf", "--input", csv_3grupos,
               "--var", "PAS_Final", "--group", "Grupo", "--baseline_vars", "Idade,Sexo",
               "--out", "tresgrupos.pdf")
    assert out["sucesso"] is True
    _pdf_valido(os.path.join("dados", "tresgrupos.pdf"))


def test_gerar_pdf_var_inexistente_da_erro(workdir, monkeypatch, capsys):
    # nomes sem qualquer semelhança com os heurísticos de auto-criação de coluna
    # (basal/final/antes/depois) do carregar_dados, para garantir que o erro é
    # por coluna realmente inexistente e não por heurística acionada.
    df = pd.DataFrame({"Grupo": ["A", "B"] * 5, "Peso": [70.0, 80.0] * 5})
    path = os.path.join("dados", "simples.csv")
    df.to_csv(path, index=False)
    out = run_erro(monkeypatch, capsys, "gerar_pdf", "--input", path, "--var", "Coluna_Xyz_Nao_Existe")
    assert "erro" in out


def test_gerar_pdf_dedup_nao_duplica_comparacao_principal(workdir, monkeypatch, capsys, csv_3grupos):
    # Roda o mesmo teste que será a comparação principal ANTES do gerar_pdf —
    # ele não pode aparecer de novo na seção de "demais análises".
    run(monkeypatch, capsys, "anova_oneway", "--input", csv_3grupos, "--var", "PAS_Final", "--group", "Grupo")
    run(monkeypatch, capsys, "correlacao", "--input", csv_3grupos, "--var1", "PAS_Basal", "--var2", "Idade")

    secoes = st.ler_manifesto()
    col_var, col_group = "PAS_Final", "Grupo"
    extras = [
        e for e in secoes
        if e["comando"] in st.COMANDO_FORMATADORES
        and not (e["comando"] in st._COMPARACAO_GRUPOS_COMANDOS
                 and e["params"].get("var") == col_var and e["params"].get("group") == col_group)
    ]
    # só a correlação deveria sobrar como "extra"; a ANOVA foi consumida pela comparação principal
    assert [e["comando"] for e in extras] == ["correlacao"]

    out = run(monkeypatch, capsys, "gerar_pdf", "--input", csv_3grupos,
               "--var", col_var, "--group", col_group, "--out", "dedup.pdf")
    assert out["sucesso"] is True


def test_gerar_pdf_sem_matplotlib_nao_gera_imagens(workdir, monkeypatch, capsys, csv_3grupos):
    pypdf = pytest.importorskip("pypdf")
    monkeypatch.setattr(st, "MATPLOTLIB_OK", False)
    out = run(monkeypatch, capsys, "gerar_pdf", "--input", csv_3grupos,
               "--var", "PAS_Final", "--group", "Grupo", "--out", "sem_mpl.pdf")
    assert out["sucesso"] is True
    path = os.path.join("dados", "sem_mpl.pdf")
    _pdf_valido(path)
    leitor = pypdf.PdfReader(path)
    assert sum(len(p.images) for p in leitor.pages) == 0


@pytest.mark.skipif(not st.MATPLOTLIB_OK, reason="matplotlib não instalado")
def test_gerar_pdf_com_matplotlib_gera_imagens(workdir, monkeypatch, capsys, csv_3grupos):
    pypdf = pytest.importorskip("pypdf")
    out = run(monkeypatch, capsys, "gerar_pdf", "--input", csv_3grupos,
               "--var", "PAS_Final", "--group", "Grupo", "--out", "com_mpl.pdf")
    assert out["sucesso"] is True
    path = os.path.join("dados", "com_mpl.pdf")
    leitor = pypdf.PdfReader(path)
    assert sum(len(p.images) for p in leitor.pages) >= 2  # boxplot + Q-Q pelo menos


# --------------------------------------------------------------------------- #
# Checklist de aderência a diretriz de relato (CONSORT/STROBE/TRIPOD)
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("texto,esperado", [
    ("ensaio_clinico", "ensaio_clinico"),
    ("Ensaio Clínico", "ensaio_clinico"),
    ("RCT", "ensaio_clinico"),
    ("coorte", "coorte"),
    ("cohort", "coorte"),
    ("caso-controle", "caso_controle"),
    ("transversal", "transversal"),
    ("cross_sectional", "transversal"),
    ("tripod", "diagnostico_preditivo"),
    ("lorem_ipsum", None),
    (None, None),
    ("", None),
])
def test_normalizar_desenho(texto, esperado):
    assert st._normalizar_desenho(texto) == esperado


def test_montar_checklist_diretriz_so_marca_o_que_realmente_rodou():
    checklist = st.montar_checklist_diretriz("ensaio_clinico", {
        "tabela1": True, "correcao_multiplas": False, "posthoc": True,
        "regressao_linear": False, "regressao_logistica": False, "kaplan_meier": False,
    })
    status_por_item = {linha[0]: linha[1] for linha in checklist["linhas"]}
    assert status_por_item["Dados basais por grupo"] == "Coberto neste relatório"
    assert status_por_item["Comparações pareadas pós-teste global"] == "Coberto neste relatório"
    # item condicional com flag False: nem aparece (não é "coberto" nem "fora de escopo")
    assert "Ajuste para múltiplas comparações" not in status_por_item
    # itens sempre presentes e sempre "fora do escopo" (não dependem de flags)
    assert status_por_item["Métodos estatísticos"] == "Coberto neste relatório"
    assert status_por_item["Cegamento (quem foi cegado e como)"] == "Fora do escopo deste relatório"


def test_montar_checklist_diretriz_desenho_desconhecido_retorna_none():
    assert st.montar_checklist_diretriz("nao_existe", {}) is None


def test_gerar_pdf_com_desenho_valido_inclui_checklist(workdir, monkeypatch, capsys, csv_3grupos):
    pypdf = pytest.importorskip("pypdf")
    out = run(monkeypatch, capsys, "gerar_pdf", "--input", csv_3grupos,
               "--var", "PAS_Final", "--group", "Grupo", "--desenho", "coorte", "--out", "com_desenho.pdf")
    assert out["sucesso"] is True
    texto = "\n".join(p.extract_text() for p in pypdf.PdfReader(os.path.join("dados", "com_desenho.pdf")).pages)
    assert "STROBE" in texto
    assert "Checklist de Aderência" in texto


def test_gerar_pdf_sem_desenho_nao_inclui_checklist(workdir, monkeypatch, capsys, csv_3grupos):
    pypdf = pytest.importorskip("pypdf")
    out = run(monkeypatch, capsys, "gerar_pdf", "--input", csv_3grupos,
               "--var", "PAS_Final", "--group", "Grupo", "--out", "sem_desenho.pdf")
    assert out["sucesso"] is True
    texto = "\n".join(p.extract_text() for p in pypdf.PdfReader(os.path.join("dados", "sem_desenho.pdf")).pages)
    assert "Checklist de Aderência" not in texto


def test_gerar_pdf_desenho_desconhecido_nao_gera_erro_nem_checklist(workdir, monkeypatch, capsys, csv_3grupos):
    pypdf = pytest.importorskip("pypdf")
    out = run(monkeypatch, capsys, "gerar_pdf", "--input", csv_3grupos,
               "--var", "PAS_Final", "--group", "Grupo", "--desenho", "lorem_ipsum", "--out", "desenho_invalido.pdf")
    assert out["sucesso"] is True
    texto = "\n".join(p.extract_text() for p in pypdf.PdfReader(os.path.join("dados", "desenho_invalido.pdf")).pages)
    assert "Checklist de Aderência" not in texto


# --------------------------------------------------------------------------- #
# Helpers puros (sem CLI)
# --------------------------------------------------------------------------- #

def test_br_formata_com_virgula():
    assert st._br(1234.5, 2) == "1234,50"
    assert st._br(None) == "NC"
    assert st._br(float("nan")) == "NC"


def test_pv_limiar():
    assert st._pv(0.0001) == "p < 0,001"
    assert st._pv(0.5) == "p = 0,500"
    assert st._pv(None) == "não calculável"


def test_interpretar_p():
    assert st.interpretar_p(0.01) == "estatisticamente significativo"
    assert st.interpretar_p(0.5) == "não estatisticamente significativo"


@pytest.mark.parametrize("d,esperado", [
    (0.1, "efeito muito pequeno/negligível"),
    (0.3, "efeito pequeno"),
    (0.6, "efeito médio"),
    (1.0, "efeito grande"),
])
def test_interpretar_cohen_d(d, esperado):
    assert st.interpretar_cohen_d(d) == esperado


def test_cohen_d_independente_sinal():
    a = np.array([10.0, 11.0, 12.0, 13.0])
    b = np.array([1.0, 2.0, 3.0, 4.0])
    assert st.cohen_d_independente(a, b) > 0
    assert st.cohen_d_independente(b, a) < 0


def test_rank_biserial_bounds():
    r = st.rank_biserial_mannwhitney(u=25, n1=5, n2=10)
    assert -1 <= r <= 1


def test_welch_gl_menor_ou_igual_a_pooled():
    a = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    b = np.array([10.0, 40.0, 15.0, 60.0, 5.0])  # variância bem maior que a de 'a'
    gl_welch = st.welch_gl(a, b)
    gl_pooled = len(a) + len(b) - 2
    assert gl_welch <= gl_pooled


def test_detectar_tipo_coluna():
    assert st._detectar_tipo_coluna(pd.Series([1, 2, 3, 4.5])) == "numerica"
    assert st._detectar_tipo_coluna(pd.Series(["F", "M", "F", "M"])) == "categorica"


def test_comparar_grupos_numerico_2_grupos_detecta_diferenca():
    a = np.random.default_rng(1).normal(0, 1, 40)
    b = np.random.default_rng(1).normal(5, 1, 40)
    teste, p = st._comparar_grupos_numerico([a, b])
    assert teste in ("Teste t", "Teste t de Welch", "Mann-Whitney U")
    assert p < 0.01


def test_comparar_grupos_numerico_menos_de_2_grupos_retorna_none():
    teste, p = st._comparar_grupos_numerico([np.array([1.0, 2.0])])
    assert teste is None and p is None


def test_comparar_grupos_categorico_2x2():
    df = pd.DataFrame({
        "Grupo": ["A"] * 10 + ["B"] * 10,
        "Evento": ["Sim"] * 8 + ["Nao"] * 2 + ["Sim"] * 2 + ["Nao"] * 8,
    })
    teste, p = st._comparar_grupos_categorico(df, "Evento", "Grupo")
    assert teste == "Fisher exato"
    assert p < 0.05


def test_construir_tabela1_basais_numerica_e_categorica():
    rng = np.random.default_rng(2)
    df = pd.DataFrame({
        "Grupo": ["A"] * 10 + ["B"] * 10,
        "Idade": np.concatenate([rng.normal(40, 3, 10), rng.normal(60, 3, 10)]),
        "Sexo": ["F"] * 5 + ["M"] * 5 + ["F"] * 5 + ["M"] * 5,
    })
    tabela = st.construir_tabela1_basais(df, "Grupo", ["Idade", "Sexo"])
    assert tabela["headers"] == ["Característica", "A", "B", "p-valor", "Teste"]
    variaveis_nas_linhas = [linha[0] for linha in tabela["linhas"]]
    assert "Idade" in variaveis_nas_linhas
    assert any(v.startswith("Sexo =") for v in variaveis_nas_linhas)


def test_construir_tabela1_basais_sem_group_retorna_none():
    df = pd.DataFrame({"Idade": [40, 50, 60]})
    assert st.construir_tabela1_basais(df, None, ["Idade"]) is None


def test_construir_tabela1_basais_sem_baseline_vars_retorna_none():
    df = pd.DataFrame({"Grupo": ["A", "B"], "Idade": [40, 50]})
    assert st.construir_tabela1_basais(df, "Grupo", []) is None


# --------------------------------------------------------------------------- #
# Geração de gráficos (só roda se matplotlib estiver instalado)
# --------------------------------------------------------------------------- #

pytestmark_mpl = pytest.mark.skipif(not st.MATPLOTLIB_OK, reason="matplotlib não instalado")


@pytestmark_mpl
def test_fig_boxplot_retorna_figura():
    grupos = [np.array([1.0, 2.0, 3.0]), np.array([4.0, 5.0, 6.0])]
    fig = st._fig_boxplot(grupos, ["A", "B"], "Escore")
    assert fig is not None
    st.plt.close(fig)


@pytestmark_mpl
def test_fig_boxplot_none_sem_dados():
    fig = st._fig_boxplot([np.array([]), np.array([])], ["A", "B"], "Escore")
    assert fig is None


@pytestmark_mpl
def test_fig_qqplot_ignora_grupos_pequenos():
    grupos = [np.array([1.0, 2.0]), np.array([1.0, 2.0, 3.0, 4.0, 5.0])]
    fig = st._fig_qqplot(grupos, ["Pequeno", "Grande"], "Escore")
    assert fig is not None
    assert len(fig.axes) == 1  # só o grupo com n>=3 vira subplot
    st.plt.close(fig)


@pytestmark_mpl
def test_fig_forest_none_so_com_intercepto():
    coefs = [{"variavel": "Intercepto", "coeficiente_beta": 1.0, "ic95": [0.5, 1.5]}]
    assert st._fig_forest(coefs, usa_or=False, titulo="teste") is None


@pytestmark_mpl
def test_fig_forest_com_coeficientes():
    coefs = [
        {"variavel": "Intercepto", "coeficiente_beta": 1.0, "ic95": [0.5, 1.5]},
        {"variavel": "Idade", "coeficiente_beta": 0.3, "ic95": [0.1, 0.5]},
    ]
    fig = st._fig_forest(coefs, usa_or=False, titulo="teste")
    assert fig is not None
    st.plt.close(fig)


@pytestmark_mpl
def test_fig_km_com_e_sem_grupo():
    sem_grupo = {"pontos_curva": [{"tempo": 1, "sobrevida_acumulada": 0.9},
                                    {"tempo": 5, "sobrevida_acumulada": 0.5}]}
    fig = st._fig_km(sem_grupo, "Tempo")
    assert fig is not None
    st.plt.close(fig)

    com_grupo = {"curvas_por_grupo": {
        "A": {"n": 10, "pontos_curva": [{"tempo": 1, "sobrevida_acumulada": 0.8}]},
        "B": {"n": 10, "pontos_curva": [{"tempo": 2, "sobrevida_acumulada": 0.6}]},
    }}
    fig2 = st._fig_km(com_grupo, "Tempo")
    assert fig2 is not None
    st.plt.close(fig2)
