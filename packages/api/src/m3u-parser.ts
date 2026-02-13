import type { Channel } from "@lumen/types";

interface ExtInfMetadata {
  name: string;
  category: string;
  logo: string;
  id?: string;
  hasCatchUp: boolean;
}

const EXTINF_PREFIX = "#EXTINF:";

function parseExtInf(line: string): ExtInfMetadata {
  const raw = line.slice(EXTINF_PREFIX.length).trim();
  const commaIndex = raw.indexOf(",");
  const infoPart = commaIndex >= 0 ? raw.slice(0, commaIndex) : raw;
  const namePart = commaIndex >= 0 ? raw.slice(commaIndex + 1).trim() : "";

  const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null = null;
  while ((match = attrRegex.exec(infoPart)) !== null) {
    attrs[match[1].toLowerCase()] = match[2];
  }

  const catchupAttr =
    attrs["catchup"] ||
    attrs["catchup-source"] ||
    attrs["timeshift"] ||
    attrs["timeshift-source"];

  return {
    id: attrs["tvg-id"] || undefined,
    name: namePart || attrs["tvg-name"] || "Unknown Channel",
    category: attrs["group-title"] || "Uncategorized",
    logo: attrs["tvg-logo"] || "",
    hasCatchUp: Boolean(catchupAttr),
  };
}

function normalizeLine(line: string): string {
  return line.replace(/\r/g, "").trim();
}

export function parseM3U(content: string): Channel[] {
  const channels: Channel[] = [];
  const lines = content.split("\n").map(normalizeLine);

  let pendingMetadata: ExtInfMetadata | null = null;

  for (const line of lines) {
    if (!line) {
      continue;
    }

    if (line.startsWith("#")) {
      if (line.startsWith(EXTINF_PREFIX)) {
        pendingMetadata = parseExtInf(line);
      }
      continue;
    }

    const metadata =
      pendingMetadata ??
      ({
        name: `Channel ${channels.length + 1}`,
        category: "Uncategorized",
        logo: "",
        hasCatchUp: false,
      } satisfies ExtInfMetadata);

    const streamUrl = line;
    const fallbackId = `m3u-${channels.length + 1}`;

    channels.push({
      id: metadata.id || fallbackId,
      number: channels.length + 1,
      name: metadata.name,
      logo: metadata.logo,
      category: metadata.category,
      streamUrl,
      hasCatchUp: metadata.hasCatchUp,
      isFavorite: false,
      epg: [],
    });

    pendingMetadata = null;
  }

  return channels;
}
