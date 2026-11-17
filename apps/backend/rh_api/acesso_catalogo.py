"""Catálogo ÚNICO das funções do Conecta (49 de 12/nov + 17 do pente fino de 16/nov) (Central de Acessos, Etapa 6).

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
    descartada: bool = False  # tirada da lista pelo Paulo (16/nov/2026): não aparece nas telas
    fecha_com: str | None = None  # sem botão próprio de motor, mas fecha junto quando esse motor desliga


def _f(n, id_, nome, modulo, prefixos=(), chaves=(), motor=None, base=False, futura=False, descartada=False, fecha_com=None) -> Funcao:
    return Funcao(n, id_, nome, modulo, tuple(prefixos), tuple(chaves), motor, base, futura, descartada, fecha_com)


FUNCOES_CATALOGO: tuple[Funcao, ...] = (
    _f(1, "monitorias", "Monitorias", O, ("monitoria.",), ("sessao.monitoria.acessar",), motor="monitoria"),
    _f(2, "wfm", "WFM + Trocas", O, ("wfm.",), ("sessao.wfm.acessar",), motor="wfm"),
    _f(3, "equipes", "Controle de Equipes", O, ("equipes.",), ("sessao.equipe.acessar",), motor="equipes"),
    _f(4, "relatorios", "Relatórios", T, ("relatorios.", "relhub."), ("sessao.relatorios.acessar",), motor="relatorios"),
    _f(5, "mfa", "Acesso MFA", T),
    _f(6, "certificados", "Controle de Certificados", H, futura=True),
    _f(7, "diario", "Diário de Bordo", O, ("diario.",), ("sessao.diario.acessar",), motor="diario"),
    _f(8, "treinamentos", "Treinamentos", O, (), ("sessao.treinamentos.acessar", "trilhas.configurar"), motor="treinamentos"),
    _f(9, "curriculos", "Caixa de Currículos", H, (), ("sessao.curriculos.acessar",), motor="cx-curriculos"),
    _f(10, "processos", "Processos Seletivos", H, ("processos.", "vagas."), ("sessao.processos.acessar", "etapas.configurar"), motor="processos"),
    _f(11, "talentos", "Banco de Talentos", H, ("candidatos.",)),
    _f(12, "suporte", "Ticket de Suporte", T, ("chamados.",), motor="suporte"),
    _f(13, "onedrive", "One Drive", T, ("onedrive.",), ("sessao.drive.acessar",), motor="drive"),
    _f(14, "mural", "Mural", T, ("mural.",), motor="mural"),
    _f(15, "logs", "Logs", T, ("logs.",)),
    _f(16, "provas", "Conecta Provas", H, ("provas.",), ("sessao.provas.acessar",), motor="provas"),
    _f(17, "indicadores", "Indicadores de Gestão", T, (), ("sessao.gestao.acessar", "dashboard.visualizar"), motor="gestao"),
    _f(18, "fit_cultural", "Fit Cultural", H, ("fit_cultural.",), fecha_com="provas"),
    _f(19, "emails", "Emails", T, ("emails.",), motor="emails"),
    _f(20, "chat", "Chat", T, futura=True),
    _f(21, "administracao", "Área administrativa", T, ("configuracoes.",), ("sessao.configuracoes.acessar",)),
    _f(22, "unidades", "Operação", T, ("operacoes.",)),  # nome pedido pelo Paulo (16/nov/2026)
    _f(23, "usuarios", "Usuários", T, ("usuarios.",), base=True),
    _f(24, "perfis", "Perfis e Permissões", T, base=True),
    _f(25, "modulos", "Módulos e funções", T, base=True),
    _f(26, "ambiente", "Configurar Ambiente", T),
    _f(27, "config_gerais", "Configurações gerais", T),
    _f(28, "seguranca", "Segurança", T, ("ambiente.",)),
    _f(29, "auditoria", "Auditoria", T),
    _f(30, "lgpd", "LGPD", T, ("lgpd.",), motor="lgpd"),
    _f(31, "zona_risco", "Zona de Risco", T, descartada=True),
    _f(32, "status", "Status do Sistema", T),
    _f(33, "tela_inicial", "Tela Inicial por perfil", T, ("inicio.",)),
    _f(34, "notificacoes", "Notificações", T, ("notificacoes.",), motor="notificacoes"),
    _f(35, "calendario", "Calendário", T, ("calendario.",), motor="calendario"),
    _f(36, "entrevistas", "Entrevistas", H, ("entrevistas.",), fecha_com="processos"),
    _f(37, "admissao", "Admissão (Onboarding)", H, ("onboarding.",), motor="admissao"),
    _f(38, "funil", "Funil de Candidatos", H),
    _f(39, "candidatura", "Candidatura Pública", H),
    _f(40, "analise_ia", "Análise de Currículos com IA", H, descartada=True),
    _f(41, "disc", "DISC", H),
    _f(42, "raciocinio", "Raciocínio Lógico", H),
    _f(43, "documentos", "Central de Documentos", H, ("documentos.",), motor="documentos"),
    _f(44, "modelos_documentos", "Modelos de Documentos", H, ("documentos_templates.",), motor="modelos_documentos"),
    _f(45, "politicas", "Políticas", H, ("politicas.",), motor="politicas"),
    _f(46, "scorecards", "Scorecards", O),
    _f(47, "tipos_atendimento", "Tipos de Atendimento", O),
    _f(48, "ajuda", "Central de Ajuda", T, ("documentos_biblioteca.",), motor="ajuda"),
    _f(49, "ambiente_pessoal", "Ambiente pessoal", T),
    # Pente fino de 16/nov/2026 (Anexo A2 da auditoria): funções que existiam no código sem estar na lista.
    _f(50, "paineis", "Painéis (TV por unidade)", O, ("painel.",), ("sessao.painel.acessar",), motor="paineis"),
    _f(51, "sso", "Login com Microsoft", T),
    _f(52, "senha", "Política de senha", T),
    _f(53, "novidades_login", "Novidades do Login", T),
    _f(54, "orientacoes", "Orientações guiadas", T),
    _f(55, "busca", "Busca global", T),
    _f(56, "integracoes", "Integrações (Microsoft 365, SharePoint, e-mail)", T),
    _f(57, "intranets", "Intranets das operações", T),
    _f(58, "caixa_email", "Caixa de e-mail", H),
    _f(59, "rotinas", "Rotinas automáticas", T),
    _f(60, "backup", "Backup (mostrar e avisar)", T, futura=True),
    _f(61, "emails_admin", "E-mails de administrador", T, futura=True),
    _f(62, "pastas", "Pastas de salvamento", T, futura=True),
    _f(63, "exportacoes", "Exportações (Excel e PDF)", T),
    _f(64, "gestao_global", "Gestão Global da Monitoria", O),
    _f(65, "escalas_ti", "Escalas e Plantões da TI", T),
    _f(66, "telefonia", "Telefonia (login e pausa reais)", O, futura=True),
)

POR_ID: dict[str, Funcao] = {f.id: f for f in FUNCOES_CATALOGO}
FUNCOES_VISIVEIS: tuple[Funcao, ...] = tuple(f for f in FUNCOES_CATALOGO if not f.descartada)


def prefixos_do_motor() -> dict[str, tuple[str, ...]]:
    """Motor -> prefixos e chaves das funções do catálogo ligadas a ele. Fonte da camada "função" da regra única
    (`modulos_catalogo.PREFIXOS_DA_FUNCAO`): uma lista só, sem cópia à mão."""
    saida: dict[str, list[str]] = {}
    for f in FUNCOES_CATALOGO:
        if f.motor or f.fecha_com:
            saida.setdefault(f.motor or f.fecha_com, []).extend((*f.prefixos, *f.chaves))
    return {m: tuple(dict.fromkeys(v)) for m, v in saida.items()}


def motor_da_permissao(chave: str) -> str | None:
    """Motor (função do menu que fecha a porta) dono da permissão, pelo catálogo único."""
    f = funcao_de(chave)
    return (f.motor or f.fecha_com) if f else None


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
