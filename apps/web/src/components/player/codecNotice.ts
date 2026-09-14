export const resolveCodecNotice = (audio: string | null, video: string | null): string | null => {
  const messages = [];
  if (audio === 'mp2') messages.push('Zvuk nije dostupan: ovaj sadržaj koristi MP2 audio, koji web plejer ne podržava. Slika se reprodukuje bez zvuka.');
  if (video === 'hevc') messages.push('Ovaj sadržaj koristi HEVC (H.265) video. Ako nema slike, izaberite drugi kanal ili pokušajte na uređaju koji podržava taj format.');
  return messages.join(' ') || null;
};
