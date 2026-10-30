import { useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { aprovacoesPendentesWfm, pendenciasPresencaWfm } from '../../../services/api/wfm.js?v=20261030-folga';

// Total de presenças pendentes de confirmação (escalados até hoje, sem lançamento) da semana, vindo do servidor.
// Alimenta o selo da aba Presença. Sem permissão de lançar presença ou sem operação, não consulta.

const paraIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function semanaDe(base = new Date()) {
  const seg = new Date(base.getFullYear(), base.getMonth(), base.getDate() - ((base.getDay() + 6) % 7));
  const dom = new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + 6);
  return [paraIso(seg), paraIso(dom)];
}

export function usePendenciasPresenca(operacao, habilitado, gatilho = '') {
  const [total, setTotal] = useState(0);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (!habilitado || !operacao) { setTotal(0); return undefined; }
    let ativo = true;
    const [ini, fim] = semanaDe();
    pendenciasPresencaWfm(operacao, ini, fim).then((r) => { if (ativo) setTotal(Number(r?.total) || 0); }).catch(() => { if (ativo) setTotal(0); });
    return () => { ativo = false; };
  }, [operacao, habilitado, gatilho, versao]);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { total, recarregar };
}

// Escalas (de qualquer mês) aguardando a decisão do usuário. Alimenta a bolinha da lista de escalas, o selo da aba Escala e o
// painel "Aprovações pendentes". Sem a permissão de aprovar, não consulta. Atualiza ao voltar para a aba e a cada 60 s.
export function usePendenciasAprovacao(habilitado, gatilho = '') {
  const [itens, setItens] = useState([]);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (!habilitado) { setItens([]); return undefined; }
    let ativo = true;
    const buscar = () => aprovacoesPendentesWfm().then((r) => { if (ativo) setItens(r?.itens || []); }, () => {});
    buscar();
    const silencioso = () => { if (!document.hidden) buscar(); };
    const timer = setInterval(silencioso, 60000);
    document.addEventListener('visibilitychange', silencioso);
    return () => { ativo = false; clearInterval(timer); document.removeEventListener('visibilitychange', silencioso); };
  }, [habilitado, gatilho, versao]);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { itens, total: itens.length, recarregar };
}
