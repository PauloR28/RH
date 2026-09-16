// Definições geométricas de ícones em SVG "stroke" (estilo Lucide, desenhados do zero).
// viewBox aplicado externamente: "0 0 24 24".
// Cada ícone é uma lista de tuplas [tag, atributos]. O renderer aplica globalmente:
// stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round".
// Exceção: formas com atributo `fill: 'currentColor'` explícito são pontos decorativos sólidos.

// ---------------------------------------------------------------------------
// Geometria-base reaproveitada entre famílias visuais (mesmo peso/traço).
// ---------------------------------------------------------------------------

// Calendário: retângulo arredondado + 2 "orelhas" no topo + linha de cabeçalho.
const CAL_RECT = ['rect', { x: '3', y: '5', width: '18', height: '16', rx: '2' }];
const CAL_HLINE = ['path', { d: 'M3 10h18' }];
const CAL_EAR_L = ['path', { d: 'M8 3v4' }];
const CAL_EAR_R = ['path', { d: 'M16 3v4' }];

// Clipboard (prancheta) usado pela família assignment/clinical/fact/pending.
const CLIP_BASE = ['rect', { x: '5', y: '4', width: '14', height: '17', rx: '2' }];
const CLIP_CLIP = ['rect', { x: '9', y: '2', width: '6', height: '4', rx: '1' }];

// Página com canto dobrado, base da família documento/página.
const PAGE_BASE = ['path', { d: 'M13 3H7C5.9 3 5 3.9 5 5V19C5 20.1 5.9 21 7 21H17C18.1 21 19 20.1 19 19V8Z' }];
const PAGE_FOLD = ['path', { d: 'M13 3V8H19' }];

// Pessoa: círculo de cabeça + arco de ombros.
const PERSON_HEAD = ['circle', { cx: '12', cy: '8', r: '4' }];
const PERSON_BODY = ['path', { d: 'M4 21c1.6-4 5-6 8-6s6.4 2 8 6' }];
const PERSON_BODY_SHORT = ['path', { d: 'M3 21C4.4 17.5 7.2 15.6 10 15.1' }];

// Escudo, base de shield/verified_user/admin_panel_settings/shield_person/supervisor.
const SHIELD_BASE = ['path', { d: 'M12 3L19 6V11C19 15.5 16 19 12 21C8 19 5 15.5 5 11V6Z' }];

// Círculo de status (base de check_circle/cancel/error/info/help/task_alt/play_circle...).
const CIRCLE9 = ['circle', { cx: '12', cy: '12', r: '9' }];

// Pasta, base de folder/folder_open/folder_managed/folder_zip.
const FOLDER_BASE = ['path', { d: 'M3 7C3 5.9 3.9 5 5 5H9L11 7H19C20.1 7 21 7.9 21 9V17C21 18.1 20.1 19 19 19H5C3.9 19 3 18.1 3 17Z' }];

// Sino, base de notifications/notifications_active.
const BELL = ['path', { d: 'M6 10C6 6.7 8.7 4 12 4C15.3 4 18 6.7 18 10C18 14 19.5 15.5 20 16H4C4.5 15.5 6 14 6 10Z' }];
const BELL_CLAPPER = ['path', { d: 'M10 19C10 20.1 10.9 21 12 21C13.1 21 14 20.1 14 19' }];

// Pincel de edição, reaproveitado por edit_note/edit_calendar/edit_document.
const PENCIL_MARK = ['path', { d: 'M9 17L10 14L15 9L17 11L12 16Z' }];

