from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

import rh_api.task_queue as task_queue_module
from rh_api.task_queue import enfileirar


def _reset_module_state():
    task_queue_module.reset_fallback_warning_for_tests()


class EnfileirarWithoutRedisConfiguredTests(unittest.TestCase):
    """Sem RH_REDIS_URL: enfileirar() deve executar a função de forma
    síncrona/imediata (fallback idêntico ao comportamento atual do sistema),
    sem erro e sem tentar tocar rede."""

    def setUp(self):
        _reset_module_state()

    def test_executes_synchronously_and_returns_function_result(self):
        settings = mock.Mock(redis_url="")
        calls = []

        def tarefa(a, b, *, c=0):
            calls.append((a, b, c))
            return a + b + c

        with mock.patch("rh_api.task_queue.get_settings", return_value=settings):
            resultado = enfileirar(tarefa, 1, 2, c=3)

        self.assertEqual(resultado, 6)
        self.assertEqual(calls, [(1, 2, 3)])

    def test_warning_logged_only_once_across_many_calls(self):
        settings = mock.Mock(redis_url="")
        with mock.patch("rh_api.task_queue.get_settings", return_value=settings), \
                mock.patch("rh_api.task_queue.logger") as mock_logger:
            for _ in range(4):
                enfileirar(lambda: None)
            self.assertEqual(mock_logger.warning.call_count, 1)


class EnfileirarRedisRqMissingTests(unittest.TestCase):
    """Com RH_REDIS_URL configurada mas 'redis'/'rq' não instalados (cenário
    real deste ambiente): também deve cair no fallback síncrono."""

    def setUp(self):
        _reset_module_state()

    def test_falls_back_to_sync_when_dependencies_missing(self):
        settings = mock.Mock(redis_url="redis://localhost:6379/0")
        marker = {"called": False}

        def tarefa():
            marker["called"] = True
            return "ok"

        with mock.patch("rh_api.task_queue.get_settings", return_value=settings), \
                mock.patch.dict(sys.modules, {"redis": None, "rq": None}):
            resultado = enfileirar(tarefa)

        self.assertTrue(marker["called"])
        self.assertEqual(resultado, "ok")


class EnfileirarMockedRqTests(unittest.TestCase):
    """Lógica de enfileiramento isolada, mockando a fila RQ."""

    def setUp(self):
        _reset_module_state()

    def test_enqueues_via_rq_queue_when_available(self):
        fake_job = mock.Mock(id="job-123")
        fake_queue = mock.Mock()
        fake_queue.enqueue.return_value = fake_job

        def tarefa(x):
            return x

        with mock.patch.object(task_queue_module, "_get_rq_queue", return_value=fake_queue):
            resultado = enfileirar(tarefa, 42)

        fake_queue.enqueue.assert_called_once_with(tarefa, 42)
        self.assertIs(resultado, fake_job)

    def test_falls_back_to_sync_when_enqueue_raises(self):
        fake_queue = mock.Mock()
        fake_queue.enqueue.side_effect = RuntimeError("fila indisponível")

        calls = []

        def tarefa(x):
            calls.append(x)
            return x * 2

        with mock.patch.object(task_queue_module, "_get_rq_queue", return_value=fake_queue):
            resultado = enfileirar(tarefa, 21)

        self.assertEqual(calls, [21])
        self.assertEqual(resultado, 42)


if __name__ == "__main__":
    unittest.main()
