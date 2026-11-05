# Mockbird service

Run the single-process viewer, documentation, project files, and API service:

```sh
node skills/design/assets/serve.mjs --service --data ./data 8765 --no-open
```

`--data` is created when absent and contains the atomically-written
`projects.json`. `GET /health` returns JSON status. `POST /api/session` seeds a
local session cookie for fixtures; service write routes require that cookie (or
the equivalent `X-Session-Token` header). `SIGINT` and `SIGTERM` close the HTTP
server cleanly.
