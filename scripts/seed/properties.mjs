const VIVIENDA = 'Acoge a 1.000 de Población. 1 Turno Económico. Admite niveles superiores multiplicando coste, población y Turnos Económicos.';
const FELICIDAD = '1 Turno Económico. El coste de Piedra puede sustituirse por Madera con consecuencias.';
const INFRA = '1 Turno Económico.';

export const PROPERTY_TYPES = [
  { name: 'madesovka', displayName: 'Madesovka', category: 'vivienda', description: `Coste: 4 de Madera. ${VIVIENDA}` },
  { name: 'patrovka', displayName: 'Patrovka', category: 'vivienda', description: `Coste: 4 de Piedra. ${VIVIENDA}` },
  { name: 'habitatge', displayName: 'Habitatge', category: 'vivienda', description: `Coste: 2 de Madera y 2 de Ladrillo. ${VIVIENDA}` },
  { name: 'ustasovka', displayName: 'Ustasovka', category: 'vivienda', description: `Coste: 2 de Madera y 2 de Piedra. ${VIVIENDA}` },

  { name: 'granja', displayName: 'Granja', category: 'ganaderia', description: null },
  { name: 'granja-pequena', displayName: 'Granja Pequeña', category: 'ganaderia', description: 'Coste: 4 de Madera y 1 de Piedra. Alberga 4 animales.' },
  { name: 'granja-grande', displayName: 'Granja Grande', category: 'ganaderia', description: 'Coste: 8 de Madera y 1 de Piedra. Alberga 8 animales.' },

  { name: 'puente-de-piedra', displayName: 'Puente de Piedra', category: 'infraestructura', description: `Coste: 10 de Piedra. ${INFRA}` },
  { name: 'calzada', displayName: 'Calzada', category: 'infraestructura', description: `Coste: 4 de Piedra por tramo (2 cuadrículas enteras). Anula los efectos negativos al paso y multiplica x2 la capacidad de movimiento. ${INFRA}` },
  { name: 'canal', displayName: 'Canal', category: 'infraestructura', description: `Coste: 20 de Piedra. Crea una ruta de agua. ${INFRA}` },
  { name: 'camino', displayName: 'Camino', category: 'infraestructura', description: 'Requiere una Pala. 2 Turnos Económicos por tramo (2 cuadrículas enteras). Anula los efectos negativos al paso en determinadas regiones.' },
  { name: 'muralla', displayName: 'Muralla', category: 'infraestructura', description: `Coste: 4 de Piedra por tramo (1 cuadrícula entera). ${INFRA}` },
  { name: 'puente-elevadizo', displayName: 'Puente Elevadizo', category: 'infraestructura', description: `Coste: 10 de Piedra, 2 de Madera y 0,5 de Hierro Fundido. ${INFRA}` },

  { name: 'casino', displayName: 'Casino', category: 'ocio', description: `Coste: 8 de Piedra. ${FELICIDAD}` },
  { name: 'bar', displayName: 'Bar', category: 'ocio', description: `Coste: 4 de Piedra. ${FELICIDAD}` },
  { name: 'burdel', displayName: 'Burdel', category: 'ocio', description: `Coste: 6 de Piedra. ${FELICIDAD}` },
  { name: 'hospital', displayName: 'Hospital', category: 'ocio', description: `Coste: 12 de Piedra. ${FELICIDAD}` },

  { name: 'taller-fabrica', displayName: 'Taller / Fábrica', category: 'produccion', description: 'Coste: 2 de Hierro Fundido, 4 de Piedra y 2 de Carbón. Capacidad de 2.000 Trabajadores. 1 Turno Económico.' },
  { name: 'fundidora', displayName: 'Fundidora', category: 'produccion', description: 'Coste: 5 de Piedra. Capacidad de 1.000 Trabajadores. 1 Turno Económico.' },
  { name: 'forja', displayName: 'Forja', category: 'produccion', description: 'Coste: 1 de Hierro Fundido, 2 de Piedra y 1 de Carbón. Capacidad de 1.000 Trabajadores. 1 Turno Económico.' },
  { name: 'parcela-de-cultivo', displayName: 'Parcela de Cultivo', category: 'produccion', description: 'Requiere una Azada y una unidad de semillas (1 de Trigo para 1 Semilla). Produce 0,5 de cultivo al turno sin herramienta. Capacidad de 500 Trabajadores. 1 Turno Económico.' },

  { name: 'mina', displayName: 'Mina', category: 'extraccion', description: 'Coste: 4 de Madera. Requiere prospección previa.' },

  { name: 'iglesia', displayName: 'Iglesia', category: 'religion', description: 'Coste: 10 de Piedra o Madera.' },
  { name: 'seminario', displayName: 'Seminario', category: 'religion', description: 'Coste: 8 de Piedra o Madera.' },
  { name: 'mision', displayName: 'Misión', category: 'religion', description: 'Coste: 6 de Piedra o Madera.' },

  { name: 'academia', displayName: 'Academia', category: 'educacion', description: 'Coste: 10 de Piedra o Madera. Forma nuevos Eruditos.' },
  { name: 'laboratorio', displayName: 'Laboratorio', category: 'educacion', description: 'Coste: 8 de Piedra o Madera. Permite seguir investigaciones avanzadas.' },

  { name: 'puerto', displayName: 'Puerto', category: 'naval', description: 'Coste: 3 de Madera y 5 de Piedra. Permite construir navíos.' },
  { name: 'barco', displayName: 'Barco', category: 'naval', description: 'Construido en Puerto: 10 de Madera. 8 de Vida. Transporta 2.500 Unidades.' },
  { name: 'galera', displayName: 'Galera', category: 'naval', description: 'Construida en Puerto: 10 de Madera. 6 de Vida. Transporta 1.000 Unidades.' },
  { name: 'buque', displayName: 'Buque', category: 'naval', description: 'Construido en Puerto: 18 de Madera. 10 de Vida. Transporta 4.000 Unidades. 2 Artefactos Pesados.' },

  { name: 'terreno', displayName: 'Terreno', category: 'terreno', description: null },
];
