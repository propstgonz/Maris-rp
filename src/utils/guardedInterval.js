export function startGuardedInterval(task, intervalMs) {
  let busy = false;
  return setInterval(() => {
    if (busy) return;
    busy = true;
    Promise.resolve()
      .then(task)
      .catch(() => {})
      .finally(() => { busy = false; });
  }, intervalMs);
}
