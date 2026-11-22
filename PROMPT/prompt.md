# PROYECTO: REDISEÑO INTEGRAL DEL BOT DE ROLEPLAY DE DISCORD

## 1. ROL Y ESTRUCTURA DEL EQUIPO

Actúa como Opus 5.5 en calidad de arquitecto principal, CTO y orquestador del proyecto.

Tu responsabilidad es analizar, diseñar, coordinar y supervisar la reconstrucción integral de mi bot de Roleplay para Discord, partiendo del proyecto antiguo existente.

Debes utilizar una arquitectura multiagente:

### Orquestador principal — Opus 5.5

Responsabilidades:
- Analizar el repositorio completo.
- Comprender la arquitectura actual y sus dependencias.
- Leer y analizar íntegramente el documento de mecánicas.
- Diseñar la nueva arquitectura.
- Dividir el desarrollo en módulos independientes.
- Asignar agentes especializados Sonnet 5.5.
- Coordinar dependencias y contratos entre módulos.
- Resolver conflictos técnicos.
- Supervisar la integración.
- Validar que el resultado respeta todas las mecánicas.
- Coordinar las auditorías independientes.

Debes mantener el control arquitectónico de todo el proyecto.

### Equipo de desarrollo — Sonnet 5.5

Despliega agentes especializados según las necesidades detectadas.

Distribución inicial recomendada:

**Agente 1 — Arquitectura y backend**
- Estructura general.
- Servicios compartidos.
- Eventos y comandos.
- Integración de módulos.
- Organización del código.

**Agente 2 — Sistema de perfiles**
- Perfil individual de usuario.
- Estadísticas asignadas.
- Raza.
- Menhir elegido.
- Estado civil.
- Relaciones entre usuarios.
- Validaciones y restricciones.

**Agente 3 — Sistema de NPCs**
- Inventario de NPCs.
- Registro de NPCs pertenecientes a cada entidad.
- Altas, bajas y transferencias.
- Consultas y visualización.

**Agente 4 — Sistema de bienes y objetos**
- Inventario de bienes.
- Inventario de objetos.
- Gestión de cantidades cuando corresponda.
- Operaciones de adquisición, transferencia y eliminación.
- Persistencia.

**Agente 5 — Sistema de edificios y propiedades**
- Inventario de edificios.
- Inventario de propiedades.
- Propietarios.
- Transferencias.
- Adquisiciones.
- Restricciones y validaciones.

**Agente 6 — Sistema de escuelas y dominio**
- Las cinco escuelas.
- Niveles de dominio.
- Progresión.
- Registro de niveles alcanzados.
- Validaciones de desbloqueo.

**Agente 7 — Sistema de conjuros**
- Catálogo de conjuros.
- Requisitos de desbloqueo.
- Asociación con escuelas.
- Relación con los niveles de dominio.
- Consulta de conjuros desbloqueados.

**Agente 8 — Interfaz de Discord**
- Comandos slash.
- Embeds.
- Menús.
- Botones.
- Paginación.
- Presentación de perfiles e inventarios.
- Experiencia de usuario.

**Agente 9 — Base de datos y migraciones**
- Modelo de datos.
- Relaciones.
- Persistencia.
- Integridad referencial.
- Migraciones.
- Compatibilidad con datos existentes.

**Agente 10 — Pruebas y calidad**
- Tests unitarios.
- Tests de integración.
- Validación de permisos.
- Casos límite.
- Pruebas de progresión.
- Pruebas de relaciones entre usuarios.
- Detección de errores funcionales.

Puedes ampliar, fusionar o dividir estos agentes según la complejidad real del proyecto.

Evita que dos agentes modifiquen simultáneamente los mismos archivos sin coordinación.

### Equipo de auditoría — Opus 5.5

Utiliza agentes Opus independientes para revisar el resultado.

**Auditor 1 — Arquitectura**
Comprueba la calidad de la arquitectura, modularidad, dependencias y mantenibilidad.

**Auditor 2 — Mecánicas**
Comprueba que todas las mecánicas de El Tomegrama.pdf están correctamente interpretadas.

