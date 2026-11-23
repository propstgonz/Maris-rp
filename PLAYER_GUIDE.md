# Guía del jugador

Todo lo que necesitas para llevar la ficha de tu personaje de *El Tomegrama* en Discord. Los comandos son `/slash`: escríbelos y Discord te guía con las opciones. `/ayuda` te enseña una versión corta de esta guía sin salir de Discord.

Lo que consultes (`/perfil`, `/bienes`...) solo lo ves tú. La partida en sí, las tiradas de mundo y los resultados los arbitra el equipo de Rolepriest; el bot guarda tu ficha y aplica las reglas mecánicas.

## Crear tu personaje

`/personaje crear` abre un formulario con el nombre y la edad (de 1 a 1000) y después te deja elegir género (hombre o mujer) y raza. Cuando todo está elegido pulsas «Crear personaje».

- Solo puedes tener **un personaje a la vez**.
- La raza **no se puede cambiar** después. Si te equivocas, pídeselo a un Rolepriest.
- Al crearlo se abre un canal privado entre tú y el Staff (modmail). Puedes escribir al bot por MD y tu mensaje llega a ese canal; las respuestas del Staff te llegan por MD.
- Si tu personaje anterior murió, tienes que esperar **336 horas (2 semanas) desde su muerte** antes de crear otro.

`/personaje foto` cambia la imagen de tu personaje (PNG, JPG, WEBP o GIF, hasta 2 MB). `/personaje historial` lista los nombres de los personajes que has tenido.

## Tu ficha: `/perfil`

Muestra tus estadísticas, raza, menhir, puntos libres, Magia y estado civil, y te deja pasar a tus NPCs, bienes, propiedades, escuelas y conjuros con un selector.

### Estadísticas (PICARDA)

Tienes siete: Potencia, Intuición, Chiripa, Autismo, Resistencia, Donjuanismo y Agilidad.

- Empiezas con **8 puntos para repartir**, como quieras, con un máximo de **6 puntos por estadística**. Puedes dejar puntos sin gastar.
- Pulsa **Asignar puntos** en `/perfil`. Elige la estadística, escribe cuántos puntos y confirma. **Es irreversible.**
- La estadística que cuenta en las tiradas es la **efectiva**: lo que has asignado más el bono de tu raza más el de tu menhir. Puede superar 6 o ser negativa.
- Los puntos extra solo los concede un Rolepriest.

### Menhir

Hay 11 menhires. Eliges **uno** con el botón **Elegir menhir** de `/perfil`. Después tienes que esperar **6 meses** para cambiarlo. Si te equivocas antes, habla con un Rolepriest.

### Magia

Tu Magia sale del Autismo efectivo: 25 por punto, con un tope que depende de tu raza (150 a 200). El Menhir del Mago suma 50 y el Menhir Ritual la convierte en Vida (Magia entre 100).

## Inventarios

Tienes tres: **NPCs**, **bienes** y **propiedades**.

- `/npcs ver`, `/bienes ver`, `/propiedades ver`: listados de 10 en 10 con botones para pasar página. Los bienes admiten decimales (hasta 2).
- Las altas y bajas las hace un Rolepriest cuando se resuelve algo en la partida.
- `/npcs traspasar`, `/bienes traspasar`, `/propiedades traspasar`: ofreces algo a otro jugador. **Tiene que aceptar** (le llega un MD y lo ve en `/solicitudes`). Hasta que acepte no se mueve nada, y la oferta caduca a las 24 horas. Solo puedes tener 5 ofertas pendientes con la misma persona.

## Solicitudes: `/solicitudes`

Lista lo que otros te han ofrecido (traspasos y propuestas de matrimonio), con botones para **aceptar** o **rechazar**, y lo que tú has ofrecido, con un botón para **cancelar**.

## Matrimonio

Eres Soltero/a hasta que te casas. `/matrimonio proponer` envía la propuesta a otro personaje vivo; si la acepta (por MD o en `/solicitudes`), os casáis. Solo puedes estar casado con una persona. `/matrimonio divorciar` te divorcia (irreversible). Si tu cónyuge muere definitivamente, quedas Viudo/a.

## Magia: escuelas y conjuros

Hay cinco escuelas: Destrucción, Alteración, Restauración, Ilusión y Conjuración (Encantamiento está excluida de momento).

- `/escuelas ver`: tu nivel en cada escuela, qué necesitas para el siguiente y tu Magia total.
- `/escuelas iniciar`: si tu **Autismo efectivo es 6 o más**, puedes iniciar **una** escuela gratis, una sola vez.
- Para subir de nivel necesitas un **mentor** y que un Rolepriest autorice la tirada: el bot tira un D20, le suma tu modificador (Autismo más una segunda estadística según la escuela) y lo compara con el umbral del nivel: Principiante 19, Aprendiz 19, Hábil más de 20, Experto 24, Maestro 28.
- Si fallas, tienes que esperar **28 días** para reintentarlo en esa escuela.
- `/conjuros`: los conjuros que tu nivel desbloquea. Puedes filtrar por escuela. Subir de nivel desbloquea más.

## Dados: `/dado`

Tira un dado libre para resolver cualquier cosa de rol y lo ve todo el canal: D6 (por defecto), D12, D20 o D100.

## Si tu personaje muere

- Si **sales del servidor**, tu personaje entra en **gracia durante 7 días**: no pierdes nada. Si vuelves en esos 7 días, lo recuperas intacto; un Rolepriest también puede revivirlo antes.
- Si se acaban los 7 días, o un Rolepriest usa `/kill`, la muerte es **definitiva**: se borran tus inventarios, estadísticas, raza, menhir y magia, y tu cónyuge queda viudo/a. Podrás crear otro personaje 336 horas después de la muerte.
