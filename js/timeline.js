/** Kordinatat kohore te tablatures dhe kufijte e sigurt te grupeve. */
export const PIXELS_PER_MS = 0.145;
export const MIN_GROUP_DISTANCE_MS = 80;
export function timelineGeometry(width) {
    const w = Math.max(300, width);
    const left = Math.min(128, Math.max(78, Math.round(w * .205)));
    const right = 14;
    return { left, right, scale: PIXELS_PER_MS, visibleMs: (w - left - right) / PIXELS_PER_MS, width: w };
}
export function timelineX(time, viewStart, left, scale = PIXELS_PER_MS) {
    return left + (time - viewStart) * scale;
}
export function timelineTime(x, viewStart, left, scale = PIXELS_PER_MS) {
    return viewStart + (x - left) / scale;
}
export function clampTimelineStart(desired, visibleMs, songEnd) {
    const max = Math.max(0, songEnd - visibleMs * .82);
    return Math.min(max, Math.max(0, Number.isFinite(desired) ? Math.round(desired) : 0));
}
export function clampGroupBoundary(groups, index, proposed, durationMs) {
    if (index <= 0 || index >= groups.length || !Number.isFinite(proposed))
        return null;
    const min = groups[index - 1].start + MIN_GROUP_DISTANCE_MS;
    const max = Math.min((groups[index + 1]?.start ?? Number.POSITIVE_INFINITY) - MIN_GROUP_DISTANCE_MS, Math.max(min, durationMs - MIN_GROUP_DISTANCE_MS));
    if (max < min)
        return null;
    return Math.min(max, Math.max(min, Math.round(proposed / 10) * 10));
}
export function findGroupBoundary(groups, x, viewStart, left, scale = PIXELS_PER_MS, thresholdPx = 17) {
    let closest = -1;
    let dist = thresholdPx;
    for (let i = 1; i < groups.length; i++) {
        const d = Math.abs(timelineX(groups[i].start, viewStart, left, scale) - x);
        if (d <= dist) {
            dist = d;
            closest = i;
        }
    }
    return closest;
}
