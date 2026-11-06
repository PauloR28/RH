/* ═══════════════════════════════════════════════════════════════════════
 * CONECTA — Responsividade (Fase 13) · conecta-responsivo.js · PROPOSTA
 * Comportamentos que o CSS sozinho não faz. Sem biblioteca. ~2 KB.
 * No sistema real isto vira parte do componente do topo (React); aqui roda
 * sobre o HTML das telas da Fase 12 para a amostra.
 *
 * Fase 15 (Conecta): ARQUIVO DE REFERÊNCIA, ainda NÃO é carregado pelo app.
 * Ele mexe direto no DOM, o que briga com o React. O topo (Mais/Menu/gaveta)
 * já foi refeito em React em ui/components/moldura.js; tabelas, filtros,
 * ações e teclado entram como componentes nas etapas das telas.
 * ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var ICONE = window.CONECTA_ICONES || {};
  var SECAO_ICONE = { 'Início': 'house', 'Turnos e Plantões': 'calendar-dots', 'Monitoria': 'clipboard-text', 'Equipes': 'users', 'Relatórios': 'presentation-chart', 'Mural': 'megaphone', 'Tecnologia': 'wrench', 'Configurações': 'gear-six' };
  var ic = function (n) { return ICONE[n] || ''; };

  /* DEC-076 · Topo: "Mais ▾" (seções que não cabem), lupa e botão "Menu" com gaveta (celular) */
  function topo(cab) {
    var nav = cab.querySelector('.c-topo-nav'); if (!nav || cab.dataset.pronto) return; cab.dataset.pronto = '1';
    var links = [].slice.call(nav.querySelectorAll('a'));
    // Botão Menu (só aparece no celular, via CSS)
    var menu = document.createElement('button'); menu.type = 'button'; menu.className = 'c-topo-menu';
    menu.setAttribute('aria-haspopup', 'dialog'); menu.innerHTML = ic('list') + '<span>Menu</span>';
    cab.insertBefore(menu, cab.firstChild);
    // "Mais ▾": recebe as seções que não cabem (Compacto)
    var mais = document.createElement('div'); mais.className = 'c-topo-mais';
    mais.innerHTML = '<button type="button" aria-haspopup="menu" aria-expanded="false">Mais' + ic('caret-down') + '</button><div class="c-menu" role="menu" hidden></div>';
    nav.appendChild(mais);
    var bMais = mais.firstChild, lista = mais.lastChild;
    bMais.onclick = function () { var abrir = lista.hidden; lista.hidden = !abrir; bMais.setAttribute('aria-expanded', abrir); if (abrir) { var p = lista.querySelector('a'); if (p) p.focus(); } };
    mais.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !lista.hidden) { lista.hidden = true; bMais.setAttribute('aria-expanded', 'false'); bMais.focus(); } });
    function arruma() {
      links.forEach(function (a) { a.className = ''; a.removeAttribute('role'); nav.insertBefore(a, mais); });
      lista.innerHTML = ''; mais.removeAttribute('data-tem');
      if (getComputedStyle(nav).display === 'none') return;
      var sobra = links.filter(function (a) { return a.getAttribute('aria-current') !== 'page'; });
      while (nav.scrollWidth > nav.clientWidth + 1 && sobra.length) {
        var a = sobra.pop(); mais.setAttribute('data-tem', '');
        a.className = 'c-menu-item'; a.setAttribute('role', 'menuitem'); lista.insertBefore(a, lista.firstChild);
      }
    }
    // Lupa: troca o campo de busca quando não há espaço
    var busca = cab.querySelector('.c-topo-busca');
    if (busca) { var lupa = document.createElement('button'); lupa.type = 'button'; lupa.className = 'c-topo-icone c-topo-lupa'; lupa.setAttribute('aria-label', 'Buscar no Conecta'); lupa.title = 'Buscar no Conecta'; lupa.innerHTML = ic('magnifying-glass'); busca.parentNode.insertBefore(lupa, busca.nextSibling); }
    // Tema claro/escuro: no celular sai do topo e vai para a gaveta (falta espaço)
    var tema = cab.querySelector('.c-topo-icone[aria-label^="Tema"]'); if (tema) tema.classList.add('c-topo-tema');
    // Gaveta do celular: todas as seções com ícone + nome (Arquitetura, regra 9)
    var g = document.createElement('dialog'); g.className = 'c-gaveta-menu'; g.setAttribute('aria-label', 'Menu');
    g.innerHTML = '<div class="c-gaveta-cab">' + (cab.querySelector('.c-topo-logo') || {}).innerHTML + '<button type="button" class="c-topo-icone" aria-label="Fechar menu" title="Fechar">' + ic('x') + '</button></div>' +
      '<nav aria-label="Seções"><ul class="c-gaveta-lista">' + links.map(function (a) { var n = a.textContent.trim(); return '<li><a href="' + a.getAttribute('href') + '"' + (a.getAttribute('aria-current') ? ' aria-current="page"' : '') + '>' + ic(SECAO_ICONE[n] || 'squares-four') + n + '</a></li>'; }).join('') + '</ul></nav>' +
      '<ul class="c-gaveta-lista c-gaveta-rodape"><li><a href="#">' + ic('moon') + 'Tema escuro</a></li><li><a href="#">' + ic('gear-six') + 'Configurações</a></li><li><a href="#">' + ic('door-open') + 'Sair</a></li></ul>';
    document.body.appendChild(g);
    menu.onclick = function () { g.showModal(); menu.setAttribute('aria-expanded', 'true'); };
    g.querySelector('.c-gaveta-cab button').onclick = function () { g.close(); };
    g.addEventListener('close', function () { menu.setAttribute('aria-expanded', 'false'); menu.focus(); });
    g.addEventListener('click', function (e) { if (e.target === g) g.close(); }); // clique fora fecha
    new ResizeObserver(arruma).observe(cab); arruma();
  }

  /* DEC-076 · Sub-abas: a aba atual sempre à vista quando a faixa rola */
  function subbarra(sb) {
    var atual = sb.querySelector('[aria-selected="true"], [aria-current="page"], .c-aba--atual');
    if (atual && sb.scrollWidth > sb.clientWidth) sb.scrollLeft = atual.offsetLeft - 16;
    var marca = function () { sb.toggleAttribute('data-mais-dir', sb.scrollLeft + sb.clientWidth < sb.scrollWidth - 1); sb.toggleAttribute('data-mais-esq', sb.scrollLeft > 1); };
    sb.addEventListener('scroll', marca, { passive: true }); new ResizeObserver(marca).observe(sb); marca();
  }

  /* DEC-077 · Tabelas. Cada coluna diz o seu papel e a sua prioridade (no sistema real: na definição
     da coluna; aqui: data-papel / data-prioridade no <th>, ou o mapa CONECTA_COLUNAS pelo título).
     papel: titulo | selo | info | acoes | marca   ·   prioridade: 1 sempre, 2 some depois, 3 some primeiro */
  var CELULAR = 600;
  function tabela(t) {
    var caixa = t.closest('.c-tabela-caixa') || t.parentNode; if (t.dataset.pronto) return; t.dataset.pronto = '1';
    var ths = [].slice.call(t.tHead ? t.tHead.rows[0].cells : []);
    var mapa = window.CONECTA_COLUNAS || {};
    ths.forEach(function (th, i) {
      var nome = th.textContent.trim(), m = mapa[nome] || '';
      var papel = th.dataset.papel || (th.classList.contains('c-marca') ? 'marca' : th.classList.contains('c-acoes') ? 'acoes' : th.classList.contains('c-dia-sem') ? 'dia' : m.split(':')[0] || 'info');
      var prio = th.dataset.prioridade || m.split(':')[1] || (papel === 'info' ? '2' : '1');
      [].forEach.call(t.rows, function (r) { var c = r.cells[i]; if (!c) return; c.dataset.papel = papel; c.dataset.prioridade = prio; if (r.parentNode.tagName === 'TFOOT' && nome && c.textContent.trim()) c.dataset.rotulo = nome;
        if (r.parentNode.tagName === 'TBODY' && papel !== 'marca' && papel !== 'acoes' && nome) { c.dataset.rotulo = nome; if (papel === 'info' && !c.querySelector('.c-oculto')) c.insertAdjacentHTML('afterbegin', '<span class="c-oculto">' + nome + ': </span>'); } });
    });
    // 1ª informação da linha (para o separador "·" na lista do celular)
    [].forEach.call(t.tBodies[0] ? t.tBodies[0].rows : [], function (r) { var f = [].find.call(r.cells, function (c) { return c.dataset.papel === 'info' && c.dataset.prioridade === '1'; }); if (f) f.dataset.primeira = ''; });
    // Grade de dias (Escala, Presença): no celular mostra 1 dia por vez, com ‹ dia ›
    var dias = ths.filter(function (th) { return th.dataset.papel === 'dia'; });
    if (dias.length) {
      t.classList.add('c-tabela--dias');
      var atual = Math.max(0, dias.findIndex(function (d) { return d.classList.contains('c-hoje'); }));
      var barra = document.createElement('div'); barra.className = 'c-dia-troca';
      barra.innerHTML = '<button type="button" class="c-botao c-botao--texto c-botao--icone" aria-label="Dia anterior">' + ic('caret-left') + '</button><b aria-live="polite"></b><button type="button" class="c-botao c-botao--texto c-botao--icone" aria-label="Próximo dia">' + ic('caret-right') + '</button>';
      caixa.parentNode.insertBefore(barra, caixa);
      var mostra = function () { var i0 = ths.indexOf(dias[atual]); [].forEach.call(t.rows, function (r) { [].forEach.call(r.cells, function (c, i) { if (c.dataset.papel === 'dia') c.toggleAttribute('data-dia-atual', i === i0); }); }); barra.querySelector('b').textContent = dias[atual].textContent.trim(); };
      barra.firstChild.onclick = function () { atual = (atual + dias.length - 1) % dias.length; mostra(); };
      barra.lastChild.onclick = function () { atual = (atual + 1) % dias.length; mostra(); };
      mostra();
    }
    // Compacto: esconde colunas de prioridade 3, depois 2 (da direita para a esquerda) até caber
    function arruma() {
      [].forEach.call(t.querySelectorAll('[data-escondida]'), function (c) { c.removeAttribute('data-escondida'); });
      if (innerWidth < CELULAR) return; // no celular quem manda é a lista (CSS)
      var ordem = ['3', '2'].reduce(function (a, p) { return a.concat(ths.filter(function (th) { return th.dataset.prioridade === p && th.dataset.papel !== 'dia'; }).reverse()); }, []);
      var n = 0;
      while (caixa.scrollWidth > caixa.clientWidth + 1 && n < ordem.length) { var i = ths.indexOf(ordem[n++]); [].forEach.call(t.rows, function (r) { if (r.cells[i]) r.cells[i].setAttribute('data-escondida', ''); }); }
      caixa.toggleAttribute('data-colunas-escondidas', n > 0);
      caixa.dataset.escondidas = n;
    }
    new ResizeObserver(arruma).observe(caixa); arruma();
  }

  /* DEC-078 · Filtros: o que não cabe vai para o botão "Filtros" (mesmos campos, movidos; nada se perde) */
  function filtros(bar) {
    if (bar.dataset.pronto) return; bar.dataset.pronto = '1';
    var campos = [].slice.call(bar.querySelectorAll(':scope > select, :scope > .c-campo-filtro'));
    if (!campos.length) return;
    var botao = document.createElement('button'); botao.type = 'button'; botao.className = 'c-botao c-botao--secundario c-botao--compacto c-filtros-botao';
    botao.setAttribute('aria-haspopup', 'dialog'); bar.appendChild(botao);
    var g = document.createElement('dialog'); g.className = 'c-filtros-gaveta'; g.setAttribute('aria-label', 'Filtros');
    g.innerHTML = '<div class="c-janela-cab"><h2>Filtros</h2><button type="button" class="c-botao c-botao--texto c-botao--icone" aria-label="Fechar" title="Fechar">' + ic('x') + '</button></div><div class="c-janela-corpo c-filtros-lista"></div><div class="c-janela-rodape"><button type="button" class="c-botao c-botao--texto c-filtros-limpar">Limpar filtros</button><button type="button" class="c-botao c-botao--principal c-filtros-ver">Ver resultados</button></div>';
    document.body.appendChild(g);
    var lista = g.querySelector('.c-filtros-lista');
    var fecha = function () { g.close(); };
    g.querySelector('.c-janela-cab button').onclick = fecha; g.querySelector('.c-filtros-ver').onclick = fecha;
    g.addEventListener('click', function (e) { if (e.target === g) fecha(); });
    g.addEventListener('close', function () { botao.focus(); });
    g.querySelector('.c-filtros-limpar').onclick = function () { campos.forEach(function (c) { if (c.tagName === 'SELECT') c.selectedIndex = 0; }); conta(); };
    botao.onclick = function () { g.showModal(); };
    function conta() {
      var fora = campos.filter(function (c) { return c.parentNode === lista; });
      var ativos = fora.filter(function (c) { return c.tagName === 'SELECT' && c.selectedIndex > 0; }).length;
      botao.innerHTML = ic('funnel') + (innerWidth < CELULAR ? 'Filtros' : '+' + fora.length + ' filtro' + (fora.length > 1 ? 's' : '')) + (ativos ? '<span class="c-conta">' + ativos + '</span>' : '');
      botao.hidden = !fora.length;
    }
    campos.forEach(function (c) { c.addEventListener('change', conta); });
    function arruma() {
      campos.forEach(function (c) { bar.insertBefore(c, botao); c.classList.remove('c-entrada--gaveta'); });
      botao.hidden = false; botao.innerHTML = ic('funnel') + '+0';
      if (innerWidth < CELULAR) campos.forEach(function (c) { lista.appendChild(c); });
      else { var resto = campos.slice(); while (bar.scrollWidth > bar.clientWidth + 1 && resto.length) lista.insertBefore(resto.pop(), lista.firstChild); }
      [].forEach.call(lista.children, function (c) { c.classList.add('c-entrada--gaveta'); });
      conta();
    }
    new ResizeObserver(arruma).observe(bar); arruma();
  }

  /* DEC-078 · Ações: no celular, botões secundários do cabeçalho e da barra de seleção vão para "⋯" */
  function acoes(caixa) {
    if (caixa.dataset.pronto) return; caixa.dataset.pronto = '1';
    var sec = [].slice.call(caixa.querySelectorAll(':scope > .c-botao--secundario:not(.c-botao--icone), :scope > .c-botao--texto:not(.c-botao--icone):not(.c-fim)'));
    if (!sec.length) return;
    var m = document.createElement('div'); m.className = 'c-abre-menu c-acoes-mais';
    m.innerHTML = '<button type="button" class="c-botao c-botao--secundario c-botao--icone" aria-label="Mais ações" title="Mais ações" aria-haspopup="menu" aria-expanded="false">' + ic('dots-three') + '</button><div class="c-menu c-menu--solto" role="menu" hidden></div>';
    var principal = caixa.querySelector(':scope > .c-botao--principal'); caixa.insertBefore(m, principal || null);
    var b = m.firstChild, lista = m.lastChild;
    b.onclick = function () { var abrir = lista.hidden; lista.hidden = !abrir; b.setAttribute('aria-expanded', abrir); };
    m.addEventListener('keydown', function (e) { if (e.key === 'Escape') { lista.hidden = true; b.focus(); } });
    var lugar = sec.map(function (x) { return x.nextSibling; });
    function arruma() {
      var cel = innerWidth < CELULAR;
      sec.forEach(function (x, i) { if (cel) { x.classList.add('c-menu-item'); x.setAttribute('role', 'menuitem'); lista.appendChild(x); } else { x.classList.remove('c-menu-item'); x.removeAttribute('role'); caixa.insertBefore(x, m); } });
      m.hidden = !cel; lista.hidden = true;
    }
    window.addEventListener('resize', arruma); arruma();
  }

  /* DEC-079 · Teclado. 1) "Pular para o conteúdo". 2) Tabela = 1 parada do Tab: setas ↑ ↓ andam
     entre as linhas, Enter abre o detalhe, Espaço marca, Tab entra nas ações só da linha atual.
     3) "/" vai para a busca da tela. Esc fecha menus, painéis e janelas (já nativo no <dialog>). */
  function pular(app) {
    var main = app.querySelector('main'); if (!main || app.querySelector('.c-pular')) return;
    main.id = main.id || 'conteudo'; main.tabIndex = -1;
    var a = document.createElement('a'); a.className = 'c-pular'; a.href = '#' + main.id; a.textContent = 'Pular para o conteúdo';
    a.onclick = function (e) { e.preventDefault(); main.focus(); };
    app.insertBefore(a, app.firstChild);
  }
  var FOCAVEL = 'a[href], button, input, select, textarea';
  function linhas(t) {
    var trs = [].slice.call(t.tBodies[0] ? t.tBodies[0].rows : []).filter(function (r) { return r.classList.contains('c-clicavel'); });
    if (!trs.length || t.dataset.teclado) return; t.dataset.teclado = '1';
    function ativa(r, focar) {
      trs.forEach(function (x) { x.tabIndex = x === r ? 0 : -1; [].forEach.call(x.querySelectorAll(FOCAVEL), function (c) { c.tabIndex = x === r ? 0 : -1; }); });
      if (focar) r.focus();
    }
    trs.forEach(function (r, i) {
      var nome = r.querySelector('[data-papel="titulo"], .c-forte'); r.setAttribute('aria-label', (nome ? nome.textContent.trim() + '. ' : '') + 'Enter abre o detalhe');
      r.addEventListener('focusin', function () { ativa(r, false); });
      r.addEventListener('keydown', function (e) {
        if (e.target !== r) return;
        var alvo = { ArrowDown: trs[i + 1], ArrowUp: trs[i - 1], Home: trs[0], End: trs[trs.length - 1] }[e.key];
        if (alvo) { e.preventDefault(); ativa(alvo, true); }
        else if (e.key === 'Enter') { e.preventDefault(); r.click(); }
        else if (e.key === ' ') { var c = r.querySelector('input[type=checkbox]'); if (c) { e.preventDefault(); c.click(); } }
      });
    });
    ativa(trs[0], false);
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    var b = document.querySelector('main .c-busca input, main input[type=search]'); if (b) { e.preventDefault(); b.focus(); }
  });

  function iniciar() {
    document.querySelectorAll('.c-topo').forEach(topo);
    document.querySelectorAll('.c-subbarra').forEach(subbarra);
    document.querySelectorAll('table.c-tabela').forEach(tabela);
    document.querySelectorAll('.c-tabela-caixa > .c-filtros').forEach(filtros);
    document.querySelectorAll('.c-cab-dir, .c-selecao').forEach(acoes);
    document.querySelectorAll('.c-app').forEach(pular);
    document.querySelectorAll('table.c-tabela').forEach(linhas);
  }
  window.ConectaResponsivo = { iniciar: iniciar };
  if (document.readyState !== 'loading') iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
})();
