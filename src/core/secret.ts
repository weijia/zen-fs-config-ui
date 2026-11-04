/**
 * Mask a secret for display. Only the last four characters stay visible so
 * tokens are never rendered in clear text in the edit form.
 */
export function maskSecret(value: unknown): string {
  const text = value == null ? '' : String(value);
  if (!text) return '';
  if (text.length <= 4) return '••••';
  return `••••${text.slice(-4)}`;
}
