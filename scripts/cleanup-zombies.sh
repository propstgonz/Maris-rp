#!/bin/sh
# ─── scripts/cleanup-zombies.sh ──────────────────────────────────────────────
# Borra archivos "zombie" que quedaron huérfanos en el servidor de producción
# por despliegues manuales (copia de ficheros por SSH, sin sincronizar
# borrados) a lo largo de toda la sesión de rediseño. El despliegue actual
# es vía Jenkins (`checkout scm` + `docker compose up -d --build`, ver
# docs/deploy.md), que sí sincroniza borrados — este script ya no debería
# hacer falta salvo en un checkout heredado de aquella época.
#
# Ejecutar DENTRO del directorio del bot en el servidor (donde está
# docker-compose.yml), luego reconstruir el contenedor.
#
# IMPORTANTE: esto hay que volver a ejecutarlo cada vez que un archivo se
# renombra o mueve de carpeta en el repo (staff/ <-> player/, etc.) — un
# despliegue por copia de ficheros NUNCA borra solo lo que ya no existe en
# local. Si vuelves a ver "[WARN] Nombre duplicado" en el log de arranque,
# hay un zombie nuevo que añadir a esta lista.
# ─────────────────────────────────────────────────────────────────────────────
set -e

FILES="
src/commands/player/mercado.js
src/commands/player/monedas.js
src/commands/player/moverse.js
src/commands/player/recolectar.js
src/commands/player/tirar.js
src/commands/player/viajar.js
src/commands/staff/auditoria.js
src/commands/staff/config.js
src/commands/staff/dryrunreset.js
src/commands/staff/item.js
src/commands/staff/laburo.js
src/commands/staff/nacion.js
src/commands/staff/removeeffect.js
src/commands/staff/revivir.js
src/commands/staff/setavatar.js
src/commands/staff/seteffect.js
src/commands/staff/setmonedas.js
src/commands/staff/setpos.js
src/commands/staff/setstat.js
src/services/auditService.js
src/services/effectService.js
src/utils/confirm.js
src/utils/effectsMeta.js
"

for f in $FILES; do
  if [ -f "$f" ]; then
    rm -v "$f"
  else
    echo "(ya no existe) $f"
  fi
done

echo ""
echo "✔ Limpieza terminada. Ahora reconstruye y reinicia:"
echo "  docker compose up --build -d"
echo ""
echo "Comprueba el log de arranque: NO debería salir ningún"
echo "\"[WARN] [CommandLoader] Nombre duplicado\"."
