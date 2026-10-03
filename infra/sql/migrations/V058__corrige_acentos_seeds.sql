-- Conecta - V058: corrige textos acentuados semeados com mojibake pelas migrations antigas (sqlcmd sem -f 65001).
-- Igualdade exata com o texto corrompido (nao altera o que foi editado), 100% ASCII, idempotente. Remove apenas
-- duplicatas de motivos de eliminacao criadas pela propria V036 e nunca usadas. Gerada de
-- rh_api/repositories/acentos_migration.py.

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'nivel') IS NOT NULL
    UPDATE dbo.perfis SET nivel = N'Avan' + NCHAR(231) + N'ado' WHERE nivel COLLATE Latin1_General_BIN2 = N'Avan' + NCHAR(195) + NCHAR(167) + N'ado';

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'nivel') IS NOT NULL
    UPDATE dbo.perfis SET nivel = N'B' + NCHAR(225) + N'sico' WHERE nivel COLLATE Latin1_General_BIN2 = N'B' + NCHAR(195) + NCHAR(161) + N'sico';

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'nivel') IS NOT NULL
    UPDATE dbo.perfis SET nivel = N'Intermedi' + NCHAR(225) + N'rio' WHERE nivel COLLATE Latin1_General_BIN2 = N'Intermedi' + NCHAR(195) + NCHAR(161) + N'rio';

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'nome') IS NOT NULL
    UPDATE dbo.perfis SET nome = N'Funcion' + NCHAR(225) + N'rio' WHERE nome COLLATE Latin1_General_BIN2 = N'Funcion' + NCHAR(195) + NCHAR(161) + N'rio';

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'descricao') IS NOT NULL
    UPDATE dbo.perfis SET descricao = N'Opera' + NCHAR(231) + NCHAR(227) + N'o completa de recrutamento e sele' + NCHAR(231) + NCHAR(227) + N'o.' WHERE descricao COLLATE Latin1_General_BIN2 = N'Opera' + NCHAR(195) + NCHAR(167) + NCHAR(195) + NCHAR(163) + N'o completa de recrutamento e sele' + NCHAR(195) + NCHAR(167) + NCHAR(195) + NCHAR(163) + N'o.';

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'descricao') IS NOT NULL
    UPDATE dbo.perfis SET descricao = N'Acesso aos pr' + NCHAR(243) + N'prios fluxos.' WHERE descricao COLLATE Latin1_General_BIN2 = N'Acesso aos pr' + NCHAR(195) + NCHAR(179) + N'prios fluxos.';

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'descricao') IS NOT NULL
    UPDATE dbo.perfis SET descricao = N'Colaborador com acesso de autoatendimento e ' + NCHAR(224) + N' Central de Treinamentos.' WHERE descricao COLLATE Latin1_General_BIN2 = N'Colaborador com acesso de autoatendimento e ' + NCHAR(195) + NCHAR(160) + N' Central de Treinamentos.';

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'descricao') IS NOT NULL
    UPDATE dbo.perfis SET descricao = N'Acompanhamento de equipe, entrevistas e aplica' + NCHAR(231) + NCHAR(227) + N'o de treinamentos.' WHERE descricao COLLATE Latin1_General_BIN2 = N'Acompanhamento de equipe, entrevistas e aplica' + NCHAR(195) + NCHAR(167) + NCHAR(195) + NCHAR(163) + N'o de treinamentos.';

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'descricao') IS NOT NULL
    UPDATE dbo.perfis SET descricao = N'Colaborador operacional com acesso de autoatendimento e ' + NCHAR(224) + N' Central de Treinamentos.' WHERE descricao COLLATE Latin1_General_BIN2 = N'Colaborador operacional com acesso de autoatendimento e ' + NCHAR(195) + NCHAR(160) + N' Central de Treinamentos.';

