/** A text file imported whole, as Vite's `?raw` gives it (the start card reads the skill). */
declare module "*.md?raw" {
  const text: string;
  export default text;
}
