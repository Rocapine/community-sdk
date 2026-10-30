/** The letter an avatar shows without a photo: the name's first character
 * (a whole code point, so an emoji survives), upper-cased; "?" without a name. */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
}