**Auditor 3 — Perfiles y relaciones**
Comprueba el funcionamiento del perfil, las estadísticas, la raza, el menhir y el estado civil.

**Auditor 4 — Inventarios**
Comprueba que los inventarios de NPCs, bienes/objetos y edificios/propiedades funcionan correctamente y de forma independiente.

**Auditor 5 — Progresión mágica**
Comprueba las cinco escuelas, los niveles de dominio y el desbloqueo de conjuros.

**Auditor 6 — Seguridad e integración**
Comprueba permisos, operaciones sensibles, persistencia, concurrencia y posibles exploits.

**Auditor final — Opus 5.5**
Realiza una auditoría integral e independiente. Debe comprobar el código y ejecutar las pruebas, no limitarse a aceptar los informes de los demás agentes.

---

## 2. DOCUMENTACIÓN OBLIGATORIA

Existe un documento fundamental:

`/PROMPT/El Tomegrama.pdf`

Este PDF contiene las mecánicas del sistema de Roleplay.

Es la fuente de verdad para implementar las reglas del juego.

Debes leerlo íntegramente y analizarlo en profundidad antes de diseñar la arquitectura definitiva.

Identifica:
- Todas las mecánicas.
- Entidades del sistema.
- Relaciones entre entidades.
- Estadísticas.
- Razas.
- Menhires.
- Escuelas.
- Niveles de dominio.
- Conjuros.
- Requisitos de desbloqueo.
- Inventarios.
- Economía.
- Edificios y propiedades.
- NPCs.
- Restricciones.
- Excepciones.
- Reglas de progresión.
- Condiciones de validez de las operaciones.

No inventes mecánicas ni rellenes vacíos documentales con suposiciones.

Cuando encuentres ambigüedades, documéntalas y solicita aclaración si afectan a la implementación.

---

## 3. OBJETIVO DEL REDISEÑO

Quiero reconstruir el bot antiguo en una nueva versión modular, mantenible y preparada para futuras ampliaciones.

El nuevo bot debe disponer de los siguientes sistemas.

### 3.1. Eliminación del mapa

Eliminar completamente el sistema de mapa.

Esto incluye:
- Comandos.
- Interfaces.
- Dependencias exclusivas.
- Servicios auxiliares.
- Referencias.
- Lógica residual.

No debe quedar ninguna funcionalidad del mapa accesible desde Discord.

Comprueba las dependencias antes de eliminar componentes compartidos.

### 3.2. Interfaz de usuario — Perfil

Quiero implementar un sistema de perfiles individuales para los usuarios de Discord que participen en el Roleplay.

El perfil debe mostrar exclusivamente los siguientes apartados funcionales:

**A. Estadísticas asignadas**
- Mostrar las estadísticas correspondientes al usuario.
- Permitir su asignación o modificación según las reglas del documento.
- Validar las restricciones existentes.
- No permitir modificaciones arbitrarias que vulneren las mecánicas.

**B. Raza**
- Mostrar la raza seleccionada o asignada.
- Gestionar su selección o modificación según las reglas del Tomegrama.
- Respetar las restricciones correspondientes.

**C. Menhir elegido**
- Mostrar el menhir elegido por el usuario.
- Gestionar su selección según las mecánicas.
- Validar los requisitos y restricciones.

**D. Estado civil**
Este apartado tiene una particularidad importante.

El estado civil únicamente debe ser funcional cuando intervenga otro usuario de Discord que tenga su propio perfil y participe en el sistema.

No quiero que el estado civil permita establecer relaciones con nombres escritos libremente o personajes que no estén representados por usuarios registrados.

Debe existir una relación real entre perfiles de usuarios.

Analiza cómo implementar:
- Vinculación entre dos usuarios.
- Solicitudes de relación cuando corresponda.
- Aceptación o rechazo.
- Actualización del estado civil de ambas partes.
- Separación o desvinculación, si las reglas lo permiten.
- Validación de que ambas partes tienen un perfil válido.
- Prevención de relaciones duplicadas o inconsistentes.

No presupongas qué estados civiles existen ni qué condiciones tienen: extráelos del PDF.

El sistema debe mantener la integridad de ambas partes. Una relación no puede aparecer activa en un perfil y ausente en el otro.

