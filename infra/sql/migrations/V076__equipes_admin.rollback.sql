-- Rollback da V076. Tira as permissoes da funcao Equipes e as colunas de responsavel/apoio.
-- Nao mexe em usuarios nem na escala: as mudancas de equipe ja feitas continuam valendo.
IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL DELETE FROM dbo.perfil_permissoes WHERE chave_permissao IN ('equipes.visualizar', 'equipes.administrar', 'equipes.mover', 'equipes.exportar');
IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL DELETE FROM dbo.permissoes WHERE chave IN ('equipes.visualizar', 'equipes.administrar', 'equipes.mover', 'equipes.exportar');
IF COL_LENGTH('dbo.equipes_operacao', 'id_apoio') IS NOT NULL ALTER TABLE dbo.equipes_operacao DROP COLUMN id_apoio;
IF COL_LENGTH('dbo.equipes_operacao', 'id_supervisor') IS NOT NULL ALTER TABLE dbo.equipes_operacao DROP COLUMN id_supervisor;
