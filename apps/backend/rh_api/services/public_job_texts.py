from __future__ import annotations

from .helpers import normalize_compare_text, normalize_text

DEFAULT_PUBLIC_JOB_TEXTS = {
    "default": {
        "descricao": (
            "Oportunidade aberta para atuar na vaga informada neste processo seletivo. "
            "A pessoa selecionada participará das rotinas da área, seguindo os procedimentos internos "
            "e contribuindo para uma entrega organizada, cordial e alinhada aos padrões da Central 24h."
        ),
        "requisitos": [
            "Ensino médio completo ou formação compatível com a vaga.",
            "Experiência anterior em atividades relacionadas será considerada um diferencial.",
            "Boa comunicação verbal e escrita.",
            "Organização, responsabilidade e postura profissional.",
            "Facilidade para aprender sistemas, processos internos e rotinas operacionais.",
            "Disponibilidade para cumprir a jornada e os horários definidos pelo RH.",
        ],
        "responsabilidades": [
            "Executar as atividades da função conforme orientação da liderança.",
            "Atender demandas internas e externas com cordialidade, clareza e agilidade.",
            "Registrar informações de forma correta nos sistemas e controles definidos.",
            "Cumprir procedimentos, prazos, políticas internas e orientações do processo.",
            "Apoiar a equipe na manutenção da qualidade e continuidade das operações.",
        ],
    },
    "atendimento": {
        "descricao": (
            "Oportunidade para atuar com atendimento ao cliente, prestando suporte, registrando informações "
            "e garantindo uma comunicação clara, humanizada e eficiente durante a rotina operacional."
        ),
        "requisitos": [
            "Ensino médio completo.",
            "Experiência com atendimento ao cliente, call center, suporte ou recepção será diferencial.",
            "Boa dicção, escuta ativa e comunicação objetiva.",
            "Conhecimento básico em informática e facilidade para utilizar sistemas.",
            "Capacidade de seguir scripts, procedimentos e orientações de qualidade.",
            "Postura cordial, resiliência e foco na resolução de demandas.",
        ],
        "responsabilidades": [
            "Realizar atendimento a clientes ou usuários pelos canais definidos pela operação.",
            "Registrar corretamente dados, solicitações e encaminhamentos nos sistemas.",
            "Seguir scripts, políticas de atendimento e orientações da liderança.",
            "Acompanhar demandas dentro dos prazos e acionar áreas responsáveis quando necessário.",
            "Contribuir para uma experiência de atendimento clara, respeitosa e eficiente.",
        ],
    },
    "administrativo": {
        "descricao": (
            "Oportunidade para apoiar rotinas administrativas, controles internos, organização de informações "
            "e acompanhamento de demandas da área, mantendo qualidade, confidencialidade e regularidade nos processos."
        ),
        "requisitos": [
            "Ensino médio completo; formação técnica ou superior em andamento será diferencial.",
            "Experiência com rotinas administrativas, controles, planilhas ou atendimento interno.",
            "Conhecimento em pacote Office, especialmente Excel em nível básico a intermediário.",
            "Organização, atenção a detalhes e boa gestão de prioridades.",
            "Boa comunicação escrita e relacionamento interpessoal.",
            "Responsabilidade no tratamento de dados e documentos internos.",
        ],
        "responsabilidades": [
            "Apoiar controles, cadastros, acompanhamentos e atualizações administrativas.",
            "Organizar documentos, informações e registros conforme procedimentos internos.",
            "Atender solicitações da área e apoiar a comunicação com equipes relacionadas.",
            "Preparar planilhas, relatórios simples e consolidações quando solicitado.",
            "Manter rotinas em dia, com atenção a prazos, qualidade e confidencialidade.",
        ],
    },
    "comercial": {
        "descricao": (
            "Oportunidade para apoiar a rotina comercial com organização de dados, planilhas, indicadores, "
            "contatos e consolidação de informações para acompanhamento da área."
        ),
        "requisitos": [
            "Conhecimento básico em pacote Office, especialmente Excel.",
            "Interesse em indicadores, dados comerciais e organização de informações.",
            "Boa comunicação escrita e verbal.",
            "Atenção a detalhes e facilidade para trabalhar com planilhas.",
            "Noções de Power BI serão consideradas diferencial.",
        ],
        "responsabilidades": [
            "Organizar bases, contatos, retornos e indicadores comerciais.",
            "Apoiar conferência de planilhas e identificação de divergências.",
            "Atualizar informações de acompanhamento conforme orientação da área.",
            "Comunicar pendências e apoiar a consolidação de dados para análise.",
        ],
    },
    "financeiro": {
        "descricao": (
            "Oportunidade para apoiar rotinas financeiras, conferência de documentos, organização de planilhas "
            "e controle de informações com atenção a prazos e qualidade dos dados."
        ),
        "requisitos": [
            "Conhecimento básico em Excel e organização de planilhas.",
            "Atenção a detalhes, responsabilidade e postura profissional.",
            "Interesse em controles financeiros, documentos e conferência de dados.",
            "Boa comunicação para registrar e sinalizar pendências.",
        ],
        "responsabilidades": [
            "Apoiar conferência de documentos, valores e informações em planilhas.",
            "Registrar pendências e divergências de forma clara.",
            "Organizar dados financeiros conforme procedimentos internos.",
            "Apoiar controles e rotinas da área com confidencialidade.",
        ],
    },
    "ti_suporte": {
        "descricao": (
            "Oportunidade para atuar com suporte técnico, atendimento a usuários, triagem de chamados, "
            "diagnóstico de problemas em hardware, software, Windows, redes e pacote Office conforme o nível da vaga."
        ),
        "requisitos": [
            "Conhecimento em hardware, software, Windows e pacote Office.",
            "Boa comunicação para atendimento ao usuário e registro de chamados.",
            "Capacidade de diagnosticar problemas com organização e evidências.",
            "Noções de redes de computadores conforme o nível da vaga.",
            "Postura colaborativa e foco em solução.",
        ],
        "responsabilidades": [
            "Atender usuários, registrar chamados e acompanhar solicitações técnicas.",
            "Realizar diagnóstico inicial ou intermediário conforme o nível da vaga.",
            "Apoiar manutenção de computadores, sistemas, acessos e pacote Office.",
            "Escalonar incidentes quando necessário e manter comunicação clara sobre o andamento.",
        ],
    },
    "supervisao": {
        "descricao": (
            "Oportunidade para atuar na condução de equipe e acompanhamento de indicadores, apoiando a operação "
            "na organização da rotina, orientação dos colaboradores e garantia dos padrões de atendimento."
        ),
        "requisitos": [
            "Ensino médio completo; superior em andamento ou completo será diferencial.",
            "Experiência anterior com liderança, monitoria, supervisão ou apoio operacional.",
            "Conhecimento de indicadores, controles operacionais e rotina de atendimento.",
            "Boa comunicação, organização e capacidade de orientar equipes.",
            "Perfil analítico, postura colaborativa e foco em resultados.",
            "Disponibilidade para acompanhar a escala e as necessidades da operação.",
        ],
        "responsabilidades": [
            "Acompanhar a rotina da equipe e apoiar a distribuição de atividades.",
            "Monitorar indicadores, qualidade, produtividade e aderência aos processos.",
            "Orientar colaboradores, apoiar dúvidas e conduzir alinhamentos operacionais.",
            "Registrar ocorrências, acompanhar planos de ação e reportar pontos relevantes.",
            "Atuar junto à liderança para manter a operação organizada e dentro dos padrões definidos.",
        ],
    },
}


