export const GROUP_COLORS = ['#e8b45a', '#42bdae', '#b894f6', '#f08097', '#79aaf0', '#86c870', '#f2a36d', '#57cad4'];
export function detectNoteGroups(hits, minNotes = 3) {
    const sorted = [...new Set(hits.filter(h => Number.isFinite(h.time) && h.time >= 0)
            .map(h => Math.round(h.time)))].sort((a, b) => a - b);
    const groups = [{ start: 0, label: 'Grupi 1', color: GROUP_COLORS[0] }];
    if (sorted.length < minNotes * 2) return groups;
    const gaps = sorted.slice(1).map((v, i) => v - sorted[i]).filter(g => g >= 60 && g <= 1100).sort((a, b) => a - b);
    const typical = gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)] : 300;
    const threshold = Math.max(480, Math.min(1200, Math.round(typical * 1.85)));
    let startIndex = 0;
    for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i] - sorted[i - 1];
        const before = i - startIndex, after = sorted.length - i;
        if (gap >= threshold && before >= minNotes && after >= minNotes) {
            groups.push({ start: sorted[i], label: `Grupi ${groups.length + 1}`, color: GROUP_COLORS[groups.length % GROUP_COLORS.length] });
            startIndex = i;
        }
    }
    return groups;
}
export function groupAtTime(groups, time) {
    let index = 0;
    for (let i = 0; i < groups.length; i++) if (groups[i].start <= time) index = i; else break;
    return index;
}
