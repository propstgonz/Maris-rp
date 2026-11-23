CREATE TABLE schools (
    id                 INT PRIMARY KEY AUTO_INCREMENT,
    slug               VARCHAR(32) NOT NULL UNIQUE,
    name               VARCHAR(64) NOT NULL,
    description        TEXT NOT NULL,
    secondary_stat     ENUM('potencia','intuicion','chiripa','autismo','resistencia','donjuanismo','agilidad') NOT NULL,
    secondary_divisor  TINYINT NOT NULL DEFAULT 1,
    is_active          TINYINT(1) NOT NULL DEFAULT 1,
    sort               TINYINT NOT NULL
);

CREATE TABLE mastery_levels (
    `rank`          TINYINT PRIMARY KEY,
    slug            VARCHAR(32) NOT NULL UNIQUE,
    name            VARCHAR(64) NOT NULL,
    threshold       DECIMAL(4,1) NOT NULL,
    requires_mentor TINYINT(1) NOT NULL
);

CREATE TABLE school_progress (
    player_id   INT NOT NULL,
    school_id   INT NOT NULL,
    level_rank  TINYINT NOT NULL DEFAULT 0 CHECK (level_rank BETWEEN 0 AND 5),
    retry_after DATETIME DEFAULT NULL,
    PRIMARY KEY (player_id, school_id),
    CONSTRAINT fk_school_progress_player FOREIGN KEY (player_id) REFERENCES players(id),
    CONSTRAINT fk_school_progress_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE magic_attempts (
    id                        INT PRIMARY KEY AUTO_INCREMENT,
    player_id                 INT NOT NULL,
    school_id                 INT NOT NULL,
    target_rank               TINYINT NOT NULL,
    mentor_player_id          INT DEFAULT NULL,
    mentor_label              VARCHAR(120) DEFAULT NULL,
    authorized_by_discord_id  VARCHAR(191) NOT NULL,
    roll                      TINYINT NOT NULL,
    modifier                  DECIMAL(5,1) NOT NULL,
    total                     DECIMAL(5,1) NOT NULL,
    threshold                 DECIMAL(4,1) NOT NULL,
    success                   TINYINT(1) NOT NULL,
    created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_magic_attempts_player FOREIGN KEY (player_id) REFERENCES players(id),
    CONSTRAINT fk_magic_attempts_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE spells (
    id             INT PRIMARY KEY AUTO_INCREMENT,
    school_id      INT NOT NULL,
    min_rank       TINYINT NOT NULL,
    name           VARCHAR(100) NOT NULL,
    cost_amount    DECIMAL(6,2) NOT NULL,
    cost_resource  ENUM('magia','vida') NOT NULL DEFAULT 'magia',
    description    TEXT NOT NULL,
    sort           SMALLINT NOT NULL,
    UNIQUE KEY uq_school_spell (school_id, name),
    CONSTRAINT fk_spells_school FOREIGN KEY (school_id) REFERENCES schools(id),
    CONSTRAINT fk_spells_min_rank FOREIGN KEY (min_rank) REFERENCES mastery_levels(`rank`)
);

INSERT INTO schools (slug, name, description, secondary_stat, secondary_divisor, is_active, sort) VALUES
    ('destruccion', 'Destrucción', 'La Escuela más usada y conocida, su nombre explica su utilidad y no es para menospreciarla, sus conjuros sirven tanto para la auto-defensa de los hechiceros como auténticas armas de asedio con Bolas de de Fuego, Tormentas de Relámpagos y auténticas Ventiscas, todas ellas responsables de miles de muertes en las manos expertas.', 'autismo', 2, 1, 1),
    ('alteracion', 'Alteración', 'La Alteración es una de las Escuelas más versátiles y por tanto útiles tanto dentro como fuera del combate, sus expertos son capaces de Transmutar objetos en Oro, iluminar espacios, respirar bajo el agua, paralizar individuos, manipular objetos con Telequinesis y fortalecer su piel como si fuera una auténtica armadura, más un largo etcétera… Sin embargo dominar esta Escuela es aún más arduo que sus hermanas.', 'intuicion', 1, 1, 2),
    ('restauracion', 'Restauración', 'La más apreciada entre el pueblo y los soldados, la Restauración destierra y erradica lo impío, sana al necesitado, desvía la magia agresiva… Dominar esta Escuela o siquiera empezarla convierte a cualquier de sus estudiosos en valiosísimos compañeros.', 'resistencia', 1, 1, 3),
    ('ilusion', 'Ilusión', 'De las 6 Escuelas la Ilusión es solamente para aquellos con la destreza de saber cuándo y cómo utilizarla, sus conjuros cambian la percepción de aquellos que les rodean y pueden servir tanto para dotarles de Valor, apaciguarlos con Calma, afligirles con Miedo o volverlos incontrolables con Furia… Los expertos de esta Escuela pueden incluso envolverse en Invisibilidad.', 'agilidad', 1, 1, 4),
    ('conjuracion', 'Conjuración', 'Por supuesto hemos de incluir a la infame y comúnmente llamada Escuela de Nigromancia, dominar la Conjuración otorga al hechicero la capacidad de reanimar a los muertos, invocar Atronach (Guardianes) o Familiares (Fantasmas Guardianes) e incluso la de invocar armas para sí mismo o los suyos… Sin embargo, utilizarla en público puede acarrear denuncias, multas, tiempos en prisión e incluso la muerte misma.', 'donjuanismo', 1, 1, 5),
    ('encantamiento', 'Encantamiento', 'Que se puede decir de esta Escuela, se trata de la menos conocida, recluida a habitaciones con runas y salas ocultas el Encantamiento tiene como único propósito la de enarbolar cualidades y mejoras en sortijas y equipamientos, haciéndolas ampliamente superiores… Las armas y armaduras de los Héroes y Heroínas Legendarias, tales como Ysgramor, son por lo general encantadas por maestros encantadores o mismamente por los Divinos.', 'potencia', 1, 0, 6);

INSERT INTO mastery_levels (`rank`, slug, name, threshold, requires_mentor) VALUES
    (1, 'principiante', 'Principiante', 19.0, 1),
    (2, 'aprendiz', 'Aprendiz', 19.0, 1),
    (3, 'habil', 'Hábil', 20.5, 1),
    (4, 'experto', 'Experto', 24.0, 1),
    (5, 'maestro', 'Maestro', 28.0, 1);

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Llamas', 10, 'magia', 'Ejerce 0,5 de Daño Elemental a 1 Casilla de Distancia. Los Daños Elementales pueden ser eficaces o no.', 1 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Chispas', 10, 'magia', 'Ejerce 0,5 de Daño Elemental a 1 Casilla de Distancia. Los Daños Elementales pueden ser eficaces o no.', 2 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Congelación', 10, 'magia', 'Ejerce 0,5 de Daño Elemental a 1 Casilla de Distancia. Los Daños Elementales pueden ser eficaces o no.', 3 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Proyectil Ígneo', 30, 'magia', 'Ejerce 1 de Daño Elemental a 2 Casillas de Distancia. Los Daños Elementales pueden ser eficaces o no.', 4 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Relámpago', 30, 'magia', 'Ejerce 1 de Daño Elemental a 2 Casillas de Distancia. Los Daños Elementales pueden ser eficaces o no.', 5 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Estaca de Hielo', 30, 'magia', 'Ejerce 1 de Daño Elemental a 2 Casillas de Distancia. Los Daños Elementales pueden ser eficaces o no.', 6 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Bola de Fuego', 60, 'magia', 'Ejerce 1 de Daño Elemental a 3 Casillas de Distancia con Efecto Cruceta. Los Daños Elementales pueden ser eficaces o no.', 7 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Relámpago Encadenado', 60, 'magia', 'Ejerce 1 de Daño Elemental a 3 Casillas de Distancia con Efecto Cruceta. Los Daños Elementales pueden ser eficaces o no.', 8 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Mini-Ventísca', 60, 'magia', 'Ejerce 1 de Daño Elemental a 3 Casillas de Distancia con Efecto Cruceta. Los Daños Elementales pueden ser eficaces o no.', 9 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Manto de Fuego', 160, 'magia', 'Ejerce 1 de Daño cada vez que alguien intenta o consigue atacar al usuario de manera cuerpo a cuerpo.', 10 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Manto de Escarcha', 160, 'magia', 'Ejerce 1 de Daño cada vez que alguien intenta o consigue atacar al usuario de manera cuerpo a cuerpo.', 11 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Manto de Relámpagos', 160, 'magia', 'Ejerce 1 de Daño cada vez que alguien intenta o consigue atacar al usuario de manera cuerpo a cuerpo.', 12 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Incinerar', 125, 'magia', 'Ejerce 3 de Daño Elemental a 2 Casillas de Distancia. Los Daños Elementales pueden ser eficaces o no.', 13 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Rayo', 125, 'magia', 'Ejerce 3 de Daño Elemental a 2 Casillas de Distancia. Los Daños Elementales pueden ser eficaces o no.', 14 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Lanza Helada', 125, 'magia', 'Ejerce 3 de Daño Elemental a 2 Casillas de Distancia. Los Daños Elementales pueden ser eficaces o no.', 15 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Muro de Llamas', 120, 'magia', 'Obstaculiza el paso de cualquier ente u objeto en una línea de 1 Casilla de largo. Los que crucen recibirán 2 de Daño Elemental.', 16 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Muro de Escarcha', 120, 'magia', 'Obstaculiza el paso de cualquier ente u objeto en una línea de 1 Casilla de largo. Los que crucen recibirán 2 de Daño Elemental.', 17 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Muro de Relámpagos', 120, 'magia', 'Obstaculiza el paso de cualquier ente u objeto en una línea de 1 Casilla de largo. Los que crucen recibirán 2 de Daño Elemental.', 18 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Tormenta de Fuego', 175, 'magia', 'Ejerce 4 de Daño Elemental a 4 Casillas de Distancia con Efecto Cruceta. Los Daños Elementales pueden ser eficaces o no.', 19 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Tormenta de Relámpagos', 175, 'magia', 'Ejerce 4 de Daño Elemental a 4 Casillas de Distancia con Efecto Cruceta. Los Daños Elementales pueden ser eficaces o no.', 20 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Ventísca', 175, 'magia', 'Ejerce 4 de Daño Elemental a 4 Casillas de Distancia con Efecto Cruceta. Los Daños Elementales pueden ser eficaces o no.', 21 FROM schools WHERE slug = 'destruccion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Luz de Vela', 10, 'magia', 'Crea una luz que ilumina sus alrededores, similar a una antorcha.', 1 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Piel Robliza', 25, 'magia', 'Reduce el Daño Físico que recibe en 0,25.', 2 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Equilibrio', 0.25, 'vida', 'Convierte la Vida consumida en 25 de Magia.', 3 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Luz de Mago', 20, 'magia', 'Crea una luz que ilumina toda la sala, cueva, habitación…', 4 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Piel Pétrea', 50, 'magia', 'Reduce el Daño Físico que recibe en 0,5.', 5 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Respiración Acuática', 60, 'magia', 'Posibilita al Usuario respirar bajo el agua.', 6 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Piel Férrea', 75, 'magia', 'Reduce el Daño Físico que recibe en 0,75.', 7 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Detectar Vida', 100, 'magia', 'Identificas incluso con obstáculos de por medio la presencia de entes vivos.', 8 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Telequinesia', 100, 'magia', 'Puede mover a distancia objetos o entes sin alma propia hasta 1 Casilla de distancia.', 9 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Paralizar', 140, 'magia', 'Paraliza a un ente 2 Turnos.', 10 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Piel de Ébano', 100, 'magia', 'Reduce el Daño Físico que recibe en 1.', 11 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Detectar Muerte', 100, 'magia', 'Identificas incluso con obstáculos de por medio la presencia de entes no vivos.', 12 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Parálisis Masivo', 200, 'magia', 'Paraliza a todo ente en un radio de 1 Casilla.', 13 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Piel de Dragón', 150, 'magia', 'Reduce el Daño Físico que recibe en 1,5.', 14 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Transmutar', 100, 'magia', 'Convierte en un determinado lapso de tiempo (1 Turno) entes u objetos en lo deseado.', 15 FROM schools WHERE slug = 'alteracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Curación', 25, 'magia', 'Cura al Usuario o al compañero adyacente 0,25 de Vida.', 1 FROM schools WHERE slug = 'restauracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Custodia Inferior', 25, 'magia', 'Reduce el Daño Mágico que recibe en 0,25.', 2 FROM schools WHERE slug = 'restauracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Curación Rápida', 50, 'magia', 'Cura al Usuario o al compañero adyacente 0,5 de Vida.', 3 FROM schools WHERE slug = 'restauracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Custodia Inquebrantable', 50, 'magia', 'Reduce el Daño Mágico que recibe en 0,5.', 4 FROM schools WHERE slug = 'restauracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Curación Nigromántica', 50, 'magia', 'Cura al Usuario Vampiro 0,5 de Vida, también válido para el compañero vampiro o no-muerto adyacente.', 5 FROM schools WHERE slug = 'restauracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Fuego Solar', 30, 'magia', 'Lanza un proyectil ardiente que provoca 1 de Daño Mágico a 2 Casillas de Distancia… Si el objetivo es un vampiro o no-muerto el Daño Mágico es el doble.', 6 FROM schools WHERE slug = 'restauracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Cerrar Heridas', 75, 'magia', 'Cura al Usuario o al compañero adyacente 1 de Vida.', 7 FROM schools WHERE slug = 'restauracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Custodia Superior', 75, 'magia', 'Reduce el Daño Mágico que recibe en 1.', 8 FROM schools WHERE slug = 'restauracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Aura de Stendarr', 120, 'magia', 'Ejerce una zona segura en 1 Casilla de radio en la cual todo no-muerto o vampiro recibe 2 de Daño Mágico por Turno.', 9 FROM schools WHERE slug = 'restauracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Expulsión de No-Muertos', 140, 'magia', 'Ejerce una zona de 2 Casillas de radio en la cual los No-Muertos son irrefrenablemente expulsados, sin capacidad de traspasar.', 10 FROM schools WHERE slug = 'restauracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Perdición de los No-Muertos', 175, 'magia', 'Convierte en ceniza toda invocación, todo no muerto y todo vampiro en una zona de 3 Casillas de radio.', 11 FROM schools WHERE slug = 'restauracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Valor', 40, 'magia', 'Obliga al objetivo a lanzar un D20, si su resultado es inferior a 5, se vuelve valiente y no huirá de ningún conflicto.', 1 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Furia', 60, 'magia', 'Obliga al objetivo a lanzar un D20, si su resultado es inferior a 5, se vuelve irascible y comenzará a atacar a cualquiera que tenga cerca.', 2 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Amortiguar', 100, 'magia', 'El Usuario o el compañero adyacente multiplica x2 su estadística de Agilidad.', 3 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Calma', 60, 'magia', 'Obliga al objetivo a lanzar un D20, si su resultado es inferior a 5, se vuelve manso y tranquilo.', 4 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Miedo', 80, 'magia', 'Obliga al objetivo a lanzar un D20, si su resultado es inferior a 5, se vuelve asustadizo y comenzará a huir.', 5 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Frenesí', 120, 'magia', 'Obliga al objetivo a lanzar un D20, si su resultado es inferior a 10, se vuelve irascible y comenzará a atacar a cualquiera que tenga cerca.', 6 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Valentía', 80, 'magia', 'Obliga al objetivo a lanzar un D20, si su resultado es inferior a 10, se vuelve valiente y no huirá de ningún conflicto.', 7 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Pacificar', 120, 'magia', 'Obliga al objetivo a lanzar un D20, si su resultado es inferior a 10, se vuelve manso y tranquilo.', 8 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Invisibilidad', 125, 'magia', 'Vuelve Invisible al Usuario o a un compañero durante 2 Turnos. Si interactúa de forma agresiva se desvanecerá la ilusión.', 9 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Derrota Aplastante', 140, 'magia', 'Obliga al objetivo a lanzar un D20, si su resultado es inferior a 10, se vuelve asustadizo y comenzará a huir.', 10 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Armonía', 150, 'magia', 'Obliga a los objetivos en un radio de 1 Casilla a lanzar un D20, si su resultado es inferior a 10, se vuelven mansos y tranquilos.', 11 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Llamada a las Armas', 150, 'magia', 'Obliga a los objetivos en un radio de 1 Casilla a lanzar un D20, si su resultado es inferior a 10, se vuelven valientes, moralizados y no huirán del combate.', 12 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Histeria', 175, 'magia', 'Obliga a los objetivos en un radio de 1 Casilla a lanzar un D20, si su resultado es inferior a 10, se vuelven irascibles y comenzarán a atacarse o atacar a cualquiera que tengan cerca.', 13 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Tumulto', 150, 'magia', 'Obliga a los objetivos en un radio de 1 Casilla a lanzar un D20, si su resultado es inferior a 10, se vuelven asustadizos y comenzarán a huir y correr de un lado a otro, lo más lejos del epicentro del hechizo posible.', 14 FROM schools WHERE slug = 'ilusion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Espada Vinculada', 40, 'magia', 'Invoca una Espada de Hierro Fantasmal que ignora las Armaduras, provocando 1 de Daño Mágico.', 1 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Conjurar Familiar', 60, 'magia', 'Invoca un lobo fantasma que lucha por ti, con 1 de Vida y 1 de Daño Base.', 2 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 1, 'Daga / Cuchillo Vinculado', 25, 'magia', 'Invoca una Daga de Hierro Fantasmal que ignora las Armaduras, provocando 0,5 de Daño Mágico, incluyendo el Efecto Furtivo.', 3 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Alzar No-Muerto', 80, 'magia', 'Alza un No-Muerto de los cadáveres que se puedan encontrar, haciendo que luche por ti con 2 de Vida y un Daño variable dependiendo del arma que tenía… En caso de no tener ninguna se le invocará una Espada Vinculada.', 4 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Trampa de Alma', 60, 'magia', 'Vincula el alma de un ente a una Gema de Alma y, una vez que muera el ente, su alma quedará atrapada en dicha gema.', 5 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Invocar Atronach de las Llamas', 80, 'magia', 'Invoca una fémina guardián de fuego que lucha por ti, lanzando Proyectil Ígneo y con 1 de Vida.', 6 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 2, 'Arco Vinculado', 50, 'magia', 'Invoca un Arco Fantasmal que ignora las Armaduras, provocando 0,5 de Daño Mágico, incluyendo el Efecto Furtivo.', 7 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Invocar Atronach de la Escarcha', 100, 'magia', 'Invoca un guardián de hielo que lucha por ti con 4 de Vida y propinando golpes de 1 de Daño.', 8 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Invocar Arvak', 80, 'magia', 'Invoca caballos fantasmales para una Unidad o para ti, sin embargo, solo se pueden invocar esa cantidad por lo que es imposible hacerlo para otras unidades o acumularlos.', 9 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 3, 'Espada de Alma Vinculada', 50, 'magia', 'Invoca una Espada de Hierro Fantasmal que ignora las Armaduras, provocando 1 de Daño Mágico. (Se puede aumentar el Daño Mágico aumentando el Coste del Magia, por cada 25 de Magia el Daño Mágico aumenta 0,25)', 10 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Invocar Atronach de la Tormenta', 120, 'magia', 'Invoca un guardián de rocas y electricidad que lucha por ti con 2 de Vida y lanzando Relámpago o propinando golpes de 1 de Daño.', 11 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 4, 'Alzar Bestia No-Muerta', 125, 'magia', 'Alza un No-Muerto de los cadáveres de bestias o monstruos que se puedan encontrar, haciendo que luche por ti… La vida y el daño dependerán de la bestia resucitada.', 12 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Invocar Dremora', 150, 'magia', 'Invoca un Señor de la Guerra Dremora de los Planos de Oblivion, con 5 de Vida, Armadura Daédrica y Mandoble Daédrico, propinando 1 de Daño Base + 2 de Daño por Equipamiento + Efecto Salvajismo… El daño que recibe se reduce en 2 Puntos.', 13 FROM schools WHERE slug = 'conjuracion';

INSERT INTO spells (school_id, min_rank, name, cost_amount, cost_resource, description, sort)
SELECT id, 5, 'Genoktonía', 175, 'magia', 'Alzas en un radio de 2 Casillas a todos los entes muertos que encuentres, luchando por ti… Un verdadero caos en las manos equivocadas.', 14 FROM schools WHERE slug = 'conjuracion';
