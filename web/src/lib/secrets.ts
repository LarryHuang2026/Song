const secrets = new Set<string>();
export function registerSecret(value: string) {
  if (value) secrets.add(value);
}
export function redactSecrets(value: string) {
  for (const key of [
    process.env.FLUXPORT_API_KEY,
    process.env.SUNO_API_KEY,
    ...secrets,
  ])
    if (key) value = value.split(key).join("[REDACTED]");
  return value;
}
