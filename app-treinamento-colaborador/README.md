# Conecta App — Treinamento do Colaborador

App mobile (React Native + Expo, managed workflow) para o colaborador acompanhar e concluir os treinamentos atribuídos a ele. Consome a mesma API do Conecta (`apps/backend/rh_api/`) via HTTP — nenhum código-fonte do Conecta web é importado diretamente.

## Stack

Expo (managed) · TypeScript (`strict: true`) · `expo-router` · Context API (auth) + `@tanstack/react-query` (dados remotos) · `axios` (instância única + interceptor de 401) · `expo-secure-store` (token — nunca `AsyncStorage`) · `zod` (validação do login) · `StyleSheet` nativo (tokens de tema em `src/theme/`, migrados 1:1 de `apps/frontend/estilos/tokens.css`).

## Configuração

1. Copie `.env.example` para `.env` e ajuste `EXPO_PUBLIC_API_URL` para o IP da máquina que roda o backend **na mesma rede Wi-Fi** do celular de teste (não use `localhost`/`127.0.0.1` — o celular não enxerga isso). Para descobrir o IP no Windows: `ipconfig`.
2. Backend precisa estar rodando com bind em todas as interfaces, não só loopback: `python run.py --host 0.0.0.0 --port 8000` na raiz do repo `RH/` (o padrão do README do backend, `127.0.0.1`, só aceita conexão da própria máquina — o celular não consegue chegar nele). Se o celular não conseguir conectar mesmo assim, confira se o Firewall do Windows está liberando conexões de entrada na porta 8000 (perfil de rede privada).

## Como testar agora (celular Android físico, sem Android Studio)

```bash
npm install
npx expo start
```

1. Instale o app **Expo Go** (Play Store) no celular Android.
2. Escaneie o QR code exibido no terminal/navegador.
3. O app abre ao vivo; qualquer alteração salva recarrega automaticamente (hot-reload).

Login: use um usuário com perfil "Funcionário" ou "Operador" cujo e-mail bata com o e-mail do candidato no processo seletivo dele (vínculo automático por e-mail — RH corrige manualmente pelo campo `email_login_vinculado` em `candidatos_processos` quando os e-mails não baterem).

## Geração de APK (só quando necessário, fora do ciclo diário de teste)

```bash
eas build -p android --profile preview
```

Compila na nuvem da Expo, sem exigir Android Studio local. A configuração do `eas.json` é explicada quando isso for de fato necessário — não foi adiantada agora para não gerar complexidade desnecessária nesta fase (promt.txt §7).

## Pendências abertas / fora de escopo desta rodada

- **SSO Microsoft**: o wireframe mostrava a opção, mas o RH decidiu login tradicional (usuário/senha, usuário = e-mail) nesta fase. O fluxo Microsoft existente no backend depende de cookie de sessão web e não é mobile-friendly sem uma rota nova de troca de token — fica documentado, não implementado.
- **"Termo de Responsabilidade"**: tela existe (`app/(app)/termo-responsabilidade.tsx`) mas o texto é `MOCK_DATA` explícito — não existe hoje, no backend, um termo de responsabilidade do colaborador (o único "termo" existente é sobre RH liberar download de anexo, caso diferente). Aguardando texto oficial do RH.
- **Vínculo usuário↔treinamento por e-mail**: se o e-mail de login de um colaborador não bater com o e-mail do processo seletivo dele, a lista de treinamentos vem vazia até o RH preencher `email_login_vinculado` manualmente (sem tela de administração para isso ainda — só via banco/consulta direta).
- **Avatar ilustrado**: reaproveita os PNGs já existentes em `apps/frontend/estilos/avatares/` (servidos publicamente pelo backend); se o usuário não tiver escolhido um, cai no avatar de iniciais.
- **Ambiente de homologação/produção**: não existe URL documentada no backend — o app está configurado só para local/LAN.
- Os dois aplicativos móveis do Conecta tinham sido pausados pelo RH numa rodada anterior de `Correções.txt`; esta rodada de `promt.txt` foi confirmada pelo RH como a liberação específica para este app.

## Riscos/dívidas técnicas

- A rota de vídeo de módulo (`GET /onboarding/itens/{id}/video`) foi criada nesta rodada porque não existia nenhuma forma de reproduzir um vídeo de módulo já enviado (só existia o upload) — nem o Conecta web consome isso hoje.
- Sem teste automatizado nesta entrega (fora do escopo do MVP conforme o prompt); verificação foi manual + testes diretos contra o backend real (ver histórico da sessão).
