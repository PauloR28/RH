// Central de Ajuda: guia de processos do Conecta, organizado por sessão (cada sessão é uma
// parte do sistema). O conteúdo é estático; a sessão "monitoria" ainda recebe, na tela, os
// tópicos editáveis pelo Administrador em Configurações > Central de Monitoria.
//
// `sessao`: id da chave-mestra `sessao.<id>.acessar`; `null` = vale para todos os perfis.
// `admin`: só aparece para o Administrador.

export const GUIA_SESSOES = [
  {
    id: 'inicio',
    sessao: null,
    icone: 'home',
    titulo: 'Início e conta',
    resumo: 'Primeiros passos, navegação e preferências pessoais.',
    processos: [
      {
        titulo: 'Navegar pelo Conecta',
        onde: 'Barra superior',
        passos: [
          'Use o menu da barra superior para trocar de sessão (Caixa de Currículos, Processos, Provas, Gestão, Drive, Treinamentos, Monitoria e Configurações). Só aparecem as sessões liberadas para o seu perfil.',
          'Em sessões com subitens, clique no nome da sessão para abrir a lista de telas.',
          'Use a busca no topo da página para localizar candidatos, processos e telas.',
          'O botão de voltar leva à tela anterior sem perder o filtro em uso.',
        ],
      },
      {
        titulo: 'Alterar tema, avatar e notificações',
        onde: 'Configurações > Ambiente (ou menu do seu avatar)',
        passos: [
          'Abra o menu do seu avatar no canto direito da barra superior.',
          'Em Ambiente, escolha o tema claro ou escuro, ative ou desative o tour guiado, escolha um avatar ilustrado e defina quais notificações quer receber.',
          'As preferências valem só para a sua conta.',
        ],
      },
      {
        titulo: 'Trocar a senha no primeiro acesso',
        onde: 'Tela exibida no login',
        passos: [
          'Quem entra com usuário e senha (acesso local) precisa trocar a senha inicial no primeiro acesso.',
          'Digite a senha atual, escolha a nova senha e confirme. Enquanto a troca não for feita, o restante do sistema fica bloqueado.',
          'Quem entra pela conta Microsoft não usa senha do Conecta.',
        ],
      },
      {
        titulo: 'Acompanhar notificações',
        onde: 'Sino no topo da página',
        passos: [
          'O ponto no avatar indica notificações não lidas.',
          'Abra o menu do avatar para ler os avisos e marcar como lidos.',
          'Os tipos de aviso que chegam para você são definidos em Ambiente.',
        ],
      },
    ],
  },
  {
    id: 'curriculos',
    sessao: 'curriculos',
    icone: 'badge',
    titulo: 'Caixa de Currículos',
    resumo: 'Candidatos, caixa de e-mail e banco de talentos.',
    processos: [
      {
        titulo: 'Consultar e filtrar candidatos',
        onde: 'Cx de Currículos',
        passos: [
          'Abra Cx de Currículos e use a barra de filtros (nome, vaga, status, período) para reduzir a lista.',
          'Clique em uma linha para abrir os detalhes do candidato: dados, currículo, histórico e etapas.',
          'Limpe os filtros para voltar à lista completa.',
        ],
      },
      {
        titulo: 'Encaminhar um candidato para um processo seletivo',
        onde: 'Detalhes do candidato',
        passos: [
          'Abra o candidato desejado.',
          'Escolha o processo seletivo de destino e confirme o encaminhamento.',
          'O candidato passa a aparecer no funil do processo, na primeira etapa.',
        ],
      },
      {
        titulo: 'Tratar e-mails recebidos',
        onde: 'Cx de Currículos > Caixa de e-mail',
        passos: [
          'Abra a caixa de e-mail para ver as candidaturas recebidas por mensagem.',
          'Abra a mensagem, confira o anexo e vincule ao candidato correspondente.',
          'Mensagens já tratadas saem da fila de pendências.',
        ],
      },
      {
        titulo: 'Usar o Banco de Talentos',
        onde: 'Processos > Banco de Talentos',
        passos: [
          'Candidatos sem vaga aberta ficam guardados no Banco de Talentos.',
          'Pesquise por perfil e reative o candidato em um novo processo quando surgir uma vaga compatível.',
        ],
      },
    ],
  },
  {
    id: 'processos',
    sessao: 'processos',
    icone: 'checklist',
    titulo: 'Processos',
    resumo: 'Processos seletivos, entrevistas e decisões.',
    processos: [
      {
        titulo: 'Criar um processo seletivo',
        onde: 'Processos > Processos Seletivos > Novo processo',
        passos: [
          'Clique em Novo processo e preencha os dados da vaga (título, operação, quantidade de vagas).',
          'Monte as etapas do processo (triagem, provas, entrevistas etc.).',
          'Na etapa de disponibilidade de horários, defina os horários em que as entrevistas podem ser agendadas (com ou sem horário fixo).',
          'Revise e publique. O processo passa a aceitar candidatos.',
        ],
      },
      {
        titulo: 'Acompanhar o funil de um processo',
        onde: 'Processos > Processos Seletivos > (processo)',
        passos: [
          'Abra o processo para ver os candidatos por etapa.',
          'Avance ou reprove o candidato pelo menu de ações da linha.',
          'Todas as movimentações ficam registradas no histórico do candidato.',
        ],
      },
      {
        titulo: 'Agendar e acompanhar entrevistas',
        onde: 'Processos > Entrevistas',
        passos: [
          'Abra Entrevistas para ver as agendadas e os horários livres gerados pela disponibilidade do processo.',
          'Selecione o candidato, escolha um horário e confirme o agendamento.',
          'O evento aparece também no Calendário e o candidato recebe o aviso.',
          'Após a entrevista, registre a presença e o parecer.',
        ],
      },
      {
        titulo: 'Decidir candidatos pendentes',
        onde: 'Processos > Decisões Pendentes',
        passos: [
          'Abra Decisões Pendentes para ver candidatos aguardando aprovação ou reprovação.',
          'Consulte o histórico e os resultados de provas antes de decidir.',
          'Aprove ou reprove. Ao reprovar, informe o motivo de eliminação cadastrado.',
        ],
      },
      {
        titulo: 'Encerrar um processo',
        onde: 'Processos > Processos Seletivos',
        passos: [
          'Com todas as vagas preenchidas (ou o processo cancelado), use a ação de encerrar.',
          'Processos encerrados ficam em Processos encerrados, somente para consulta.',
        ],
      },
    ],
  },
  {
    id: 'provas',
    sessao: 'provas',
    icone: 'quiz',
    titulo: 'Provas',
    resumo: 'Conecta Provas, resultados e banco de provas.',
    processos: [
      {
        titulo: 'Gerar e enviar uma prova',
        onde: 'Provas > Provas e Resultados',
        passos: [
          'Abra Provas e Resultados e escolha o tipo de prova (conhecimento, DISC, Fit Cultural ou Raciocínio Lógico).',
          'Selecione o candidato ou o processo e gere a prova.',
          'Envie o link ao candidato. A prova só é liberada dentro do prazo definido.',
        ],
      },
      {
        titulo: 'Conferir resultados',
        onde: 'Provas > Provas e Resultados / Histórico de Provas',
        passos: [
          'Abra o resultado de um candidato para ver nota, acertos e tempo de prova.',
          'Use o Histórico de Provas para consultar provas antigas e refazer análises.',
        ],
      },
      {
        titulo: 'Manter o Banco de Provas',
        onde: 'Provas > Banco de Provas',
        passos: [
          'Cadastre ou edite questões e organize por tema.',
          'Configure as provas de DISC, Fit Cultural e Raciocínio Lógico nas respectivas abas de configuração.',
        ],
      },
    ],
  },
  {
    id: 'gestao',
    sessao: 'gestao',
    icone: 'analytics',
    titulo: 'Gestão',
    resumo: 'Indicadores, calendário e mural.',
    processos: [
      {
        titulo: 'Consultar relatórios e o dashboard de funil',
        onde: 'Gestão > Relatórios Gerais / Dashboard de Funil',
        passos: [
          'Escolha o período e a operação nos filtros.',
          'Leia os indicadores (candidatos por etapa, tempo de processo, aprovação).',
          'Exporte o relatório quando precisar compartilhar.',
        ],
      },
      {
        titulo: 'Usar o Calendário',
        onde: 'Gestão > Calendário',
        passos: [
          'O calendário reúne entrevistas, eventos e datas importantes.',
          'Clique em um dia para ver ou criar eventos.',
          'Os eventos publicados seguem sincronizados com o SharePoint.',
        ],
      },
      {
        titulo: 'Publicar no Mural',
        onde: 'Gestão > Mural',
        passos: [
          'Abra o Mural para ler os comunicados.',
          'Quem tem permissão de publicação cria a postagem, anexa imagem se quiser e publica.',
        ],
      },
    ],
  },
  {
    id: 'drive',
    sessao: 'drive',
    icone: 'cloud',
    titulo: 'Drive',
    resumo: 'Arquivos e documentos compartilhados.',
    processos: [
      {
        titulo: 'Navegar e baixar arquivos',
        onde: 'Drive',
        passos: [
          'Abra o Drive e navegue pelas pastas.',
          'Clique em um arquivo para visualizar ou baixar.',
        ],
      },
      {
        titulo: 'Enviar um arquivo',
        onde: 'Drive',
        passos: [
          'Entre na pasta de destino e use o botão de envio.',
          'Selecione o arquivo e aguarde a conclusão. Ele aparece na lista imediatamente.',
        ],
      },
    ],
  },
  {
    id: 'treinamentos',
    sessao: 'treinamentos',
    icone: 'school',
    titulo: 'Central de Treinamento',
    resumo: 'Treinamentos, trilhas e atribuições.',
    processos: [
      {
        titulo: 'Fazer um treinamento atribuído a você',
        onde: 'Treinamentos > Meus treinamentos',
        passos: [
          'Abra Meus treinamentos para ver o que foi atribuído.',
          'Entre no treinamento, conclua os módulos na ordem e faça as avaliações.',
          'O progresso fica salvo e você pode continuar depois.',
        ],
      },
      {
        titulo: 'Criar um treinamento ou trilha',
        onde: 'Treinamentos > Treinamentos',
        passos: [
          'Clique em criar, informe título e descrição e adicione os módulos.',
          'Reúna treinamentos em uma trilha quando houver uma sequência de aprendizado.',
          'Publique para liberar a atribuição.',
        ],
      },
      {
        titulo: 'Atribuir treinamentos',
        onde: 'Treinamentos > Atribuições',
        passos: [
          'Abra Atribuições, escolha o treinamento ou a trilha e selecione as pessoas.',
          'Defina o prazo e confirme. Cada pessoa é avisada por notificação.',
          'Acompanhe o andamento pela mesma tela.',
        ],
      },
    ],
  },
  {
    id: 'monitoria',
    sessao: 'monitoria',
    icone: 'fact_check',
    titulo: 'Monitoria',
    resumo: 'Avaliações de qualidade, feedback, contestação e indicadores.',
    processos: [
      {
        titulo: 'Realizar uma monitoria (avaliador)',
        onde: 'Monitoria > Nova monitoria',
        passos: [
          'Escolha a operação e o operador avaliado e preencha canal, tipo de atendimento e data do contato.',
          'Responda cada critério do formulário (SIM, NÃO, NCG ou N/A). A nota é calculada pelo sistema enquanto você avalia.',
          'Registre a observação e a sugestão de feedback e finalize.',
          'Depois de finalizada, a monitoria nunca mais é alterada: só recebe feedback, contestação, réplica ou reanálise.',
        ],
      },
      {
        titulo: 'Aplicar feedback ao operador',
        onde: 'Monitoria > Feedback',
        passos: [
          'Filtre a lista e clique em Aplicar filtros. Use a lixeira para limpar.',
          'Abra a monitoria pendente e, em Aplicar feedback, escreva a observação do feedback aplicado (obrigatória) e o complemento (opcional).',
          'Clique em Registrar feedback aplicado. O prazo para aplicar é de 72 horas.',
        ],
      },
      {
        titulo: 'Confirmar ou contestar uma monitoria (operador)',
        onde: 'Monitoria > Minhas monitorias',
        passos: [
          'Abra a monitoria com feedback aplicado.',
          'Confirme, ou conteste informando o motivo. Você tem 48 horas; sem resposta a monitoria é confirmada automaticamente.',
          'Acompanhe a réplica e a decisão na linha do tempo da monitoria.',
        ],
      },
      {
        titulo: 'Reanalisar uma contestação',
        onde: 'Monitoria > Contestações',
        passos: [
          'Abra a contestação, leia os argumentos e a réplica.',
          'Decida manter ou anular a monitoria e justifique. O prazo é de 72 horas; sem decisão, a monitoria é anulada automaticamente.',
          'Monitorias anuladas ficam no histórico, mas fora dos indicadores.',
        ],
      },
      {
        titulo: 'Consultar o histórico e compartilhar monitorias',
        onde: 'Monitoria > Histórico',
        passos: [
          'Filtre por ID, operador, avaliador, período, operação ou status.',
          'Marque uma ou mais monitorias (a caixa ao lado de ID marca todas da página) e use Exportar seleção ou Compartilhar por e-mail.',
        ],
      },
      {
        titulo: 'Criar e acompanhar um plano de ação',
        onde: 'Monitoria > Planos de ação',
        passos: [
          'Clique em Novo plano de ação, escolha operação e operador e descreva problema, objetivo, ação e prazo.',
          'Avance o plano por Aberto, Em andamento, Em revisão e Concluído, registrando o resultado.',
          'Planos vencidos aparecem destacados.',
        ],
      },
      {
        titulo: 'Ler o dashboard de qualidade',
        onde: 'Monitoria > Dashboard',
        passos: [
          'Escolha a visão: Geral, Por equipe, Por período ou Por operador.',
          'Ajuste operação, período e Top. Os indicadores respeitam o seu perfil e o seu escopo de operação.',
        ],
      },
      {
        titulo: 'Gerar e exportar relatórios',
        onde: 'Monitoria > Relatórios',
        passos: [
          'Escolha o relatório (Monitorias, Qualidade ou Planos de ação) e os filtros.',
          'Use o botão Exportar, no canto direito, e escolha XLSX ou CSV.',
        ],
      },
      {
        titulo: 'Manter os formulários de monitoria',
        onde: 'Monitoria > Formulários',
        passos: [
          'Escolha a operação e a versão do formulário. A versão ativa é a usada nas novas monitorias.',
          'Clique em Editar formulário para ajustar perguntas e pesos (a soma dos pesos deve fechar o valor do bloco) ou em Criar formulário para começar um novo modelo.',
          'Salve como nova versão. As monitorias antigas continuam com a versão original.',
        ],
      },
    ],
  },
  {
    id: 'configuracoes',
    sessao: 'configuracoes',
    icone: 'settings',
    titulo: 'Configurações',
    resumo: 'Usuários, perfis, operações e administração da Monitoria.',
    admin: true,
    processos: [
      {
        titulo: 'Criar um usuário',
        onde: 'Configurações > Usuários > Criar usuário',
        passos: [
          'Preencha nome, e-mail, perfil, tipo de acesso (Microsoft ou Local) e as operações vinculadas.',
          'Para os perfis da Monitoria (Operador, Supervisor, Qualidade e Control Desk), preencha também os Vínculos da Monitoria: turno, equipe e supervisores do operador.',
          'Regras: Operador com exatamente 1 operação e de 1 a 2 supervisores; Supervisor até 3 operações; Qualidade até 2; Control Desk sem operação.',
          'Para acesso local, defina a senha inicial; a troca é exigida no primeiro acesso.',
        ],
      },
      {
        titulo: 'Transferir a supervisão (férias, desligamento)',
        onde: 'Configurações > Usuários > Transferir supervisão',
        passos: [
          'Escolha a operação, o supervisor que sai e o que assume.',
          'Os operadores e as pendências abertas passam para o substituto. As monitorias já realizadas mantêm o supervisor original.',
        ],
      },
      {
        titulo: 'Ajustar perfis e permissões',
        onde: 'Configurações > Perfis e permissões',
        passos: [
          'Escolha o perfil e a sessão. A chave-mestra da sessão libera ou bloqueia a sessão inteira para o perfil.',
          'Marque ou desmarque as permissões e informe a justificativa.',
          'Quem já estava logado precisa sair e entrar de novo para receber a mudança.',
        ],
      },
      {
        titulo: 'Cadastrar operações',
        onde: 'Configurações > Operações',
        passos: [
          'Crie a operação com nome, cliente e dados de funcionamento.',
          'Operação inativa não recebe novos vínculos nem novas monitorias.',
        ],
      },
      {
        titulo: 'Administrar equipes e catálogos da Monitoria',
        onde: 'Configurações > Equipes e catálogos',
        passos: [
          'Escolha a operação e cadastre equipes, canais e tipos de atendimento; os turnos valem para todas as operações.',
          'Inative o que não é mais usado em vez de apagar. Equipes e turnos aparecem no cadastro de usuário.',
        ],
      },
      {
        titulo: 'Auditar as ações da Monitoria',
        onde: 'Configurações > Logs da Monitoria',
        passos: [
          'Filtre por usuário, ação, operação, resultado ou período e clique em Aplicar filtros.',
          'Clique em uma linha para ver o estado anterior e o posterior. O registro é imutável.',
        ],
      },
      {
        titulo: 'Configurar a Central de Monitoria',
        onde: 'Configurações > Central de Monitoria',
        passos: [
          'Ajuste prazos, guia de processos da Monitoria, cor e logo de cada operação.',
          'A zona de risco altera somente a configuração; monitorias realizadas nunca são apagadas.',
        ],
      },
      {
        titulo: 'Manter a biblioteca de documentos',
        onde: 'Configurações > Central de Ajuda > Documentos e modelos',
        passos: [
          'Cadastre documentos por tópico com o link do arquivo (SharePoint, OneDrive ou Drive).',
          'Crie modelos de texto com variáveis {{variavel}} para gerar documentos a partir dos dados do candidato.',
        ],
      },
    ],
  },
];
