const UNARMED_PHRASES = {
  miss: [
    '{attacker} lanza un golpe contra {target}, pero no llega a conectar.',
    '{attacker} se abalanza sobre {target} cuerpo a cuerpo — {target} lo esquiva por poco.',
    '{attacker} intenta agarrar a {target}, sin éxito.',
  ],
  selfHarm: [
    '{attacker} arremete contra {target}, pierde el equilibrio y se hace daño con el propio impulso.',
    '{attacker} lanza un puñetazo a {target} que se le va completamente de las manos.',
    '{attacker} se lanza sobre {target}, tropieza y se lastima en el intento.',
  ],
  hit: [
    '{attacker} arremete contra {target} y conecta un golpe.',
    '{attacker} se lanza sobre {target} cuerpo a cuerpo y acierta.',
    '{attacker} golpea a {target} de lleno.',
  ],
  crit: [
    '{attacker} conecta un golpe brutal contra {target}.',
    '{attacker} derriba a {target} de un solo impacto.',
    '{attacker} descarga todo su peso sobre {target} con un golpe certero.',
  ],
};

const WEAPON_PHRASES = {
  miss: [
    '{attacker} ataca a {target} con {weapon}, pero falla.',
    '{attacker} apunta a {target} con {weapon} — el ataque se queda corto.',
    '{attacker} arremete contra {target} con {weapon}, sin acertar.',
  ],
  weaponBreak: [
    '{attacker} ataca a {target} con {weapon}, pero el arma falla en el peor momento.',
    '{attacker} intenta golpear a {target} con {weapon} — algo se rompe en el intento.',
  ],
  hit: [
    '{attacker} arremete contra {target} con {weapon} y conecta.',
    '{attacker} ataca a {target} con {weapon} — el golpe da en el blanco.',
    '{attacker} descarga {weapon} sobre {target}.',
  ],
  crit: [
    '{attacker} clava {weapon} en {target} con precisión letal.',
    '{attacker} conecta un golpe crítico con {weapon} contra {target}.',
    '{attacker} no le da ninguna opción a {target}: {weapon} acierta de lleno.',
  ],
};

function pick(bank) {
  return bank[Math.floor(Math.random() * bank.length)];
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

export function combatPhrase({ category, outcome, attacker, target, weapon }) {
  const bank = (category === 'unarmed' ? UNARMED_PHRASES : WEAPON_PHRASES)[outcome];
  if (!bank) return `${attacker} ataca a ${target}.`;
  return fill(pick(bank), { attacker, target, weapon });
}
