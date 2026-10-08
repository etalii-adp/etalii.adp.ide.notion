/**
 * Whether a path matches a glob of FBL 10.1 and 12.1: relative, `/`-separated; `*` within one path
 * segment, `**` any number of segments, `?` one character, `[…]` a character class.
 */
export function globMatches(glob: string, path: string, ignoreCase: boolean): boolean {
  try {
    return new RegExp(globExpression(glob), ignoreCase ? 'i' : '').test(path.replace(/\\/g, '/'));
  } catch {
    return false;
  }
}

/** A glob as an expression of the platform's own matcher; a glob is a binding's, and a path is short. */
function globExpression(glob: string): string {
  let expression = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      expression += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') {
      expression += '[^/]*';
    } else if (c === '?') {
      expression += '[^/]';
    } else if (c === '[') {
      const close = glob.indexOf(']', i + 2);
      if (close < 0) {
        expression += '\\[';
        continue;
      }
      let set = glob.slice(i + 1, close);
      if (set.startsWith('!')) set = `^${set.slice(1)}`;
      expression += `[${set.replace(/\\/g, '\\\\')}]`;
      i = close;
    } else {
      expression += c.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
    }
  }
  return `${expression}$`;
}
