"""Catálogo das 49 funções do Conecta (Central de Acessos, Etapa 6).

Lista fechada com o Paulo em 12/nov/2026 (thread "Completar a lista de funções do Conecta"). Cada função tem:
  * `modulo`: onde ela começa ligada (PROPOSTA; o Paulo pode mudar na tela, ligando em outro módulo);
  * `prefixos` / `chaves`: as permissões dela (as "ações" que cada perfil pode ou não fazer);
  * `motor`: id da função no motor de acesso de hoje (`modulos_catalogo.FUNCOES`), quando existe. Só essas fecham a porta
    de verdade na regra única ao serem desligadas; as demais, por enquanto, só somem da tela/menu;
  * `base`: nunca desliga na Tecnologia (evita trancar todo mundo fora da própria Central de Acessos);
  * `futura`: ainda não existe no Conecta.
Toda permissão de `rbac.PERMISSION_DEFINITIONS` pertence a no máximo UMA função (um teste garante).
"""

from __future__ import annotations

from dataclasses import dataclass

T, H, O = "tecnologia", "rh", "operacao"


@dataclass(frozen=True)
class Funcao:
    n: int
    id: str
    nome: str
    modulo: str
    prefixos: tuple[str, ...] = ()
    chaves: tuple[str, ...] = ()
    motor: str | None = None
    base: bool = False
    futura: bool = False


def _f(n, id_, nome, modulo, prefixos=(), chaves=(), motor=None, base=False, futura=False) -> Funcao:
    return Funcao(n, id_, nome, modulo, tuple(prefixos), tuple(chaves), motor, base, futura)


FUNCOES_CATALOGO: tuple[Funcao, ...] = (
    _f(1, "monitorias", "Monitorias", O, ("monitoria.",), ("sessao.monitoria.acessar",), motor="monitoria"),
    _f(2, "wfm", "WFM + Trocas", O, ("wfm.",), ("sessao.wfm.acessar",), motor="wfm"),
    _f(3, "equipes", "Controle de Equipes", O, ("equipes.",), ("sessao.equipe.acessar",)),
    _f(4, "relatorios", "Relatórios", T, ("relatorios.", "relhub."), ("sessao.relatorios.acessar",)),
    _f(5, "mfa", "Acesso MFA", T),
    _f(6, "certificados", "Controle de Certificados", H, futura=True),
    _f(7, "diario", "Diário de Bordo", O, ("diario.",), ("sessao.diario.acessar",), motor="diario"),
    _f(8, "treinamentos", "Treinamentos", O, (), ("sessao.treinamentos.acessar", "trilhas.configurar"), motor="treinamentos"),
    _f(9, "curriculos", "Caixa de Currículos", H, (), ("sessao.curriculos.acessar",), motor="cx-curriculos"),
    _f(10, "processos", "Processos Seletivos", H, ("processos.", "vagas."), ("sessao.processos.acessar", "etapas.configurar"), motor="processos"),
    _f(11, "talentos", "Banco de Talentos", H, ("candidatos.",)),
    _f(12, "suporte", "Ticket de Suporte", T, ("chamados.",), motor="suporte"),
    _f(13, "onedrive", "One Drive", T, ("onedrive.",), ("sessao.drive.acessar",), motor="drive"),
    _f(14, "mural", "Mural", T, ("mural.",)),
    _f(15, "logs", "Logs", T, ("logs.",)),
    _f(16, "provas", "Conecta Provas", H, ("provas.",), ("sessao.provas.acessar",), motor="provas"),
    _f(17, "indicadores", "Indicadores de Gestão", T, (), ("sessao.gestao.acessar", "dashboard.visualizar"), motor="gestao"),
    _f(18, "fit_cultural", "Fit Cultural", H, ("fit_cultural.",)),
    _f(19, "emails", "Emails", T, ("emails.",)),
    _f(20, "chat", "Chat", T, futura=True),
    _f(21, "administracao", "Área administrativa", T, ("configuracoes.",), ("sessao.configuracoes.acessar",)),
    _f(22, "unidades", "Operações e Setores (Unidades)", T, ("operacoes.",)),
    _f(23, "usuarios", "Usuários", T, ("usuarios.",), base=True),
    _f(24, "perfis", "Perfis e Permissões", T, base=True),
    _f(25, "modulos", "Módulos e funções", T, base=True),
    _f(26, "ambiente", "Configurar Ambiente", T),
    _f(27, "config_gerais", "Configurações gerais", T),
    _f(28, "seguranca", "Segurança", T, ("ambiente.",)),
    _f(29, "auditoria", "Auditoria", T),
    _f(30, "lgpd", "LGPD", T, ("lgpd.",)),
    _f(31, "zona_risco", "Zona de Risco", T),
    _f(32, "status", "Status do Sistema", T),
    _f(33, "tela_inicial", "Tela Inicial por perfil", T, ("inicio.",)),
    _f(34, "notificacoes", "Notificações", T, ("notificacoes.",)),
    _f(35, "calendario", "Calendário", T, ("calendario.",)),
    _f(36, "entrevistas", "Entrevistas", H, ("entrevistas.",)),
    _f(37, "admissao", "Admissão (Onboarding)", H, ("onboarding.",)),
    _f(38, "funil", "Funil de Candidatos", H),
    _f(39, "candidatura", "Candidatura Pública", H),
    _f(40, "analise_ia", "Análise de Currículos com IA", H),
    _f(41, "disc", "DISC", H),
    _f(42, "raciocinio", "Raciocínio Lógico", H),
    _f(43, "documentos", "Central de Documentos", H, ("documentos.",)),
    _f(44, "modelos_documentos", "Modelos de Documentos", H, ("documentos_templates.",)),
    _f(45, "politicas", "Políticas", H, ("politicas.",)),
    _f(46, "scorecards", "Scorecards", O),
    _f(47, "tipos_atendimento", "Tipos de Atendimento", O),
    _f(48, "ajuda", "Central de Ajuda", T, ("documentos_biblioteca.",)),
    _f(49, "ambiente_pessoal", "Ambiente pessoal", T),
)

POR_ID: dict[str, Funcao] = {f.id: f for f in FUNCOES_CATALOGO}


def _da_funcao(funcao: Funcao, chave: str) -> bool:
    return chave in funcao.chaves or any(chave.startswith(p) for p in funcao.prefixos)


def funcao_de(chave: str) -> Funcao | None:
    """Função do catálogo dona da permissão. Chaves explícitas vencem prefixos (ex.: sessao.* específicas)."""
    for f in FUNCOES_CATALOGO:
        if chave in f.chaves:
            return f
    for f in FUNCOES_CATALOGO:
        if any(chave.startswith(p) for p in f.prefixos):
            return f
    return None


def permissoes_da_funcao(funcao: Funcao) -> list[str]:
    from .rbac import PERMISSION_DEFINITIONS

    return [k for k in PERMISSION_DEFINITIONS if funcao_de(k) is funcao]
