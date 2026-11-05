# Modelo de ameaças do serviço

O administrador gerencia contas, projetos e aprovações; editor altera telas e
tokens; comentarista escreve comentários; visualizador somente lê. Todas as
escritas exigem sessão, CSRF e papel. O modo `--share` é somente leitura.
Entradas de comentário são sanitizadas, caminhos são confinados ao projeto e
o serviço deve ficar atrás de TLS reverso quando exposto além de localhost.
