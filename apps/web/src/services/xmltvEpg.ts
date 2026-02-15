import type { PlayerChannel, Program } from '@lumen/types';
import { getAppStorage } from '@/services/storage';
import { loadXtreamCredentials } from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';

const XMLTV_CACHE_KEY = 'xmltv_epg_cache';
const DEFAULT_XMLTV_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type SerializableProgram = Omit<Program, 'startTime' | 'endTime'> & {
  startTimeMs: number;
  endTimeMs: number;
};

type XMLTVProgramMap = Record<string, SerializableProgram[]>;

interface XMLTVCachePayload {
  signature: string;
  fetchedAt: number;
  programsByChannel: XMLTVProgramMap;
}

interface LoadXMLTVOptions {
  maxAgeMs?: number;
  forceRefresh?: boolean;
}

const normalizeKey = (value: string | null | undefined): string => {
  if (!value) {
    return '';
  }

  return value.trim().toLowerCase();
};

const buildSignature = (server: string, username: string): string => (
  `${server.trim().toLowerCase()}|${username.trim().toLowerCase()}`
);

const parseXMLTVDate = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/);
  if (!match) {
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return new Date(parsed);
  }

  const [, year, month, day, hour, minute, second, tz = '+0000'] = match;
  const tzHours = Number(tz.slice(0, 3));
  const tzMinutes = Number(tz.slice(0, 1) + tz.slice(3, 5));
  const utcTime = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );

  const offsetMs = (tzHours * 60 + tzMinutes) * 60_000;
  return new Date(utcTime - offsetMs);
};

const parseXMLTV = (xml: string): XMLTVProgramMap => {
  if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return {};
  }

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid XMLTV payload');
  }

  const programsByChannel = new Map<string, SerializableProgram[]>();
  const programmeNodes = Array.from(doc.querySelectorAll('programme'));
  const now = Date.now();

  programmeNodes.forEach((programmeNode, index) => {
    const channel = normalizeKey(programmeNode.getAttribute('channel'));
    const startTime = parseXMLTVDate(programmeNode.getAttribute('start'));
    const endTime = parseXMLTVDate(programmeNode.getAttribute('stop'));

    if (!channel || !startTime || !endTime || endTime <= startTime) {
      return;
    }

    const titleNode = programmeNode.querySelector('title');
    const descriptionNode = programmeNode.querySelector('desc');
    const categoryNode = programmeNode.querySelector('category');

    const title = titleNode?.textContent?.trim() || 'Untitled Program';
    const description = descriptionNode?.textContent?.trim() || '';
    const category = categoryNode?.textContent?.trim() || 'show';
    const startTimeMs = startTime.getTime();
    const endTimeMs = endTime.getTime();

    const item: SerializableProgram = {
      id: `${channel}-${startTimeMs}-${index}`,
      title,
      description,
      startTimeMs,
      endTimeMs,
      category,
      hasCatchUp: startTimeMs < now,
    };

    if (!programsByChannel.has(channel)) {
      programsByChannel.set(channel, []);
    }

    programsByChannel.get(channel)?.push(item);
  });

  const result: XMLTVProgramMap = {};
  programsByChannel.forEach((items, channelId) => {
    result[channelId] = items.sort((a, b) => a.startTimeMs - b.startTimeMs);
  });

  return result;
};

const toProgram = (item: SerializableProgram): Program => ({
  id: item.id,
  title: item.title,
  description: item.description,
  startTime: new Date(item.startTimeMs),
  endTime: new Date(item.endTimeMs),
  category: item.category,
  hasCatchUp: item.hasCatchUp,
});

const getCache = async (): Promise<XMLTVCachePayload | null> => {
  const storage = getAppStorage();
  if (!storage) {
    return null;
  }

  return storage.get<XMLTVCachePayload>(XMLTV_CACHE_KEY);
};

const setCache = async (payload: XMLTVCachePayload): Promise<void> => {
  const storage = getAppStorage();
  if (!storage) {
    return;
  }

  await storage.set(XMLTV_CACHE_KEY, payload);
};

export const clearXMLTVEPGCache = async (): Promise<void> => {
  const storage = getAppStorage();
  if (!storage) {
    return;
  }

  await storage.remove(XMLTV_CACHE_KEY);
};

export const loadXMLTVEPGMap = async (
  options: LoadXMLTVOptions = {}
): Promise<Record<string, Program[]> | null> => {
  const { maxAgeMs = DEFAULT_XMLTV_CACHE_TTL_MS, forceRefresh = false } = options;
  const credentials = await loadXtreamCredentials();
  if (
    !credentials ||
    credentials.username === 'demo' ||
    credentials.server.includes('your-server.com')
  ) {
    return null;
  }

  const signature = buildSignature(credentials.server, credentials.username);
  if (!forceRefresh) {
    const cache = await getCache();
    if (
      cache &&
      cache.signature === signature &&
      Date.now() - cache.fetchedAt < maxAgeMs
    ) {
      return Object.fromEntries(
        Object.entries(cache.programsByChannel).map(([channelId, programs]) => [
          channelId,
          programs.map(toProgram),
        ])
      );
    }
  }

  xtreamCodesService.setCredentials(credentials);
  const xmlPayload = await xtreamCodesService.getXMLTVEPG();
  const programsByChannel = parseXMLTV(xmlPayload);

  await setCache({
    signature,
    fetchedAt: Date.now(),
    programsByChannel,
  });

  return Object.fromEntries(
    Object.entries(programsByChannel).map(([channelId, programs]) => [
      channelId,
      programs.map(toProgram),
    ])
  );
};

export const resolveXMLTVProgramsForChannel = (
  channel: PlayerChannel,
  xmltvProgramsByChannel: Record<string, Program[]> | null | undefined
): Program[] | null => {
  if (!xmltvProgramsByChannel) {
    return null;
  }

  const directCandidates = [
    channel.epgChannelId,
    String(channel.streamId),
    channel.id,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeKey(candidate);
    if (normalized && xmltvProgramsByChannel[normalized]) {
      return xmltvProgramsByChannel[normalized];
    }
  }

  return null;
};

export const getXMLTVCacheTTL = (): number => DEFAULT_XMLTV_CACHE_TTL_MS;
