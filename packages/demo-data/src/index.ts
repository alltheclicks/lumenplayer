import type { Channel, Program } from "@lumen/types";

const generateEPG = (
  channelId: string,
  programs: string[],
  channelHasCatchUp: boolean,
): Program[] => {
  const epg: Program[] = [];
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 7);
  startDate.setHours(6, 0, 0, 0);

  let currentTime = new Date(startDate);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 1);

  while (currentTime < endDate) {
    const programIndex = Math.floor(Math.random() * programs.length);
    const duration = [30, 45, 60, 90, 120][Math.floor(Math.random() * 5)];
    const endTime = new Date(currentTime.getTime() + duration * 60000);

    epg.push({
      id: `${channelId}-${currentTime.getTime()}`,
      title: programs[programIndex],
      description: `Description for ${programs[programIndex]}.`,
      startTime: new Date(currentTime),
      endTime: endTime,
      category: "show",
      hasCatchUp: channelHasCatchUp && currentTime < now,
    });

    currentTime = endTime;
  }

  return epg;
};

const defaultPrograms = [
  "Morning Show",
  "News",
  "Movie",
  "Series",
  "Documentary",
  "Sports",
  "Music",
  "Evening News",
  "Talk Show",
  "Quiz",
  "Reality Show",
  "Comedy",
];

export const channels: Channel[] = [
  {
    id: "ch1",
    number: 1,
    name: "Channel 1",
    logo: "\u{1F4FA}",
    category: "general",
    hasCatchUp: true,
    isFavorite: false,
    epg: generateEPG("ch1", defaultPrograms, true),
  },
  {
    id: "ch2",
    number: 2,
    name: "Channel 2",
    logo: "\u{1F4FA}",
    category: "general",
    hasCatchUp: true,
    isFavorite: false,
    epg: generateEPG("ch2", defaultPrograms, true),
  },
  {
    id: "ch3",
    number: 3,
    name: "Sports Channel",
    logo: "\u26BD",
    category: "sports",
    hasCatchUp: false,
    isFavorite: false,
    epg: generateEPG(
      "ch3",
      ["Football", "Basketball", "Tennis", "Sports News"],
      false,
    ),
  },
  {
    id: "ch4",
    number: 4,
    name: "Movie Channel",
    logo: "\u{1F3AC}",
    category: "movies",
    hasCatchUp: true,
    isFavorite: false,
    epg: generateEPG(
      "ch4",
      ["Action Movie", "Comedy", "Drama", "Thriller"],
      true,
    ),
  },
  {
    id: "ch5",
    number: 5,
    name: "News 24",
    logo: "\u{1F4F0}",
    category: "news",
    hasCatchUp: true,
    isFavorite: false,
    epg: generateEPG(
      "ch5",
      ["Breaking News", "World News", "Local News", "Weather"],
      true,
    ),
  },
];

export { generateEPG, defaultPrograms };
