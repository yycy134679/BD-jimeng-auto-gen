export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomBetween(min: number, max: number): number {
  const actualMin = Math.min(min, max);
  const actualMax = Math.max(min, max);
  return Math.floor(Math.random() * (actualMax - actualMin + 1)) + actualMin;
}
