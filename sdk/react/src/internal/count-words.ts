// How a count of people reads inside a sentence: spelled as a word from one
// to ten ("Its four people lose…", "The three people who joined…"), digits
// above ("Its 12 people…"), the way written English says a small number.
// Deleting a team and revoking an invite link say their counts this way.

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"] as const;

/** `n` as a word for zero to ten, as digits above ("four", "12"). */
export function countWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}
