-- Conecta - Modularizacao (V056): dono de cada permissao (modulo_dono) e se ela abre o modulo (abre_modulo).
-- Aditiva e idempotente; o seed nao sobrescreve valores ja definidos. Gerada de rh_api/repositories/modulos_schema.py.

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL AND COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NULL
BEGIN
    ALTER TABLE dbo.permissoes ADD modulo_dono NVARCHAR(30) NULL;
END;

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL AND COL_LENGTH('dbo.permissoes', 'abre_modulo') IS NULL
BEGIN
    ALTER TABLE dbo.permissoes ADD abre_modulo BIT NOT NULL CONSTRAINT DF_permissoes_abre_modulo DEFAULT 0;
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''core'', abre_modulo = 0 WHERE modulo_dono IS NULL AND chave IN (''dashboard.visualizar'', ''inicio.visualizar'', ''mural.criar'', ''mural.editar'', ''mural.excluir'', ''mural.visualizar'', ''notificacoes.configurar'', ''notificacoes.visualizar'', ''onboarding.concluir_proprio'', ''onboarding.editar'', ''onboarding.visualizar'', ''operacoes.visualizar'', ''sessao.drive.acessar'', ''sessao.gestao.acessar'', ''sessao.treinamentos.acessar'');');

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE modulo_dono IS NULL AND chave IN (''monitoria.configurar'', ''monitoria.contestar'', ''monitoria.criar'', ''monitoria.dashboard'', ''monitoria.equipes'', ''monitoria.exportar'', ''monitoria.feedback_aplicar'', ''monitoria.logs'', ''monitoria.matriz'', ''monitoria.plano_acao'', ''monitoria.plano_acao_visualizar'', ''monitoria.reanalisar'', ''monitoria.relatorios'', ''monitoria.usuarios'', ''monitoria.visualizar'', ''wfm.auditoria'', ''wfm.cadastros.editar'', ''wfm.cadastros.visualizar'', ''wfm.contratos.editar'', ''wfm.escala.aprovar'', ''wfm.escala.corrigir_fechada'', ''wfm.escala.criar'', ''wfm.escala.editar'', ''wfm.escala.fechar'', ''wfm.escala.propria'', ''wfm.escala.publicar'', ''wfm.escala.publicar_com_violacao'', ''wfm.escala.visualizar'', ''wfm.presenca.lancar'', ''wfm.relatorios'', ''wfm.tipos_escala.editar'', ''wfm.troca.aprovar'', ''wfm.troca.desfazer'', ''wfm.troca.solicitar'', ''wfm.troca.visualizar'');');

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 1 WHERE modulo_dono IS NULL AND chave IN (''sessao.monitoria.acessar'', ''sessao.wfm.acessar'');');

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''rh'', abre_modulo = 0 WHERE modulo_dono IS NULL AND chave IN (''calendario.editar'', ''calendario.visualizar'', ''candidatos.alterar_nota'', ''candidatos.anonimizar'', ''candidatos.aprovar_final'', ''candidatos.aprovar_operacional'', ''candidatos.avaliar_curriculo'', ''candidatos.baixar_curriculo'', ''candidatos.consultar_historico'', ''candidatos.criar'', ''candidatos.dados_sensiveis'', ''candidatos.editar'', ''candidatos.editar_admissional'', ''candidatos.editar_basico'', ''candidatos.eliminar'', ''candidatos.excluir'', ''candidatos.mover_etapa'', ''candidatos.reverter_eliminacao'', ''candidatos.visualizar'', ''documentos.configurar'', ''documentos.marcar_recebido'', ''documentos.recusar'', ''documentos.reenvio'', ''documentos.solicitar'', ''documentos.validar'', ''documentos.visualizar'', ''documentos_templates.editar'', ''documentos_templates.visualizar'', ''emails.configurar_modelos'', ''emails.enviar_livre'', ''emails.enviar_modelo'', ''entrevistas.avaliar'', ''entrevistas.cancelar'', ''entrevistas.configurar'', ''entrevistas.criar'', ''entrevistas.editar'', ''entrevistas.marcar_presenca'', ''entrevistas.visualizar'', ''etapas.configurar'', ''fit_cultural.editar'', ''fit_cultural.visualizar'', ''lgpd.registrar_solicitacao'', ''lgpd.visualizar'', ''onboarding.configurar_acesso'', ''onboarding.criar'', ''onboarding.gerenciar'', ''onedrive.excluir'', ''onedrive.upload'', ''onedrive.visualizar'', ''politicas.editar'', ''politicas.visualizar'', ''processos.criar'', ''processos.editar'', ''processos.excluir'', ''processos.visualizar'', ''provas.configurar_criterios'', ''provas.configurar_pesos'', ''provas.corrigir'', ''provas.criar'', ''provas.editar'', ''provas.enviar'', ''provas.excluir'', ''provas.questoes_criar'', ''provas.questoes_editar'', ''provas.questoes_excluir'', ''provas.visualizar'', ''trilhas.configurar'', ''vagas.cancelar'', ''vagas.criar'', ''vagas.editar'', ''vagas.editar_limitado'', ''vagas.encerrar'', ''vagas.excluir'', ''vagas.pausar'', ''vagas.solicitar_abertura'', ''vagas.visualizar'');');

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''rh'', abre_modulo = 1 WHERE modulo_dono IS NULL AND chave IN (''sessao.curriculos.acessar'', ''sessao.processos.acessar'', ''sessao.provas.acessar'');');

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''tecnologia'', abre_modulo = 0 WHERE modulo_dono IS NULL AND chave IN (''configuracoes.editar'', ''documentos_biblioteca.editar'', ''documentos_biblioteca.visualizar'', ''lgpd.anonimizar'', ''lgpd.configurar'', ''lgpd.exportar_dados'', ''logs.exportar'', ''logs.visualizar'', ''operacoes.editar'', ''relatorios.exportar'', ''relatorios.visualizar'', ''sessao.configuracoes.acessar'', ''usuarios.alterar_email'', ''usuarios.alterar_perfil'', ''usuarios.ativar'', ''usuarios.bloquear'', ''usuarios.criar'', ''usuarios.desativar'', ''usuarios.desbloquear'', ''usuarios.editar'', ''usuarios.excluir'', ''usuarios.redefinir_senha'', ''usuarios.ver_logs'', ''usuarios.visualizar'');');

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''tecnologia'', abre_modulo = 1 WHERE modulo_dono IS NULL AND chave IN (''configuracoes.visualizar'');');
