export const formatTime = (date: Date): string => {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

export const formatDate = (date: Date): string => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

export const formatDuration = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export const millisecondsToTime = (allMilliseconds: number): string => {
  const seconds = Math.floor((allMilliseconds / 1000) % 60);
  const minutes = Math.floor((allMilliseconds / (1000 * 60)) % 60);
  const hours = Math.floor((allMilliseconds / (1000 * 60 * 60)) % 24);

  const mm = minutes < 10 ? "0" + minutes : String(minutes);
  const ss = seconds < 10 ? "0" + seconds : String(seconds);

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};
