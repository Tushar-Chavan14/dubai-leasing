const hue = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

/** A stable 140-230 hue for a name (green through teal to slate blue). */
export const hueOf = (s: string) => 140 + (hue(s) % 90);

/** A generated placeholder (never a stock image): a gradient in the brand's green–slate range. */
export function placeholderStyle(seed: string) {
  const h = 140 + (hue(seed) % 90); // 140–230: green through teal to slate blue
  return {
    background: `radial-gradient(120% 90% at 85% 8%, hsl(${h + 25} 28% 62% / 0.55), transparent 60%), linear-gradient(165deg, hsl(${h} 30% 30%), hsl(${h + 20} 34% 14%))`,
  };
}
