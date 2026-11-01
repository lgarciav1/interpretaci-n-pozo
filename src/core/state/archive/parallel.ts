/** Hasta ocho blobs simultáneos; sin colas ilimitadas ni una tarea por curva en el hilo de UI. */
export async function mapArchive<T,R>(items: readonly T[], fn: (value: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length);
  let next = 0, failed = false;
  await Promise.all(Array.from({length: Math.min(8,items.length)}, async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try { result[i] = await fn(items[i]!); }
      catch (err) { failed = true; throw err; }
    }
  }));
  return result;
}
