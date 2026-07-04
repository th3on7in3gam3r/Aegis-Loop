// Demo fixture — remediated: explicit handler map instead of dynamic eval
const HANDLERS: Record<string, () => string> = {
  ping: () => 'pong',
};

export function runUserCode(source: string) {
  const handler = HANDLERS[source.trim()];
  if (!handler) {
    throw new Error(`Unsupported handler: ${source}`);
  }
  return handler();
}
