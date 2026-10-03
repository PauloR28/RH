-- Rollback da V058: nao ha o que desfazer. A migration so troca texto corrompido pelo texto correto; restaurar o
-- mojibake nao e desejavel. Para voltar ao estado anterior use o backup feito antes do deploy.
SELECT 'V058 nao tem rollback de dados; restaure o backup se necessario.' AS aviso;
