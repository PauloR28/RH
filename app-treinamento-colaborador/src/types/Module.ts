/**
 * Um módulo pode ter texto+imagens (secoes) E vídeo ao mesmo tempo — não
 * existe um "tipoConteudo" exclusivo no backend real (ver
 * apps/backend/rh_api/schemas/onboarding.py:50-67, SecaoModuloInput, e
 * repositories/onboarding.py:87-93). A tela do wireframe "Visão Curso 3"
 * mostra exatamente essa combinação (Vídeo Explicativo + Material de Leitura
 * na mesma Aula).
 */
export interface ModuleSection {
  subtitulo: string;
  texto: string;
  imagens: string[];
}

export interface Module {
  id_onboarding_item: number;
  onboarding_candidato_id: number;
  trilha_item_id: number;
  titulo: string;
  descricao: string | null;
  ordem: number;
  obrigatorio: boolean;
  concluido: boolean;
  concluido_em: string | null;
  concluido_por: string | null;
  tipo_conteudo: string | null;
  conteudo_url: string | null;
  texto_principal: string | null;
  video_path: string | null;
  video_nome_original: string | null;
  secoes: ModuleSection[];
}