**Presentación del perfil**

Quiero una interfaz clara y visualmente organizada en Discord.

El perfil debe mostrar los datos anteriores de manera diferenciada.

No añadas atributos, estadísticas secundarias ni apartados decorativos que no estén justificados por las mecánicas.

### 3.3. Inventario de NPCs

Debe existir un inventario independiente para consultar los NPCs que posee o controla cada entidad, según las reglas del sistema.

Este requisito es especialmente importante:

Los NPCs NO necesitan estadísticas individuales ni perfiles propios.

No quiero:
- Fichas individuales.
- Atributos.
- Estadísticas.
- Progresión.
- Perfiles personales.
- Sistemas de personajes NPC adicionales.

Simplemente deben figurar en el inventario correspondiente.

Ejemplo conceptual:

Inventario de NPCs:
- Guardia de la ciudad.
- Comerciante.
- Médico.
- Soldado.
- Ingeniero.

Son nombres ilustrativos, no contenido que debas introducir obligatoriamente.

Implementa las operaciones permitidas por las mecánicas documentadas.

### 3.4. Inventario de bienes y objetos

Debe existir un inventario independiente para los bienes y objetos.

Analiza el PDF para determinar:
- Qué elementos pertenecen a esta categoría.
- Cómo se adquieren.
- Cómo se pierden.
- Cómo se transfieren.
- Si tienen cantidades.
- Si existen categorías.
- Qué restricciones tienen.
- Cómo se relacionan con la economía.

Deben poder consultarse de manera clara y separada de los NPCs y edificios.

No mezcles bienes y objetos con las otras categorías de inventario.

### 3.5. Inventario de edificios y propiedades

Debe existir un inventario independiente para edificios y propiedades.

Analiza el documento para determinar:
- Qué tipos de edificios existen.
- Qué propiedades pueden poseerse.
- Cómo se adquieren.
- Cómo se transfieren.
- Cómo se eliminan.
- Qué entidades pueden ser propietarias.
- Qué restricciones existen.

La interfaz debe permitir consultar las propiedades de cada entidad sin mezclarlas con NPCs ni bienes.

### 3.6. Sistema de las cinco escuelas y niveles de dominio

Quiero incorporar un sistema de progresión basado en las cinco escuelas del Roleplay.

El sistema debe representar los niveles de dominio alcanzados por cada usuario en las cinco escuelas.

Antes de implementarlo, identifica en el PDF:
- Los nombres exactos de las cinco escuelas.
- Los niveles de dominio existentes.
- Los requisitos para alcanzar cada nivel.
- Las restricciones de progresión.
- Las posibles relaciones entre escuelas.
- Las condiciones especiales.
- Los mecanismos de asignación o progresión.

Cada usuario debe poder consultar su progreso en las cinco escuelas.

La interfaz debe mostrar claramente:
- Nombre de cada escuela.
- Nivel de dominio alcanzado.
- Estado de progresión.
- Información relevante para comprender su situación.

No inventes niveles ni requisitos.

El sistema debe permitir futuras ampliaciones sin tener que reconstruir toda la arquitectura.

### 3.7. Sistema de conjuros desbloqueados por nivel de dominio

Los conjuros deben estar vinculados al sistema de las cinco escuelas.

Quiero que los usuarios puedan consultar los conjuros que tienen desbloqueados en función de su nivel de dominio.

El sistema debe:
- Mantener un catálogo de conjuros.
- Asociar cada conjuro con su escuela correspondiente.
- Registrar sus requisitos.
- Relacionar cada conjuro con el nivel de dominio necesario.
- Determinar qué conjuros tiene desbloqueados cada usuario.
- Permitir consultar los conjuros disponibles.
- Evitar desbloqueos indebidos.
- Mantener la coherencia cuando cambie el nivel de dominio de un usuario.

Es fundamental que el sistema no permita desbloquear conjuros que no correspondan al nivel de dominio alcanzado.

Analiza si el desbloqueo debe ser automático, calculado dinámicamente o registrado persistentemente, tomando la decisión a partir de las mecánicas y justificándola técnicamente.

No inventes efectos, costes, requisitos o comportamientos de los conjuros.

