#!/usr/bin/env python3
"""
chemo_calculator.py

Calculadora determinística para a skill auditor-prescricoes-antineoplasicas.

Objetivo: tirar do "raciocínio livre" do modelo todos os cálculos numéricos
de segurança (ASC, clearance de creatinina, Calvert, dose cumulativa de
antraciclina, comparação de tolerância de dose), que devem ser sempre
reprodutíveis e auditáveis.

Uso: cada subcomando imprime um JSON no stdout. Erros de entrada (dado
faltante ou inválido) resultam em JSON com "erro" preenchido e exit code 1 —
NUNCA em um valor numérico inventado. Se um cálculo não pode ser feito com
segurança, o script se recusa a adivinhar.

Subcomandos:
  bsa           Área de superfície corporal (Mosteller / DuBois / Gehan-George)
  creatinine    Clearance de creatinina (Cockcroft-Gault), com teto opcional
  calvert       Dose de carboplatina pela fórmula de Calvert
  anthracycline Dose cumulativa equivalente de antraciclinas vs. limite
  dose_check    Compara dose prescrita com dose calculada (tolerância %)

Exemplos:
  python3 chemo_calculator.py bsa --altura_cm 165 --peso_kg 70
  python3 chemo_calculator.py creatinine --idade 60 --peso_kg 70 --creatinina 1.1 --sexo F
  python3 chemo_calculator.py calvert --auc 5 --idade 60 --peso_kg 70 --altura_cm 165 --creatinina 1.1 --sexo F
  python3 chemo_calculator.py anthracycline --historico '[{"farmaco":"doxorrubicina","dose_mg_m2":240}]' --nova_dose_mg_m2 60 --novo_farmaco doxorrubicina --asc 1.75
  python3 chemo_calculator.py dose_check --dose_prescrita_mg 150 --dose_calculada_mg 140.7
"""

import argparse
import json
import math
import sys

# ---------------------------------------------------------------------------
# Referências clínicas (mantidas em sincronia com references/formulas_protocolos.md)
# ---------------------------------------------------------------------------

# Limites cumulativos vitalícios usuais (mg/m², equivalente-doxorrubicina)
ANTHRACYCLINE_LIMITS_MG_M2_DOX_EQ = {
    "doxorrubicina": 500,   # ponto médio da faixa 450-550
    "epirrubicina": 950,    # ponto médio da faixa 900-1000, já em equivalente próprio; ver fator abaixo
    "daunorrubicina": 675,  # ponto médio da faixa 550-800
    "idarrubicina": 150,
    "mitoxantrona": 150,
}

# Fator de equivalência de cardiotoxicidade -> multiplicar a dose do fármaco
# para converter em "dose-equivalente de doxorrubicina" antes de somar ao
# histórico cumulativo. doxorrubicina = 1 por definição.
ANTHRACYCLINE_DOX_EQUIVALENCE_FACTOR = {
    "doxorrubicina": 1.0,
    "epirrubicina": 0.55,
    "daunorrubicina": 0.5,
    "idarrubicina": 3.0,
    "mitoxantrona": 4.5,
}

# Doses-teto absolutas conhecidas (mg), independente de ASC/peso
ABSOLUTE_DOSE_CAPS_MG = {
    "vincristina": 2.0,
}


def err(msg):
    print(json.dumps({"erro": msg}, ensure_ascii=False, indent=2))
    sys.exit(1)


