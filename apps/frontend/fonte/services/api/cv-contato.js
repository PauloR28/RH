import { requisitar } from './core.js';

// "Preencher com o CV": lê o currículo salvo do candidato e devolve
// nome/e-mail/telefone para o RH revisar antes de gerar a prova individual.
export async function extrairContatoCvCandidato(idTeste) {
  return requisitar(`/candidate-profiles/${encodeURIComponent(idTeste)}/cv-contact`, {
    method: 'POST',
  });
}