Si el PDF contiene información adicional sobre escuelas y conjuros, debe respetarse íntegramente.

---

## 4. DISEÑO DE LA EXPERIENCIA DE USUARIO

El bot debe ofrecer una interfaz clara, intuitiva y coherente.

Quiero que las funcionalidades estén organizadas en secciones diferenciadas:

1. Perfil.
2. Inventario de NPCs.
3. Inventario de bienes y objetos.
4. Inventario de edificios y propiedades.
5. Escuelas y niveles de dominio.
6. Conjuros desbloqueados.

Los perfiles y los sistemas de progresión deben poder consultarse fácilmente.

Los inventarios deben ser independientes.

Utiliza:
- Comandos slash.
- Embeds.
- Botones.
- Select menus.
- Paginación cuando sea necesaria.
- Respuestas privadas cuando corresponda.
- Confirmaciones para operaciones sensibles.
- Mensajes de error comprensibles.

No sobrecargues la interfaz con información innecesaria.

Prioriza una experiencia limpia y profesional.

---

## 5. ARQUITECTURA Y MODELO DE DATOS

Diseña una arquitectura modular.

Prioriza:
- Separación de responsabilidades.
- Bajo acoplamiento.
- Alta cohesión.
- Integridad de datos.
- Persistencia fiable.
- Facilidad de mantenimiento.
- Seguridad.
- Escalabilidad razonable.

Diseña las entidades y relaciones necesarias para:

- Usuarios de Discord.
- Perfiles.
- Estadísticas asignadas.
- Razas.
- Menhires.
- Relaciones entre usuarios.
- NPCs.
- Bienes y objetos.
- Edificios y propiedades.
- Cinco escuelas.
- Niveles de dominio.
- Catálogo de conjuros.
- Requisitos de desbloqueo.

Evalúa cuidadosamente qué información debe almacenarse y qué información puede derivarse de otras entidades.

Presta especial atención a:
- Relaciones entre usuarios.
- Integridad de los inventarios.
- Desbloqueos de conjuros.
- Persistencia de la progresión.
- Operaciones simultáneas.
- Prevención de duplicados.

No introduzcas tecnologías nuevas sin una justificación técnica.

---

## 6. ANÁLISIS DEL BOT ANTIGUO

Inspecciona el repositorio completo.

Identifica:
- Lenguaje.
- Framework.
- Estructura.
- Comandos.
- Base de datos.
- Dependencias.
- Servicios.
- Eventos.
- Sistemas de permisos.
- Mecánicas existentes.
- Código obsoleto.
- Deuda técnica.
- Vulnerabilidades.

Clasifica cada funcionalidad existente en:

1. Conservar.
2. Refactorizar.
3. Reimplementar.
4. Eliminar.

No asumas que la arquitectura antigua debe conservarse.

Puedes reconstruir módulos desde cero si resulta técnicamente conveniente, siempre que no pierdas funcionalidades válidas.

---

## 7. METODOLOGÍA DE DESARROLLO

### FASE 1 — Investigación

Analiza el repositorio y el PDF.

Entrega:
- Diagnóstico técnico.
- Análisis de mecánicas.
- Requisitos funcionales.
- Requisitos técnicos.
- Inventario de funcionalidades antiguas.
- Ambigüedades.
- Riesgos.

### FASE 2 — Diseño

Diseña:
- Arquitectura.
- Modelo de datos.
- Módulos.
- Servicios.
- Contratos.
- Interfaz de Discord.
- Relaciones entre perfiles.
- Sistema de inventarios.
- Progresión de escuelas.
- Desbloqueo de conjuros.

### FASE 3 — Planificación multiagente

Divide el desarrollo en tareas concretas.

Cada tarea debe especificar:
- Identificador.
- Objetivo.
- Agente.
- Archivos afectados.
- Dependencias.
- Resultado esperado.
- Criterios de aceptación.
- Pruebas.

Define qué agentes pueden trabajar en paralelo.

Evita conflictos de escritura.

### FASE 4 — Implementación

Los agentes Sonnet 5.5 desarrollarán sus módulos.

