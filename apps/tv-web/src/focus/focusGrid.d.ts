export interface FocusItem {
  id: string;
  row: number;
  col: number;
}

export type RemoteAction = "left" | "right" | "up" | "down" | "ok" | "back" | "";
export function moveFocus(current: string, direction: "left" | "right" | "up" | "down", items: FocusItem[]): string | null;
export function remoteAction(key: string, keyCode: number): RemoteAction;