def _resolve_job_key(processo: dict | None) -> str:
    safe_process = processo or {}
    haystack = " ".join(
        [
            normalize_compare_text(safe_process.get("vaga")),
            normalize_compare_text(safe_process.get("operacao")),
            normalize_compare_text(safe_process.get("trilha")),
        ],
    )
    haystack_padded = f" {haystack} "

    if any(term in haystack_padded for term in ("suporte tecnico", "help desk", " ti ", " tecnico")):
        return "ti_suporte"
    if any(term in haystack for term in ("comercial", "power bi", "dados comerciais")):
        return "comercial"
    if any(term in haystack for term in ("financeiro", "financeira", "controles financeiros")):
        return "financeiro"
    if any(term in haystack for term in ("supervisor", "supervisao", "lider")):
        return "supervisao"
    if any(term in haystack for term in ("administrativo", "assistente", "auxiliar", "backoffice", "excel")):
        return "administrativo"
    if any(term in haystack for term in ("atendimento", "operador", "call center", "teleatendimento", "sac", "suporte")):
        return "atendimento"
    return "default"


def get_default_public_job_texts(processo: dict | None) -> dict:
    texts = DEFAULT_PUBLIC_JOB_TEXTS.get(_resolve_job_key(processo), DEFAULT_PUBLIC_JOB_TEXTS["default"])
    return {
        "descricao": normalize_text(texts.get("descricao")),
        "requisitos": list(texts.get("requisitos", [])),
        "responsabilidades": list(texts.get("responsabilidades", [])),
    }
