# 03 — Formulário multi-etapa de proposta comercial

Corpo de briefing fixo do benchmark (corpus de regressão — ver benchmarks/README.md).
Cenário: fluxo de cadastro de proposta de crédito para pequenas empresas em um site
de fintech, dividido em 4 etapas.

## audience

Donos e gestores de pequenas empresas solicitando crédito, muitas vezes em celular,
com pouca familiaridade com jargão financeiro. Estão ansiosos sobre aprovação e
sensíveis a formulários longos — cada campo a mais é um risco de abandono.

## goal

Levar o usuário ao envio da proposta em menos de 5 minutos, com abandono mínimo:
4 etapas curtas (dados da empresa, faturamento, valor desejado, contato) com
progresso sempre visível, possibilidade de voltar sem perder dados e envio final
com resumo conferível.

## visualDirection

Uma coluna central estreita (leitura confortável), stepper horizontal no topo com
etapas nomeadas e estado claro (concluída / atual / pendente). Campos com rótulo
permanente acima (nunca só placeholder), helper text curto, validação inline no
blur. Um CTA por etapa ("Continuar") + link discreto "Voltar". Tela de sucesso
limpa com resumo e expectativa de prazo.

## constraints

Sem bibliotecas externas; máscaras de CNPJ, telefone e moeda em JS puro; validação
pt-BR com mensagens específicas ("CNPJ inválido", não "erro de formato"); erros
agrupados em resumo acessível no topo (aria-live) além do erro por campo; estado
parcial preservado ao voltar/avançar; teclado numérico em campos numéricos no
mobile; 360px-1280px; WCAG 2.1 AA; sem coleta de dados além do declarado.
