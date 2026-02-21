import { describe, expect, it } from "vitest";
import type { XtreamCategory, XtreamLiveStream } from "@lumen/types";
import { mapXtreamChannel } from "./mappers";

const categories: XtreamCategory[] = [
  { category_id: "1", category_name: "News", parent_id: 0 },
];

const createStream = (
  overrides: Partial<XtreamLiveStream> = {}
): XtreamLiveStream => ({
  num: 1,
  name: "Channel 1",
  stream_type: "live",
  stream_id: 11,
  stream_icon: "",
  epg_channel_id: null,
  added: "",
  category_id: "1",
  custom_sid: "",
  tv_archive: 0,
  direct_source: "",
  tv_archive_duration: 0,
  ...overrides,
});

describe("mapXtreamChannel", () => {
  it("accepts numeric-string catch-up flags from provider payloads", () => {
    const mapped = mapXtreamChannel(
      createStream({
        tv_archive: "1" as unknown as number,
        tv_archive_duration: "3" as unknown as number,
      }),
      0,
      categories
    );

    expect(mapped.hasCatchUp).toBe(true);
    expect(mapped.catchUpDays).toBe(3);
  });

  it("normalizes invalid catch-up duration values to zero", () => {
    const mapped = mapXtreamChannel(
      createStream({
        tv_archive: 1,
        tv_archive_duration: "not-a-number" as unknown as number,
      }),
      0,
      categories
    );

    expect(mapped.hasCatchUp).toBe(true);
    expect(mapped.catchUpDays).toBe(0);
  });
});