def ok(payload):
    print(json.dumps(payload, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------
# ASC
# ---------------------------------------------------------------------------

def bsa_mosteller(altura_cm, peso_kg):
    return math.sqrt((altura_cm * peso_kg) / 3600.0)


def bsa_dubois(altura_cm, peso_kg):
    return 0.007184 * (altura_cm ** 0.725) * (peso_kg ** 0.425)


def bsa_gehan_george(altura_cm, peso_kg):
    return 0.0235 * (altura_cm ** 0.42246) * (peso_kg ** 0.51456)


def cmd_bsa(args):
    if args.altura_cm <= 0 or args.peso_kg <= 0:
        err("altura_cm e peso_kg devem ser positivos.")
    formulas = {
        "mosteller": bsa_mosteller(args.altura_cm, args.peso_kg),
        "dubois": bsa_dubois(args.altura_cm, args.peso_kg),
        "gehan_george": bsa_gehan_george(args.altura_cm, args.peso_kg),
    }
    escolhida = formulas[args.formula]
    ok({
        "formula_usada": args.formula,
        "asc_m2": round(escolhida, 3),
        "todas_formulas_m2": {k: round(v, 3) for k, v in formulas.items()},
        "diferenca_percentual_entre_formulas": round(
            (max(formulas.values()) - min(formulas.values())) / min(formulas.values()) * 100, 2
        ),
    })


# ---------------------------------------------------------------------------
# Clearance de creatinina (Cockcroft-Gault)
# ---------------------------------------------------------------------------

def cmd_creatinine(args):
    if args.creatinina <= 0:
        err("creatinina_serica_mg_dl deve ser positiva.")
    if args.idade <= 0 or args.peso_kg <= 0:
        err("idade e peso_kg devem ser positivos.")
    sexo = args.sexo.strip().upper()
    if sexo not in ("M", "F"):
        err("sexo deve ser 'M' ou 'F'.")

    fator_sexo = 0.85 if sexo == "F" else 1.0
    clcr = ((140 - args.idade) * args.peso_kg * fator_sexo) / (72 * args.creatinina)
    clcr_com_teto = min(clcr, args.teto) if args.teto else clcr

    ok({
        "clcr_calculado_ml_min": round(clcr, 2),
        "teto_aplicado_ml_min": args.teto,
        "clcr_apos_teto_ml_min": round(clcr_com_teto, 2),
        "observacao": (
            "Em oncologia, aplica-se comumente um teto de 125 mL/min na TFG "
            "usada para Calvert, mesmo que o ClCr calculado seja maior, para "
            "evitar subdosagem por superestimação da função renal."
        ),
    })


# ---------------------------------------------------------------------------
# Calvert (Carboplatina)
# ---------------------------------------------------------------------------

def cmd_calvert(args):
    if args.auc <= 0:
        err("auc deve ser positivo.")
    if args.creatinina <= 0 or args.idade <= 0 or args.peso_kg <= 0:
        err("creatinina, idade e peso_kg devem ser positivos e informados — "
            "Calvert não pode ser calculado sem função renal estimada.")
    sexo = args.sexo.strip().upper()
    if sexo not in ("M", "F"):
        err("sexo deve ser 'M' ou 'F'.")

    fator_sexo = 0.85 if sexo == "F" else 1.0
    clcr = ((140 - args.idade) * args.peso_kg * fator_sexo) / (72 * args.creatinina)
    tfg_com_teto = min(clcr, args.teto_tfg)

    dose_mg = args.auc * (tfg_com_teto + 25)

    ok({
        "clcr_calculado_ml_min": round(clcr, 2),
        "tfg_usada_no_calvert_ml_min": round(tfg_com_teto, 2),
        "teto_tfg_aplicado_ml_min": args.teto_tfg,
        "auc_alvo": args.auc,
        "dose_carboplatina_mg": round(dose_mg, 1),
        "aviso": (
            "Carboplatina deve ser dosada por AUC (Calvert), nunca por mg/m². "
            "Se a prescrição expressar a dose em mg/m², isso é um alerta crítico "
            "a reportar independentemente deste cálculo."
        ),
    })


# ---------------------------------------------------------------------------
# Dose cumulativa de antraciclinas
# ---------------------------------------------------------------------------

def cmd_anthracycline(args):
    novo_farmaco = args.novo_farmaco.strip().lower()
    if novo_farmaco not in ANTHRACYCLINE_DOX_EQUIVALENCE_FACTOR:
        err(f"Fármaco '{novo_farmaco}' não está na tabela de referência interna "
            f"({list(ANTHRACYCLINE_DOX_EQUIVALENCE_FACTOR.keys())}). "
            "Não estimar fator de equivalência — reportar como dado insuficiente.")
    if args.asc <= 0:
        err("asc (m²) deve ser positiva.")
    if args.nova_dose_mg_m2 <= 0:
        err("nova_dose_mg_m2 deve ser positiva.")

    try:
        historico = json.loads(args.historico) if args.historico else []
    except json.JSONDecodeError:
        err("historico deve ser uma lista JSON válida, ex.: "
            '\'[{"farmaco":"doxorrubicina","dose_mg_m2":240}]\'')

    cumulativo_dox_eq_mg_m2 = 0.0
    detalhes_historico = []
    for item in historico:
        f = str(item.get("farmaco", "")).strip().lower()
        d = item.get("dose_mg_m2")
        if f not in ANTHRACYCLINE_DOX_EQUIVALENCE_FACTOR or d is None:
            err(f"Item de histórico inválido ou fármaco desconhecido: {item}. "
                "Não estimar — corrigir a entrada ou marcar como dado insuficiente.")
        fator = ANTHRACYCLINE_DOX_EQUIVALENCE_FACTOR[f]
        eq = d * fator
        cumulativo_dox_eq_mg_m2 += eq
        detalhes_historico.append({
            "farmaco": f, "dose_mg_m2": d, "fator_equivalencia_dox": fator,
            "dose_equivalente_dox_mg_m2": round(eq, 1),
        })

    fator_novo = ANTHRACYCLINE_DOX_EQUIVALENCE_FACTOR[novo_farmaco]
    nova_dose_eq = args.nova_dose_mg_m2 * fator_novo
    total_apos_novo_ciclo = cumulativo_dox_eq_mg_m2 + nova_dose_eq

    limite = ANTHRACYCLINE_LIMITS_MG_M2_DOX_EQ["doxorrubicina"]  # limite sempre em eq-dox
    percentual_do_limite = (total_apos_novo_ciclo / limite) * 100

    ok({
        "historico_convertido_eq_dox_mg_m2": detalhes_historico,
        "cumulativo_previo_eq_dox_mg_m2": round(cumulativo_dox_eq_mg_m2, 1),
        "novo_farmaco": novo_farmaco,
        "nova_dose_prescrita_mg_m2": args.nova_dose_mg_m2,
        "nova_dose_eq_dox_mg_m2": round(nova_dose_eq, 1),
        "cumulativo_total_apos_novo_ciclo_eq_dox_mg_m2": round(total_apos_novo_ciclo, 1),
        "limite_referencia_eq_dox_mg_m2": limite,
        "percentual_do_limite": round(percentual_do_limite, 1),
        "alerta": (
            "ACIMA DO LIMITE DE REFERÊNCIA" if total_apos_novo_ciclo > limite
            else "próximo do limite (>=80%)" if percentual_do_limite >= 80
            else "dentro do limite de referência"
        ),
    })


# ---------------------------------------------------------------------------
# Comparação de tolerância entre dose prescrita e calculada
# ---------------------------------------------------------------------------

def cmd_dose_check(args):
    if args.dose_calculada_mg <= 0:
        err("dose_calculada_mg deve ser positiva.")
    if args.dose_prescrita_mg <= 0:
        err("dose_prescrita_mg deve ser positiva.")

    diff_pct = abs(args.dose_prescrita_mg - args.dose_calculada_mg) / args.dose_calculada_mg * 100
    dentro_da_tolerancia = diff_pct <= args.tolerancia_pct

    resultado = {
        "dose_prescrita_mg": args.dose_prescrita_mg,
        "dose_calculada_mg": round(args.dose_calculada_mg, 2),
        "diferenca_percentual": round(diff_pct, 2),
        "tolerancia_pct": args.tolerancia_pct,
        "dentro_da_tolerancia": dentro_da_tolerancia,
    }

    if args.teto_absoluto_mg is not None:
        resultado["teto_absoluto_mg"] = args.teto_absoluto_mg
        resultado["excede_teto_absoluto"] = args.dose_prescrita_mg > args.teto_absoluto_mg

    ok(resultado)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser():
    p = argparse.ArgumentParser(description="Calculadora determinística para auditoria de prescrições antineoplásicas.")
    sub = p.add_subparsers(dest="comando", required=True)

    p_bsa = sub.add_parser("bsa", help="Calcula Área de Superfície Corporal.")
    p_bsa.add_argument("--altura_cm", type=float, required=True)
    p_bsa.add_argument("--peso_kg", type=float, required=True)
    p_bsa.add_argument("--formula", choices=["mosteller", "dubois", "gehan_george"], default="mosteller")
    p_bsa.set_defaults(func=cmd_bsa)

    p_cr = sub.add_parser("creatinine", help="Calcula clearance de creatinina (Cockcroft-Gault).")
    p_cr.add_argument("--idade", type=float, required=True)
    p_cr.add_argument("--peso_kg", type=float, required=True)
    p_cr.add_argument("--creatinina", type=float, required=True, help="Creatinina sérica em mg/dL")
    p_cr.add_argument("--sexo", type=str, required=True, help="M ou F")
    p_cr.add_argument("--teto", type=float, default=125.0, help="Teto de TFG em mL/min (padrão 125; use 0 para não aplicar)")
    p_cr.set_defaults(func=cmd_creatinine)

    p_cv = sub.add_parser("calvert", help="Calcula dose de carboplatina pela fórmula de Calvert.")
    p_cv.add_argument("--auc", type=float, required=True)
    p_cv.add_argument("--idade", type=float, required=True)
    p_cv.add_argument("--peso_kg", type=float, required=True)
    p_cv.add_argument("--altura_cm", type=float, required=False, default=0.0, help="Não usado no cálculo, aceito por completude do registro clínico.")
    p_cv.add_argument("--creatinina", type=float, required=True, help="Creatinina sérica em mg/dL")
    p_cv.add_argument("--sexo", type=str, required=True, help="M ou F")
    p_cv.add_argument("--teto_tfg", type=float, default=125.0, help="Teto de TFG em mL/min aplicado no Calvert (padrão 125)")
    p_cv.set_defaults(func=cmd_calvert)

    p_an = sub.add_parser("anthracycline", help="Verifica dose cumulativa equivalente de antraciclina vs. limite.")
    p_an.add_argument("--historico", type=str, default="[]",
                       help='JSON list, ex.: \'[{"farmaco":"doxorrubicina","dose_mg_m2":240}]\'')
    p_an.add_argument("--novo_farmaco", type=str, required=True)
    p_an.add_argument("--nova_dose_mg_m2", type=float, required=True)
    p_an.add_argument("--asc", type=float, required=True)
    p_an.set_defaults(func=cmd_anthracycline)

    p_dc = sub.add_parser("dose_check", help="Compara dose prescrita com dose calculada.")
    p_dc.add_argument("--dose_prescrita_mg", type=float, required=True)
    p_dc.add_argument("--dose_calculada_mg", type=float, required=True)
    p_dc.add_argument("--tolerancia_pct", type=float, default=5.0)
    p_dc.add_argument("--teto_absoluto_mg", type=float, default=None)
    p_dc.set_defaults(func=cmd_dose_check)

    return p


def main():
    parser = build_parser()
    
    # Se receber um argumento e ele for um arquivo JSON, carrega e converte para argumentos CLI
    if len(sys.argv) > 1 and sys.argv[1].endswith('.json'):
        try:
            with open(sys.argv[1], 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            cmd = data.get("subcomando") or data.get("comando") or data.get("subcommand")
            if not cmd:
                err("Comando/Subcomando não fornecido no arquivo JSON.")
            
            cli_args = [cmd]
            for k, v in data.items():
                if k in ("subcomando", "comando", "subcommand"):
                    continue
                if v is not None:
                    cli_args.append(f"--{k}")
                    if isinstance(v, (list, dict)):
                        cli_args.append(json.dumps(v))
                    else:
                        cli_args.append(str(v))
            
            args = parser.parse_args(cli_args)
        except Exception as e:
            err(f"Erro ao processar argumentos do JSON: {str(e)}")
    else:
        args = parser.parse_args()
        
    args.func(args)


if __name__ == "__main__":
    main()