Opus supervisará:
- Arquitectura.
- Contratos.
- Integración.
- Coherencia funcional.
- Calidad.

### FASE 5 — Auditorías

Los agentes Opus revisarán los módulos independientemente.

Cada defecto deberá generar una tarea de corrección verificable.

### FASE 6 — Integración

Ejecuta pruebas unitarias, de integración, persistencia, permisos y regresión.

Comprueba especialmente:

- Coherencia entre perfiles.
- Relaciones entre usuarios.
- Inventarios independientes.
- Integridad de las propiedades.
- Progresión de las cinco escuelas.
- Desbloqueo correcto de conjuros.
- Eliminación completa del mapa.

### FASE 7 — Auditoría final

El auditor principal debe verificar que el resultado cumple todos los requisitos y que el bot puede ejecutarse correctamente.

---

## 8. RESTRICCIONES IMPORTANTES

1. No inventes mecánicas.
2. No añadas estadísticas o perfiles a los NPCs.
3. No permitas relaciones civiles con usuarios sin perfil válido.
4. No permitas relaciones unilaterales o inconsistentes.
5. No mezcles los inventarios.
6. No permitas desbloqueos ilegítimos de conjuros.
7. No inventes escuelas ni niveles de dominio.
8. No inventes razas ni menhires.
9. No conserves el mapa.
10. No elimines funcionalidades válidas del bot antiguo.
11. No introduzcas dependencias innecesarias.
12. No dejes implementaciones incompletas.
13. No des por válido código únicamente porque compile.
14. No modifiques credenciales ni secretos.
15. No realices operaciones destructivas sobre datos reales sin autorización.

---

## 9. ENTREGABLES

Al finalizar quiero:

- Bot reconstruido y funcional.
- Arquitectura documentada.
- Código organizado.
- Base de datos actualizada.
- Migraciones.
- Sistema de perfiles.
- Tres inventarios independientes.
- Sistema de cinco escuelas.
- Progresión de dominio.
- Sistema de conjuros desbloqueados.
- Comandos documentados.
- Guía de instalación y configuración.
- Tests automatizados.
- Informe de auditoría.
- Registro de decisiones arquitectónicas.
- Matriz de trazabilidad de mecánicas.

El README debe permitir que otra persona pueda instalar y ejecutar el bot sin necesitar explicaciones adicionales.

---

## 10. INSTRUCCIONES PARA EL MODO PLAN

IMPORTANTE: esta primera ejecución debe permanecer en MODO PLAN.

No modifiques todavía el código.

Primero debes analizar el proyecto antiguo y leer íntegramente `/PROMPT/El Tomegrama.pdf`.

Después, presenta un plan de ingeniería completo que incluya:

1. Diagnóstico del bot antiguo.
2. Análisis de todas las mecánicas.
3. Tabla de funcionalidades conservadas, modificadas, reconstruidas y eliminadas.
4. Arquitectura propuesta.
5. Modelo de datos.
6. Sistema de perfiles.
7. Gestión de relaciones entre usuarios.
8. Inventario de NPCs.
9. Inventario de bienes y objetos.
10. Inventario de edificios y propiedades.
11. Sistema de cinco escuelas.
12. Sistema de niveles de dominio.
13. Sistema de conjuros y desbloqueos.
14. Diseño de comandos e interfaces.
15. Estructura de directorios.
16. Distribución de tareas entre Sonnet 5.5.
17. Distribución de auditorías entre Opus 5.5.
18. Grafo de dependencias.
19. Estrategia de migración.
20. Plan de pruebas.
21. Riesgos técnicos.
22. Criterios de aceptación.

El plan debe ser suficientemente preciso para que la posterior ejecución pueda comenzar sin tener que rediseñar todo el proyecto.

No quiero una propuesta superficial.

Quiero un plan de ingeniería basado en el código real del repositorio y en las mecánicas concretas de El Tomegrama.pdf.

**OBJETIVO FINAL: reconstruir profesionalmente el bot de Roleplay, con perfiles, inventarios independientes, progresión mágica y conjuros desbloqueables, manteniendo la fidelidad absoluta a las mecánicas documentadas y utilizando una arquitectura multiagente supervisada y auditada.**