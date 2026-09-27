-- QA T2-NOT-03: notificação lida em um navegador reaparecia em outro, porque o
-- estado "lida"/"oculta" das notificações montadas no front-end ficava só no
-- localStorage. Passa a ser guardado por usuário no servidor.
-- Aditiva e idempotente; espelha ensure_notification_user_state_table (bootstrap.py).

IF OBJECT_ID('dbo.notificacoes_estado_usuario', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.notificacoes_estado_usuario (
        usuario NVARCHAR(180) NOT NULL,
        chave NVARCHAR(200) NOT NULL,
        lida_em DATETIME NULL,
        oculta_em DATETIME NULL,
        CONSTRAINT PK_notificacoes_estado_usuario PRIMARY KEY (usuario, chave)
    );
END;
