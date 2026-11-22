# Matriz de trazabilidad de mecánicas

Relaciona cada mecánica de *El Tomegrama* (`PROMPT/El Tomegrama.pdf`, versión con menhires, 57 págs.) con su implementación y sus pruebas. Estado:

- **Implementada**: el bot la aplica o la valida.
- **Registro**: el bot guarda el resultado; la resolución es del Lorepriest.
- **Fuera de alcance**: no se pidió en el rediseño; el Lorepriest la aplica a mano. Queda anotada para no perderla de vista.

## Implementadas

| Mecánica | Pág. | Regla | Implementación | Pruebas |
|---|---|---|---|---|
| PICARDA: 7 estadísticas | 17 | Potencia, Intuición, Chiripa, Autismo, Resistencia, Donjuanismo, Agilidad | `src/domain/picarda.js` (`STATS`), columnas `players.stat_*` | `test/picarda.test.mjs` |
| PICARDA: 8 puntos iniciales | 18 | Se reparten como quiera el usuario | `freePoints`, guarda en `profileService.allocateStat` | `test/picarda.test.mjs`, `test/integration/profile.int.mjs` (carrera de 8 asignaciones con 7 libres) |
| PICARDA: máximo 6 por estadística | 18 | Límite de puntos asignados | `CHECK (stat_* BETWEEN 0 AND 6)` + guarda en el `WHERE` | idem |
| PICARDA: no se pueden cambiar | 18 | Asignación irreversible; puntos extra muy difíciles | El jugador solo suma; el Rolepriest concede extra (`grantBonusPoints`) y corrige (`correctStat`), auditado | `test/profileService.test.mjs` |
| Modificador por tipo de dado | 18 | d6: stat/3, d20: +stat, d100: stat×3 | Informativo (no se tira con stats fuera de la magia) | — |
| Razas y sus puntos | 37-39 | 10 razas con +/- a PICARDA y rasgos | `rp_players.races` (035), `effectiveStats` | rehearsal (10 razas), `test/picarda.test.mjs` |
| Bono racial rompe el 6 o deja negativo | 39 | Aviso explícito | La efectiva no se limita; la base sí | `test/picarda.test.mjs` |
| Menhires | 56-57 | 11 menhires; +1 a una stat, +50 Magia, Ritual Magia→Vida, efectos narrativos | `rp_players.menhirs` (035), `effectiveStats`, `magicPoints` | `test/picarda.test.mjs`, rehearsal (11 menhires) |
| Elegir 1 menhir y esperar 6 meses | 57 | Cambio cada 6 meses off-rol | `profileService.chooseMenhir` (guarda `menhir_chosen_at <= NOW() - INTERVAL 6 MONTH`) | `test/integration/profile.int.mjs` |
| Magia | 41 | 25 por punto de Autismo, máximo 150/175/200 | `magicPoints` (+ Menhir del Mago, Menhir Ritual) | `test/picarda.test.mjs` |
| 6 escuelas, Encantamiento excluida | 40-41, 51 | Destrucción, Alteración, Restauración, Ilusión, Conjuración activas | `rp_players.schools` (036, `is_active`) | `test/integration/magic.int.mjs` |
| Tirada de escuela | 42 | D20 + Autismo + X según escuela | `domain/magic.js#attemptModifier` | `test/magic.test.mjs` |
| Entrar en una escuela | 42 | ≥19; si falla, 4 semanas | `magicService.authorizedRoll` (objetivo 1) | `test/integration/magic.int.mjs` |
| Escuela gratuita | 41 | 6 de Autismo ⇒ elegir escuela inicial | `claimFreeSchool` (Autismo efectivo, una vez) | `test/integration/magic.int.mjs` (Aldmer 4+2 sí, Bosmer 5 no) |
| Niveles de dominio | 43 | Aprendiz ≥19, Hábil >20, Experto ≥24, Maestro ≥28, mentor de nivel igual o superior | `rp_players.mastery_levels` (036), `authorizedRoll` | `test/integration/magic.int.mjs` (Hábil 20 falla, 21 pasa) |
| Enfriamiento de 4 semanas | 42-43 | Tras fallar | `school_progress.retry_after` (28 días), claim atómico | carrera de tiradas simultáneas |
| Conjuros por escuela y nivel | 44-51 | 75 conjuros con coste y efecto | `rp_players.spells` (036) | rehearsal (21/15/11/14/14) |
| Desbloqueo de conjuros | 43-51 | Cada nivel da acceso a sus conjuros | Derivado: `magicService.getUnlockedSpells` | `test/integration/magic.int.mjs` (subir desbloquea, bajar bloquea) |
| Un personaje a la vez | 23 (regla 1) | — | Una fila de `players` por cuenta de Discord | `test/integration/profile.int.mjs` (creación simultánea) |
| Sin lucro post mortem | 23 (regla 4) | — | `killCharacter` vacía los 3 inventarios | `test/integration/marriage.int.mjs` |
| Espera de 2 semanas tras morir | 31 (RED 1) | — | `character_creation_cooldown_hours = 336` | `createCharacter` |

## Registro (el Lorepriest resuelve; el bot guarda)

| Mecánica | Pág. | Registro |
|---|---|---|
| Edificios, viviendas y sus niveles | 5-7, 9-10, 14, 27 | Inventario de propiedades (`properties.level`, `property_types.category`); catálogo opcional `npm run seed:tomegrama` |
| Propiedad «registrada en los archivos regionales» | 32 | `properties` + `audit_log` |
| Bienes, materiales, herramientas, armas, armaduras, minerales, ganado, Platas | 4, 7-9, 12, 15, 35-36 | Inventario de bienes con decimales; catálogo opcional |
| Población, unidades, eruditos, misioneros, curas, socios, herreros | 3-4, 10, 14, 19-20, 33, 52 | Inventario de NPCs (sin estadísticas, requisito del rediseño) |
| Hechicero Mentor | 41-43 | `magic_attempts.mentor_player_id` / `mentor_label` |
| Traspasos entre usuarios | 32-33 | Solicitud con aceptación (`consent_requests`) |
| Estado civil | — (no está en el Tomegrama) | Matrimonio monógamo por decisión del usuario (ADR-10) |

## Fuera de alcance

Población y felicidad (3-4), turnos económicos (4), costes de construcción (5-7), producción, herramientas y prospección (7-9), religión y conversión (10-11), mercado y tabla de stock (12-13), investigación (14), fauna y cría (15-16), reclutamiento (19), experiencia militar y efectos de armas (20-22), reglamentos (23-25), procedimiento de dados (26), lo naval (27-28), tiempo, desplazamiento y alcance (29-30, depende del mapa eliminado), RED 2-4 (31), arrendamiento y socio burgués (32-33), estabilidad y rebelión (34), equipamiento (35-36), herrería y su dominio (52-53), robo y criminalidad (54-55), efectos narrativos de menhires (Atronach, Amante, Ofidio, Sombrío) y de conjuros en combate.

`/dado` sigue disponible para todas ellas.
