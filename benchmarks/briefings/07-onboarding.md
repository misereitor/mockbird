# 07 — Onboarding de produto financeiro

Corpo de briefing fixo do benchmark (corpus de regressão — ver benchmarks/README.md).
Cenário: primeira experiência de um aplicativo de controle financeiro pessoal após
o cadastro — ativação em poucos minutos.

## audience

Usuários recém-cadastrados em um app de finanças pessoais, maioria mobile, com
pouca disciplina financeira e medo de "app complicado". Chegam com uma intenção
concreta (saber para onde vai o dinheiro) e baixa tolerância a configuração longa.

## goal

Ativar o usuário em até 3 minutos: criar a primeira meta de economia OU registrar
a primeira despesa, com sensação de progresso imediata. Onboarding em 3 passos
curtos + checklist de ativação que persiste na home, celebrando cada item concluído.

## visualDirection

Acolhedor mas adulto — nada de mascote infantil. Um passo por tela, número do passo
e barra de progresso discretos, ilustração leve opcional mas nunca no lugar do
conteúdo. Microcopy humano e específico ("Vamos definir sua primeira meta leva 30
segundos"). Ação primária única por tela, ancorada embaixo. Estados de sucesso com
microcomemoração contida (check animado curto).

## constraints

Sem bibliotecas externas; permitir pular qualquer passo e retomar depois (checklist
persistido em localStorage mock); tooltips de ajuda acessíveis por foco (não só
hover); campos com validação inline; erros de rede simulados com retry visível;
360px-768px principal; WCAG 2.1 AA; nada de tour interminável — máximo 3 passos +
checklist.
