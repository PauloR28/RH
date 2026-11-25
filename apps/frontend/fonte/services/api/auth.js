import {
  limparSessaoAutenticacao,
  lerSessaoAutenticacao,
  possuiSessaoAutenticada,
  requisitar,
  salvarSessaoAutenticacao,
} from './core.js?v=20261125-acessos-salvar';

export async function fazerLoginApi(usuario, senha, mfaCode = '') {
  const resultado = await requisitar(
    '/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha, mfa_code: mfaCode }),
    },
    { autenticado: false },
  );

  salvarSessaoAutenticacao(resultado.access_token, resultado);
  return resultado;
}

export async function concluirLoginMicrosoftApi() {
  const resultado = await requisitar(
    '/auth/microsoft/complete',
    {
      method: 'POST',
      credentials: 'include',
    },
    { autenticado: false },
  );

  salvarSessaoAutenticacao(resultado.access_token, resultado);
  return resultado;
}

export async function verificarSessaoApi() {
  const sessao = await requisitar('/auth/me', { method: 'GET' });
  salvarSessaoAutenticacao(lerSessaoAutenticacao().token, sessao);
  return sessao;
}

export async function atualizarAvatarUsuarioApi(avatarIlustrado) {
  const resultado = await requisitar('/auth/me/avatar', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatar_ilustrado: avatarIlustrado || '' }),
  });

  salvarSessaoAutenticacao(resultado.access_token || lerSessaoAutenticacao().token, resultado);
  return resultado;
}

export async function atualizarNomeUsuarioApi(nome) {
  const resultado = await requisitar('/auth/me/nome', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: nome || '' }),
  });

  salvarSessaoAutenticacao(resultado.access_token || lerSessaoAutenticacao().token, resultado);
  return resultado;
}

export async function atualizarSenhaUsuarioApi(senhaAtual, novaSenha) {
  return requisitar('/auth/me/senha', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senha_atual: senhaAtual || '', nova_senha: novaSenha || '' }),
  });
}

export async function atualizarSobrenomeUsuarioApi(sobrenome) {
  const resultado = await requisitar('/auth/me/sobrenome', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sobrenome: sobrenome || '' }),
  });

  salvarSessaoAutenticacao(resultado.access_token || lerSessaoAutenticacao().token, resultado);
  return resultado;
}

export async function atualizarCargoUsuarioApi(cargo) {
  const resultado = await requisitar('/auth/me/cargo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cargo: cargo || '' }),
  });

  salvarSessaoAutenticacao(resultado.access_token || lerSessaoAutenticacao().token, resultado);
  return resultado;
}

export async function solicitarAlteracaoEmailApi(emailNovo) {
  return requisitar('/auth/me/email', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email_novo: emailNovo || '' }),
  });
}

export async function ativarLoginLocalApi(novaSenha, confirmarSenha) {
  const resultado = await requisitar('/auth/me/ativar-login-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nova_senha: novaSenha || '', confirmar_senha: confirmarSenha || '' }),
  });

  salvarSessaoAutenticacao(resultado.access_token || lerSessaoAutenticacao().token, resultado);
  return resultado;
}

export async function atualizarProvedorAutenticacaoApi(provedor) {
  const resultado = await requisitar('/auth/me/provedor-autenticacao', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provedor: provedor || '' }),
  });

  salvarSessaoAutenticacao(resultado.access_token || lerSessaoAutenticacao().token, resultado);
  return resultado;
}

export async function listarSolicitacoesAlteracaoEmailApi() {
  return requisitar('/settings/users/email-change-requests', { method: 'GET' });
}

export async function aprovarSolicitacaoAlteracaoEmailApi(idSolicitacao) {
  return requisitar(`/settings/users/email-change-requests/${idSolicitacao}/approve`, {
    method: 'POST',
  });
}

export async function rejeitarSolicitacaoAlteracaoEmailApi(idSolicitacao, motivo = '') {
  return requisitar(`/settings/users/email-change-requests/${idSolicitacao}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo: motivo || '' }),
  });
}

export async function encerrarSessaoApi() {
  try {
    if (!possuiSessaoAutenticada()) {
      return { success: true };
    }

    return await requisitar('/auth/logout', { method: 'POST' });
  } finally {
    limparSessaoAutenticacao();
  }
}
