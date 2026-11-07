/** A precise tab click maps pixels to ms irrespective of live playback position. */
export function manualTapTime(isPlaying, playerMs, x, viewStartMs, left, scale, maxDurationMs) {
    const proposed = viewStartMs + (x - left) / scale;
    if (!Number.isFinite(proposed))
        return 0;
    return Math.max(0, Math.min(Math.max(0, maxDurationMs), Math.round(proposed)));
}
export function manualNote(n, time, withF = true, groupStart = 0) {
    if (!Number.isInteger(n) || n < 1 || n > 15 || !Number.isFinite(time) || time < 0)
        throw new Error('Nota ose koha nuk është e vlefshme.');
    return { time: Math.round(time), noteNumber: n, string: (n === 14 ? 2 : 1),
        confidence: 1, withF: n === 14 ? false : withF, groupStart, detail: 'Vendosur manualisht' };
}