IF OBJECT_ID('dbo.trilhas_onboarding', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding', 'nome') IS NOT NULL
    UPDATE dbo.trilhas_onboarding SET nome = N'Trilha padr' + NCHAR(227) + N'o de onboarding' WHERE nome COLLATE Latin1_General_BIN2 = N'Trilha padr' + NCHAR(195) + NCHAR(163) + N'o de onboarding';

IF OBJECT_ID('dbo.trilhas_onboarding', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding', 'descricao') IS NOT NULL
    UPDATE dbo.trilhas_onboarding SET descricao = N'Trilha inicial sugerida pelo RH. Edite os itens conforme a necessidade da opera' + NCHAR(231) + NCHAR(227) + N'o.' WHERE descricao COLLATE Latin1_General_BIN2 = N'Trilha inicial sugerida pelo RH. Edite os itens conforme a necessidade da opera' + NCHAR(195) + NCHAR(167) + NCHAR(195) + NCHAR(163) + N'o.';

IF OBJECT_ID('dbo.trilhas_onboarding_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding_itens', 'titulo') IS NOT NULL
    UPDATE dbo.trilhas_onboarding_itens SET titulo = N'Documenta' + NCHAR(231) + NCHAR(227) + N'o admissional' WHERE titulo COLLATE Latin1_General_BIN2 = N'Documenta' + NCHAR(195) + NCHAR(167) + NCHAR(195) + NCHAR(163) + N'o admissional';

IF OBJECT_ID('dbo.trilhas_onboarding_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding_itens', 'titulo') IS NOT NULL
    UPDATE dbo.trilhas_onboarding_itens SET titulo = N'Apresenta' + NCHAR(231) + NCHAR(227) + N'o da equipe' WHERE titulo COLLATE Latin1_General_BIN2 = N'Apresenta' + NCHAR(195) + NCHAR(167) + NCHAR(195) + NCHAR(163) + N'o da equipe';

IF OBJECT_ID('dbo.trilhas_onboarding_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding_itens', 'titulo') IS NOT NULL
    UPDATE dbo.trilhas_onboarding_itens SET titulo = N'Treinamento inicial da opera' + NCHAR(231) + NCHAR(227) + N'o' WHERE titulo COLLATE Latin1_General_BIN2 = N'Treinamento inicial da opera' + NCHAR(195) + NCHAR(167) + NCHAR(195) + NCHAR(163) + N'o';

IF OBJECT_ID('dbo.trilhas_onboarding_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding_itens', 'titulo') IS NOT NULL
    UPDATE dbo.trilhas_onboarding_itens SET titulo = N'Alinhamento de metas do primeiro m' + NCHAR(234) + N's' WHERE titulo COLLATE Latin1_General_BIN2 = N'Alinhamento de metas do primeiro m' + NCHAR(195) + NCHAR(170) + N's';

IF OBJECT_ID('dbo.trilhas_onboarding_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding_itens', 'descricao') IS NOT NULL
    UPDATE dbo.trilhas_onboarding_itens SET descricao = N'Coletar e validar os documentos exigidos para a admiss' + NCHAR(227) + N'o.' WHERE descricao COLLATE Latin1_General_BIN2 = N'Coletar e validar os documentos exigidos para a admiss' + NCHAR(195) + NCHAR(163) + N'o.';

IF OBJECT_ID('dbo.trilhas_onboarding_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding_itens', 'descricao') IS NOT NULL
    UPDATE dbo.trilhas_onboarding_itens SET descricao = N'Criar usu' + NCHAR(225) + N'rio, e-mail e acessos aos sistemas internos.' WHERE descricao COLLATE Latin1_General_BIN2 = N'Criar usu' + NCHAR(195) + NCHAR(161) + N'rio, e-mail e acessos aos sistemas internos.';

IF OBJECT_ID('dbo.trilhas_onboarding_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding_itens', 'descricao') IS NOT NULL
    UPDATE dbo.trilhas_onboarding_itens SET descricao = N'Apresentar o novo colaborador ao time e aos l' + NCHAR(237) + N'deres diretos.' WHERE descricao COLLATE Latin1_General_BIN2 = N'Apresentar o novo colaborador ao time e aos l' + NCHAR(195) + NCHAR(173) + N'deres diretos.';

IF OBJECT_ID('dbo.trilhas_onboarding_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding_itens', 'descricao') IS NOT NULL
    UPDATE dbo.trilhas_onboarding_itens SET descricao = N'Entregar crach' + NCHAR(225) + N', equipamentos e materiais de trabalho.' WHERE descricao COLLATE Latin1_General_BIN2 = N'Entregar crach' + NCHAR(195) + NCHAR(161) + N', equipamentos e materiais de trabalho.';

IF OBJECT_ID('dbo.motivos_eliminacao', 'U') IS NOT NULL AND COL_LENGTH('dbo.motivos_eliminacao', 'nome') IS NOT NULL
    UPDATE dbo.motivos_eliminacao SET nome = N'Candidato n' + NCHAR(227) + N'o compareceu' WHERE nome COLLATE Latin1_General_BIN2 = N'Candidato n' + NCHAR(195) + NCHAR(163) + N'o compareceu';

IF OBJECT_ID('dbo.motivos_eliminacao', 'U') IS NOT NULL AND COL_LENGTH('dbo.motivos_eliminacao', 'nome') IS NOT NULL
    UPDATE dbo.motivos_eliminacao SET nome = N'Optou por n' + NCHAR(227) + N'o prosseguir' WHERE nome COLLATE Latin1_General_BIN2 = N'Optou por n' + NCHAR(195) + NCHAR(163) + N'o prosseguir';

IF OBJECT_ID('dbo.motivos_eliminacao', 'U') IS NOT NULL AND COL_LENGTH('dbo.motivos_eliminacao', 'nome') IS NOT NULL
    UPDATE dbo.motivos_eliminacao SET nome = N'Baixa ader' + NCHAR(234) + N'ncia a vaga' WHERE nome COLLATE Latin1_General_BIN2 = N'Baixa ader' + NCHAR(195) + NCHAR(170) + N'ncia a vaga';

IF OBJECT_ID('dbo.motivos_eliminacao', 'U') IS NOT NULL AND COL_LENGTH('dbo.motivos_eliminacao', 'nome') IS NOT NULL
    UPDATE dbo.motivos_eliminacao SET nome = N'N' + NCHAR(227) + N'o atendeu aos requisitos' WHERE nome COLLATE Latin1_General_BIN2 = N'N' + NCHAR(195) + NCHAR(163) + N'o atendeu aos requisitos';

IF OBJECT_ID('dbo.wfm_tipos_escala', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_tipos_escala', 'nome') IS NOT NULL
    UPDATE dbo.wfm_tipos_escala SET nome = N'Plant' + NCHAR(227) + N'o de s' + NCHAR(225) + N'bado' WHERE nome COLLATE Latin1_General_BIN2 = N'Plant' + NCHAR(195) + NCHAR(163) + N'o de s' + NCHAR(195) + NCHAR(161) + N'bado';

IF OBJECT_ID('dbo.wfm_tipos_escala', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_tipos_escala', 'descricao') IS NOT NULL
    UPDATE dbo.wfm_tipos_escala SET descricao = N'Escala de plant' + NCHAR(227) + N'o de s' + NCHAR(225) + N'bado da equipe de TI.' WHERE descricao COLLATE Latin1_General_BIN2 = N'Escala de plant' + NCHAR(195) + NCHAR(163) + N'o de s' + NCHAR(195) + NCHAR(161) + N'bado da equipe de TI.';

IF OBJECT_ID('dbo.motivos_eliminacao', 'U') IS NOT NULL
    DELETE m FROM dbo.motivos_eliminacao m
    WHERE m.usado = 0
      AND m.chave IN (N'candidato_nao_compareceu', N'optou_nao_prosseguir', N'baixa_aderencia_vaga', N'nao_atendeu_requisitos')
      AND EXISTS (SELECT 1 FROM dbo.motivos_eliminacao o WHERE o.chave = m.chave AND o.nome = m.nome AND o.id_item < m.id_item);
