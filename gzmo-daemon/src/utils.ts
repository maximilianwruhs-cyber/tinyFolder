export function isoDate(date = new Date()): string {
  return date.toISOString().split("T")[0]!;
}
