/** Substitute `{{ path }}` in a command template, or append path if no template. */
export function substitutePathTemplate(command: string, path: string): string {
  if (command.includes('{{ path }}')) {
    return command.replace(/\{\{ path \}\}/g, `"${path}"`);
  }
  return `${command} "${path}"`;
}
