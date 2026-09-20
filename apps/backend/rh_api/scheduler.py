from __future__ import annotations

import logging

from .config import Settings

logger = logging.getLogger(__name__)


def _run_inactivity_reminder_job(settings: Settings) -> None:
    """Executado periodicamente pelo APScheduler dentro do próprio processo
    do backend (roadmap: "Lembretes e alertas automáticos"). Cria sua
    própria conexão/repositório a cada execução (não compartilha estado com
    requests HTTP) e nunca deixa uma exceção escapar — um job de background
    que derruba o processo do backend seria pior do que simplesmente pular
    uma execução.
    """
    try:
        # Import tardio para não acoplar o módulo do scheduler ao restante do
        # backend antes de sabermos que o job realmente vai rodar.
        from .repositories import DatabaseRepository

        repository = DatabaseRepository(settings)
        resultado = repository.run_scheduled_inactivity_reminders()
        logger.info("Job agendado de lembretes de inatividade executado: %s", resultado)
    except Exception:  # pragma: no cover - blindagem defensiva do job agendado
        logger.exception("Falha ao executar o job agendado de lembretes de inatividade.")


def _run_training_call_escalation_job(settings: Settings) -> None:
    """Escalonamento por chamada pendente da Central de Treinamentos (Prompt.txt,
    rodada 06/set/2026 — ver docs/central-treinamentos/01-plano-tecnico.md §6):
    3 dias sem chamada salva notifica RH/Gestor/ADM, 5 dias encerra a sessão
    automaticamente. Mesmo padrão defensivo do job de lembretes acima."""
    try:
        from .repositories import DatabaseRepository

        repository = DatabaseRepository(settings)
        resultado = repository.run_training_call_escalation()
        logger.info("Job agendado de escalonamento de chamada de treinamento executado: %s", resultado)
    except Exception:  # pragma: no cover - blindagem defensiva do job agendado
        logger.exception("Falha ao executar o job agendado de escalonamento de chamada de treinamento.")


def _run_monitoria_sla_job(settings: Settings) -> None:
    """SLAs da Monitoria (promt.txt §5.9): confirma automaticamente após 48h sem
    manifestação do operador, anula após 72h sem reanálise e conta feedbacks
    vencidos. Idempotente (ver mon_processar_slas). Mesma blindagem dos demais jobs."""
    try:
        from .repositories import DatabaseRepository

        resultado = DatabaseRepository(settings).mon_processar_slas()
        logger.info("Job de SLA da Monitoria executado: %s", resultado)
    except Exception:  # pragma: no cover - blindagem defensiva do job agendado
        logger.exception("Falha ao executar o job de SLA da Monitoria.")


def start_scheduler(settings: Settings):
    """Inicia um `BackgroundScheduler` (APScheduler) com o job periódico de
    lembretes/alertas automáticos, se a biblioteca estiver disponível e a
    automação estiver habilitada.

    Infraestrutura leve e opcional/degradável (CLAUDE.md): se o APScheduler
    não estiver instalado, ou falhar ao iniciar por qualquer motivo, o
    restante do backend deve continuar funcionando normalmente — apenas os
    lembretes automáticos ficam indisponíveis, registrado em log.

    Retorna a instância do scheduler (para ser desligada no shutdown) ou
    `None` quando o scheduler não pôde ser iniciado.
    """
    if not getattr(settings, "scheduler_enabled", True):
        logger.info("Scheduler de lembretes automáticos desativado por configuração (RH_SCHEDULER_ENABLED).")
        return None

    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except ImportError:
        logger.warning(
            "APScheduler não está instalado; lembretes e alertas automáticos ficarão "
            "indisponíveis (o restante do backend continua funcionando normalmente). "
            "Instale a dependência 'apscheduler' para habilitar."
        )
        return None

    try:
        interval_hours = max(1, int(getattr(settings, "scheduler_inactivity_interval_hours", 1) or 1))
        scheduler = BackgroundScheduler(timezone="UTC")
        scheduler.add_job(
            _run_inactivity_reminder_job,
            trigger="interval",
            hours=interval_hours,
            args=(settings,),
            id="lembretes_inatividade_processos",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
        )
        scheduler.add_job(
            _run_training_call_escalation_job,
            trigger="interval",
            hours=1,
            args=(settings,),
            id="escalonamento_chamada_treinamento",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
        )
        scheduler.add_job(
            _run_monitoria_sla_job,
            trigger="interval",
            minutes=5,
            args=(settings,),
            id="sla_monitoria",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
        )
        scheduler.start()
        logger.info(
            "Scheduler de lembretes automáticos iniciado (verificação a cada %s hora(s)).",
            interval_hours,
        )
        return scheduler
    except Exception:
        logger.exception(
            "Falha ao iniciar o scheduler de lembretes automáticos; o restante do backend "
            "continua funcionando normalmente."
        )
        return None


def stop_scheduler(scheduler) -> None:
    if scheduler is None:
        return
    try:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler de lembretes automáticos encerrado.")
    except Exception:  # pragma: no cover - blindagem defensiva no shutdown
        logger.exception("Falha ao encerrar o scheduler de lembretes automáticos.")
