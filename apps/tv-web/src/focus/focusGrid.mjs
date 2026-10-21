export function moveFocus(current, direction, items) {
  if (!items.length) return null;
  const origin = items.find((item) => item.id === current) || items[0];
  const candidates = items.filter((item) => {
    if (direction === "left") return item.col < origin.col;
    if (direction === "right") return item.col > origin.col;
    if (direction === "up") return item.row < origin.row;
    return item.row > origin.row;
  });
  if (!candidates.length) return origin.id;
  candidates.sort((a, b) => {
    const aPrimary = direction === "left" || direction === "right" ? Math.abs(a.col - origin.col) : Math.abs(a.row - origin.row);
    const bPrimary = direction === "left" || direction === "right" ? Math.abs(b.col - origin.col) : Math.abs(b.row - origin.row);
    const aSecondary = direction === "left" || direction === "right" ? Math.abs(a.row - origin.row) : Math.abs(a.col - origin.col);
    const bSecondary = direction === "left" || direction === "right" ? Math.abs(b.row - origin.row) : Math.abs(b.col - origin.col);
    return aPrimary - bPrimary || aSecondary - bSecondary;
  });
  return candidates[0].id;
}

export function remoteAction(key, keyCode) {
  if (key === "ArrowLeft" || keyCode === 37) return "left";
  if (key === "ArrowRight" || keyCode === 39) return "right";
  if (key === "ArrowUp" || keyCode === 38) return "up";
  if (key === "ArrowDown" || keyCode === 40) return "down";
  if (key === "Enter" || key === "Accept" || keyCode === 13) return "ok";
  if (["Escape", "Backspace", "BrowserBack", "GoBack"].includes(key) || [8, 27, 10009, 461].includes(keyCode)) return "back";
  return "";
}
