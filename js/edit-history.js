/** Bounded, independent snapshots. Undo and redo never expose stored mutable objects. */
export class EditHistory {
    maxSteps;
    maxBytes;
    past = [];
    future = [];
    constructor(maxSteps = 50, maxBytes = 4 * 1024 * 1024) {
        this.maxSteps = maxSteps;
        this.maxBytes = maxBytes;
        if (!Number.isInteger(maxSteps) || maxSteps < 1 || !Number.isFinite(maxBytes) || maxBytes < 1)
            throw Error('Kufij historie të pavlefshëm.');
    }
    get undoCount() { return this.past.length; }
    get redoCount() { return this.future.length; }
    get undoLabel() { return this.past.at(-1)?.label ?? ''; }
    get redoLabel() { return this.future.at(-1)?.label ?? ''; }
    step(snapshot, label) {
        const copy = structuredClone(snapshot);
        return { snapshot: copy, label, bytes: JSON.stringify(copy).length * 2 };
    }
    trim() {
        const bytes = () => [...this.past, ...this.future].reduce((sum, step) => sum + step.bytes, 0);
        while (this.past.length + this.future.length > 1 &&
            (this.past.length + this.future.length > this.maxSteps || bytes() > this.maxBytes)) {
            if (this.past.length)
                this.past.shift();
            else
                this.future.shift();
        }
    }
    record(before, after, label) {
        if (before.song.id !== after.song.id)
            throw Error('Historiku duhet të mbetet brenda së njëjtës këngë.');
        if (JSON.stringify(before.song) === JSON.stringify(after.song))
            return false;
        this.past.push(this.step(before, label));
        this.future = [];
        this.trim();
        return true;
    }
    undo(current) {
        const step = this.past.pop();
        if (!step)
            return null;
        this.future.push(this.step(current, step.label));
        this.trim();
        return { snapshot: structuredClone(step.snapshot), label: step.label };
    }
    redo(current) {
        const step = this.future.pop();
        if (!step)
            return null;
        this.past.push(this.step(current, step.label));
        this.trim();
        return { snapshot: structuredClone(step.snapshot), label: step.label };
    }
}
