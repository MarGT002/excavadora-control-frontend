# Excavadora IoT · CONTROL + MONITOREO

Aplicación web (Prácticas 4.1 y 4.2) para **controlar** y **monitorear en tiempo real** la Excavadora IoT.
Consume la API existente en AWS (FastAPI + 21 procedimientos almacenados + Amazon RDS) y su canal WebSocket seguro.

- **Sitio:** https://margt002.github.io/excavadora-control-frontend/
- **Repositorio:** https://github.com/MarGT002/excavadora-control-frontend
- **API:** https://appt1.deguel.site (Swagger: `/docs`) · **WSS:** `wss://appt1.deguel.site/ws/vehiculos/1`

Desarrollado por **Mario García Terrazas** · 2026

---

## Arquitectura

```
GitHub Pages (HTML5 + CSS3 + Bootstrap 5 + ES Modules)
 ├─ CONTROL ── commands/demos ──► Fetch POST ──► FastAPI (AWS EC2 + Caddy HTTPS) ──► SP ──► Amazon RDS
 ├─ MONITOREO ─ carga/resync ───► Fetch GET  ──┘            │
 └─ ws.js (UNA sesión WSS compartida) ◄──── eventos ────────┘  (movimiento, demo_*, estado)
                                   ▲
           Postman / Thunder Client / extensión Chrome (cliente WSS independiente de verificación)
```

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Configuración | `assets/js/config.js` | URL base, WSS, vehículo, rutas reales, nombres del catálogo. **Sin secretos.** |
| Servicios | `services/http.js` | Fetch + `AbortController` (timeout), códigos HTTP, JSON inválido, errores de red. |
| | `services/api.js` | Contratos REST reales y validación/normalización de respuestas. |
| | `services/ws.js` | Sesión WSS única con reconexión exponencial; filtra vehículo y tipo de evento. |
| Dominio | `core/catalog.js` | Catálogo real (`GET /comandos`): nombre → `id_comando`. |
| | `core/command-service.js` | **Único** envío de comandos (palancas + botones), prioridad de DETENER, anti-ráfagas. |
| | `core/demo-service.js` | Iniciar/cancelar DEMO y progreso por eventos WSS. |
| | `core/toggle-state.js` | Estado ON/OFF estimado de Encender, Luces y Bocina (a partir de los eventos publicados). |
| | `core/connectivity.js` | Verificación periódica de API (`/health`) y RDS (`/health/db`). |
| | `core/store.js` | Bus de eventos compartido. |
| Interfaz | `ui/joystick.js` | Palanca con Pointer Events + teclado; solo emite transiciones. |
| | `ui/indicators.js`, `ui/toast.js`, `ui/theme.js` | Tres indicadores, avisos accesibles y modo claro/oscuro. |
| Vistas | `views/router.js` | Navegación `#control` / `#monitoreo` sin recargar. |
| | `views/control-view.js` | Palancas (movimiento continuo), DETENER, funciones con estado y DEMO. |
| | `views/monitor-view.js` | Último movimiento + tabla de 10 movimientos + resincronización. |

```
index.html
assets/
  css/styles.css
  img/favicon.svg · favicon-32.png · apple-touch-icon.png
  js/app.js · config.js
     services/ http.js · api.js · ws.js
     core/     store.js · catalog.js · command-service.js · demo-service.js · toggle-state.js · connectivity.js
     ui/       joystick.js · indicators.js · toast.js · theme.js
     views/    router.js · control-view.js · monitor-view.js
     utils/    format.js · validate.js
```

## Contratos usados (verificados en `/openapi.json`)

| Uso | Método y ruta | Notas |
|---|---|---|
| Vehículo | `GET /vehiculos/1` | nombre del vehículo |
| Catálogo | `GET /vehiculos/1/comandos` | 13 comandos (AVANZAR … DEMO) |
| Movimiento | `POST /vehiculos/1/movimientos` `{"id_comando", "origen":"WEB_CONTROL"}` | 201; estado + historial; publica `movimiento` por WSS |
| DEMO | `GET /vehiculos/1/demos` · `POST /vehiculos/1/demos/{id}/iniciar` (202, 409 si ya corre) · `POST /vehiculos/1/demos/cancelar` | la secuencia la ejecuta el backend |
| Monitoreo | `GET /vehiculos/1/estado` · `GET /vehiculos/1/historial` (máx. 10, más reciente primero) | |
| Salud | `GET /health` · `GET /health/db` (200 / 503) | agregados al backend para los indicadores |

