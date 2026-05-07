export const PRIMARY_SOURCE_KEY = "primary";

let externalNonce = 0;

export function nextExternalSourceKey(file: File): string {
  externalNonce += 1;
  return `ext:${file.name}:${file.size}:${externalNonce.toString(36)}`;
}
