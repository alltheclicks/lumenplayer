declare module "mux.js" {
  export interface Mp4InspectorSample {
    duration?: number;
  }

  export interface Mp4InspectorBox {
    type: string;
    boxes?: Mp4InspectorBox[];
    trackId?: number;
    baseMediaDecodeTime?: number | bigint;
    samples?: Mp4InspectorSample[];
  }

  export interface Mp4TrackInfo {
    id: number;
    type: string;
    timescale: number;
  }

  export interface Mp4TransmuxedSegment {
    initSegment?: Uint8Array;
    data: Uint8Array;
    captions?: unknown[];
    metadata?: unknown[];
  }

  export interface Mp4Transmuxer {
    on(event: "data", listener: (segment: Mp4TransmuxedSegment) => void): void;
    on(event: "done", listener: () => void): void;
    on(event: "error", listener: (error: unknown) => void): void;
    off(event: "data", listener: (segment: Mp4TransmuxedSegment) => void): void;
    off(event: "done", listener: () => void): void;
    off(event: "error", listener: (error: unknown) => void): void;
    push(data: Uint8Array): void;
    flush(): void;
    setBaseMediaDecodeTime(baseMediaDecodeTime: number): void;
  }

  const muxjs: {
    mp4: {
      Transmuxer: new (options?: {
        baseMediaDecodeTime?: number;
        keepOriginalTimestamps?: boolean;
        remux?: boolean;
      }) => Mp4Transmuxer;
      probe: {
        tracks(data: Uint8Array): Mp4TrackInfo[];
      };
      tools: {
        inspect(data: Uint8Array): Mp4InspectorBox[];
      };
    };
  };

  export default muxjs;
}
