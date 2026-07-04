// Demo fixture — triggers unsafe-eval rule
export function runUserCode(source: string) {
  return eval(source);
}
