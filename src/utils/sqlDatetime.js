export function toSqlDatetime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function fromSqlDatetime(value) {
  if (value == null) return null;
  return new Date(`${value.replace(' ', 'T')}Z`);
}