**Eventos WSS** (todos con `tipo`, `id_vehiculo`, `timestamp`): `estado` (al conectar), `movimiento`, `demo_inicio`, `demo_movimiento`, `demo_fin`, `demo_cancelada`, `error`.

## Controles

| Control | Acción |
|---|---|
| Palanca izquierda (Orugas) | ↑ AVANZAR · ↓ RETROCEDER · ← GIRAR_IZQUIERDA · → GIRAR_DERECHA |
| Palanca derecha (Brazo · Pala) | ↑ SUBIR_BRAZO · ↓ BAJAR_BRAZO · ← ABRIR_PALA · → CERRAR_PALA |
| Sostener una palanca | El comando se reenvía cada 600 ms (`HOLD_REPEAT_MS`): movimiento continuo, como un control de consola |
| Soltar cualquier palanca | DETENER |
| Botones | ENCENDER · LUCES · BOCINA (con estado ON/OFF visible) · DEMO (demo integrada del juguete) |
| Botón ☀/☾ | Modo claro / oscuro (se recuerda en el navegador) |
| DETENER (o `Esc` / `Espacio`) | Prioridad absoluta: cancela la DEMO si corre y envía DETENER |
| Teclado | Foco en palanca: flechas o WASD (orugas) / IJKL (brazo) |

Reglas: un POST al **cambiar** de dirección (nunca por píxel) y reenvíos controlados mientras se sostiene (sin acumularse si hay uno en vuelo); un solo movimiento en vuelo; con una palanca en uso la otra y los botones se bloquean; durante una DEMO solo se admite DETENER/Cancelar; respuestas tardías anteriores a un DETENER se ignoran y DETENER se reafirma.

**Retroalimentación:** el punto junto al estado de cada palanca indica la fase: ámbar *solicitado* → azul *aceptado por API* (HTTP 201) → verde *evento WSS recibido* (rojo = error). Los botones muestran contorno ámbar mientras se envían. Ninguna fase confirma movimiento físico de los motores.

**Funciones con estado:** Encender, Luces y Bocina alternan en el vehículo con cada pulso. Su estado ON/OFF se **estima** con los eventos `movimiento`/`demo_movimiento` publicados (de cualquier pestaña); al encender, las luces quedan activas. No es telemetría del dispositivo.

**Diseño:** la aplicación ocupa exactamente la pantalla (`100dvh`): no hay desplazamiento de página en celular vertical/horizontal, tableta ni escritorio; las palancas se dimensionan con *container queries* según el espacio disponible.

## Indicadores

| Indicador | Estados | Fuente |
|---|---|---|
| WebSocket WSS | En línea / Conectando · Reconectando / Desconectado | eventos `open`/`close` de la sesión real del navegador |
| API AWS · 21 servicios | Disponible / Comprobando / No disponible | `GET /health` cada 20 s, timeout 5 s |
| Amazon RDS | Disponible / No disponible / Sin verificar | `GET /health/db` (SELECT 1 en el backend). Si la API no responde o no existe el diagnóstico: «Sin verificar» |

«WebSocket en línea» **no** significa que el ESP8266 esté conectado; esa presencia requerirá un latido propio del dispositivo en una etapa posterior.

## Monitoreo