export const ICONES = {
  // ---------------------------------------------------------------------
  // Ações básicas
  // ---------------------------------------------------------------------
  add: [
    ['path', { d: 'M12 5V19M5 12H19' }],
  ],
  close: [
    ['path', { d: 'M6 6L18 18M18 6L6 18' }],
  ],
  check: [
    ['path', { d: 'M4 12.5L9 17.5L20 6.5' }],
  ],
  check_circle: [
    CIRCLE9,
    ['path', { d: 'M8 12.5L10.5 15L16 9.5' }],
  ],
  cancel: [
    CIRCLE9,
    ['path', { d: 'M9 9L15 15M15 9L9 15' }],
  ],
  delete: [
    ['path', { d: 'M4 7H20' }],
    ['path', { d: 'M9 7V4C9 3.4 9.4 3 10 3H14C14.6 3 15 3.4 15 4V7' }],
    ['path', { d: 'M6 7L7 20C7 20.6 7.4 21 8 21H16C16.6 21 17 20.6 17 20L18 7' }],
  ],
  delete_forever: [
    ['path', { d: 'M4 7H20' }],
    ['path', { d: 'M9 7V4C9 3.4 9.4 3 10 3H14C14.6 3 15 3.4 15 4V7' }],
    ['path', { d: 'M6 7L7 20C7 20.6 7.4 21 8 21H16C16.6 21 17 20.6 17 20L18 7' }],
    ['path', { d: 'M10 11L14 17M14 11L10 17' }],
  ],
  edit: [
    ['path', { d: 'M4 20L5 16L16 5L19 8L8 19Z' }],
    ['path', { d: 'M14 6L18 10' }],
  ],
  edit_square: [
    ['rect', { x: '4', y: '4', width: '16', height: '16', rx: '2' }],
    ['path', { d: 'M9 15L10 12L16 6L18 8L12 14Z' }],
  ],
  edit_note: [
    PAGE_BASE,
    PAGE_FOLD,
    ['path', { d: 'M8 12H12' }],
    PENCIL_MARK,
  ],
  edit_calendar: [
    CAL_RECT,
    CAL_EAR_L,
    CAL_EAR_R,
    PENCIL_MARK,
  ],
  edit_document: [
    PAGE_BASE,
    PAGE_FOLD,
    PENCIL_MARK,
  ],
  save: [
    ['path', { d: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z' }],
    ['path', { d: 'M17 21v-8H7v8' }],
    ['path', { d: 'M7 3v5h8' }],
  ],
  refresh: [
    ['path', { d: 'M21 12a9 9 0 1 1-3-6.7' }],
    ['path', { d: 'M21 3v6h-6' }],
  ],
  sync: [
    ['path', { d: 'M4 12a8 8 0 0 1 14-5.3M18 3v4h-4' }],
    ['path', { d: 'M20 12a8 8 0 0 1-14 5.3M6 21v-4h4' }],
  ],
  search: [
    ['circle', { cx: '11', cy: '11', r: '7' }],
    ['path', { d: 'M21 21L16.7 16.7' }],
  ],
  search_off: [
    ['circle', { cx: '11', cy: '11', r: '7' }],
    ['path', { d: 'M21 21L16.7 16.7' }],
    ['path', { d: 'M4 4L20 20' }],
  ],
  filter_alt: [
    ['path', { d: 'M4 5h16l-6 7v6l-4 2v-8z' }],
  ],
  filter_alt_off: [
    ['path', { d: 'M4 5h16l-6 7v6l-4 2v-8z' }],
    ['path', { d: 'M3 3L21 21' }],
  ],
  more_horiz: [
    ['path', { d: 'M5 12H5.01M12 12H12.01M19 12H19.01' }],
  ],
  more_vert: [
    ['path', { d: 'M12 5H12.01M12 12H12.01M12 19H12.01' }],
  ],
  content_copy: [
    ['rect', { x: '8', y: '8', width: '12', height: '12', rx: '2' }],
    ['path', { d: 'M6 16H5C3.9 16 3 15.1 3 14V5C3 3.9 3.9 3 5 3H14C15.1 3 16 3.9 16 5V6' }],
  ],
  download: [
    ['path', { d: 'M12 4V15' }],
    ['path', { d: 'M7 10L12 15L17 10' }],
    ['path', { d: 'M5 20H19' }],
  ],
  upload: [
    ['path', { d: 'M12 19V8' }],
    ['path', { d: 'M7 13L12 8L17 13' }],
    ['path', { d: 'M5 20H19' }],
  ],
  upload_file: [
    PAGE_BASE,
    PAGE_FOLD,
    ['path', { d: 'M12 12V18' }],
    ['path', { d: 'M9.5 14.5L12 12L14.5 14.5' }],
  ],
  publish: [
    ['path', { d: 'M12 4L18 10H14V17H10V10H6Z' }],
    ['path', { d: 'M5 20H19' }],
  ],
  share: [
    ['circle', { cx: '6', cy: '12', r: '2.3' }],
    ['circle', { cx: '18', cy: '6', r: '2.3' }],
    ['circle', { cx: '18', cy: '18', r: '2.3' }],
    ['path', { d: 'M8.1 10.8L15.9 6.9M8.1 13.2L15.9 17.1' }],
  ],
  link: [
    ['path', { d: 'M9 15L15 9' }],
    ['path', { d: 'M11 6L12.5 4.5C14.2 2.8 16.9 2.8 18.5 4.5C20.2 6.2 20.2 8.9 18.5 10.5L17 12' }],
    ['path', { d: 'M13 18L11.5 19.5C9.8 21.2 7.1 21.2 5.5 19.5C3.8 17.8 3.8 15.1 5.5 13.5L7 12' }],
  ],
  send: [
    ['path', { d: 'M21 3L10 14' }],
    ['path', { d: 'M21 3L14 21L10 13L2 9Z' }],
  ],
  logout: [
    ['path', { d: 'M9 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H9' }],
    ['path', { d: 'M16 17L21 12L16 7' }],
    ['path', { d: 'M21 12H9' }],
  ],
  login: [
    ['path', { d: 'M15 3H19C20.1 3 21 3.9 21 5V19C21 20.1 20.1 21 19 21H15' }],
    ['path', { d: 'M8 17L3 12L8 7' }],
    ['path', { d: 'M3 12H15' }],
  ],
  restart_alt: [
    ['path', { d: 'M3 12a9 9 0 1 0 3-6.7' }],
    ['path', { d: 'M3 4v5h5' }],
  ],

  // ---------------------------------------------------------------------
  // Navegação / setas (mesmo ângulo de chevron 45°, mesma espessura)
  // ---------------------------------------------------------------------
  arrow_back: [
    ['path', { d: 'M19 12H5' }],
    ['path', { d: 'M11 18l-6-6 6-6' }],
  ],
  arrow_forward: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M13 5l7 7-7 7' }],
  ],
  arrow_upward: [
    ['path', { d: 'M12 19V5' }],
    ['path', { d: 'M5 12l7-7 7 7' }],
  ],
  arrow_downward: [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'M19 12l-7 7-7-7' }],
  ],
  arrow_circle_right: [
    CIRCLE9,
    ['path', { d: 'M10 8L14 12L10 16' }],
  ],
  arrow_right_alt: [
    ['path', { d: 'M3 12H16' }],
    ['path', { d: 'M13 5L20 12L13 19' }],
  ],
  chevron_left: [
    ['path', { d: 'M15 5L8 12L15 19' }],
  ],
  chevron_right: [
    ['path', { d: 'M9 5L16 12L9 19' }],
  ],
  expand_less: [
    ['path', { d: 'M5 15L12 8L19 15' }],
  ],
  expand_more: [
    ['path', { d: 'M5 9L12 16L19 9' }],
  ],
  open_in_new: [
    ['path', { d: 'M14 4H20V10' }],
    ['path', { d: 'M20 4L11 13' }],
    ['path', { d: 'M18 14V18C18 19.1 17.1 20 16 20H6C4.9 20 4 19.1 4 18V8C4 6.9 4.9 6 6 6H10' }],
  ],
  compare_arrows: [
    ['path', { d: 'M17 3L21 7L17 11' }],
    ['path', { d: 'M21 7H7' }],
    ['path', { d: 'M7 21L3 17L7 13' }],
    ['path', { d: 'M3 17H17' }],
  ],
  trending_up: [
    ['path', { d: 'M3 17L9 11L13 15L21 7' }],
    ['path', { d: 'M15 7H21V13' }],
  ],
  trending_down: [
    ['path', { d: 'M3 7L9 13L13 9L21 17' }],
    ['path', { d: 'M15 17H21V11' }],
  ],

  // ---------------------------------------------------------------------
  // Status / feedback (mesmo círculo externo com marca central)
  // ---------------------------------------------------------------------
  info: [
    CIRCLE9,
    ['path', { d: 'M12 11V16.5' }],
    ['circle', { cx: '12', cy: '7.7', r: '0.6', fill: 'currentColor' }],
  ],
  warning: [
    ['path', { d: 'M12 3.5L21.5 20H2.5Z' }],
    ['path', { d: 'M12 10V14' }],
    ['circle', { cx: '12', cy: '17', r: '0.6', fill: 'currentColor' }],
  ],
  error: [
    CIRCLE9,
    ['path', { d: 'M12 7.5V13.5' }],
    ['circle', { cx: '12', cy: '16.5', r: '0.6', fill: 'currentColor' }],
  ],
  help: [
    CIRCLE9,
    ['path', { d: 'M9.5 9.2C9.5 7.7 10.6 6.5 12 6.5C13.4 6.5 14.5 7.7 14.5 9.2C14.5 10.5 13.8 11 13 11.5C12.3 11.9 12 12.4 12 13.3' }],
    ['circle', { cx: '12', cy: '16.5', r: '0.6', fill: 'currentColor' }],
  ],
  verified: [
    ['path', { d: 'M12 2L14 4.5L17 3.5L17.5 6.5L20.5 7.5L19.5 10.5L21.5 13L19 15L19.5 18L16.5 18.5L15 21L12 19.5L9 21L7.5 18.5L4.5 18L5 15L2.5 13L4.5 10.5L3.5 7.5L6.5 6.5L7 3.5L10 4.5Z' }],
    ['path', { d: 'M8.5 12.3L10.8 14.6L15.3 9.8' }],
  ],
  verified_user: [
    SHIELD_BASE,
    ['path', { d: 'M8.5 11.5L10.8 13.8L15.5 9' }],
  ],
  task_alt: [
    CIRCLE9,
    ['circle', { cx: '12', cy: '12', r: '6.5' }],
    ['path', { d: 'M9.5 12.3L11.3 14.1L15 10.5' }],
  ],
  star: [
    ['path', { d: 'M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.6-4.1 6.1-.6z' }],
  ],
  flag: [
    ['path', { d: 'M6 21V4' }],
    ['path', { d: 'M6 4H17L14.5 8L17 12H6' }],
  ],
  priority_high: [
    ['path', { d: 'M12 4V14' }],
    ['circle', { cx: '12', cy: '19', r: '0.9', fill: 'currentColor' }],
  ],
  pending_actions: [
    CLIP_BASE,
    CLIP_CLIP,
    ['circle', { cx: '12', cy: '14', r: '3.2' }],
    ['path', { d: 'M12 12.5V14.3L13.5 15.2' }],
  ],
  hourglass_top: [
    ['path', { d: 'M6 3H18' }],
    ['path', { d: 'M6 21H18' }],
    ['path', { d: 'M7 3L12 9L17 3' }],
    ['path', { d: 'M7 21L12 15L17 21' }],
  ],
  timer: [
    ['circle', { cx: '12', cy: '13', r: '8' }],
    ['path', { d: 'M12 13V9' }],
    ['path', { d: 'M10 2H14' }],
  ],
  speed: [
    ['path', { d: 'M4 16A8 8 0 0 1 20 16' }],
    ['path', { d: 'M12 16L15 10' }],
    ['circle', { cx: '12', cy: '16', r: '1', fill: 'currentColor' }],
  ],
  bolt: [
    ['path', { d: 'M13 2L4 14h6l-1 8 9-12h-6z' }],
  ],
  motion_photos_off: [
    ['circle', { cx: '12', cy: '12', r: '8' }],
    ['path', { d: 'M4 4L20 20' }],
  ],
  thumb_up: [
    ['path', { d: 'M7 11V20H4V11Z' }],
    ['path', { d: 'M7 11L10.5 4C11.5 4 12.5 5 12.5 6.5V10H18C19 10 19.7 11 19.5 12L18 18.5C17.8 19.4 17 20 16 20H7V11Z' }],
  ],

  // ---------------------------------------------------------------------
  // Documentos / arquivos (silhueta de página com canto dobrado)
  // ---------------------------------------------------------------------
  description: [
    PAGE_BASE,
    PAGE_FOLD,
    ['path', { d: 'M9 13H15' }],
    ['path', { d: 'M9 17H15' }],
  ],
  article: [
    PAGE_BASE,
    PAGE_FOLD,
    ['path', { d: 'M8 12H16' }],
    ['path', { d: 'M8 15H16' }],
    ['path', { d: 'M8 18H13' }],
  ],
  picture_as_pdf: [
    PAGE_BASE,
    PAGE_FOLD,
    ['rect', { x: '7', y: '13', width: '8', height: '4', rx: '1' }],
  ],
  print: [
    ['path', { d: 'M6 9V4H18V9' }],
    ['rect', { x: '4', y: '9', width: '16', height: '7', rx: '1' }],
    ['rect', { x: '8', y: '15', width: '8', height: '5', rx: '1' }],
  ],
  table_chart: [
    ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }],
    ['path', { d: 'M3 10H21' }],
    ['path', { d: 'M9 10V20' }],
  ],
  table_view: [
    ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }],
    ['path', { d: 'M3 10H21' }],
    ['path', { d: 'M3 15H21' }],
  ],
  slideshow: [
    ['rect', { x: '3', y: '5', width: '18', height: '12', rx: '2' }],
    ['path', { d: 'M10 9L15 11L10 13Z' }],
    ['path', { d: 'M8 21H16' }],
  ],
  image: [
    ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }],
    ['circle', { cx: '9', cy: '9', r: '1.7' }],
    ['path', { d: 'M4 17L9 12L13 16L16 13L20 17' }],
  ],
  folder_zip: [
    FOLDER_BASE,
    ['path', { d: 'M12 7V9M12 10.5V12M12 13.5V15' }],
  ],
  folder_open: [
    FOLDER_BASE,
    ['path', { d: 'M4 12H20' }],
  ],
  folder_managed: [
    FOLDER_BASE,
    ['path', { d: 'M9 13.5L11 15.5L15.5 11' }],
  ],
  inventory_2: [
    ['rect', { x: '3', y: '7', width: '18', height: '13', rx: '2' }],
    ['path', { d: 'M3 11H21' }],
    ['path', { d: 'M9 15H15' }],
  ],
  document_scanner: [
    ['rect', { x: '4', y: '3', width: '16', height: '6', rx: '1' }],
    ['rect', { x: '4', y: '15', width: '16', height: '6', rx: '1' }],
    ['path', { d: 'M4 12H20' }],
  ],
  insert_chart: [
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
    ['path', { d: 'M8 17V12M12 17V8M16 17V14' }],
  ],
  menu_book: [
    ['path', { d: 'M12 6C10.5 4.8 8.5 4 6.5 4C5.5 4 4.5 4.2 4 4.5V18.5C4.5 18.2 5.5 18 6.5 18C8.5 18 10.5 18.8 12 20' }],
    ['path', { d: 'M12 6C13.5 4.8 15.5 4 17.5 4C18.5 4 19.5 4.2 20 4.5V18.5C19.5 18.2 18.5 18 17.5 18C15.5 18 13.5 18.8 12 20' }],
  ],
  checklist: [
    ['path', { d: 'M9 6H20' }],
    ['path', { d: 'M9 12H20' }],
    ['path', { d: 'M9 18H20' }],
    ['path', { d: 'M4 6L5 7L7 4.5M4 12L5 13L7 10.5M4 18L5 19L7 16.5' }],
  ],
  rule: [
    ['path', { d: 'M3 6H21' }],
    ['path', { d: 'M3 6V10M8 6V9M13 6V9M18 6V10' }],
  ],
  rule_settings: [
    ['path', { d: 'M3 6H15' }],
    ['path', { d: 'M3 6V10M8 6V9M13 6V9' }],
    ['circle', { cx: '18', cy: '16', r: '3' }],
    ['path', { d: 'M18 11.5V13M18 19V20.5M14.5 16H16M20 16H21.5' }],
  ],
  assignment: [
    CLIP_BASE,
    CLIP_CLIP,
    ['path', { d: 'M8 11H16M8 15H13' }],
  ],
  assignment_add: [
    CLIP_BASE,
    CLIP_CLIP,
    ['path', { d: 'M12 12V18M9 15H15' }],
  ],
  assignment_ind: [
    CLIP_BASE,
    CLIP_CLIP,
    ['circle', { cx: '12', cy: '12', r: '2' }],
    ['path', { d: 'M8 18C8.8 16 10.2 15 12 15C13.8 15 15.2 16 16 18' }],
  ],
  assignment_late: [
    CLIP_BASE,
    CLIP_CLIP,
    ['path', { d: 'M12 10V13.5' }],
    ['circle', { cx: '12', cy: '16', r: '0.6', fill: 'currentColor' }],
  ],
  assignment_turned_in: [
    CLIP_BASE,
    CLIP_CLIP,
    ['path', { d: 'M9 13L11 15L15 10.5' }],
  ],
  clinical_notes: [
    CLIP_BASE,
    CLIP_CLIP,
    ['path', { d: 'M8 13H10L11.5 10L13 16L14.5 13H16' }],
  ],
  fact_check: [
    CLIP_BASE,
    CLIP_CLIP,
    ['path', { d: 'M8 12L9.5 13.5L12 11' }],
    ['path', { d: 'M8 16H16' }],
  ],
  format_align_left: [
    ['path', { d: 'M4 6H20M4 11H14M4 16H20M4 21H14' }],
  ],
  format_align_center: [
    ['path', { d: 'M4 6H20M7 11H17M4 16H20M7 21H17' }],
  ],
  format_align_right: [
    ['path', { d: 'M4 6H20M10 11H20M4 16H20M10 21H20' }],
  ],
  format_align_justify: [
    ['path', { d: 'M4 6H20M4 11H20M4 16H20M4 21H20' }],
  ],
  format_list_bulleted: [
    ['path', { d: 'M9 6H21M9 12H21M9 18H21' }],
    ['path', { d: 'M4.5 6H4.51M4.5 12H4.51M4.5 18H4.51' }],
  ],
  format_list_numbered: [
    ['path', { d: 'M9 6H21M9 12H21M9 18H21' }],
    ['path', { d: 'M4 5V7M4 11V13M4 17V19' }],
  ],
  archive: [
    ['rect', { x: '3', y: '4', width: '18', height: '5', rx: '1' }],
    ['path', { d: 'M5 9V17C5 18.1 5.9 19 7 19H17C18.1 19 19 18.1 19 17V9' }],
    ['path', { d: 'M10 13H14' }],
  ],
  rate_review: [
    PAGE_BASE,
    PAGE_FOLD,
    ['path', { d: 'M8 15L9 12L13 8L15 10L11 14Z' }],
  ],

  // ---------------------------------------------------------------------
  // Pessoas (círculo de cabeça + arco de ombros)
  // ---------------------------------------------------------------------
  person: [
    PERSON_HEAD,
    PERSON_BODY,
  ],
  person_add: [
    PERSON_HEAD,
    PERSON_BODY_SHORT,
    ['path', { d: 'M18 8V14M15 11H21' }],
  ],
  person_remove: [
    PERSON_HEAD,
    PERSON_BODY_SHORT,
    ['path', { d: 'M15 11H21' }],
  ],
  person_search: [
    PERSON_HEAD,
    PERSON_BODY_SHORT,
    ['circle', { cx: '17', cy: '16', r: '3' }],
    ['path', { d: 'M19.5 18.5L22 21' }],
  ],
  person_check: [
    PERSON_HEAD,
    PERSON_BODY_SHORT,
    ['path', { d: 'M15 16L17 18L21 14' }],
  ],
  person_cancel: [
    PERSON_HEAD,
    PERSON_BODY_SHORT,
    ['path', { d: 'M15 14L21 20M21 14L15 20' }],
  ],
  group: [
    ['circle', { cx: '9', cy: '8', r: '3' }],
    ['path', { d: 'M3 20C4 16.5 6.2 14.5 9 14.5C11.8 14.5 14 16.5 15 20' }],
    ['circle', { cx: '17', cy: '9', r: '2.3' }],
    ['path', { d: 'M15 20C15.6 17.5 17 15.8 19 15.4' }],
  ],
  groups: [
    ['circle', { cx: '8', cy: '8', r: '2.8' }],
    ['path', { d: 'M2.5 20C3.3 17 5.2 15.4 8 15.4C10.8 15.4 12.7 17 13.5 20' }],
    ['circle', { cx: '17', cy: '8', r: '2.8' }],
    ['path', { d: 'M12.5 20C13.3 17 15.2 15.4 18 15.4C19 15.4 19.9 15.6 20.7 16' }],
  ],
  diversity_3: [
    ['circle', { cx: '12', cy: '5.5', r: '2.3' }],
    ['circle', { cx: '6', cy: '16', r: '2.3' }],
    ['circle', { cx: '18', cy: '16', r: '2.3' }],
    ['path', { d: 'M12 8V11M9.7 12.3L7.8 14.2M14.3 12.3L16.2 14.2' }],
  ],
  supervisor_account: [
    ['circle', { cx: '10', cy: '8', r: '3.5' }],
    ['path', { d: 'M3 20C4.2 16.5 7 14.5 10 14.5' }],
    ['path', { d: 'M16 4L20 5.5V9C20 11.5 18.5 13 16 13.5C13.5 13 12 11.5 12 9V5.5Z' }],
  ],
  shield_person: [
    SHIELD_BASE,
    ['circle', { cx: '12', cy: '10', r: '2.2' }],
    ['path', { d: 'M8.5 16C9.5 14.3 10.7 13.5 12 13.5C13.3 13.5 14.5 14.3 15.5 16' }],
  ],
  how_to_reg: [
    ['circle', { cx: '9', cy: '8', r: '3' }],
    ['path', { d: 'M3 20C3.9 16.8 6.2 15 9 15C9.8 15 10.6 15.1 11.3 15.4' }],
    ['path', { d: 'M14 17L16.5 19.5L21 15' }],
  ],
  badge: [
    ['rect', { x: '5', y: '5', width: '14', height: '16', rx: '3' }],
    ['circle', { cx: '12', cy: '11', r: '2.5' }],
    ['path', { d: 'M8 18C8.8 16.2 10.2 15.4 12 15.4C13.8 15.4 15.2 16.2 16 18' }],
  ],
  support_agent: [
    ['circle', { cx: '12', cy: '9', r: '4' }],
    ['path', { d: 'M5 14A7 7 0 0 1 19 14' }],
    ['path', { d: 'M5 14H6.5C7 14 7.5 14.4 7.5 14.8V17.2C7.5 17.6 7 18 6.5 18H5V14Z' }],
  ],

  // ---------------------------------------------------------------------
  // Calendário / tempo (mesma moldura, marca interna variando)
  // ---------------------------------------------------------------------
  calendar_month: [
    CAL_RECT,
    CAL_HLINE,
    CAL_EAR_L,
    CAL_EAR_R,
  ],
  calendar_today: [
    CAL_RECT,
    CAL_EAR_L,
    CAL_EAR_R,
    CAL_HLINE,
    ['rect', { x: '9', y: '13', width: '6', height: '5', rx: '1' }],
  ],
  calendar_add_on: [
    CAL_RECT,
    CAL_EAR_L,
    CAL_EAR_R,
    CAL_HLINE,
    ['path', { d: 'M12 13V18M9.5 15.5H14.5' }],
  ],
  calendar_clock: [
    CAL_RECT,
    CAL_EAR_L,
    CAL_EAR_R,
    ['circle', { cx: '12', cy: '15', r: '3.2' }],
    ['path', { d: 'M12 13.5V15L13.3 15.8' }],
  ],
  event: [
    CAL_RECT,
    CAL_EAR_L,
    CAL_EAR_R,
    CAL_HLINE,
    ['circle', { cx: '12', cy: '14.5', r: '1.4', fill: 'currentColor' }],
  ],
  event_available: [
    CAL_RECT,
    CAL_EAR_L,
    CAL_EAR_R,
    CAL_HLINE,
    ['path', { d: 'M9 14.5L11 16.5L15 12' }],
  ],
  event_busy: [
    CAL_RECT,
    CAL_EAR_L,
    CAL_EAR_R,
    CAL_HLINE,
    ['path', { d: 'M10 13L14 17M14 13L10 17' }],
  ],
  schedule: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'M12 7V12L16 14' }],
  ],
  today: [
    CAL_RECT,
    CAL_EAR_L,
    CAL_EAR_R,
    ['circle', { cx: '12', cy: '13', r: '1.4', fill: 'currentColor' }],
  ],
  history: [
    ['path', { d: 'M3 12a9 9 0 1 0 3-6.7' }],
    ['path', { d: 'M3 4v5h5' }],
    ['path', { d: 'M12 8V12L15 14' }],
  ],
  history_edu: [
    ['path', { d: 'M3 12a9 9 0 1 0 3-6.7' }],
    ['path', { d: 'M3 4v5h5' }],
    ['rect', { x: '10', y: '9', width: '7', height: '8', rx: '1' }],
  ],

  // ---------------------------------------------------------------------
  // Comunicação
  // ---------------------------------------------------------------------
  mail: [
    ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }],
    ['path', { d: 'M3 7L12 13L21 7' }],
  ],
  chat: [
    ['path', { d: 'M4 4H20V16H8L4 20Z' }],
  ],
  forward_to_inbox: [
    ['path', { d: 'M2 6H15V16H2Z' }],
    ['path', { d: 'M2 7L8.5 12L15 7' }],
    ['path', { d: 'M16 10H21M18.5 8L21 10L18.5 12' }],
  ],
  notifications: [
    BELL,
    BELL_CLAPPER,
  ],
  notifications_active: [
    BELL,
    BELL_CLAPPER,
    ['path', { d: 'M5 7L3 5M19 7L21 5' }],
  ],

  // ---------------------------------------------------------------------
  // Configurações / diversos
  // ---------------------------------------------------------------------
  settings: [
    ['path', { d: 'M12 2V5M12 19V22M22 12H19M5 12H2M19.5 4.5L17.5 6.5M6.5 17.5L4.5 19.5M19.5 19.5L17.5 17.5M6.5 6.5L4.5 4.5' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  settings_applications: [
    ['path', { d: 'M12 2V5M12 19V22M22 12H19M5 12H2M19.5 4.5L17.5 6.5M6.5 17.5L4.5 19.5M19.5 19.5L17.5 17.5M6.5 6.5L4.5 4.5' }],
    ['rect', { x: '9', y: '9', width: '6', height: '6', rx: '1' }],
  ],
  settings_backup_restore: [
    ['path', { d: 'M3 12a9 9 0 1 0 3-6.7' }],
    ['path', { d: 'M3 4v5h5' }],
    ['circle', { cx: '12', cy: '12', r: '2' }],
  ],
  tune: [
    ['path', { d: 'M4 7H12M16 7H20' }],
    ['circle', { cx: '14', cy: '7', r: '2' }],
    ['path', { d: 'M4 17H8M12 17H20' }],
    ['circle', { cx: '10', cy: '17', r: '2' }],
  ],
  palette: [
    CIRCLE9,
    ['circle', { cx: '9', cy: '9', r: '1.4', fill: 'currentColor' }],
    ['circle', { cx: '15', cy: '9', r: '1.4', fill: 'currentColor' }],
    ['circle', { cx: '12', cy: '16', r: '1.4', fill: 'currentColor' }],
  ],
  admin_panel_settings: [
    SHIELD_BASE,
    ['circle', { cx: '12', cy: '11', r: '2.2' }],
    ['path', { d: 'M12 7.5V9M12 13V14.5M8.7 8.7L9.7 9.7M14.3 12.3L15.3 13.3M8.7 13.3L9.7 12.3M14.3 9.7L15.3 8.7' }],
  ],
  apartment: [
    ['rect', { x: '5', y: '3', width: '14', height: '18', rx: '1' }],
    ['path', { d: 'M9 7H10M14 7H15M9 11H10M14 11H15M9 15H10M14 15H15' }],
  ],
  business_center: [
    ['rect', { x: '3', y: '8', width: '18', height: '12', rx: '2' }],
    ['rect', { x: '8', y: '4', width: '8', height: '4', rx: '1' }],
    ['path', { d: 'M3 13H21' }],
  ],
  work: [
    ['rect', { x: '3', y: '8', width: '18', height: '12', rx: '2' }],
    ['rect', { x: '8', y: '4', width: '8', height: '4', rx: '1' }],
  ],
  payments: [
    ['circle', { cx: '9', cy: '12', r: '6' }],
    ['circle', { cx: '16', cy: '12', r: '6' }],
  ],
  school: [
    ['path', { d: 'M12 3L2 8L12 13L22 8Z' }],
    ['path', { d: 'M6 10.5V15.5C6 17 8.5 18.5 12 18.5C15.5 18.5 18 17 18 15.5V10.5' }],
  ],
  psychology: [
    ['path', { d: 'M9 3C6.2 3 4 5.2 4 8C4 9.8 5 11.3 6 12V18C6 19.1 6.9 20 8 20H9V22H15V20H16C17.1 20 18 19.1 18 18V12C19 11.3 20 9.8 20 8C20 5.2 17.8 3 15 3C13.8 3 12.7 3.4 11.8 4.1C11 3.4 10 3 9 3Z' }],
  ],
  auto_awesome: [
    ['path', { d: 'M12 3L13.2 7.8L18 9L13.2 10.2L12 15L10.8 10.2L6 9L10.8 7.8Z' }],
    ['path', { d: 'M19 15L19.6 17.4L22 18L19.6 18.6L19 21L18.4 18.6L16 18L18.4 17.4Z' }],
  ],
  analytics: [
    ['path', { d: 'M3 20H21' }],
    ['path', { d: 'M6 20V13M12 20V9M18 20V16' }],
    ['path', { d: 'M5 10L9 7L13 9L19 4' }],
  ],
  bar_chart: [
    ['path', { d: 'M3 20H21' }],
    ['path', { d: 'M6 20V12M12 20V6M18 20V15' }],
  ],
  leaderboard: [
    ['path', { d: 'M3 20H21' }],
    ['path', { d: 'M6 20V15M12 20V6M18 20V11' }],
  ],
  grid_view: [
    ['rect', { x: '3', y: '3', width: '8', height: '8', rx: '1' }],
    ['rect', { x: '13', y: '3', width: '8', height: '8', rx: '1' }],
    ['rect', { x: '3', y: '13', width: '8', height: '8', rx: '1' }],
    ['rect', { x: '13', y: '13', width: '8', height: '8', rx: '1' }],
  ],
  view_kanban: [
    ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }],
    ['path', { d: 'M9 4V20M15 4V20' }],
  ],
  view_list: [
    ['rect', { x: '3', y: '5', width: '18', height: '4', rx: '1' }],
    ['rect', { x: '3', y: '11', width: '18', height: '4', rx: '1' }],
    ['rect', { x: '3', y: '17', width: '12', height: '4', rx: '1' }],
  ],
  visibility: [
    ['path', { d: 'M2 12C4 7 8 5 12 5C16 5 20 7 22 12C20 17 16 19 12 19C8 19 4 17 2 12Z' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  visibility_off: [
    ['path', { d: 'M2 12C4 7.5 8 5.5 12 5.5C13.6 5.5 15.1 5.8 16.4 6.4' }],
    ['path', { d: 'M22 12C20 16.5 16 18.5 12 18.5C10.4 18.5 8.9 18.2 7.6 17.6' }],
    ['path', { d: 'M9.5 9.8C8.9 10.4 8.5 11.2 8.5 12C8.5 13.9 10.1 15.5 12 15.5C12.8 15.5 13.6 15.1 14.2 14.5' }],
    ['path', { d: 'M3 3L21 21' }],
  ],
  lock: [
    ['rect', { x: '5', y: '11', width: '14', height: '9', rx: '2' }],
    ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }],
  ],
  lock_open: [
    ['rect', { x: '5', y: '11', width: '14', height: '9', rx: '2' }],
    ['path', { d: 'M8 11V7a4 4 0 0 1 7.5-2' }],
  ],
  home: [
    ['path', { d: 'M4 11L12 4L20 11' }],
    ['path', { d: 'M6 10V20H18V10' }],
    ['path', { d: 'M10 20V14H14V20' }],
  ],
  inbox: [
    ['path', { d: 'M3 12H8L10 15H14L16 12H21' }],
    ['path', { d: 'M5 12L6.5 5H17.5L19 12' }],
    ['path', { d: 'M3 12V18C3 19.1 3.9 20 5 20H19C20.1 20 21 19.1 21 18V12' }],
  ],
  tag: [
    ['path', { d: 'M12 3H19C20.1 3 21 3.9 21 5V12L13 20C12.5 20.5 11.5 20.5 11 20L4 13C3.5 12.5 3.5 11.5 4 11L12 3Z' }],
    ['circle', { cx: '16.5', cy: '7.5', r: '1.3' }],
  ],
  shield: [
    SHIELD_BASE,
  ],
  shield_lock: [
    SHIELD_BASE,
    ['rect', { x: '9', y: '11', width: '6', height: '5', rx: '1' }],
    ['path', { d: 'M10.5 11V9.5a1.5 1.5 0 0 1 3 0V11' }],
  ],
  cloud: [
    ['path', { d: 'M7 18H17C19 18 21 16.2 21 14C21 12 19.5 10.3 17.5 10.1C17 7.7 14.8 6 12.3 6C9.5 6 7.2 8 7 10.6C4.7 11 3 13 3 15C3 16.7 5 18 7 18Z' }],
  ],
  celebration: [
    ['path', { d: 'M4 20L7 11L13 14L10 20Z' }],
    ['path', { d: 'M13 11L20 4' }],
    ['path', { d: 'M15 5L16 7M18 4L19 6M20 8L22 9' }],
  ],
  monitoring: [
    ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }],
    ['path', { d: 'M6 14H8.5L10.5 9L13 17L14.5 14H18' }],
  ],
  radio_button_checked: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['circle', { cx: '12', cy: '12', r: '4', fill: 'currentColor' }],
  ],
  photo_camera: [
    ['path', { d: 'M4 8H8L10 6H14L16 8H20C20.6 8 21 8.4 21 9V18C21 18.6 20.6 19 20 19H4C3.4 19 3 18.6 3 18V9C3 8.4 3.4 8 4 8Z' }],
    ['circle', { cx: '12', cy: '13.5', r: '3.5' }],
  ],
  play_circle: [
    CIRCLE9,
    ['path', { d: 'M10 8.5L16 12L10 15.5Z' }],
  ],
  play_arrow: [
    ['path', { d: 'M7 4.5L20 12L7 19.5Z' }],
  ],
  pause_circle: [
    CIRCLE9,
    ['path', { d: 'M10 8.5V15.5M14 8.5V15.5' }],
  ],
  stop: [
    ['rect', { x: '6', y: '6', width: '12', height: '12', rx: '1.5' }],
  ],
  stop_circle: [
    CIRCLE9,
    ['rect', { x: '9.5', y: '9.5', width: '5', height: '5', rx: '1' }],
  ],
  folder: [
    FOLDER_BASE,
  ],
  circle: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
  ],
  block: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'M6 6L18 18' }],
  ],
  light_mode: [
    ['circle', { cx: '12', cy: '12', r: '4.5' }],
    ['path', { d: 'M12 2.5V5M12 19V21.5M4.2 4.2L6 6M18 18L19.8 19.8M2.5 12H5M19 12H21.5M4.2 19.8L6 18M18 6L19.8 4.2' }],
  ],
  dark_mode: [
    ['path', { d: 'M20 14.5A8.5 8.5 0 1 1 9.5 4A7 7 0 0 0 20 14.5Z' }],
  ],
  sentiment_satisfied: [
    CIRCLE9,
    ['path', { d: 'M8 14C9 15.7 10.4 16.5 12 16.5C13.6 16.5 15 15.7 16 14' }],
    ['path', { d: 'M8.5 9.5H8.51M15.5 9.5H15.51' }],
  ],

  // ---------------------------------------------------------------------
  // Complementares (adicionados após a lista original — mesmas famílias)
  // ---------------------------------------------------------------------
  keyboard_arrow_up: [
    ['path', { d: 'M5 15L12 8L19 15' }],
  ],
  keyboard_arrow_down: [
    ['path', { d: 'M5 9L12 16L19 9' }],
  ],
  manage_accounts: [
    PERSON_HEAD,
    PERSON_BODY_SHORT,
    ['circle', { cx: '17.5', cy: '17', r: '2.6' }],
    ['path', { d: 'M17.5 13V14.4M17.5 19.6V21M13.9 17H15.3M19.7 17H21.1M15.2 14.7L16.2 15.7M18.8 18.3L19.8 19.3M15.2 19.3L16.2 18.3M18.8 15.7L19.8 14.7' }],
  ],
  quiz: [
    PAGE_BASE,
    PAGE_FOLD,
    ['path', { d: 'M10 12C10 10.5 11 9.5 12 9.5C13 9.5 14 10.5 14 12C14 13 13 13.5 12.5 14.3C12.2 14.8 12 15.1 12 15.7' }],
    ['circle', { cx: '12', cy: '17.8', r: '0.6', fill: 'currentColor' }],
  ],
  alternate_email: [
    ['circle', { cx: '12', cy: '12', r: '3.2' }],
    ['path', { d: 'M15.2 12V14.3C15.2 15.7 16.6 16.5 17.7 15.6C18.9 14.7 19.6 13.2 19.6 11.5C19.6 7.9 16.6 5 13 5C8.9 5 5.5 8.4 5.5 12.5C5.5 16.6 8.9 20 13 20C14.3 20 15.5 19.7 16.6 19.1' }],
  ],
  upcoming: [
    CIRCLE9,
    ['path', { d: 'M9 13L12 9.5L15 13' }],
    ['path', { d: 'M12 9.5V16' }],
  ],
};