- Al abrir la vista: `GET /estado` y `GET /historial` (carga inicial REST).
- Evento WSS `movimiento` (de esta u otra pestaña/cliente): actualiza la tarjeta de inmediato y **dispara** la resincronización REST del historial (agrupada 350 ms). No hay polling del historial.
- Evento `demo_movimiento`: actualiza la tarjeta (etiqueta «DEMO») pero **no** la tabla: el backend no guarda los pasos de DEMO en `historial_comandos`.
- Reconexión WSS: nueva carga REST de estado e historial.
- Concurrencia: cada consulta tiene número de secuencia y se abortan las anteriores; un REST viejo no sobrescribe un evento WSS más nuevo; deduplicación por `id_historial`.
- Fechas: RDS entrega fechas sin zona; se interpretan como UTC (`DB_TIME_OFFSET` en `config.js`) y se muestran en hora de Ciudad de México.

## Ejecutar en local

Los módulos ES no funcionan con `file://`. En la carpeta del proyecto:

```bash
python -m http.server 5500
# abrir http://localhost:5500
```
(o la extensión *Live Server* de VS Code, puerto 5500). El backend autoriza CORS para `http://localhost:5500`.

## Publicar en GitHub Pages

1. `git push` a la rama `main`.
2. GitHub → *Settings* → *Pages* → *Deploy from a branch* → `main` / `(root)`.
3. Abrir `https://margt002.github.io/excavadora-control-frontend/`. Todas las rutas son relativas (`./assets/...`).

## Pruebas funcionales (verificación WSS independiente)

Conecta Postman (*New → WebSocket*) o Thunder Client a `wss://appt1.deguel.site/ws/vehiculos/1`. Debe llegar primero un mensaje `estado`.

| Prueba | Pasos | Esperado |
|---|---|---|
| A · Movimiento | Mueve la palanca izquierda hacia arriba | `POST /movimientos` 201 (DevTools → Network) y en Postman `{"tipo":"movimiento","comando":"AVANZAR","codigo":1,"origen":"WEB_CONTROL",...}` |
| B · Cambio y DETENER | Arrastra arriba → derecha y suelta | AVANZAR (reenviado mientras se sostiene), GIRAR_DERECHA, DETENER; ninguna orden por píxel de arrastre |
| C · DEMO | Elige «Demo principal» → Iniciar | `demo_inicio`, N × `demo_movimiento` en orden, `demo_fin`. Con Cancelar/DETENER: `demo_cancelada` |
| D · Indicadores | DevTools → Network → *Offline* y luego *No throttling* | WSS: Desconectado → Reconectando → En línea; API: No disponible → Disponible; RDS: Sin verificar mientras la API no responde |
| E · Responsivo | Celular vertical/horizontal y escritorio | Todo en una pantalla, sin desplazamiento; botones ≥ 44 px; créditos al pie |
| 4.2-A · Carga inicial | Abrir Monitoreo | Tarjeta y 10 filas ordenadas (ID descendente) |
| 4.2-B · En vivo | Desde Control: AVANZAR, DERECHA, DETENER | Tarjeta cambia al instante y la tabla se resincroniza sin recargar |
| 4.2-C · Otra pestaña | Envía comandos desde otra pestaña o Swagger | Monitoreo se actualiza solo; máximo 10 filas, sin duplicados |
| 4.2-E · DEMO | Ejecuta una DEMO con Monitoreo abierto | La tarjeta muestra pasos «DEMO», la tabla no cambia |

> Un evento WSS demuestra que el backend publicó el evento; **no** demuestra ejecución física en los motores.

## Seguridad, accesibilidad y errores (checklist)

- [x] HTTPS + WSS (sin contenido mixto). Sin API keys, tokens ni credenciales en el repositorio.
- [x] CORS restringido en el backend a `https://margt002.github.io` y `localhost:5500` (CORS no es autenticación).
- [x] Iniciar/cancelar DEMO públicos en el backend; la API key solo protege eliminaciones y vive en el `.env` del servidor.
- [x] Datos remotos validados (tipo, vehículo, campos) y renderizados con `textContent` / `new Option()` (sin `innerHTML`).
- [x] Timeouts, abortos, errores HTTP/red, reconexión con espera progresiva, sin trazas internas en pantalla.
- [x] HTML semántico, `aria-live`, nombres accesibles, foco visible, teclado, objetivos táctiles ≥ 44 px, estados con texto + icono + color.
- [x] Sin acceso del navegador a MySQL/RDS.
