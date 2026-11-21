var NOTE_NAMES = [
	"C-",
	"C#",
	"D-",
	"D#",
	"E-",
	"F-",
	"F#",
	"G-",
	"G#",
	"A-",
	"A#",
	"B-"
];
/** how long a line lasts with swing, as a factor (even lines longer, odd lines shorter; a pair stays the same) */
var swingFactor = (swing, line) => {
	const s = Math.max(0, Math.min(100, swing ?? 0)) / 300;
	return line % 2 === 0 ? 1 + s : 1 - s;
};
/**
* A chord turned over `k` times (1, 2, 3): its lowest note goes up an octave each time,
* then the whole is moved so the written note is still one of them. maj (+4 +7) once:
* -8 -5 (E G under the C: the third in the bass); twice: -5 +4 (G under, E over).
*/
function invertChord(notes, k) {
	let all = [{
		v: 0,
		root: true
	}, ...notes.map((v) => ({
		v,
		root: false
	}))].sort((a, b) => a.v - b.v);
	for (let i = 0; i < k; i++) {
		const [low, ...rest] = all;
		all = [...rest, {
			...low,
			v: low.v + 12
		}];
	}
	const root = all.find((x) => x.root).v;
	return all.filter((x) => !x.root).map((x) => x.v - root);
}
var ECHO_MAX_MS = 2e3;
/** an echo checked and clamped (from a file, a command) */
function cleanEcho(x) {
	const o = x && typeof x === "object" ? x : null;
	if (!o || o.type !== "normal" && o.type !== "cross") return void 0;
	const num = (v, d, lo, hi) => typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
	return {
		type: o.type,
		ms: num(o.ms, 250, 1, ECHO_MAX_MS),
		depth: num(o.depth, 2, 1, 6)
	};
}
/** our default chord table: 1–F in the chord column */
var DEFAULT_CHORDS = [
	{
		name: "maj",
		notes: [4, 7]
	},
	{
		name: "min",
		notes: [3, 7]
	},
	{
		name: "7",
		notes: [
			4,
			7,
			10
		]
	},
	{
		name: "m7",
		notes: [
			3,
			7,
			10
		]
	},
	{
		name: "maj7",
		notes: [
			4,
			7,
			11
		]
	},
	{
		name: "sus2",
		notes: [2, 7]
	},
	{
		name: "sus4",
		notes: [5, 7]
	},
	{
		name: "dim",
		notes: [3, 6]
	},
	{
		name: "aug",
		notes: [4, 8]
	},
	{
		name: "5",
		notes: [7]
	},
	{
		name: "6",
		notes: [
			4,
			7,
			9
		]
	},
	{
		name: "m6",
		notes: [
			3,
			7,
			9
		]
	},
	{
		name: "add9",
		notes: [
			4,
			7,
			14
		]
	},
	{
		name: "m9",
		notes: [
			3,
			7,
			10,
			14
		]
	},
	{
		name: "oct",
		notes: [12]
	}
];
var chordsOf = (s) => s.chords ?? DEFAULT_CHORDS;
/** the notes chord `n` (1–15) adds; none for 0 */
var chordNotes = (s, n) => n ? chordsOf(s)[n - 1]?.notes ?? [] : [];
/** our own instruments: computed, no sound data */
var computed = (i) => i?.kind === "analog" || i?.kind === "fm" || i?.kind === "drums" || i?.kind === "chip";
/** an instrument that makes sound (a sample with frames, or one of our synths) */
var playable = (i) => !!i && (computed(i) || i.kind !== "empty" && i.data.length > 0);
function emptyCell(pages = 1) {
	return {
		note: 0,
		inst: 0,
		cmd: new Array(pages).fill(0),
		val: new Array(pages).fill(0)
	};
}
function newBlock(tracks, lines = 64, pages = 1, name = "") {
	return {
		name,
		lines,
		pages,
		cells: Array.from({ length: lines }, () => Array.from({ length: tracks }, () => emptyCell(pages)))
	};
}
function emptyInstrument() {
	return {
		name: "",
		kind: "empty",
		data: /* @__PURE__ */ new Float32Array(0),
		bits16: false,
		loopStart: 0,
		loopLength: 0,
		pingPong: false,
		volume: 64,
		gain: 1,
		finetune: 0,
		transpose: 0,
		hold: 0,
		decay: 0
	};
}
/** A track's name as shown. */
var trackName = (s, t) => s.trackNames[t]?.trim() || `track ${t + 1}`;
function newSong(tracks = 8) {
	return {
		title: "",
		format: "MMD1",
		tracks,
		blocks: [newBlock(tracks)],
		sequence: [0],
		restart: 0,
		instruments: [],
		tempoMode: "bpm",
		tempo: 125,
		speed: 6,
		lpb: 4,
		transpose: 0,
		noteShift: 0,
		masterVolume: 64,
		trackVolume: new Array(tracks).fill(64),
		trackPan: amigaPan(tracks),
		trackNames: new Array(tracks).fill(""),
		flags: {
			volHex: true,
			vol7bit: false,
			ptSlides: false,
			eightChannel: false,
			hardwareMix: false,
			filter: false
		}
	};
}
/** The Amiga's voices: left, right, right, left (again for more tracks), not quite hard. */
function amigaPan(tracks, width = .6) {
	return Array.from({ length: tracks }, (_, i) => (i & 3) === 0 || (i & 3) === 3 ? -width : width);
}
/** "C-3", "D#1", "---", "^^^" (note off) */
function noteName(n) {
	if (!n) return "---";
	if (n === 128) return "^^^";
	const i = n - 1;
	return `${NOTE_NAMES[i % 12]}${Math.floor(i / 12) + 1}`.slice(0, 3);
}
var hex = (v, digits = 2) => v.toString(16).toUpperCase().padStart(digits, "0");
/** The Amiga's clock (PAL): a period of P plays PAULA_CLOCK / P frames a second. */
var PAULA_CLOCK = 3546895;
/**
* ProTracker's periods for finetune 0, C-1 … B-3 (its exact table; the
* other finetunes and the octaves past it follow the same curve).
*/
var PT_PERIODS = [
	856,
	808,
	762,
	720,
	678,
	640,
	604,
	570,
	538,
	508,
	480,
	453,
	428,
	404,
	381,
	360,
	339,
	320,
	302,
	285,
	269,
	254,
	240,
	226,
	214,
	202,
	190,
	180,
	170,
	160,
	151,
	143,
	135,
	127,
	120,
	113
];
/** The period of a note (0 = C-1, may be negative or past B-3) with a finetune -8…7. */
function periodOf(semi, finetune = 0) {
	if (finetune === 0 && semi >= 0 && semi < PT_PERIODS.length) return PT_PERIODS[semi];
	return 856 * Math.pow(2, -(semi + finetune / 8) / 12);
}
/** The note (0 = C-1) closest to a period — for a .mod's cells. */
function semiOfPeriod(period) {
	let best = 0;
	let dist = Infinity;
	for (let s = -24; s < 72; s++) {
		const d = Math.abs(periodOf(s) - period);
		if (d < dist) dist = d, best = s;
	}
	return best;
}
/** The tempo as ProTracker's BPM (ticks at BPM × 2 / 5 Hz). */
function ptBpmOf(mode, tempo, lpb, eightChannel = false, hardwareMix = true) {
	const t = Math.max(1, tempo);
	if (mode === "pt") return Math.max(32, Math.min(255, t));
	if (mode === "bpm" && !eightChannel) return t < 7 ? 111.5 : t * Math.max(1, lpb) / 4;
	if (eightChannel) return [
		179,
		164,
		152,
		141,
		131,
		123,
		116,
		110,
		104,
		99
	][Math.min(10, t) - 1];
	if (hardwareMix && t <= 10) return 10640682 / 14500 / t;
	if (!hardwareMix && t < 8) return 157.86;
	return t / .264;
}
// \0@oxc-project+runtime@0.156.0/helpers/esm/typeof.js
function _typeof(o) {
	"@babel/helpers - typeof";
	return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof(o);
}
// \0@oxc-project+runtime@0.156.0/helpers/esm/toPrimitive.js
function toPrimitive(t, r) {
	if ("object" != _typeof(t) || !t) return t;
	var e = t[Symbol.toPrimitive];
	if (void 0 !== e) {
		var i = e.call(t, r || "default");
		if ("object" != _typeof(i)) return i;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return ("string" === r ? String : Number)(t);
}
// \0@oxc-project+runtime@0.156.0/helpers/esm/toPropertyKey.js
function toPropertyKey(t) {
	var i = toPrimitive(t, "string");
	return "symbol" == _typeof(i) ? i : i + "";
}
// \0@oxc-project+runtime@0.156.0/helpers/esm/defineProperty.js
function _defineProperty(e, r, t) {
	return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
		value: t,
		enumerable: !0,
		configurable: !0,
		writable: !0
	}) : e[r] = t, e;
}
/** how many columns a cell has */
var colsOf = (pages) => 4 + 4 * pages;
/** what a column is: the note, the instrument, or a page's command / parameter (and which digit) */
function colKind(col) {
	if (col === 0) return { kind: "note" };
	if (col <= 2) return {
		kind: "inst",
		digit: col - 1
	};
	if (col === 3) return { kind: "chord" };
	const k = col - 4;
	const page = Math.floor(k / 4), r = k % 4;
	return {
		kind: r < 2 ? "cmd" : "val",
		page,
		digit: r % 2
	};
}
var clone = (c) => ({
	note: c.note,
	inst: c.inst,
	...c.chord ? { chord: c.chord } : {},
	cmd: [...c.cmd],
	val: [...c.val]
});
var cloneBlock = (b) => ({
	...b,
	cells: b.cells.map((row) => row.map(clone))
});
var setNibble = (v, digit, n) => digit === 0 ? (n & 15) << 4 | v & 15 : v & 240 | n & 15;
var Editor = class {
	constructor(song) {
		_defineProperty(this, "song", void 0);
		_defineProperty(this, "done", []);
		_defineProperty(this, "undone", []);
		_defineProperty(
			this,
			/** something changed (the title shows ●, `med save` clears it) */
			"dirty",
			false
		);
		_defineProperty(this, "onChange", void 0);
		_defineProperty(
			this,
			/** the clock merging uses (tests set it) */
			"now",
			() => Date.now()
		);
		this.song = song;
	}
	get canUndo() {
		return this.done.length > 0;
	}
	undo() {
		const s = this.done.pop();
		if (!s) return null;
		s.undo();
		this.undone.push(s);
		this.changed(s);
		return s.label;
	}
	redo() {
		const s = this.undone.pop();
		if (!s) return null;
		s.redo();
		s.at = 0;
		this.done.push(s);
		this.changed(s);
		return s.label;
	}
	changed(s) {
		if (!s?.view) this.dirty = true;
		this.onChange?.();
	}
	/** a change as a snapshot of what it touches, before and after */
	snap(label, take, put, fn, merge) {
		const before = take();
		fn();
		const after = take();
		this.record({
			label,
			undo: () => put(before),
			redo: () => put(after),
			merge
		});
	}
	/** change some cells of a block, undoably */
	cells(label, block, at, fn) {
		const b = this.song.blocks[block];
		if (!b) return;
		const spots = at.filter(([l, t]) => l >= 0 && l < b.lines && t >= 0 && t < this.song.tracks);
		if (!spots.length) return;
		const before = spots.map(([l, t]) => clone(b.cells[l][t]));
		for (const [l, t] of spots) fn(b.cells[l][t], l, t);
		const after = spots.map(([l, t]) => clone(b.cells[l][t]));
		const put = (cells) => spots.forEach(([l, t], i) => b.cells[l][t] = clone(cells[i]));
		this.record({
			label,
			undo: () => put(before),
			redo: () => put(after)
		});
	}
	/** change the song's shape (blocks, lines, the sequence, the tracks), undoably */
	shape(label, fn, merge) {
		const take = () => ({
			blocks: this.song.blocks.map(cloneBlock),
			sequence: [...this.song.sequence],
			tracks: this.song.tracks,
			vol: [...this.song.trackVolume],
			pan: [...this.song.trackPan],
			names: [...this.song.trackNames],
			strum: this.song.trackStrum ? [...this.song.trackStrum] : void 0,
			insts: [...this.song.instruments],
			chords: this.song.chords
		});
		const put = (s) => {
			this.song.blocks = s.blocks.map(cloneBlock);
			this.song.sequence = [...s.sequence];
			this.song.tracks = s.tracks;
			this.song.trackVolume = [...s.vol];
			this.song.trackPan = [...s.pan];
			this.song.trackNames = [...s.names];
			if (s.strum) this.song.trackStrum = [...s.strum];
			else delete this.song.trackStrum;
			this.song.instruments = [...s.insts];
			if (s.chords) this.song.chords = s.chords;
			else delete this.song.chords;
		};
		this.snap(label, take, put, fn, merge);
	}
	record(s) {
		const last = this.done[this.done.length - 1];
		const now = this.now();
		if (s.merge && last?.merge === s.merge && !this.undone.length && now - (last.at ?? 0) <= 1e3) {
			last.redo = s.redo;
			last.at = now;
			return this.changed(s);
		}
		s.at = now;
		this.done.push(s);
		if (this.done.length > 500) this.done.shift();
		this.undone = [];
		this.changed(s);
	}
	/**
	* A change the editor can't snapshot itself (the engine's mutes): `apply` does it,
	* `revert` takes it back. `view`: it changes only how the song plays here.
	*/
	act(label, apply, revert, o = {}) {
		apply();
		this.record({
			label,
			undo: revert,
			redo: apply,
			view: o.view
		});
	}
	/** the song's settings (tempo, speed, swing, echo, the LED filter, the title…), undoably; `merge`: a nudge */
	settings(label, fn, merge = false) {
		const s = this.song;
		const take = () => ({
			title: s.title,
			tempoMode: s.tempoMode,
			tempo: s.tempo,
			speed: s.speed,
			lpb: s.lpb,
			transpose: s.transpose,
			masterVolume: s.masterVolume,
			flags: { ...s.flags },
			chordColumn: s.chordColumn,
			echo: s.echo ? { ...s.echo } : void 0,
			swing: s.swing
		});
		const put = (v) => {
			Object.assign(s, {
				title: v.title,
				tempoMode: v.tempoMode,
				tempo: v.tempo,
				speed: v.speed,
				lpb: v.lpb,
				transpose: v.transpose,
				masterVolume: v.masterVolume,
				flags: { ...v.flags }
			});
			for (const k of ["chordColumn", "swing"]) v[k] === void 0 ? delete s[k] : s[k] = v[k];
			if (v.echo) s.echo = { ...v.echo };
			else delete s.echo;
		};
		this.snap(label, take, put, () => fn(s), merge ? `settings ${label}` : void 0);
	}
	/** a note (and the instrument, when one is given) */
	writeNote(block, line, track, note, inst = 0) {
		const n = note === 128 ? 128 : Math.max(1, Math.min(127, note));
		this.cells("note", block, [[line, track]], (c) => {
			c.note = n;
			if (inst && n !== 128) c.inst = inst;
		});
	}
	/** one hex digit in the instrument, a command or a parameter */
	writeHex(block, line, track, col, digit) {
		const k = colKind(col);
		if (k.kind === "note") return;
		this.cells("digit", block, [[line, track]], (c) => {
			if (k.kind === "inst") c.inst = Math.min(63, setNibble(c.inst, k.digit, digit));
			else if (k.kind === "chord") {
				if (digit) c.chord = digit & 15;
				else delete c.chord;
			} else {
				while (c.cmd.length <= k.page) c.cmd.push(0), c.val.push(0);
				if (k.kind === "cmd") c.cmd[k.page] = setNibble(c.cmd[k.page], k.digit, digit);
				else c.val[k.page] = setNibble(c.val[k.page], k.digit, digit);
			}
		});
	}
	/** empty what a column holds: the note (and its instrument), the instrument, or a page's command */
	clear(block, line, track, col) {
		const k = colKind(col);
		this.cells("clear", block, [[line, track]], (c) => {
			if (k.kind === "note") c.note = 0, c.inst = 0, delete c.chord;
			else if (k.kind === "inst") c.inst = 0;
			else if (k.kind === "chord") delete c.chord;
			else c.cmd[k.page] = 0, c.val[k.page] = 0;
		});
	}
	/** a selection's cells emptied */
	clearSelection(sel) {
		this.cells("clear", sel.block, spotsOf(sel), (c) => Object.assign(c, emptyCell(c.cmd.length)));
	}
	/** an empty line at `line` in these tracks: what's below moves down (the last line falls off) */
	insertLine(block, line, tracks) {
		const b = this.song.blocks[block];
		if (!b) return;
		const spots = [];
		for (let l = line; l < b.lines; l++) for (const t of tracks) spots.push([l, t]);
		const old = b.cells.map((r) => r.map(clone));
		this.cells("insert line", block, spots, (c, l, t) => Object.assign(c, l === line ? emptyCell(b.pages) : clone(old[l - 1][t])));
	}
	/** the line at `line` goes in these tracks: what's below moves up (an empty line comes in at the bottom) */
	deleteLine(block, line, tracks) {
		const b = this.song.blocks[block];
		if (!b) return;
		const spots = [];
		for (let l = line; l < b.lines; l++) for (const t of tracks) spots.push([l, t]);
		const old = b.cells.map((r) => r.map(clone));
		this.cells("delete line", block, spots, (c, l, t) => Object.assign(c, l === b.lines - 1 ? emptyCell(b.pages) : clone(old[l + 1][t])));
	}
	copy(sel) {
		const b = this.song.blocks[sel.block];
		const cells = [];
		for (let l = sel.line0; l <= sel.line1; l++) {
			const row = [];
			for (let t = sel.track0; t <= sel.track1; t++) row.push(clone(b?.cells[l]?.[t] ?? emptyCell()));
			cells.push(row);
		}
		return { cells };
	}
	cut(sel) {
		const clip = this.copy(sel);
		this.clearSelection(sel);
		return clip;
	}
	/** a clip's cells from (line, track): what doesn't fit is left out */
	paste(block, line, track, clip) {
		const spots = [];
		clip.cells.forEach((row, i) => row.forEach((_, j) => spots.push([line + i, track + j])));
		this.cells("paste", block, spots, (c, l, t) => {
			const src = clip.cells[l - line][t - track];
			c.note = src.note;
			c.inst = src.inst;
			for (let p = 0; p < Math.max(c.cmd.length, src.cmd.length); p++) {
				if (p >= c.cmd.length) break;
				c.cmd[p] = src.cmd[p] ?? 0;
				c.val[p] = src.val[p] ?? 0;
			}
		});
	}
	/** the notes of a selection, up or down (semitones); note offs and empty cells stay */
	transpose(sel, semis) {
		this.cells("transpose", sel.block, spotsOf(sel), (c) => {
			if (c.note && c.note !== 128) c.note = Math.max(1, Math.min(127, c.note + semis));
		});
	}
	/** a new empty block (returns its number) */
	newBlock(lines = 64) {
		let n = 0;
		this.shape("new block", () => {
			this.song.blocks.push(newBlock(this.song.tracks, Math.max(1, Math.min(3200, lines)), 1));
			n = this.song.blocks.length - 1;
		});
		return n;
	}
	/** a copy of a block (returns the new one's number) */
	cloneBlock(block) {
		let n = block;
		const b = this.song.blocks[block];
		if (!b) return n;
		this.shape("copy block", () => {
			this.song.blocks.push({
				...cloneBlock(b),
				name: b.name
			});
			n = this.song.blocks.length - 1;
		});
		return n;
	}
	/** a block's length in lines (1–3200): new lines are empty, cut ones go */
	setLines(block, lines) {
		const b = this.song.blocks[block];
		if (!b) return;
		const n = Math.max(1, Math.min(3200, Math.floor(lines)));
		this.shape("block length", () => {
			if (n < b.lines) b.cells.length = n;
			while (b.cells.length < n) b.cells.push(Array.from({ length: this.song.tracks }, () => emptyCell(b.pages)));
			b.lines = n;
		});
	}
	/** how many tracks every block has (1–16; a song read with more keeps what it has) */
	setTracks(n) {
		const tracks = Math.max(1, Math.min(Math.max(16, this.song.tracks), Math.floor(n)));
		this.shape("tracks", () => {
			for (const b of this.song.blocks) for (const row of b.cells) {
				if (row.length > tracks) row.length = tracks;
				while (row.length < tracks) row.push(emptyCell(b.pages));
			}
			const s = this.song;
			s.trackVolume = Array.from({ length: tracks }, (_, i) => s.trackVolume[i] ?? 64);
			s.trackPan = Array.from({ length: tracks }, (_, i) => s.trackPan[i] ?? ((i & 3) === 0 || (i & 3) === 3 ? -.6 : .6));
			s.trackNames = Array.from({ length: tracks }, (_, i) => s.trackNames[i] ?? "");
			if (s.trackStrum) s.trackStrum = Array.from({ length: tracks }, (_, i) => s.trackStrum[i] ?? 0);
			s.tracks = tracks;
		});
	}
	/** a track's name, volume (0–64), pan (-1…1) and chord strum (ms) */
	setTrack(track, what, merge = false) {
		if (track < 0 || track >= this.song.tracks) return;
		const s = this.song;
		const take = () => ({
			vol: [...s.trackVolume],
			pan: [...s.trackPan],
			names: [...s.trackNames],
			strum: s.trackStrum ? [...s.trackStrum] : void 0
		});
		const put = (v) => {
			s.trackVolume = [...v.vol];
			s.trackPan = [...v.pan];
			s.trackNames = [...v.names];
			if (v.strum) s.trackStrum = [...v.strum];
			else delete s.trackStrum;
		};
		this.snap("track", take, put, () => {
			if (what.name !== void 0) s.trackNames[track] = what.name.replace(/[\u0000-\u001f]/g, "").slice(0, 24);
			if (what.volume !== void 0) s.trackVolume[track] = Math.max(0, Math.min(64, Math.round(what.volume)));
			if (what.pan !== void 0) s.trackPan[track] = Math.max(-1, Math.min(1, what.pan));
			if (what.strum !== void 0) {
				s.trackStrum ??= new Array(s.tracks).fill(0);
				s.trackStrum[track] = Math.max(0, Math.min(200, Math.round(what.strum)));
				if (s.trackStrum.every((x) => !x)) delete s.trackStrum;
			}
		}, merge ? `track ${track} ${Object.keys(what).join(",")}` : void 0);
	}
	/**
	* Change an instrument (its sound, its loop, its settings), undoably: `fn` gets a copy
	* (the sound arrays are replaced, never changed in place, so ⌘Z brings the old ones back).
	*/
	instrument(index, label, fn, merge = false) {
		const old = this.song.instruments[index];
		if (!old) return;
		const take = () => this.song.instruments[index];
		const put = (v) => this.song.instruments[index] = v;
		this.snap(label, take, put, () => {
			const copy = { ...old };
			if (old.synth) copy.synth = structuredClone(old.synth);
			if (old.drums) copy.drums = structuredClone(old.drums);
			if (old.fm) copy.fm = structuredClone(old.fm);
			if (old.chip) copy.chip = structuredClone(old.chip);
			fn(copy);
			if (copy.loopStart + copy.loopLength > copy.data.length) copy.loopLength = Math.max(0, copy.data.length - copy.loopStart);
			if (copy.loopLength <= 2) copy.loopStart = 0, copy.loopLength = 0;
			if (!computed(copy)) copy.kind = copy.data.length ? copy.kind === "empty" ? "sample" : copy.kind : "empty";
			this.song.instruments[index] = copy;
		}, merge ? `instrument ${index} ${label}` : void 0);
	}
	/** put instruments in the first free slots (or at `at`): their numbers (0-based), as many as fit */
	addInstruments(list, at) {
		const placed = [];
		this.shape("instruments", () => {
			const s = this.song;
			for (const ins of list) {
				let i = at !== void 0 && placed.length === 0 ? at : s.instruments.findIndex((x, k) => x.kind === "empty" && !placed.includes(k));
				if (i < 0) i = s.instruments.length;
				if (i >= 63) break;
				while (s.instruments.length < i) s.instruments.push({
					...ins,
					name: "",
					kind: "empty",
					data: /* @__PURE__ */ new Float32Array(0),
					loopStart: 0,
					loopLength: 0
				});
				s.instruments[i] = ins;
				placed.push(i);
			}
		});
		return placed;
	}
	/** one line of the song's chord table (1–15), or the default table back (`def` null) */
	chords(n, def) {
		this.shape("chords", () => {
			const s = this.song;
			if (!def) return void delete s.chords;
			s.chords = (s.chords ?? DEFAULT_CHORDS).map((c) => ({
				name: c.name,
				notes: [...c.notes]
			}));
			s.chords[n - 1] = def;
		});
	}
	/** put a block in the sequence at `pos` (before what's there) */
	seqInsert(pos, block) {
		if (!this.song.blocks[block]) return;
		this.shape("sequence", () => this.song.sequence.splice(Math.max(0, Math.min(this.song.sequence.length, pos)), 0, block));
	}
	/** take a position out of the sequence (one always stays) */
	seqDelete(pos) {
		if (this.song.sequence.length <= 1 || pos < 0 || pos >= this.song.sequence.length) return;
		this.shape("sequence", () => this.song.sequence.splice(pos, 1));
	}
	/** which block a position plays */
	seqSet(pos, block) {
		if (!this.song.blocks[block] || pos < 0 || pos >= this.song.sequence.length) return;
		this.shape("sequence", () => this.song.sequence[pos] = block);
	}
};
function spotsOf(sel) {
	const out = [];
	for (let l = Math.min(sel.line0, sel.line1); l <= Math.max(sel.line0, sel.line1); l++) for (let t = Math.min(sel.track0, sel.track1); t <= Math.max(sel.track0, sel.track1); t++) out.push([l, t]);
	return out;
}
/** "C-3" "c#2" "D3" → the note number (1 = C-1), "^^^" / "off" → note off, "---" → 0; null when it isn't a note */
function parseNote(s) {
	const t = s.trim().toUpperCase();
	if (t === "---" || t === "0") return 0;
	if (t === "^^^" || t === "OFF") return 128;
	const m = /^([A-G])([#-]?)(\d)$/.exec(t);
	if (!m) return null;
	const base = {
		C: 0,
		D: 2,
		E: 4,
		F: 5,
		G: 7,
		A: 9,
		B: 11
	}[m[1]];
	const n = (+m[3] - 1) * 12 + base + (m[2] === "#" ? 1 : 0) + 1;
	return n >= 1 && n <= 127 ? n : null;
}
// src/keys.ts
/**
* The computer's keyboard as a piano, the way trackers have always done it:
* the bottom row (Z S X D C V G B H N J M) is an octave, the row above it
* (Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P) the next one and a bit. Read by the
* key's PLACE (KeyboardEvent.code), never its letter: on an AZERTY keyboard
* W X C… sit where Z X C… are on a QWERTY one, and play the same notes.
*/
var PIANO = {
	KeyZ: 0,
	KeyS: 1,
	KeyX: 2,
	KeyD: 3,
	KeyC: 4,
	KeyV: 5,
	KeyG: 6,
	KeyB: 7,
	KeyH: 8,
	KeyN: 9,
	KeyJ: 10,
	KeyM: 11,
	Comma: 12,
	KeyL: 13,
	Period: 14,
	Semicolon: 15,
	Slash: 16,
	KeyQ: 12,
	Digit2: 13,
	KeyW: 14,
	Digit3: 15,
	KeyE: 16,
	KeyR: 17,
	Digit5: 18,
	KeyT: 19,
	Digit6: 20,
	KeyY: 21,
	Digit7: 22,
	KeyU: 23,
	KeyI: 24,
	Digit9: 25,
	KeyO: 26,
	Digit0: 27,
	KeyP: 28,
	BracketLeft: 29,
	Equal: 30,
	BracketRight: 31
};
/** The semitone above the octave's C a key plays (0–31), or null for a key that isn't on the piano. */
function pianoKey(code) {
	return code in PIANO ? PIANO[code] : null;
}
// src/dsp/params.ts
/** a setting by its key, or its label, or the last part of its key ("cutoff", "reso"…) */
function findIn(table, name) {
	const n = name.toLowerCase();
	return table.find((x) => x.key === n) ?? table.find((x) => x.key.endsWith("." + n) || x.label === n) ?? table.find((x) => x.key.split(".").pop().startsWith(n) && n.length >= 3);
}
function getIn(p, key) {
	const [a, b] = key.split(".");
	const v = b ? p[a][b] : p[a];
	return typeof v === "number" || typeof v === "string" ? v : String(v);
}
/** A setting from text ("saw", "800", "1.5k") — checked and clamped. Throws on a bad value. */
function setIn(table, p, key, text) {
	const def = table.find((x) => x.key === key);
	if (!def) throw new Error(`no setting "${key}"`);
	let v;
	if (def.choices) {
		if (!def.choices.includes(text)) throw new Error(`${def.label}: ${def.choices.join(" | ")}`);
		v = def.numeric ? +text : text;
	} else {
		const m = /^(-?[\d.]+)(k?)$/i.exec(text.trim());
		const x = m ? parseFloat(m[1]) * (m[2] ? 1e3 : 1) : NaN;
		if (!Number.isFinite(x)) throw new Error(`${def.label}: a number, ${def.min}…${def.max}`);
		v = Math.max(def.min, Math.min(def.max, x));
	}
	const [a, b] = key.split(".");
	if (b) p[a][b] = v;
	else p[a] = v;
}
/** One step up or down (←→ on the screen): the next choice, or the next value. */
function nudgeIn(table, p, key, dir, big = false) {
	const def = table.find((x) => x.key === key);
	const cur = getIn(p, key);
	if (def.choices) {
		const i = def.choices.indexOf(String(cur));
		setIn(table, p, key, def.choices[(i + dir + def.choices.length) % def.choices.length]);
		return;
	}
	const x = Number(cur);
	const times = big ? 4 : 1;
	let next;
	if (def.log) next = x <= 0 ? dir > 0 ? .001 : 0 : x * def.step ** (dir * times);
	else next = Math.round((x + dir * def.step * times) / def.step) * def.step;
	if (def.log && next < .001 && dir < 0) next = def.min;
	setIn(table, p, key, String(+next.toPrecision(4)));
}
/** a setting as the screen shows it */
function showIn(p, def) {
	const v = getIn(p, def.key);
	if (typeof v === "string") return v + (def.unit ? ` ${def.unit}` : "");
	return (def.unit === "Hz" && v >= 1e3 ? `${+(v / 1e3).toFixed(2)}k` : def.unit === "s" && v < 1 ? `${Math.round(v * 1e3)} ms` : String(+v.toFixed(2))) + (def.unit && !(def.unit === "s" && v < 1) ? ` ${def.unit}` : "");
}
/** Settings read from a file onto `fresh` (the defaults): every value checked, anything wrong kept as it was. */
function sanitizeWith(table, fresh, j) {
	if (!j || typeof j !== "object") return fresh;
	for (const def of table) {
		const [a, b] = def.key.split(".");
		const o = j;
		const raw = b ? o[a]?.[b] : o[a];
		if (raw === void 0 || raw === null) continue;
		try {
			setIn(table, fresh, def.key, String(raw));
		} catch {}
	}
	return fresh;
}
// src/dsp/levels.ts
/**
* breakerMED — each preset's level (dB), so they all sound about as loud as each
* other (a hat as loud as a pad, by its loudest 100 ms). Measured by
* tests/levels.test.ts, which says what to put here when a preset changes.
*/
var PRESET_LEVELS = {
	"analog:bass": 1,
	"analog:acid": .5,
	"analog:lead": .5,
	"analog:pad": 5,
	"analog:pluck": 6,
	"analog:brass": 2.5,
	"analog:sine": 1,
	"fm:epiano": .5,
	"fm:bass": 1,
	"fm:brass": 1,
	"fm:organ": -2,
	"fm:pluck": .5,
	"fm:metal": .5,
	"fm:ym-bass": 1.5,
	"fm:ym-slap": -.5,
	"fm:ym-brass": 1.5,
	"fm:ym-lead": 2,
	"fm:ym-epiano": .5,
	"chip:2a03-lead": 1.5,
	"chip:2a03-lead12": 4,
	"chip:2a03-square": .5,
	"chip:2a03-bass": 5,
	"chip:2a03-arp": 4,
	"chip:2a03-pluck": 4,
	"chip:2a03-kick": 7.5,
	"chip:2a03-snare": 4,
	"chip:2a03-hat": 2,
	"chip:dmg-lead": .5,
	"chip:dmg-lead25": 2,
	"chip:dmg-sweep": 1.5,
	"chip:dmg-wave-bass": 2.5,
	"chip:dmg-wave-pad": 5.5,
	"chip:dmg-arp": 2,
	"chip:dmg-snare": 4.5,
	"chip:dmg-hat": 3,
	"chip:sid-pwm-lead": .5,
	"chip:sid-pwm-bass": 1.5,
	"chip:sid-saw-bass": 5,
	"chip:sid-sync-lead": 5.5,
	"chip:sid-ring-bell": 5.5,
	"chip:sid-arp": 1,
	"chip:sid-kick": 7.5,
	"chip:sid-snare": 9.5,
	"chip:ay-square": .5,
	"chip:ay-buzz-saw": 4.5,
	"chip:ay-buzz-tri": 4.5,
	"chip:ay-arp": .5,
	"chip:ay-kick": 5,
	"chip:ay-snare": 3.5,
	"chip:ay-hat": 2.5,
	"chip:psg-square": .5,
	"chip:psg-bass": 6.5,
	"chip:psg-arp": .5,
	"chip:psg-pluck": 2.5,
	"chip:psg-snare": 3.5,
	"chip:psg-hat": 3,
	"chip:pce-wave-lead": 6.5,
	"chip:pce-wave-bass": 2.5,
	"chip:pce-organ": 6,
	"chip:pce-pluck": 8,
	"chip:pce-arp": 5.5
};
// src/dsp/analog.ts
/**
* breakerMED — the analog synth (subtractive, the classic way: Moog, Juno,
* SH-101). Two oscillators and a sub → a filter (low / high / band-pass, 12 or
* 24 dB, resonance) → an amplifier; an envelope for each (ADSR), an LFO for the
* pitch, the filter or the pulse width, glide. Our own code: band-limited
* oscillators (polyBLEP) and a state-variable filter (TPT), cheap and stable.
*
* A note's pitch comes from the tracker like a sample's (a "rate"), so slides,
* vibrato and arpeggios work the same: C-3 is middle C (261.63 Hz).
*/
/** what a rate means for a synth: the tracker's C-3 rate is middle C */
var C3_RATE$2 = 3546895 / 214;
var C3_HZ = 261.6256;
function defaultAnalog() {
	return {
		level: 0,
		osc1: {
			wave: "saw",
			pw: .5,
			level: .8
		},
		osc2: {
			wave: "saw",
			pw: .5,
			level: 0,
			semi: 0,
			detune: 7
		},
		sub: 0,
		filter: {
			type: "lp",
			cutoff: 2e3,
			reso: .2,
			env: 2,
			keytrack: .5,
			slope: 12
		},
		amp: {
			a: .005,
			d: .2,
			s: .8,
			r: .2
		},
		fenv: {
			a: .005,
			d: .3,
			s: .3,
			r: .2
		},
		lfo: {
			wave: "sine",
			rate: 5,
			pitch: 0,
			cutoff: 0,
			pw: 0
		},
		glide: 0
	};
}
/** our own starting points */
var ANALOG_PRESETS = {
	bass: (p) => Object.assign(p, {
		osc1: {
			wave: "saw",
			pw: .5,
			level: .8
		},
		sub: .5,
		filter: {
			type: "lp",
			cutoff: 300,
			reso: .3,
			env: 3,
			keytrack: .3,
			slope: 24
		},
		amp: {
			a: .002,
			d: .3,
			s: .7,
			r: .1
		},
		fenv: {
			a: .002,
			d: .25,
			s: .1,
			r: .1
		}
	}),
	acid: (p) => Object.assign(p, {
		osc1: {
			wave: "saw",
			pw: .5,
			level: .9
		},
		filter: {
			type: "lp",
			cutoff: 350,
			reso: .85,
			env: 4,
			keytrack: .4,
			slope: 12
		},
		amp: {
			a: .002,
			d: .2,
			s: .8,
			r: .05
		},
		fenv: {
			a: .001,
			d: .18,
			s: 0,
			r: .05
		},
		glide: .06
	}),
	lead: (p) => Object.assign(p, {
		osc1: {
			wave: "square",
			pw: .35,
			level: .6
		},
		osc2: {
			wave: "saw",
			pw: .5,
			level: .5,
			semi: 0,
			detune: 9
		},
		filter: {
			type: "lp",
			cutoff: 2500,
			reso: .25,
			env: 1.5,
			keytrack: .6,
			slope: 12
		},
		lfo: {
			wave: "sine",
			rate: 5.5,
			pitch: .15,
			cutoff: 0,
			pw: .15
		},
		glide: .03
	}),
	pad: (p) => Object.assign(p, {
		osc1: {
			wave: "saw",
			pw: .5,
			level: .5
		},
		osc2: {
			wave: "saw",
			pw: .5,
			level: .5,
			semi: 0,
			detune: 14
		},
		filter: {
			type: "lp",
			cutoff: 1200,
			reso: .15,
			env: 1,
			keytrack: .5,
			slope: 12
		},
		amp: {
			a: .6,
			d: .5,
			s: .8,
			r: 1.2
		},
		fenv: {
			a: .8,
			d: 1,
			s: .5,
			r: 1
		},
		lfo: {
			wave: "triangle",
			rate: .4,
			pitch: 0,
			cutoff: .4,
			pw: 0
		}
	}),
	pluck: (p) => Object.assign(p, {
		osc1: {
			wave: "saw",
			pw: .5,
			level: .8
		},
		osc2: {
			wave: "square",
			pw: .5,
			level: .3,
			semi: 12,
			detune: 0
		},
		filter: {
			type: "lp",
			cutoff: 500,
			reso: .3,
			env: 4,
			keytrack: .6,
			slope: 12
		},
		amp: {
			a: .001,
			d: .35,
			s: 0,
			r: .2
		},
		fenv: {
			a: .001,
			d: .15,
			s: 0,
			r: .1
		}
	}),
	brass: (p) => Object.assign(p, {
		osc1: {
			wave: "saw",
			pw: .5,
			level: .6
		},
		osc2: {
			wave: "saw",
			pw: .5,
			level: .5,
			semi: 0,
			detune: 6
		},
		filter: {
			type: "lp",
			cutoff: 700,
			reso: .1,
			env: 2.5,
			keytrack: .5,
			slope: 12
		},
		amp: {
			a: .05,
			d: .3,
			s: .8,
			r: .25
		},
		fenv: {
			a: .08,
			d: .4,
			s: .5,
			r: .2
		}
	}),
	sine: (p) => Object.assign(p, {
		osc1: {
			wave: "sine",
			pw: .5,
			level: .9
		},
		filter: {
			type: "lp",
			cutoff: 18e3,
			reso: 0,
			env: 0,
			keytrack: 0,
			slope: 12
		},
		amp: {
			a: .01,
			d: .1,
			s: 1,
			r: .3
		}
	})
};
/** a fresh copy of a preset (or the default) */
function analogPreset(name) {
	const p = defaultAnalog();
	ANALOG_PRESETS[name ?? ""]?.(p);
	p.level = PRESET_LEVELS[`analog:${name ?? ""}`] ?? 0;
	return structuredClone(p);
}
/** a band-limiting correction at a waveform's jump (polyBLEP) */
function blep(t, dt) {
	if (t < dt) {
		const x = t / dt;
		return x + x - x * x - 1;
	}
	if (t > 1 - dt) {
		const x = (t - 1) / dt;
		return x * x + x + x + 1;
	}
	return 0;
}
function osc(wave, phase, dt, pw, noise) {
	switch (wave) {
		case "saw": return 2 * phase - 1 - blep(phase, dt);
		case "square": {
			let y = phase < pw ? 1 : -1;
			y += blep(phase, dt);
			y -= blep((phase - pw + 1) % 1, dt);
			return y;
		}
		case "triangle": return phase < .5 ? 4 * phase - 1 : 3 - 4 * phase;
		case "sine": return Math.sin(2 * Math.PI * phase);
		case "noise": return noise();
	}
}
/** an envelope's level after `t` seconds of the note (`releasedAt`: when the key went up, its level then) */
function adsr(e, t, released) {
	if (released) {
		const r = Math.max(.001, e.r);
		return Math.max(0, released.from * (1 - (t - released.at) / r));
	}
	const a = Math.max(5e-4, e.a);
	if (t < a) return t / a;
	const d = Math.max(5e-4, e.d);
	if (t < a + d) return 1 - (1 - e.s) * ((t - a) / d);
	return e.s;
}
var AnalogVoice = class {
	constructor(outRate) {
		_defineProperty(this, "outRate", void 0);
		_defineProperty(this, "on", false);
		_defineProperty(this, "rings", true);
		_defineProperty(this, "p", defaultAnalog());
		_defineProperty(this, "hz", C3_HZ);
		_defineProperty(this, "targetHz", C3_HZ);
		_defineProperty(this, "ph1", 0);
		_defineProperty(this, "ph2", 0);
		_defineProperty(this, "phSub", 0);
		_defineProperty(this, "lfoPh", 0);
		_defineProperty(this, "lfoHold", 0);
		_defineProperty(this, "t", 0);
		_defineProperty(this, "released", null);
		_defineProperty(this, "gl", 0);
		_defineProperty(this, "gr", 0);
		_defineProperty(this, "seed", 12345);
		_defineProperty(this, "s1", [0, 0]);
		_defineProperty(this, "s2", [0, 0]);
		_defineProperty(this, "noise", () => (this.seed = this.seed * 1103515245 + 12345 & 2147483647) / 1073741823 - 1);
		this.outRate = outRate;
	}
	start(n) {
		const glide = this.on && (n.instrument.synth?.glide ?? 0) > 0;
		this.p = n.instrument.synth ?? defaultAnalog();
		this.targetHz = n.rate / C3_RATE$2 * C3_HZ;
		if (!glide) this.hz = this.targetHz;
		this.t = 0;
		this.released = null;
		this.on = true;
	}
	/** the tracker's pitch (slides, vibrato, arpeggio), loudness and place */
	set(rate, volume, pan) {
		this.targetHz = Math.max(1, rate) / C3_RATE$2 * C3_HZ;
		if (!(this.p.glide > 0)) this.hz = this.targetHz;
		const v = Math.max(0, Math.min(1, volume)) * 10 ** ((this.p.level ?? 0) / 20);
		this.gl = v * Math.min(1, 1 - pan);
		this.gr = v * Math.min(1, 1 + pan);
	}
	/** the key goes up: the release phase (the voice ends when it's silent) */
	stop() {
		if (!this.on || this.released) return;
		this.released = {
			at: this.t,
			from: adsr(this.p.amp, this.t, null)
		};
	}
	/** right now, no release (a hard cut) */
	kill() {
		this.on = false;
	}
	render(left, right, from, to) {
		if (!this.on) return;
		const p = this.p;
		const sr = this.outRate;
		const dtSec = 1 / sr;
		const glideK = p.glide > 0 ? 1 - Math.exp(-dtSec / Math.max(.001, p.glide / 3)) : 1;
		let g = 0, k = 0, fcut = 0;
		for (let i = from; i < to; i++) {
			this.hz += (this.targetHz - this.hz) * glideK;
			this.lfoPh = (this.lfoPh + p.lfo.rate * dtSec) % 1;
			let lfo;
			switch (p.lfo.wave) {
				case "triangle":
					lfo = this.lfoPh < .5 ? 4 * this.lfoPh - 1 : 3 - 4 * this.lfoPh;
					break;
				case "square":
					lfo = this.lfoPh < .5 ? 1 : -1;
					break;
				case "saw":
					lfo = 2 * this.lfoPh - 1;
					break;
				case "random":
					if (this.lfoPh < p.lfo.rate * dtSec) this.lfoHold = this.noise();
					lfo = this.lfoHold;
					break;
				default: lfo = Math.sin(2 * Math.PI * this.lfoPh);
			}
			const hz = this.hz * 2 ** (lfo * p.lfo.pitch / 12);
			const dt1 = Math.min(.49, hz / sr);
			const dt2 = Math.min(.49, hz * 2 ** ((p.osc2.semi + p.osc2.detune / 100) / 12) / sr);
			const pw1 = Math.max(.05, Math.min(.95, p.osc1.pw + lfo * p.lfo.pw * .45));
			const pw2 = Math.max(.05, Math.min(.95, p.osc2.pw + lfo * p.lfo.pw * .45));
			let x = p.osc1.level ? osc(p.osc1.wave, this.ph1, dt1, pw1, this.noise) * p.osc1.level : 0;
			if (p.osc2.level) x += osc(p.osc2.wave, this.ph2, dt2, pw2, this.noise) * p.osc2.level;
			if (p.sub) x += osc("square", this.phSub, dt1 / 2, .5, this.noise) * p.sub;
			this.ph1 = (this.ph1 + dt1) % 1;
			this.ph2 = (this.ph2 + dt2) % 1;
			this.phSub = (this.phSub + dt1 / 2) % 1;
			if ((i - from) % 8 === 0) {
				const env = adsr(p.fenv, this.t, this.released ? {
					at: this.released.at,
					from: adsr(p.fenv, this.released.at, null)
				} : null);
				const key = Math.log2(hz / C3_HZ) * p.filter.keytrack;
				fcut = Math.max(20, Math.min(sr * .45, p.filter.cutoff * 2 ** (env * p.filter.env + key + lfo * p.lfo.cutoff)));
				g = Math.tan(Math.PI * fcut / sr);
				k = 2 - 2 * Math.min(.98, Math.max(0, p.filter.reso));
			}
			x = this.svf(this.s1, x, g, k, p.filter.type);
			if (p.filter.slope === 24) x = this.svf(this.s2, x, g, k, p.filter.type);
			const amp = adsr(p.amp, this.t, this.released);
			this.t += dtSec;
			if (this.released && amp <= 0 || !this.released && p.amp.s <= 0 && this.t > p.amp.a + p.amp.d) {
				this.on = false;
				return;
			}
			const y = x * amp * .5;
			left[i] += y * this.gl;
			right[i] += y * this.gr;
		}
	}
	/** one TPT state-variable filter step (Zavalishin): low, band or high-pass */
	svf(s, x, g, k, type) {
		const hp = (x - (k + g) * s[0] - s[1]) / (1 + g * (k + g));
		const bp = g * hp + s[0];
		const lp = g * bp + s[1];
		s[0] = g * hp + bp;
		s[1] = g * bp + lp;
		return type === "lp" ? lp : type === "hp" ? hp : bp;
	}
};
var WAVES = [
	"saw",
	"square",
	"triangle",
	"sine",
	"noise"
];
var ANALOG_PARAMS = [
	{
		key: "osc1.wave",
		label: "osc 1 wave",
		choices: WAVES
	},
	{
		key: "osc1.pw",
		label: "osc 1 width",
		min: .05,
		max: .95,
		step: .05
	},
	{
		key: "osc1.level",
		label: "osc 1 level",
		min: 0,
		max: 1,
		step: .05
	},
	{
		key: "osc2.wave",
		label: "osc 2 wave",
		choices: WAVES
	},
	{
		key: "osc2.pw",
		label: "osc 2 width",
		min: .05,
		max: .95,
		step: .05
	},
	{
		key: "osc2.level",
		label: "osc 2 level",
		min: 0,
		max: 1,
		step: .05
	},
	{
		key: "osc2.semi",
		label: "osc 2 semitones",
		min: -24,
		max: 24,
		step: 1
	},
	{
		key: "osc2.detune",
		label: "osc 2 detune",
		min: -50,
		max: 50,
		step: 1,
		unit: "ct"
	},
	{
		key: "sub",
		label: "sub (octave down)",
		min: 0,
		max: 1,
		step: .05
	},
	{
		key: "filter.type",
		label: "filter",
		choices: [
			"lp",
			"hp",
			"bp"
		]
	},
	{
		key: "filter.slope",
		label: "filter slope",
		choices: ["12", "24"],
		numeric: true,
		unit: "dB"
	},
	{
		key: "filter.cutoff",
		label: "cutoff",
		min: 20,
		max: 2e4,
		step: 1.12,
		log: true,
		unit: "Hz"
	},
	{
		key: "filter.reso",
		label: "resonance",
		min: 0,
		max: 1,
		step: .05
	},
	{
		key: "filter.env",
		label: "filter env amount",
		min: -8,
		max: 8,
		step: .25,
		unit: "oct"
	},
	{
		key: "filter.keytrack",
		label: "key tracking",
		min: 0,
		max: 1,
		step: .1
	},
	{
		key: "fenv.a",
		label: "filter attack",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "fenv.d",
		label: "filter decay",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "fenv.s",
		label: "filter sustain",
		min: 0,
		max: 1,
		step: .05
	},
	{
		key: "fenv.r",
		label: "filter release",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "amp.a",
		label: "attack",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "amp.d",
		label: "decay",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "amp.s",
		label: "sustain",
		min: 0,
		max: 1,
		step: .05
	},
	{
		key: "amp.r",
		label: "release",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "lfo.wave",
		label: "lfo wave",
		choices: [
			"sine",
			"triangle",
			"square",
			"saw",
			"random"
		]
	},
	{
		key: "lfo.rate",
		label: "lfo rate",
		min: .05,
		max: 40,
		step: 1.15,
		log: true,
		unit: "Hz"
	},
	{
		key: "lfo.pitch",
		label: "lfo → pitch",
		min: 0,
		max: 12,
		step: .05,
		unit: "st"
	},
	{
		key: "lfo.cutoff",
		label: "lfo → cutoff",
		min: 0,
		max: 4,
		step: .1,
		unit: "oct"
	},
	{
		key: "lfo.pw",
		label: "lfo → width",
		min: 0,
		max: 1,
		step: .05
	},
	{
		key: "glide",
		label: "glide",
		min: 0,
		max: 2,
		step: .01,
		unit: "s"
	},
	{
		key: "level",
		label: "level",
		min: -24,
		max: 12,
		step: .5,
		unit: "dB"
	}
];
/** Settings read from a file: every value checked, anything missing or wrong → the default. */
var sanitizeAnalog = (j) => sanitizeWith(ANALOG_PARAMS, defaultAnalog(), j);
// src/dsp/fm.ts
/**
* breakerMED — the FM synth, the basic kind: two sine waves, one (the
* modulator) bending the other's phase (the carrier), the way the 80s did
* electric pianos, bells and slap basses. The modulator runs at `ratio` × the
* note (whole ratios sound in tune, others clang), `index` says how far it bends
* (the brightness), its own envelope moves that over the note, and it can feed
* back on itself (from pure to noisy). Our own code.
*
* The pitch comes from the tracker like a sample's (a "rate"): C-3 is middle C.
*/
function defaultFm() {
	return {
		level: 0,
		ratio: 1,
		detune: 0,
		index: 2,
		feedback: 0,
		menv: {
			a: .002,
			d: .6,
			s: .3,
			r: .3
		},
		amp: {
			a: .003,
			d: 1,
			s: .6,
			r: .3
		},
		lfo: {
			rate: 5,
			pitch: 0
		}
	};
}
/** our own starting points */
var FM_PRESETS = {
	epiano: (p) => Object.assign(p, {
		ratio: 1,
		index: 1.8,
		detune: 3,
		menv: {
			a: .001,
			d: .9,
			s: .15,
			r: .3
		},
		amp: {
			a: .002,
			d: 1.8,
			s: .35,
			r: .4
		}
	}),
	bell: (p) => Object.assign(p, {
		ratio: 3.5,
		index: 3.5,
		menv: {
			a: .001,
			d: 2,
			s: .1,
			r: 1.5
		},
		amp: {
			a: .001,
			d: 3,
			s: 0,
			r: 2
		}
	}),
	bass: (p) => Object.assign(p, {
		ratio: 1,
		index: 3,
		feedback: .25,
		menv: {
			a: .001,
			d: .18,
			s: .15,
			r: .1
		},
		amp: {
			a: .002,
			d: .5,
			s: .7,
			r: .08
		}
	}),
	brass: (p) => Object.assign(p, {
		ratio: 1,
		index: 2.6,
		menv: {
			a: .07,
			d: .3,
			s: .65,
			r: .2
		},
		amp: {
			a: .04,
			d: .2,
			s: .85,
			r: .2
		},
		lfo: {
			rate: 5.5,
			pitch: .08
		}
	}),
	organ: (p) => Object.assign(p, {
		ratio: 2,
		index: .9,
		menv: {
			a: .005,
			d: .1,
			s: 1,
			r: .05
		},
		amp: {
			a: .008,
			d: .1,
			s: 1,
			r: .06
		}
	}),
	pluck: (p) => Object.assign(p, {
		ratio: 2,
		index: 3,
		menv: {
			a: .001,
			d: .12,
			s: 0,
			r: .1
		},
		amp: {
			a: .001,
			d: .6,
			s: 0,
			r: .2
		}
	}),
	metal: (p) => Object.assign(p, {
		ratio: 1.41,
		index: 5,
		feedback: .45,
		menv: {
			a: .001,
			d: 1.2,
			s: .3,
			r: .8
		},
		amp: {
			a: .001,
			d: 2,
			s: .2,
			r: 1
		}
	}),
	"ym-bass": (p) => Object.assign(p, {
		ratio: 1,
		index: 4.5,
		feedback: .35,
		menv: {
			a: .001,
			d: .12,
			s: .25,
			r: .06
		},
		amp: {
			a: .001,
			d: .4,
			s: .8,
			r: .05
		}
	}),
	"ym-slap": (p) => Object.assign(p, {
		ratio: 2,
		index: 6,
		feedback: .2,
		menv: {
			a: .001,
			d: .06,
			s: .1,
			r: .05
		},
		amp: {
			a: .001,
			d: .3,
			s: .5,
			r: .05
		}
	}),
	"ym-brass": (p) => Object.assign(p, {
		ratio: 1,
		index: 3.4,
		feedback: .3,
		menv: {
			a: .04,
			d: .25,
			s: .75,
			r: .15
		},
		amp: {
			a: .02,
			d: .2,
			s: .9,
			r: .15
		},
		lfo: {
			rate: 6,
			pitch: .1
		}
	}),
	"ym-lead": (p) => Object.assign(p, {
		ratio: 1,
		index: 2.2,
		feedback: .55,
		menv: {
			a: .005,
			d: .4,
			s: .6,
			r: .2
		},
		amp: {
			a: .003,
			d: .3,
			s: .85,
			r: .2
		},
		lfo: {
			rate: 5.5,
			pitch: .15
		}
	}),
	"ym-epiano": (p) => Object.assign(p, {
		ratio: 14,
		index: 1.2,
		menv: {
			a: .001,
			d: .25,
			s: 0,
			r: .2
		},
		amp: {
			a: .001,
			d: 1.5,
			s: .25,
			r: .4
		}
	}),
	"ym-bell": (p) => Object.assign(p, {
		ratio: 7,
		index: 2.8,
		menv: {
			a: .001,
			d: 1.5,
			s: .05,
			r: 1
		},
		amp: {
			a: .001,
			d: 2.5,
			s: 0,
			r: 1.5
		}
	})
};
function fmPreset(name) {
	const p = defaultFm();
	FM_PRESETS[name ?? ""]?.(p);
	p.level = PRESET_LEVELS[`fm:${name ?? ""}`] ?? 0;
	return structuredClone(p);
}
var FM_PARAMS = [
	{
		key: "ratio",
		label: "ratio",
		min: .25,
		max: 16,
		step: .25
	},
	{
		key: "detune",
		label: "detune",
		min: -100,
		max: 100,
		step: 1,
		unit: "ct"
	},
	{
		key: "index",
		label: "index (bright)",
		min: 0,
		max: 12,
		step: .1
	},
	{
		key: "feedback",
		label: "feedback",
		min: 0,
		max: 1,
		step: .05
	},
	{
		key: "menv.a",
		label: "mod attack",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "menv.d",
		label: "mod decay",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "menv.s",
		label: "mod sustain",
		min: 0,
		max: 1,
		step: .05
	},
	{
		key: "menv.r",
		label: "mod release",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "amp.a",
		label: "attack",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "amp.d",
		label: "decay",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "amp.s",
		label: "sustain",
		min: 0,
		max: 1,
		step: .05
	},
	{
		key: "amp.r",
		label: "release",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "lfo.rate",
		label: "lfo rate",
		min: .05,
		max: 40,
		step: 1.15,
		log: true,
		unit: "Hz"
	},
	{
		key: "lfo.pitch",
		label: "lfo → pitch",
		min: 0,
		max: 12,
		step: .05,
		unit: "st"
	},
	{
		key: "level",
		label: "level",
		min: -24,
		max: 12,
		step: .5,
		unit: "dB"
	}
];
var sanitizeFm = (j) => sanitizeWith(FM_PARAMS, defaultFm(), j);
var TAU$1 = 2 * Math.PI;
var FmVoice = class {
	constructor(sr) {
		_defineProperty(this, "sr", void 0);
		_defineProperty(this, "on", false);
		_defineProperty(this, "rings", true);
		_defineProperty(this, "p", defaultFm());
		_defineProperty(this, "hz", C3_HZ);
		_defineProperty(this, "pc", 0);
		_defineProperty(this, "pm", 0);
		_defineProperty(this, "lfoPh", 0);
		_defineProperty(
			this,
			/** the modulator's last two outputs (feedback averages them: steadier) */
			"m1",
			0
		);
		_defineProperty(this, "m2", 0);
		_defineProperty(this, "t", 0);
		_defineProperty(this, "released", null);
		_defineProperty(this, "gl", 0);
		_defineProperty(this, "gr", 0);
		this.sr = sr;
	}
	start(n) {
		this.p = n.instrument.fm ?? defaultFm();
		this.hz = n.rate / C3_RATE$2 * C3_HZ;
		this.pc = this.pm = 0;
		this.m1 = this.m2 = 0;
		this.t = 0;
		this.released = null;
		this.on = true;
	}
	set(rate, volume, pan) {
		this.hz = Math.max(1, rate) / C3_RATE$2 * C3_HZ;
		const v = Math.max(0, Math.min(1, volume)) * 10 ** ((this.p.level ?? 0) / 20);
		this.gl = v * Math.min(1, 1 - pan);
		this.gr = v * Math.min(1, 1 + pan);
	}
	stop() {
		if (!this.on || this.released) return;
		this.released = {
			at: this.t,
			amp: adsr(this.p.amp, this.t, null),
			mod: adsr(this.p.menv, this.t, null)
		};
	}
	render(left, right, from, to) {
		if (!this.on) return;
		const p = this.p, dt = 1 / this.sr;
		const modRatio = p.ratio * 2 ** (p.detune / 1200);
		const fb = p.feedback * Math.PI;
		for (let i = from; i < to; i++) {
			this.lfoPh = (this.lfoPh + p.lfo.rate * dt) % 1;
			const hz = p.lfo.pitch ? this.hz * 2 ** (Math.sin(TAU$1 * this.lfoPh) * p.lfo.pitch / 12) : this.hz;
			const r = this.released;
			const amp = adsr(p.amp, this.t, r && {
				at: r.at,
				from: r.amp
			});
			const idx = p.index * adsr(p.menv, this.t, r && {
				at: r.at,
				from: r.mod
			});
			const m = Math.sin(TAU$1 * this.pm + fb * (this.m1 + this.m2) * .5);
			this.m2 = this.m1;
			this.m1 = m;
			const y = Math.sin(TAU$1 * this.pc + idx * m) * amp;
			this.pc = (this.pc + hz * dt) % 1;
			this.pm = (this.pm + hz * modRatio * dt) % 1;
			this.t += dt;
			if (r && amp <= 0 || !r && p.amp.s <= 0 && this.t > p.amp.a + p.amp.d) {
				this.on = false;
				return;
			}
			left[i] += y * .5 * this.gl;
			right[i] += y * .5 * this.gr;
		}
	}
};
// src/dsp/chip.ts
/**
* BreakerMED — CHIP: the sound chips of old consoles and home computers, for
* chiptune. One instrument, a mode per chip; everything is computed here from
* how the chips worked (their clocks, period registers, DACs, noise shift
* registers) — no sample or ROM taken from any machine. Our own code.
*
*   2a03   (NES-style)            pulse 12.5 / 25 / 50 / 75 %, a 4-bit stepped triangle,
*                                 noise from a 15-bit LFSR, long or short (metallic)
*   dmg    (Game Boy-style)       pulse, a 32-step 4-bit wave channel, 15/7-bit noise
*   sid    (C64-style)            saw, triangle, pulse of any width (and its sweep),
*                                 ring mod and hard sync, a LP / BP / HP filter
*   ay     (ZX / MSX / ST-style)  square, noise, and the envelope "buzzer"
*   psg    (SN76489, Master System-style)  square, white or periodic noise
*   pce    (PC Engine-style)      a 32-step 5-bit wavetable
*
* What makes them sound like chips: the pitch snaps to each chip's period grid
* (high notes go a little out of tune, like on the real thing), the volume moves
* in 16 steps (SID: 256), the waves come out of a few-bit DAC. Plus what chiptune
* musicians did by hand: an automatic vibrato (after a delay), a pitch sweep
* (kicks, lasers), a pulse-width sweep, and chords played as a fast arpeggio.
*
* The pitch comes from the tracker like a sample's (a "rate"): C-3 is middle C.
*/
var CHIPS = [
	"2a03",
	"dmg",
	"sid",
	"ay",
	"psg",
	"pce"
];
var CHIP_WAVES = [
	"pulse",
	"triangle",
	"saw",
	"noise",
	"wave",
	"buzz-saw",
	"buzz-tri",
	"tone+noise"
];
/** the wavetables (for "wave"): ours, 32 steps; "custom" is the instrument's own */
var TABLE_NAMES = [
	"sine",
	"saw",
	"square",
	"organ",
	"bass",
	"pluck",
	"vox",
	"custom"
];
/** what each chip is called in the help (the console it's like) */
var CHIP_LIKE = {
	"2a03": "NES-style",
	dmg: "Game Boy-style",
	sid: "C64-style",
	ay: "ZX Spectrum / MSX / Atari ST-style",
	psg: "SN76489, Master System-style",
	pce: "PC Engine-style"
};
function defaultChip() {
	return {
		level: 0,
		chip: "2a03",
		wave: "pulse",
		duty: .5,
		noise: "long",
		table: "sine",
		amp: {
			a: 0,
			d: .3,
			s: .8,
			r: .08
		},
		vib: {
			depth: 0,
			rate: 6,
			delay: .2
		},
		sweep: 0,
		arp: 0,
		pwm: {
			depth: 0,
			rate: 1
		},
		ring: 0,
		sync: 0,
		filter: {
			type: "off",
			cutoff: 2e3,
			reso: .3
		}
	};
}
var pre = (o) => (p) => {
	const { amp, vib, pwm, filter, ...rest } = o;
	Object.assign(p, rest);
	if (amp) Object.assign(p.amp, amp);
	if (vib) Object.assign(p.vib, vib);
	if (pwm) Object.assign(p.pwm, pwm);
	if (filter) Object.assign(p.filter, filter);
};
/** our own presets, named by the chip (the console it's like is in the help) */
var CHIP_PRESETS = {
	"2a03-lead": pre({
		chip: "2a03",
		wave: "pulse",
		duty: .25,
		amp: {
			d: .5,
			s: .7
		},
		vib: {
			depth: .25,
			rate: 6,
			delay: .25
		}
	}),
	"2a03-lead12": pre({
		chip: "2a03",
		wave: "pulse",
		duty: .125,
		amp: {
			d: .4,
			s: .6
		},
		vib: {
			depth: .2,
			rate: 6,
			delay: .3
		}
	}),
	"2a03-square": pre({
		chip: "2a03",
		wave: "pulse",
		duty: .5,
		amp: {
			d: .2,
			s: .75
		}
	}),
	"2a03-bass": pre({
		chip: "2a03",
		wave: "triangle",
		amp: {
			d: .1,
			s: 1,
			r: .02
		}
	}),
	"2a03-arp": pre({
		chip: "2a03",
		wave: "pulse",
		duty: .125,
		arp: 50,
		amp: {
			d: .3,
			s: .6
		}
	}),
	"2a03-pluck": pre({
		chip: "2a03",
		wave: "pulse",
		duty: .25,
		amp: {
			d: .18,
			s: 0,
			r: .05
		}
	}),
	"2a03-kick": pre({
		chip: "2a03",
		wave: "triangle",
		sweep: -260,
		amp: {
			d: .18,
			s: 0,
			r: .02
		}
	}),
	"2a03-snare": pre({
		chip: "2a03",
		wave: "noise",
		amp: {
			d: .16,
			s: 0,
			r: .04
		}
	}),
	"2a03-hat": pre({
		chip: "2a03",
		wave: "noise",
		noise: "short",
		amp: {
			d: .05,
			s: 0,
			r: .02
		}
	}),
	"dmg-lead": pre({
		chip: "dmg",
		wave: "pulse",
		duty: .5,
		amp: {
			d: .6,
			s: .6
		},
		vib: {
			depth: .3,
			rate: 5.5,
			delay: .3
		}
	}),
	"dmg-lead25": pre({
		chip: "dmg",
		wave: "pulse",
		duty: .25,
		amp: {
			d: .4,
			s: .5
		}
	}),
	"dmg-sweep": pre({
		chip: "dmg",
		wave: "pulse",
		duty: .5,
		sweep: 30,
		amp: {
			d: .35,
			s: 0,
			r: .05
		}
	}),
	"dmg-wave-bass": pre({
		chip: "dmg",
		wave: "wave",
		table: "bass",
		amp: {
			a: 0,
			d: .1,
			s: 1,
			r: .03
		}
	}),
	"dmg-wave-pad": pre({
		chip: "dmg",
		wave: "wave",
		table: "organ",
		amp: {
			a: .08,
			d: .3,
			s: .8,
			r: .25
		},
		vib: {
			depth: .15,
			rate: 5,
			delay: .4
		}
	}),
	"dmg-arp": pre({
		chip: "dmg",
		wave: "pulse",
		duty: .25,
		arp: 60,
		amp: {
			d: .3,
			s: .5
		}
	}),
	"dmg-snare": pre({
		chip: "dmg",
		wave: "noise",
		amp: {
			d: .14,
			s: 0,
			r: .03
		}
	}),
	"dmg-hat": pre({
		chip: "dmg",
		wave: "noise",
		noise: "short",
		amp: {
			d: .04,
			s: 0,
			r: .02
		}
	}),
	"sid-pwm-lead": pre({
		chip: "sid",
		wave: "pulse",
		duty: .4,
		pwm: {
			depth: .3,
			rate: 1.2
		},
		amp: {
			a: .005,
			d: .4,
			s: .7,
			r: .2
		},
		vib: {
			depth: .25,
			rate: 6,
			delay: .3
		}
	}),
	"sid-pwm-bass": pre({
		chip: "sid",
		wave: "pulse",
		duty: .3,
		pwm: {
			depth: .2,
			rate: .7
		},
		filter: {
			type: "lp",
			cutoff: 900,
			reso: .5
		},
		amp: {
			d: .25,
			s: .6,
			r: .06
		}
	}),
	"sid-saw-bass": pre({
		chip: "sid",
		wave: "saw",
		filter: {
			type: "lp",
			cutoff: 600,
			reso: .7
		},
		amp: {
			d: .2,
			s: .5,
			r: .05
		}
	}),
	"sid-sync-lead": pre({
		chip: "sid",
		wave: "saw",
		sync: 2.5,
		amp: {
			a: .003,
			d: .5,
			s: .7,
			r: .15
		},
		vib: {
			depth: .2,
			rate: 6,
			delay: .25
		}
	}),
	"sid-ring-bell": pre({
		chip: "sid",
		wave: "triangle",
		ring: 3.5,
		amp: {
			a: 0,
			d: .9,
			s: 0,
			r: .6
		}
	}),
	"sid-arp": pre({
		chip: "sid",
		wave: "pulse",
		duty: .25,
		arp: 50,
		pwm: {
			depth: .15,
			rate: 2
		},
		amp: {
			d: .4,
			s: .6
		}
	}),
	"sid-kick": pre({
		chip: "sid",
		wave: "triangle",
		sweep: -320,
		amp: {
			d: .2,
			s: 0,
			r: .02
		}
	}),
	"sid-snare": pre({
		chip: "sid",
		wave: "noise",
		filter: {
			type: "hp",
			cutoff: 1200,
			reso: .2
		},
		amp: {
			d: .18,
			s: 0,
			r: .05
		}
	}),
	"ay-square": pre({
		chip: "ay",
		wave: "pulse",
		duty: .5,
		amp: {
			d: .3,
			s: .8
		}
	}),
	"ay-buzz-saw": pre({
		chip: "ay",
		wave: "buzz-saw",
		amp: {
			d: .2,
			s: .9,
			r: .05
		}
	}),
	"ay-buzz-tri": pre({
		chip: "ay",
		wave: "buzz-tri",
		amp: {
			d: .2,
			s: .9,
			r: .05
		}
	}),
	"ay-arp": pre({
		chip: "ay",
		wave: "pulse",
		arp: 50,
		amp: {
			d: .3,
			s: .7
		}
	}),
	"ay-kick": pre({
		chip: "ay",
		wave: "tone+noise",
		sweep: -280,
		amp: {
			d: .16,
			s: 0,
			r: .02
		}
	}),
	"ay-snare": pre({
		chip: "ay",
		wave: "noise",
		amp: {
			d: .15,
			s: 0,
			r: .04
		}
	}),
	"ay-hat": pre({
		chip: "ay",
		wave: "noise",
		amp: {
			d: .045,
			s: 0,
			r: .02
		}
	}),
	"psg-square": pre({
		chip: "psg",
		wave: "pulse",
		amp: {
			d: .3,
			s: .8
		}
	}),
	"psg-bass": pre({
		chip: "psg",
		wave: "noise",
		noise: "short",
		amp: {
			d: .2,
			s: .9,
			r: .03
		}
	}),
	"psg-arp": pre({
		chip: "psg",
		wave: "pulse",
		arp: 50,
		amp: {
			d: .3,
			s: .7
		}
	}),
	"psg-pluck": pre({
		chip: "psg",
		wave: "pulse",
		amp: {
			d: .2,
			s: 0,
			r: .05
		}
	}),
	"psg-snare": pre({
		chip: "psg",
		wave: "noise",
		amp: {
			d: .14,
			s: 0,
			r: .04
		}
	}),
	"psg-hat": pre({
		chip: "psg",
		wave: "noise",
		amp: {
			d: .04,
			s: 0,
			r: .02
		}
	}),
	"pce-wave-lead": pre({
		chip: "pce",
		wave: "wave",
		table: "vox",
		amp: {
			a: .01,
			d: .4,
			s: .7,
			r: .15
		},
		vib: {
			depth: .2,
			rate: 6,
			delay: .3
		}
	}),
	"pce-wave-bass": pre({
		chip: "pce",
		wave: "wave",
		table: "bass",
		amp: {
			d: .15,
			s: .9,
			r: .04
		}
	}),
	"pce-organ": pre({
		chip: "pce",
		wave: "wave",
		table: "organ",
		amp: {
			a: .01,
			d: .2,
			s: .9,
			r: .1
		}
	}),
	"pce-pluck": pre({
		chip: "pce",
		wave: "wave",
		table: "pluck",
		amp: {
			d: .25,
			s: 0,
			r: .08
		}
	}),
	"pce-arp": pre({
		chip: "pce",
		wave: "wave",
		table: "saw",
		arp: 50,
		amp: {
			d: .3,
			s: .6
		}
	})
};
function chipPreset(name) {
	const p = defaultChip();
	CHIP_PRESETS[name ?? ""]?.(p);
	p.level = PRESET_LEVELS[`chip:${name ?? ""}`] ?? 0;
	return structuredClone(p);
}
/** the presets of one chip (the INSTRUMENT screen shows those) */
var chipPresetsFor = (chip) => Object.keys(CHIP_PRESETS).filter((n) => n.startsWith(chip + "-"));
var CHIP_PARAMS = [
	{
		key: "chip",
		label: "chip",
		choices: CHIPS
	},
	{
		key: "wave",
		label: "wave",
		choices: CHIP_WAVES
	},
	{
		key: "duty",
		label: "pulse width",
		min: .0625,
		max: .9375,
		step: .0625
	},
	{
		key: "noise",
		label: "noise",
		choices: ["long", "short"]
	},
	{
		key: "table",
		label: "wavetable",
		choices: TABLE_NAMES
	},
	{
		key: "amp.a",
		label: "attack",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "amp.d",
		label: "decay",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "amp.s",
		label: "sustain",
		min: 0,
		max: 1,
		step: .0625
	},
	{
		key: "amp.r",
		label: "release",
		min: 0,
		max: 10,
		step: 1.25,
		log: true,
		unit: "s"
	},
	{
		key: "vib.depth",
		label: "vibrato",
		min: 0,
		max: 2,
		step: .05,
		unit: "st"
	},
	{
		key: "vib.rate",
		label: "vibrato rate",
		min: .5,
		max: 20,
		step: .5,
		unit: "Hz"
	},
	{
		key: "vib.delay",
		label: "vibrato delay",
		min: 0,
		max: 2,
		step: .05,
		unit: "s"
	},
	{
		key: "sweep",
		label: "pitch sweep",
		min: -600,
		max: 600,
		step: 10,
		unit: "st/s"
	},
	{
		key: "arp",
		label: "chord arpeggio",
		min: 0,
		max: 100,
		step: 5,
		unit: "/s"
	},
	{
		key: "pwm.depth",
		label: "pwm depth",
		min: 0,
		max: .45,
		step: .025
	},
	{
		key: "pwm.rate",
		label: "pwm rate",
		min: .05,
		max: 20,
		step: 1.25,
		log: true,
		unit: "Hz"
	},
	{
		key: "ring",
		label: "ring mod",
		min: 0,
		max: 8,
		step: .25
	},
	{
		key: "sync",
		label: "hard sync",
		min: 0,
		max: 8,
		step: .25
	},
	{
		key: "filter.type",
		label: "filter",
		choices: [
			"off",
			"lp",
			"bp",
			"hp"
		]
	},
	{
		key: "filter.cutoff",
		label: "cutoff",
		min: 30,
		max: 18e3,
		step: 1.12,
		log: true,
		unit: "Hz"
	},
	{
		key: "filter.reso",
		label: "resonance",
		min: 0,
		max: .95,
		step: .05
	},
	{
		key: "level",
		label: "level",
		min: -24,
		max: 12,
		step: .5,
		unit: "dB"
	}
];
function sanitizeChip(j) {
	const p = sanitizeWith(CHIP_PARAMS, defaultChip(), j);
	const c = j?.custom;
	if (Array.isArray(c) && c.length === 32 && c.every((x) => Number.isInteger(x) && x >= 0 && x <= 31)) p.custom = [...c];
	return p;
}
/** "0123…" (32 hex digits, 0–F, or 0–V for 5 bits) → a custom wave; null if it isn't one */
function parseTable(text) {
	const t = text.replace(/\s+/g, "").toLowerCase();
	if (t.length !== 32) return null;
	const v = [...t].map((ch) => parseInt(ch, 32));
	if (v.some((x) => !(x >= 0 && x <= 31))) return null;
	return v.every((x) => x <= 15) ? v.map((x) => x * 2 + (x > 7 ? 1 : 0)) : v;
}
/** our wavetables, 32 steps from 0 to 31 */
var TABLES = (() => {
	const make = (f) => Array.from({ length: 32 }, (_, i) => Math.max(0, Math.min(31, Math.round(15.5 + 15.5 * f(i / 32)))));
	const s = (x) => Math.sin(2 * Math.PI * x);
	return {
		sine: make(s),
		saw: make((x) => 1 - 2 * x),
		square: make((x) => x < .5 ? 1 : -1),
		organ: make((x) => (s(x) + .5 * s(2 * x) + .33 * s(4 * x)) / 1.5),
		bass: make((x) => x < .25 ? 1 : x < .5 ? .2 : x < .75 ? -.6 : -1),
		pluck: make((x) => s(x) * .6 + s(3 * x) * .4),
		vox: make((x) => (s(x) + .6 * s(3 * x) + .3 * s(5 * x)) / 1.6)
	};
})();
var tableOf = (p) => p.table === "custom" && p.custom ? p.custom : TABLES[p.table] ?? TABLES.sine;
var NES = 1789773;
var SID = 985248;
var AY = 1773400;
var PSG = 3579545;
var NES_NOISE = [
	4,
	8,
	16,
	32,
	64,
	96,
	128,
	160,
	202,
	254,
	380,
	508,
	762,
	1016,
	2034,
	4068
];
/** a period register: f = clock / (k × n), n whole, from lo to hi */
var grid = (hz, clock, k, lo, hi) => clock / (k * Math.max(lo, Math.min(hi, Math.round(clock / (k * hz)))));
/** the tone's frequency on this chip */
function chipHz(chip, wave, hz) {
	if (hz <= 0) return 0;
	switch (chip) {
		case "2a03": return wave === "triangle" ? grid(hz, NES, 32, 1, 2048) : grid(hz, NES, 16, 1, 2048);
		case "dmg": {
			const base = wave === "wave" ? 65536 : 131072;
			return base / Math.max(1, Math.min(2048, Math.round(base / hz)));
		}
		case "sid": return Math.max(1, Math.min(65535, Math.round(hz * 16777216 / SID))) * SID / 16777216;
		case "ay": return wave === "buzz-saw" ? grid(hz, AY, 256, 1, 65535) : wave === "buzz-tri" ? grid(hz, AY, 512, 1, 65535) : grid(hz, AY, 16, 1, 4095);
		case "psg": return grid(hz, PSG, 32, 1, 1023);
		case "pce": return grid(hz, PSG, 32, 1, 4095);
	}
}
/** the noise's shift rate on this chip, for a note (higher notes, brighter noise) */
function noiseHz(chip, hz) {
	const want = hz * 16;
	switch (chip) {
		case "2a03": {
			let best = NES / NES_NOISE[0];
			for (const n of NES_NOISE) if (Math.abs(NES / n - want) < Math.abs(best - want)) best = NES / n;
			return best;
		}
		case "dmg": {
			let best = 0;
			for (const r of [
				.5,
				1,
				2,
				3,
				4,
				5,
				6,
				7
			]) for (let s = 0; s < 14; s++) {
				const f = 524288 / r / 2 ** (s + 1);
				if (Math.abs(f - want) < Math.abs(best - want)) best = f;
			}
			return best;
		}
		case "ay": return grid(want, AY, 16, 1, 31);
		case "psg": return grid(want, PSG, 32, 1, 1023);
		default: return Math.min(want, 4e4);
	}
}
/** how many volume steps the chip has (2a03, dmg, ay, psg, pce: 16; SID: 256) */
var VOLUME_STEPS = (chip) => chip === "sid" ? 255 : 15;
/** an envelope's level as the chip can set it */
var chipVolume = (chip, env) => Math.round(Math.max(0, Math.min(1, env)) * VOLUME_STEPS(chip)) / VOLUME_STEPS(chip);
/** the four pulse widths of the 2A03 and the Game Boy */
var DUTIES = [
	.125,
	.25,
	.5,
	.75
];
var snapDuty = (chip, d) => chip === "2a03" || chip === "dmg" ? DUTIES.reduce((a, b) => Math.abs(b - d) < Math.abs(a - d) ? b : a) : Math.max(.02, Math.min(.98, d));
var TAU = 2 * Math.PI;
/** sub-steps a frame: the waves are computed 4× faster and averaged (less aliasing, still sharp) */
var OVER = 4;
/** frames between two pitch updates (~1.5 kHz: smooth enough for vibrato and sweeps) */
var CONTROL = 32;
/** a state-variable filter (TPT), for the SID's */
var Svf$1 = class {
	constructor() {
		_defineProperty(this, "s1", 0);
		_defineProperty(this, "s2", 0);
		_defineProperty(this, "g", 0);
		_defineProperty(this, "k", 1);
	}
	set(hz, sr, reso) {
		this.g = Math.tan(Math.PI * Math.min(hz, sr * .45) / sr);
		this.k = 2 - 1.9 * reso;
	}
	run(x, type) {
		const hp = (x - (this.k + this.g) * this.s1 - this.s2) / (1 + this.g * (this.k + this.g));
		const bp = this.g * hp + this.s1;
		const lp = this.g * bp + this.s2;
		this.s1 = this.g * hp + bp;
		this.s2 = this.g * bp + lp;
		return type === "lp" ? lp : type === "bp" ? bp : hp;
	}
};
var ChipVoice = class {
	constructor(sr) {
		_defineProperty(this, "sr", void 0);
		_defineProperty(this, "on", false);
		_defineProperty(this, "rings", true);
		_defineProperty(this, "p", defaultChip());
		_defineProperty(this, "table", TABLES.sine);
		_defineProperty(
			this,
			/** the note's frequency (from the tracker, slides and vibrato included) */
			"hz",
			C3_HZ
		);
		_defineProperty(this, "ph", 0);
		_defineProperty(this, "inner", 0);
		_defineProperty(this, "ringPh", 0);
		_defineProperty(this, "noisePh", 0);
		_defineProperty(
			this,
			/** the pitch, the noise rate and the width, worked out every CONTROL frames (the grid search isn't free) */
			"ctl",
			0
		);
		_defineProperty(this, "cur", {
			hz: 0,
			nhz: 0,
			duty: .5
		});
		_defineProperty(this, "lfsr", 32767);
		_defineProperty(this, "bit", 1);
		_defineProperty(this, "t", 0);
		_defineProperty(this, "released", null);
		_defineProperty(this, "gl", 0);
		_defineProperty(this, "gr", 0);
		_defineProperty(
			this,
			/** the chord, as semitones over the note, when it's played as an arpeggio */
			"arpSteps",
			[]
		);
		_defineProperty(this, "filt", new Svf$1());
		_defineProperty(
			this,
			/** a DC blocker (the chips' outputs went through a capacitor) */
			"dcx",
			0
		);
		_defineProperty(this, "dcy", 0);
		this.sr = sr;
	}
	start(n) {
		this.p = n.instrument.chip ?? defaultChip();
		this.table = tableOf(this.p);
		this.hz = n.rate / C3_RATE$2 * C3_HZ;
		this.ph = this.inner = this.ringPh = this.noisePh = 0;
		this.ctl = 0;
		this.lfsr = 32767;
		this.t = 0;
		this.released = null;
		this.arpSteps = [];
		this.on = true;
	}
	/** play the chord's notes one after the other (the renderer calls it when the instrument's arp is on) */
	arpeggio(steps) {
		this.arpSteps = steps;
	}
	set(rate, volume, pan) {
		this.hz = Math.max(1, rate) / C3_RATE$2 * C3_HZ;
		const v = Math.max(0, Math.min(1, volume)) * 10 ** ((this.p.level ?? 0) / 20);
		this.gl = v * Math.min(1, 1 - pan);
		this.gr = v * Math.min(1, 1 + pan);
	}
	stop() {
		if (!this.on || this.released) return;
		this.released = {
			at: this.t,
			amp: adsr(this.p.amp, this.t, null)
		};
	}
	/** one noise step: the chip's shift register */
	shift() {
		const p = this.p;
		const s = this.lfsr;
		let fb;
		switch (p.chip) {
			case "ay":
				fb = (s ^ s >> 3) & 1;
				this.lfsr = (s >> 1 | fb << 16) & 131071;
				break;
			case "psg":
				if (p.noise === "short") this.lfsr = (s >> 1 | (s & 1) << 15) & 65535 || 32768;
				else fb = (s ^ s >> 3) & 1, this.lfsr = (s >> 1 | fb << 15) & 65535;
				break;
			default:
				fb = (s ^ s >> (p.noise === "short" && p.chip === "2a03" ? 6 : 1)) & 1;
				this.lfsr = s >> 1 | fb << 14;
				if (p.noise === "short" && p.chip === "dmg") this.lfsr = this.lfsr & -65 | fb << 6;
		}
		this.bit = this.lfsr & 1;
	}
	render(left, right, from, to) {
		if (!this.on) return;
		const p = this.p, sr = this.sr, dt = 1 / sr, sub = dt / OVER;
		const filterOn = p.chip === "sid" && p.filter.type !== "off";
		if (filterOn) this.filt.set(p.filter.cutoff, sr, p.filter.reso);
		const tri4 = p.chip !== "sid";
		for (let i = from; i < to; i++) {
			const r = this.released;
			const env = adsr(p.amp, this.t, r && {
				at: r.at,
				from: r.amp
			});
			if (r && env <= 0 || !r && p.amp.s <= 0 && this.t > p.amp.a + p.amp.d) {
				this.on = false;
				return;
			}
			const vol = chipVolume(p.chip, env);
			const noisy = p.wave === "noise" || p.wave === "tone+noise";
			if (this.ctl-- <= 0) {
				this.ctl = CONTROL;
				let semis = 0;
				if (this.arpSteps.length && p.arp > 0) {
					const all = [0, ...this.arpSteps];
					semis += all[Math.floor(this.t * p.arp) % all.length];
				}
				if (p.sweep) semis += Math.max(-72, Math.min(72, p.sweep * this.t));
				if (p.vib.depth && this.t > p.vib.delay) semis += Math.sin(TAU * p.vib.rate * (this.t - p.vib.delay)) * p.vib.depth;
				const want = this.hz * 2 ** (semis / 12);
				this.cur.hz = want < 8 ? 0 : chipHz(p.chip, p.wave, want);
				this.cur.nhz = noisy ? noiseHz(p.chip, want) : 0;
				this.cur.duty = snapDuty(p.chip, p.duty + (p.pwm.depth ? Math.sin(TAU * p.pwm.rate * this.t) * p.pwm.depth : 0));
			}
			const { hz, nhz, duty } = this.cur;
			let acc = 0;
			for (let k = 0; k < OVER; k++) {
				let ph = this.ph;
				if (p.sync > 0) {
					this.inner += hz * sub;
					if (this.inner >= 1) this.inner -= 1, this.ph = 0;
					this.ph = (this.ph + hz * p.sync * sub) % 1;
					ph = this.ph;
				} else {
					this.ph = (this.ph + hz * sub) % 1;
					ph = this.ph;
				}
				if (noisy) {
					this.noisePh += nhz * sub;
					while (this.noisePh >= 1) this.noisePh -= 1, this.shift();
				}
				let y;
				switch (p.wave) {
					case "pulse":
						y = ph < duty ? 1 : -1;
						break;
					case "triangle": {
						const x = ph < .5 ? 4 * ph - 1 : 3 - 4 * ph;
						y = tri4 ? Math.round((x + 1) * 7.5) / 7.5 - 1 : x;
						break;
					}
					case "saw":
						y = 1 - 2 * ph;
						if (p.chip !== "sid") y = Math.round((y + 1) * 7.5) / 7.5 - 1;
						break;
					case "noise":
						y = this.bit ? 1 : -1;
						break;
					case "tone+noise":
						y = (ph < .5 ? 1 : 0) & this.bit ? 1 : -1;
						break;
					case "wave": {
						const bits = p.chip === "dmg" ? 15 : 31;
						const v = this.table[Math.floor(ph * 32) & 31];
						y = (bits === 15 ? v >> 1 : v) / (bits / 2) - 1;
						break;
					}
					case "buzz-saw":
						y = (15 - Math.floor(ph * 16)) / 7.5 - 1;
						break;
					case "buzz-tri": {
						const s = Math.floor(ph * 32);
						y = (s < 16 ? 15 - s : s - 16) / 7.5 - 1;
						break;
					}
				}
				if (p.ring > 0 && (this.ringPh = (this.ringPh + hz * p.ring * sub) % 1) >= .5) y = -y;
				acc += y;
			}
			let y = acc / OVER * vol;
			if (filterOn) y = this.filt.run(y, p.filter.type);
			const out = y - this.dcx + .995 * this.dcy;
			this.dcx = y;
			this.dcy = out;
			this.t += dt;
			left[i] += out * .35 * this.gl;
			right[i] += out * .35 * this.gr;
		}
	}
};
// src/synths.ts
/**
* breakerMED — our synths, described once: the command that drives each, the
* instrument kind, where its settings live, its list of settings and presets.
* `med synth` / `med fm` and the INSTRUMENT screen work from this, so a new
* synth is a voice (dsp/), a list of settings and one entry here.
*/
var SYNTHS = [
	{
		cmd: "synth",
		kind: "analog",
		field: "synth",
		what: "an analog synth",
		example: "set cutoff 800",
		params: ANALOG_PARAMS,
		presets: Object.keys(ANALOG_PRESETS),
		preset: analogPreset,
		sanitize: sanitizeAnalog
	},
	{
		cmd: "fm",
		kind: "fm",
		field: "fm",
		what: "an FM synth",
		example: "set index 4",
		params: FM_PARAMS,
		presets: Object.keys(FM_PRESETS),
		preset: fmPreset,
		sanitize: sanitizeFm
	},
	{
		cmd: "chip",
		kind: "chip",
		field: "chip",
		what: "a chip synth",
		example: "set chip sid",
		params: CHIP_PARAMS,
		presets: Object.keys(CHIP_PRESETS),
		presetsFor: (p) => chipPresetsFor(p.chip),
		preset: chipPreset,
		sanitize: sanitizeChip
	}
];
/** the synth an instrument is (or none) */
var synthOf = (ins) => SYNTHS.find((s) => s.kind === ins?.kind);
/** an instrument's synth settings (or undefined) */
var settingsOf = (ins, sk) => ins[sk.field];
var putSettings = (ins, sk, v) => ins[sk.field] = v;
// src/dsp/drums.ts
var DRUM_NAMES = [
	"kick",
	"rim",
	"snare",
	"clap",
	"closed hat",
	"low tom",
	"open hat",
	"mid tom",
	"cowbell",
	"high tom",
	"crash",
	"ride"
];
var DRUM_NOTES = [
	"C",
	"C#",
	"D",
	"D#",
	"E",
	"F",
	"F#",
	"G",
	"G#",
	"A",
	"A#",
	"B"
];
var DRUM_SETTINGS = [
	{
		key: "tune",
		min: -24,
		max: 24,
		step: 1,
		unit: "st"
	},
	{
		key: "decay",
		min: .1,
		max: 4,
		step: .1,
		unit: "×"
	},
	{
		key: "level",
		min: 0,
		max: 1,
		step: .05,
		unit: ""
	},
	{
		key: "tone",
		min: 0,
		max: 1,
		step: .05,
		unit: ""
	}
];
var flat = () => DRUM_NAMES.map(() => ({
	tune: 0,
	decay: 1,
	level: .8,
	tone: .5
}));
/** our own kits */
var DRUM_KITS = {
	/** long, round, a deep kick (the 808's way) */
	classic: (k) => {
		k.drums[0] = {
			tune: 0,
			decay: 1.4,
			level: 1,
			tone: .2
		};
		k.drums[2] = {
			tune: 0,
			decay: 1,
			level: .75,
			tone: .45
		};
	},
	/** short, hard, a kick with a click (the 909's way) */
	punch: (k) => {
		k.drums[0] = {
			tune: 3,
			decay: .7,
			level: 1,
			tone: .8
		};
		k.drums[2] = {
			tune: 2,
			decay: .8,
			level: .85,
			tone: .75
		};
		k.drums[3] = {
			tune: 0,
			decay: .8,
			level: .8,
			tone: .6
		};
		k.drums[4] = {
			tune: 0,
			decay: .6,
			level: .6,
			tone: .8
		};
	},
	/** everything short and tight */
	tight: (k) => {
		for (const d of k.drums) d.decay = .5;
		k.drums[0].tone = .6;
	},
	/** crushed: 6 bits, a third of the rate (an old sampler's drums) */
	lofi: (k) => {
		k.bits = 6;
		k.hold = 3;
		k.drums[0] = {
			tune: -2,
			decay: 1,
			level: 1,
			tone: .4
		};
	},
	/** a long sub kick that hums, a soft snare, airy hats */
	boom: (k) => {
		k.drums[0] = {
			tune: -3,
			decay: 2.6,
			level: 1,
			tone: .1
		};
		k.drums[2] = {
			tune: -1,
			decay: 1.1,
			level: .7,
			tone: .3
		};
		k.drums[3] = {
			tune: -1,
			decay: 1.2,
			level: .75,
			tone: .4
		};
		k.drums[6] = {
			tune: 0,
			decay: 1.4,
			level: .6,
			tone: .4
		};
	},
	/** four on the floor: a firm kick, a wide clap, a bright open hat and ride */
	house: (k) => {
		k.drums[0] = {
			tune: 1,
			decay: .9,
			level: 1,
			tone: .7
		};
		k.drums[3] = {
			tune: 1,
			decay: 1.3,
			level: .9,
			tone: .6
		};
		k.drums[4] = {
			tune: 1,
			decay: .7,
			level: .65,
			tone: .75
		};
		k.drums[6] = {
			tune: 1,
			decay: 1.3,
			level: .65,
			tone: .75
		};
		k.drums[11] = {
			tune: 2,
			decay: 1.2,
			level: .6,
			tone: .8
		};
	},
	/** snappy and high: clicky kick, tight snare, toms and cowbell tuned up */
	electro: (k) => {
		k.drums[0] = {
			tune: 5,
			decay: .6,
			level: 1,
			tone: .9
		};
		k.drums[2] = {
			tune: 4,
			decay: .6,
			level: .85,
			tone: .9
		};
		for (const t of [
			5,
			7,
			9
		]) k.drums[t] = {
			tune: 5,
			decay: .7,
			level: .8,
			tone: .6
		};
		k.drums[8] = {
			tune: 3,
			decay: .8,
			level: .7,
			tone: .5
		};
		k.drums[4] = {
			tune: 2,
			decay: .35,
			level: .6,
			tone: .9
		};
	},
	/** a kick that slides on and on, a hard snare, ticking hats */
	trap: (k) => {
		k.drums[0] = {
			tune: -5,
			decay: 3.2,
			level: 1,
			tone: .35
		};
		k.drums[2] = {
			tune: 3,
			decay: .6,
			level: .9,
			tone: .8
		};
		k.drums[3] = {
			tune: 2,
			decay: .9,
			level: .9,
			tone: .7
		};
		k.drums[4] = {
			tune: 3,
			decay: .3,
			level: .55,
			tone: .85
		};
		k.drums[6] = {
			tune: 3,
			decay: .8,
			level: .55,
			tone: .85
		};
	},
	/** soft and warm, 8 bits: drums off an old record */
	dusty: (k) => {
		k.bits = 8;
		k.hold = 2;
		k.drums[0] = {
			tune: -1,
			decay: 1.1,
			level: 1,
			tone: .3
		};
		k.drums[2] = {
			tune: -2,
			decay: 1.2,
			level: .8,
			tone: .3
		};
		k.drums[4] = {
			tune: -1,
			decay: .8,
			level: .55,
			tone: .3
		};
		k.drums[6] = {
			tune: -1,
			decay: 1.1,
			level: .55,
			tone: .3
		};
	},
	/** tuned down, long and crushed to 4 bits: metal and machines */
	industrial: (k) => {
		k.bits = 4;
		k.hold = 2;
		for (const d of k.drums) Object.assign(d, {
			tune: -4,
			decay: 1.5,
			tone: .9
		});
		k.drums[0].level = 1;
	},
	/** toms that ring, a rim and a cowbell up front */
	tribal: (k) => {
		k.drums[0] = {
			tune: -2,
			decay: 1.2,
			level: .95,
			tone: .4
		};
		k.drums[1] = {
			tune: 0,
			decay: 1.2,
			level: .9,
			tone: .6
		};
		k.drums[5] = {
			tune: -3,
			decay: 2,
			level: .95,
			tone: .3
		};
		k.drums[7] = {
			tune: 0,
			decay: 1.8,
			level: .95,
			tone: .3
		};
		k.drums[9] = {
			tune: 3,
			decay: 1.6,
			level: .95,
			tone: .3
		};
		k.drums[8] = {
			tune: 0,
			decay: 1,
			level: .9,
			tone: .5
		};
	},
	/** every drum short and quiet, a clicky rim: room for the rest */
	minimal: (k) => {
		for (const d of k.drums) Object.assign(d, {
			decay: .35,
			level: .65
		});
		k.drums[0] = {
			tune: 0,
			decay: .6,
			level: .95,
			tone: .5
		};
		k.drums[1] = {
			tune: 2,
			decay: .5,
			level: .8,
			tone: .85
		};
	}
};
function drumKit(name) {
	const k = {
		drums: flat(),
		bits: 16,
		hold: 1
	};
	DRUM_KITS[name ?? "classic"]?.(k);
	return structuredClone(k);
}
/** Settings read from a file: every value checked, anything wrong → the default. */
function sanitizeKit(j) {
	const k = drumKit();
	const o = j && typeof j === "object" ? j : {};
	const num = (v, d, lo, hi) => typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
	const list = Array.isArray(o.drums) ? o.drums : [];
	k.drums = k.drums.map((d, i) => {
		const x = list[i] && typeof list[i] === "object" ? list[i] : {};
		return {
			tune: num(x.tune, d.tune, -24, 24),
			decay: num(x.decay, d.decay, .1, 4),
			level: num(x.level, d.level, 0, 1),
			tone: num(x.tone, d.tone, 0, 1)
		};
	});
	k.bits = Math.round(num(o.bits, 16, 1, 16));
	k.hold = Math.round(num(o.hold, 1, 1, 16));
	return k;
}
/** A drum by its name, its note ("D#") or its number (1–12). */
function findDrum(name) {
	const n = name.toLowerCase();
	const i = DRUM_NAMES.findIndex((d) => d === n || d.replace(" ", "") === n || d.split(" ")[0] === n);
	if (i >= 0) return i;
	const j = DRUM_NOTES.findIndex((x) => x.toLowerCase() === n);
	if (j >= 0) return j;
	const k = parseInt(n, 10);
	return k >= 1 && k <= 12 ? k - 1 : -1;
}
function setDrum(kit, drum, key, value) {
	const def = DRUM_SETTINGS.find((s) => s.key === key);
	if (!Number.isFinite(value)) throw new Error(`${key}: a number, ${def.min}…${def.max}`);
	kit.drums[drum][key] = Math.max(def.min, Math.min(def.max, +value.toFixed(3)));
}
function nudgeDrum(kit, drum, key, dir, big = false) {
	const def = DRUM_SETTINGS.find((s) => s.key === key);
	const step = def.step * (big ? 4 : 1);
	setDrum(kit, drum, key, Math.round((kit.drums[drum][key] + dir * step) / def.step) * def.step);
}
/** which drum a rate plays: its note's place in the octave (C-3, C-4… are all the kick) */
function drumOf(rate, c3Rate) {
	return (Math.round(12 * Math.log2(Math.max(1, rate) / c3Rate)) % 12 + 12) % 12;
}
var C3_RATE$1 = 3546895 / 214;
/** the six out-of-tune squares of a metal sound (the classic ratios) */
var METAL = [
	205.3,
	304.4,
	369.6,
	522.7,
	540,
	800
];
/** a small state-variable filter (Zavalishin's TPT): one call a frame */
var Svf = class {
	constructor() {
		_defineProperty(this, "s1", 0);
		_defineProperty(this, "s2", 0);
		_defineProperty(this, "g", 0);
		_defineProperty(this, "k", 0);
	}
	set(hz, sr, q = .7) {
		this.g = Math.tan(Math.PI * Math.min(hz, sr * .45) / sr);
		this.k = 1 / q;
	}
	run(x) {
		const hp = (x - (this.k + this.g) * this.s1 - this.s2) / (1 + this.g * (this.k + this.g));
		const bp = this.g * hp + this.s1;
		const lp = this.g * bp + this.s2;
		this.s1 = this.g * hp + bp;
		this.s2 = this.g * bp + lp;
		return {
			lp,
			bp,
			hp
		};
	}
};
var DrumVoice = class {
	constructor(sr) {
		_defineProperty(this, "sr", void 0);
		_defineProperty(this, "on", false);
		_defineProperty(
			this,
			/** a drum rings on when the track plays the next note */
			"rings",
			true
		);
		_defineProperty(this, "drum", 0);
		_defineProperty(this, "p", flat()[0]);
		_defineProperty(this, "kit", drumKit());
		_defineProperty(this, "t", 0);
		_defineProperty(this, "ph", [
			0,
			0,
			0,
			0,
			0,
			0
		]);
		_defineProperty(this, "seed", 22222);
		_defineProperty(this, "f1", new Svf());
		_defineProperty(this, "f2", new Svf());
		_defineProperty(this, "gl", 0);
		_defineProperty(this, "gr", 0);
		_defineProperty(
			this,
			/** a note off: a short fade (20 ms) */
			"fade",
			1
		);
		_defineProperty(this, "fading", false);
		_defineProperty(this, "held", 0);
		_defineProperty(this, "holdLeft", 0);
		this.sr = sr;
	}
	noise() {
		this.seed = this.seed * 1103515245 + 12345 & 2147483647;
		return this.seed / 1073741823 - 1;
	}
	start(n) {
		this.kit = n.instrument.drums ?? drumKit();
		this.drum = drumOf(n.rate, C3_RATE$1);
		this.p = this.kit.drums[this.drum] ?? flat()[0];
		this.t = 0;
		this.ph.fill(0);
		this.fade = 1;
		this.fading = false;
		this.holdLeft = 0;
		this.f1 = new Svf();
		this.f2 = new Svf();
		const tune = 2 ** (this.p.tune / 12);
		const tone = this.p.tone;
		switch (this.drum) {
			case 2:
				this.f1.set(1800 + tone * 5e3, this.sr, .8);
				break;
			case 3:
				this.f1.set(1100 * tune, this.sr, 2.5);
				break;
			case 4:
			case 6:
				this.f1.set((6e3 + tone * 4e3) * tune, this.sr, .8);
				this.f2.set(1e4, this.sr, .6);
				break;
			case 8:
				this.f1.set(800 * tune, this.sr, 3);
				break;
			case 10:
			case 11:
				this.f1.set((4e3 + tone * 4e3) * tune, this.sr, .7);
				this.f2.set(12e3, this.sr, .6);
				break;
			default: this.f1.set(3e3, this.sr);
		}
		this.on = true;
	}
	/** the volume and the place; a drum keeps its pitch (its note chose it) */
	set(_rate, volume, pan) {
		const v = Math.max(0, Math.min(1, volume));
		this.gl = v * Math.min(1, 1 - pan);
		this.gr = v * Math.min(1, 1 + pan);
	}
	stop() {
		this.fading = true;
	}
	/** a closed hat (or a pedal) cuts an open one ringing on the same track */
	chokedBy(drum) {
		return this.drum === 6 && drum === 4;
	}
	kill() {
		this.on = false;
	}
	render(left, right, from, to) {
		if (!this.on) return;
		const dt = 1 / this.sr;
		const { tune: semis, decay, level, tone } = this.p;
		const tune = 2 ** (semis / 12);
		const bits = this.kit.bits, hold = Math.max(1, this.kit.hold);
		const steps = bits < 16 ? 2 ** (bits - 1) : 0;
		for (let i = from; i < to; i++) {
			const t = this.t;
			let y = 0;
			let alive = true;
			switch (this.drum) {
				case 0: {
					const len = .45 * decay;
					const f = 48 * tune * (1 + 3.5 * Math.exp(-t / .025));
					this.ph[0] = (this.ph[0] + f * dt) % 1;
					y = Math.sin(2 * Math.PI * this.ph[0]) * Math.exp(-t / (len / 3));
					y += this.noise() * Math.exp(-t / .0025) * tone * .6;
					y = Math.tanh(y * 1.6);
					alive = t < len * 1.6;
					break;
				}
				case 1:
					this.ph[0] = (this.ph[0] + 1700 * tune * dt) % 1;
					this.ph[1] = (this.ph[1] + 480 * tune * dt) % 1;
					y = (Math.sin(2 * Math.PI * this.ph[0]) * .6 + (this.ph[1] < .5 ? .4 : -.4)) * Math.exp(-t / (.012 * decay));
					alive = t < .08 * decay;
					break;
				case 2: {
					this.ph[0] = (this.ph[0] + 185 * tune * dt) % 1;
					this.ph[1] = (this.ph[1] + 330 * tune * dt) % 1;
					const body = (Math.sin(2 * Math.PI * this.ph[0]) + Math.sin(2 * Math.PI * this.ph[1]) * .6) * Math.exp(-t / (.05 * decay)) * (1 - tone * .6);
					const snap = this.f1.run(this.noise()).bp * 1.8 * Math.exp(-t / (.09 * decay)) * (.3 + tone);
					y = body * .6 + snap;
					alive = t < .5 * decay;
					break;
				}
				case 3: {
					const burst = t < .03 ? Math.exp(-(t % .01 / .003)) : Math.exp(-(t - .03) / (.12 * decay));
					y = this.f1.run(this.noise()).bp * burst * 2.2;
					alive = t < .03 + .7 * decay;
					break;
				}
				case 4:
				case 6:
				case 10:
				case 11: {
					let m = 0;
					for (let k = 0; k < 6; k++) {
						this.ph[k] = (this.ph[k] + METAL[k] * 2.4 * tune * dt) % 1;
						m += this.ph[k] < .5 ? 1 : -1;
					}
					m = m / 6 + (this.drum === 10 ? this.noise() * .5 : this.drum === 11 ? this.noise() * .1 : 0);
					const len = this.drum === 4 ? .045 : this.drum === 6 ? .35 : this.drum === 10 ? 1.1 : 1.6;
					const f = this.f1.run(m);
					y = (this.drum === 11 ? f.bp : this.f2.run(f.hp).lp) * Math.exp(-t / (len * decay / 3)) * (this.drum === 11 ? 1.4 : this.drum === 10 ? 2.4 : 4.5);
					alive = t < len * decay * 1.3;
					break;
				}
				case 5:
				case 7:
				case 9: {
					const f = (this.drum === 5 ? 95 : this.drum === 7 ? 140 : 200) * tune * (1 + .6 * Math.exp(-t / .04));
					this.ph[0] = (this.ph[0] + f * dt) % 1;
					y = (Math.sin(2 * Math.PI * this.ph[0]) + this.noise() * Math.exp(-t / .01) * tone * .5) * Math.exp(-t / (.12 * decay));
					alive = t < .6 * decay;
					break;
				}
				case 8: {
					this.ph[0] = (this.ph[0] + 540 * tune * dt) % 1;
					this.ph[1] = (this.ph[1] + 800 * tune * dt) % 1;
					const x = (this.ph[0] < .5 ? .5 : -.5) + (this.ph[1] < .5 ? .5 : -.5);
					y = this.f1.run(x).bp * .35 * (t < .01 ? 1 : Math.exp(-(t - .01) / (.09 * decay)));
					alive = t < .4 * decay;
					break;
				}
			}
			this.t += dt;
			if (this.fading) {
				this.fade -= dt / .02;
				if (this.fade <= 0) alive = false;
			}
			if (!alive) {
				this.on = false;
				return;
			}
			y *= level * this.fade;
			if (hold > 1) {
				if (this.holdLeft-- <= 0) this.held = y, this.holdLeft = hold - 1;
				y = this.held;
			}
			if (steps) y = Math.round(y * steps) / steps;
			left[i] += y * .5 * this.gl;
			right[i] += y * .5 * this.gr;
		}
	}
};
// src/format/aiff.ts
/** an IEEE 754 80-bit extended number (AIFF's sample rate; whole rates below 2³² are exact) */
function extended(n) {
	const out = /* @__PURE__ */ new Uint8Array(10);
	if (n <= 0) return out;
	const e = Math.floor(Math.log2(n));
	const exp = e + 16383;
	out[0] = exp >> 8 & 127;
	out[1] = exp & 255;
	const hi = Math.floor(n * 2 ** (31 - e));
	out[2] = hi >>> 24 & 255;
	out[3] = hi >>> 16 & 255;
	out[4] = hi >>> 8 & 255;
	out[5] = hi & 255;
	return out;
}
function writeAiff(pcm, bits = 16) {
	const ch = Math.max(1, pcm.channels.length);
	const frames = pcm.channels[0]?.length ?? 0;
	const float = bits === 32;
	const bytes = bits / 8;
	const comm = float ? 36 : 18;
	const data = frames * ch * bytes;
	const size = 4 + (8 + comm) + (16 + data) + (float ? 12 : 0);
	const out = new Uint8Array(8 + size);
	const v = new DataView(out.buffer);
	let o = 0;
	const tag = (s) => [...s].forEach((c) => v.setUint8(o++, c.charCodeAt(0)));
	const u32 = (x) => (v.setUint32(o, x), o += 4);
	const u16 = (x) => (v.setUint16(o, x), o += 2);
	tag("FORM");
	u32(size);
	tag(float ? "AIFC" : "AIFF");
	if (float) {
		tag("FVER");
		u32(4);
		u32(2726318400);
	}
	tag("COMM");
	u32(comm);
	u16(ch);
	u32(frames);
	u16(bits);
	out.set(extended(pcm.rate), o);
	o += 10;
	if (float) {
		tag("fl32");
		out[o++] = 12;
		tag("32-bit float");
		out[o++] = 0;
	}
	tag("SSND");
	u32(8 + data);
	u32(0);
	u32(0);
	for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
		const x = pcm.channels[c]?.[i] ?? 0;
		const s = x > 1 ? 1 : x < -1 ? -1 : x === x ? x : 0;
		if (float) v.setFloat32(o, s);
		else if (bits === 16) v.setInt16(o, Math.round(s * 32767));
		else {
			const n = Math.round(s * 8388607);
			out[o] = n >> 16 & 255;
			out[o + 1] = n >> 8 & 255;
			out[o + 2] = n & 255;
		}
		o += bytes;
	}
	return out;
}
/** an 80-bit extended number back (AIFF's sample rate) */
function fromExtended(b, o) {
	const exp = (b[o] & 127) << 8 | b[o + 1];
	let mant = 0;
	for (let i = 0; i < 8; i++) mant = mant * 256 + b[o + 2 + i];
	return exp === 0 && mant === 0 ? 0 : mant * 2 ** (exp - 16383 - 63);
}
/** Read an AIFF / AIFF-C file (integers, "sowt" little-endian, 32/64-bit float); null when it isn't one. */
function readAiff(b) {
	if (b.length < 12) return null;
	const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
	if (tag(0) !== "FORM" || tag(8) !== "AIFF" && tag(8) !== "AIFC") return null;
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let ch = 0, frames = 0, bits = 0, rate = 0, comp = "NONE", data = -1;
	for (let o = 12; o + 8 <= b.length;) {
		const id = tag(o), len = v.getUint32(o + 4);
		if (id === "COMM" && o + 26 <= b.length) {
			ch = v.getUint16(o + 8);
			frames = v.getUint32(o + 10);
			bits = v.getUint16(o + 14);
			rate = fromExtended(b, o + 16);
			if (tag(8) === "AIFC" && len >= 22) comp = tag(o + 26);
		} else if (id === "SSND") data = o + 16 + v.getUint32(o + 8);
		o += 8 + len + (len & 1);
	}
	if (data < 0 || !ch || !rate) return null;
	const float = comp === "fl32" || comp === "FL32" || comp === "fl64";
	const little = comp === "sowt";
	if (!float && !little && comp !== "NONE" && comp !== "twos") return null;
	const bytes = comp === "fl64" ? 8 : float ? 4 : Math.ceil(bits / 8);
	const n = Math.min(frames, Math.floor((b.length - data) / (bytes * ch)));
	const channels = Array.from({ length: ch }, () => new Float32Array(n));
	let o = data;
	for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
		let x;
		if (float) x = bytes === 8 ? v.getFloat64(o) : v.getFloat32(o);
		else if (bytes === 1) x = v.getInt8(o) / 128;
		else if (bytes === 2) x = v.getInt16(o, little) / 32768;
		else if (bytes === 3) x = little ? ((b[o + 2] << 24 | b[o + 1] << 16 | b[o] << 8) >> 8) / 8388608 : ((b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8) >> 8) / 8388608;
		else x = v.getInt32(o, little) / 2147483648;
		channels[c][i] = x === x ? x : 0;
		o += bytes;
	}
	return {
		rate,
		channels
	};
}
// src/format/flac.ts
var BLOCK = 4096;
var Bits = class {
	constructor() {
		_defineProperty(this, "buf", /* @__PURE__ */ new Uint8Array(65536));
		_defineProperty(this, "len", 0);
		_defineProperty(this, "acc", 0);
		_defineProperty(this, "n", 0);
	}
	room(extra) {
		if (this.len + extra + 8 <= this.buf.length) return;
		let size = this.buf.length * 2;
		while (size < this.len + extra + 8) size *= 2;
		const b = new Uint8Array(size);
		b.set(this.buf.subarray(0, this.len));
		this.buf = b;
	}
	/** write the low `count` bits of `v` (count ≤ 24 at a time) */
	put(v, count) {
		if (count > 24) {
			this.put(Math.floor(v / 2 ** 24) & (1 << count - 24) - 1, count - 24);
			this.put(v & 16777215, 24);
			return;
		}
		this.room(4);
		this.acc = this.acc << count | v & (1 << count) - 1;
		this.n += count;
		while (this.n >= 8) {
			this.n -= 8;
			this.buf[this.len++] = this.acc >>> this.n & 255;
		}
		this.acc &= (1 << this.n) - 1;
	}
	/** a signed value in `count` bits (two's complement) */
	putSigned(v, count) {
		this.put(v < 0 ? v + 2 ** count : v, count);
	}
	/** q zeros then a one */
	unary(q) {
		while (q >= 24) this.put(0, 24), q -= 24;
		this.put(1, q + 1);
	}
	align() {
		if (this.n) this.put(0, 8 - this.n);
	}
	get bytes() {
		return this.len;
	}
	slice(from, to = this.len) {
		return this.buf.slice(from, to);
	}
	done() {
		this.align();
		return this.buf.slice(0, this.len);
	}
};
function crc8(b) {
	let c = 0;
	for (const x of b) {
		c ^= x;
		for (let i = 0; i < 8; i++) c = c & 128 ? (c << 1 ^ 7) & 255 : c << 1 & 255;
	}
	return c;
}
function crc16(b) {
	let c = 0;
	for (const x of b) {
		c ^= x << 8;
		for (let i = 0; i < 8; i++) c = c & 32768 ? (c << 1 ^ 32773) & 65535 : c << 1 & 65535;
	}
	return c;
}
/** the residual of FLAC's fixed predictor of this order */
function residual(x, order) {
	const r = new Int32Array(x.length - order);
	for (let i = order; i < x.length; i++) {
		const p = order === 0 ? 0 : order === 1 ? x[i - 1] : order === 2 ? 2 * x[i - 1] - x[i - 2] : order === 3 ? 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3] : 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
		r[i - order] = x[i] - p;
	}
	return r;
}
var zigzag = (v) => v >= 0 ? 2 * v : -2 * v - 1;
/** the best Rice parameter for these values, and how many bits they take with it */
function rice(r) {
	let sum = 0;
	for (const v of r) sum += zigzag(v);
	let best = {
		k: 0,
		bits: Infinity
	};
	const guess = Math.max(0, Math.floor(Math.log2(Math.max(1, sum / Math.max(1, r.length)))));
	for (let k = Math.max(0, guess - 1); k <= Math.min(14, guess + 2); k++) {
		let bits = 0;
		for (const v of r) bits += Math.floor(zigzag(v) / 2 ** k) + 1 + k;
		if (bits < best.bits) best = {
			k,
			bits
		};
	}
	return best;
}
function subframe(w, x, bps) {
	let best = null;
	for (let order = 0; order <= Math.min(4, x.length - 1); order++) {
		const r = residual(x, order);
		const { k, bits } = rice(r);
		const total = 8 + order * bps + 2 + 4 + 4 + bits;
		if (!best || total < best.bits) best = {
			order,
			k,
			bits: total,
			r
		};
	}
	const verbatim = 8 + x.length * bps;
	if (!best || best.bits >= verbatim || best.k > 14) {
		w.put(2, 8);
		for (const v of x) w.putSigned(v, bps);
		return;
	}
	w.put((8 | best.order) << 1, 8);
	for (let i = 0; i < best.order; i++) w.putSigned(x[i], bps);
	w.put(0, 2);
	w.put(0, 4);
	w.put(best.k, 4);
	for (const v of best.r) {
		const u = zigzag(v);
		w.unary(Math.floor(u / 2 ** best.k));
		if (best.k) w.put(u & (1 << best.k) - 1, best.k);
	}
}
/** a frame number the way FLAC writes it (like UTF-8) */
function utf8(n) {
	if (n < 128) return [n];
	if (n < 2048) return [192 | n >> 6, 128 | n & 63];
	if (n < 65536) return [
		224 | n >> 12,
		128 | n >> 6 & 63,
		128 | n & 63
	];
	return [
		240 | n >> 18,
		128 | n >> 12 & 63,
		128 | n >> 6 & 63,
		128 | n & 63
	];
}
function writeFlac(pcm, bits = 16) {
	const ch = Math.max(1, Math.min(8, pcm.channels.length));
	const frames = pcm.channels[0]?.length ?? 0;
	const max = 2 ** (bits - 1) - 1;
	const w = new Bits();
	for (const c of "fLaC") w.put(c.charCodeAt(0), 8);
	w.put(128, 8);
	w.put(34, 24);
	w.put(BLOCK, 16);
	w.put(BLOCK, 16);
	w.put(0, 24);
	w.put(0, 24);
	w.put(Math.round(pcm.rate), 20);
	w.put(ch - 1, 3);
	w.put(bits - 1, 5);
	w.put(Math.floor(frames / 2 ** 32), 4);
	w.put(Math.floor(frames / 2 ** 16) & 65535, 16);
	w.put(frames & 65535, 16);
	for (let i = 0; i < 16; i++) w.put(0, 8);
	const ints = pcm.channels.slice(0, ch).map((c) => Int32Array.from(c, (x) => Math.max(-max - 1, Math.min(max, Math.round((x === x ? x : 0) * max)))));
	for (let start = 0, n = 0; start < frames; start += BLOCK, n++) {
		const size = Math.min(BLOCK, frames - start);
		const frameAt = w.bytes;
		w.put(65528, 16);
		w.put(size === BLOCK ? 12 : 7, 4);
		w.put(0, 4);
		w.put(ch - 1, 4);
		w.put(0, 3);
		w.put(0, 1);
		for (const b of utf8(n)) w.put(b, 8);
		if (size !== BLOCK) w.put(size - 1, 16);
		w.put(crc8(w.slice(frameAt)), 8);
		for (let c = 0; c < ch; c++) subframe(w, ints[c].subarray(start, start + size), bits);
		w.align();
		w.put(crc16(w.slice(frameAt)), 16);
	}
	return w.done();
}
// src/format/wav.ts
/** A WAV file: 16 or 24-bit integers, or 32-bit floats. */
function writeWav(pcm, bits = 16) {
	const ch = Math.max(1, pcm.channels.length);
	const frames = pcm.channels[0]?.length ?? 0;
	const bytes = bits / 8;
	const float = bits === 32;
	const dataLen = frames * ch * bytes;
	const out = new Uint8Array(44 + dataLen);
	const v = new DataView(out.buffer);
	const tag = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
	tag(0, "RIFF");
	v.setUint32(4, 36 + dataLen, true);
	tag(8, "WAVE");
	tag(12, "fmt ");
	v.setUint32(16, 16, true);
	v.setUint16(20, float ? 3 : 1, true);
	v.setUint16(22, ch, true);
	v.setUint32(24, Math.round(pcm.rate), true);
	v.setUint32(28, Math.round(pcm.rate) * ch * bytes, true);
	v.setUint16(32, ch * bytes, true);
	v.setUint16(34, bits, true);
	tag(36, "data");
	v.setUint32(40, dataLen, true);
	let o = 44;
	for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
		const x = pcm.channels[c]?.[i] ?? 0;
		const s = x > 1 ? 1 : x < -1 ? -1 : x === x ? x : 0;
		if (float) v.setFloat32(o, s, true);
		else if (bits === 16) v.setInt16(o, Math.round(s * 32767), true);
		else {
			const n = Math.round(s * 8388607);
			v.setUint8(o, n & 255);
			v.setUint8(o + 1, n >> 8 & 255);
			v.setUint8(o + 2, n >> 16 & 255);
		}
		o += bytes;
	}
	return out;
}
/** Read a WAV file (null when it isn't one we can read). */
function readWav(b) {
	if (b.length < 12) return null;
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
	if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
	let fmt = 0, ch = 0, rate = 0, bits = 0, data = -1, dataLen = 0;
	for (let o = 12; o + 8 <= b.length;) {
		const id = tag(o);
		const len = v.getUint32(o + 4, true);
		if (id === "fmt " && o + 24 <= b.length) {
			fmt = v.getUint16(o + 8, true);
			ch = v.getUint16(o + 10, true);
			rate = v.getUint32(o + 12, true);
			bits = v.getUint16(o + 22, true);
			if (fmt === 65534 && len >= 40 && o + 34 <= b.length) fmt = v.getUint16(o + 32, true);
		} else if (id === "data") {
			data = o + 8;
			dataLen = Math.min(len, b.length - data);
			break;
		}
		o += 8 + len + (len & 1);
	}
	if (data < 0 || !ch || !rate || !(fmt === 1 || fmt === 3)) return null;
	const bytes = bits / 8;
	if (![
		1,
		2,
		3,
		4,
		8
	].includes(bytes) || fmt === 3 && bytes < 4) return null;
	const frames = Math.floor(dataLen / (bytes * ch));
	const channels = Array.from({ length: ch }, () => new Float32Array(frames));
	let o = data;
	for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
		let x;
		if (fmt === 3) x = bytes === 8 ? v.getFloat64(o, true) : v.getFloat32(o, true);
		else if (bytes === 1) x = (b[o] - 128) / 128;
		else if (bytes === 2) x = v.getInt16(o, true) / 32768;
		else if (bytes === 3) x = ((b[o + 2] << 24 | b[o + 1] << 16 | b[o] << 8) >> 8) / 8388608;
		else x = v.getInt32(o, true) / 2147483648;
		channels[c][i] = x === x ? x : 0;
		o += bytes;
	}
	return {
		rate,
		channels
	};
}
// src/replayer.ts
/**
* breakerMED — the replayer: it reads a song tick by tick, the way OctaMED and
* ProTracker do, and says what each voice does (start this instrument, at
* this speed, this loud, there). No sound and no clock here: `step()` gives
* one tick and how long it lasts; engine.ts dates those and sends them to the
* deck's sampler (ib.audio). So it runs the same in a test.
*
* A line is `speed` ticks. On a line's first tick the notes start and the
* one-off commands act; the slides, vibratos and arpeggios move on the other
* ticks (on every tick, the first too, in OctaMED's own slide mode).
*
* Commands, in OctaMED's numbering (hex):
*   00 arpeggio · 01/02 slide up/down · 03 slide to note · 04 vibrato (twice
*   ProTracker's depth) · 05 03 + volume slide · 06 04 + volume slide · 07 tremolo ·
*   09 speed (ticks a line) · 0A / 0D volume slide · 0B jump to a position ·
*   0C volume · 0F tempo, 0F00 next block, 0FF1 note twice, 0FF2 half a line
*   late, 0FF3 three times, 0FF8/9 filter, 0FFE stop, 0FFF note off ·
*   11/12 fine slide · 14 vibrato (ProTracker's) · 15 finetune · 16 loop ·
*   18 cut the note · 19 sample offset · 1A/1B fine volume · 1D next block at a
*   line · 1E repeat the line · 1F note delay / retrigger · 2E pan.
* Not yet: 08 hold/decay (the instrument's own hold/decay works), 0E synth jump,
* 20 reverse, the synth instruments' programs, MIDI.
*/
var SINE = [
	0,
	24,
	49,
	74,
	97,
	120,
	141,
	161,
	180,
	197,
	212,
	224,
	235,
	244,
	250,
	253,
	255,
	253,
	250,
	244,
	235,
	224,
	212,
	197,
	180,
	161,
	141,
	120,
	97,
	74,
	49,
	24
];
var Player = class {
	constructor(song, opts = {}) {
		_defineProperty(this, "song", void 0);
		_defineProperty(this, "opts", void 0);
		_defineProperty(this, "seq", 0);
		_defineProperty(this, "line", 0);
		_defineProperty(this, "tick", 0);
		_defineProperty(this, "speed", void 0);
		_defineProperty(this, "tempo", void 0);
		_defineProperty(
			this,
			/** a tempo OctaMED's 0F01 / 0F02 set (as ProTracker BPM), else null */
			"bpmOverride",
			null
		);
		_defineProperty(this, "chans", void 0);
		_defineProperty(this, "delayLines", 0);
		_defineProperty(this, "breakTo", null);
		_defineProperty(this, "jumpTo", null);
		_defineProperty(this, "stopped", false);
		_defineProperty(this, "mix", void 0);
		this.song = song;
		this.opts = opts;
		this.speed = song.speed;
		this.tempo = song.tempo;
		this.chans = Array.from({ length: song.tracks }, (_, i) => this.newChan(i));
		this.mix = Math.min(1, 2 / Math.sqrt(Math.max(4, song.tracks)));
	}
	newChan(i) {
		return {
			inst: 0,
			semi: 0,
			period: 0,
			target: 0,
			portaSpeed: 0,
			volume: 64,
			finetune: 0,
			vibPos: 0,
			vibSpeed: 0,
			vibDepth: 0,
			vibShift: 7,
			tremPos: 0,
			tremSpeed: 0,
			tremDepth: 0,
			pan: this.song.trackPan[i] ?? 0,
			offsetMem: 0,
			delayed: null,
			chord: 0,
			cutAt: -1,
			retrig: 0,
			loopLine: 0,
			loopCount: 0,
			age: 0,
			on: false,
			sent: {
				rate: -1,
				volume: -1,
				pan: -2
			}
		};
	}
	/** Start (again) from a position. */
	jump(seq, line = 0) {
		this.seq = Math.max(0, Math.min(this.song.sequence.length - 1, seq));
		this.line = line;
		this.tick = 0;
		this.delayLines = 0;
		this.breakTo = this.jumpTo = null;
		this.stopped = false;
	}
	get block() {
		return this.song.sequence[this.seq] ?? 0;
	}
	get tickSeconds() {
		const f = this.song.flags;
		return 2.5 / (this.bpmOverride ?? ptBpmOf(this.song.tempoMode, this.tempo, this.song.lpb, f.eightChannel, f.hardwareMix)) * swingFactor(this.song.swing, this.line);
	}
	/** Silence everything (the events to send). */
	silence() {
		return this.chans.map((c, voice) => (c.on = false, c.sent = {
			rate: -1,
			volume: -1,
			pan: -2
		}, {
			voice,
			stop: true
		}));
	}
	/** One tick: what the voices do, and how long it lasts. */
	step() {
		const out = {
			seconds: this.tickSeconds,
			events: []
		};
		if (this.stopped) return {
			...out,
			ended: true
		};
		const triggers = /* @__PURE__ */ new Map();
		if (this.tick === 0 && this.delayLines === 0) {
			out.line = {
				seq: this.seq,
				block: this.block,
				line: this.line
			};
			this.readLine(triggers);
		} else this.effects(triggers);
		this.voices(out.events, triggers);
		out.seconds = this.tickSeconds;
		if (++this.tick >= this.speed) {
			this.tick = 0;
			if (this.delayLines > 0) this.delayLines--;
			if (this.delayLines === 0) this.advance(out);
		}
		if (this.stopped) out.ended = true;
		return out;
	}
	cells() {
		return this.song.blocks[this.block]?.cells[this.line] ?? [];
	}
	inst(c) {
		return this.song.instruments[c.inst - 1];
	}
	/** a note number → the semitone it plays (0 = C-1), the Amiga's octave folding included */
	semiOf(note, inst) {
		let s = note - 1 + this.song.transpose + this.song.noteShift + (inst?.transpose ?? 0);
		if (this.song.format.startsWith("MMD") && !computed(inst)) {
			const top = this.song.flags.hardwareMix ? 36 : 48;
			if (s >= top) s -= Math.floor((s - top + 12) / 12) * 12;
		}
		return s;
	}
	readLine(triggers) {
		const f = this.song.flags;
		this.cells().forEach((cell, t) => {
			const c = this.chans[t];
			if (!c) return;
			c.cutAt = -1;
			c.retrig = 0;
			let porta = false;
			let delay = 0;
			for (let p = 0; p < cell.cmd.length; p++) {
				const cmd = cell.cmd[p], v = cell.val[p];
				if (cmd === 3 || cmd === 5) porta = true;
				if (cmd === 31 && v >> 4) delay = v >> 4;
				if (cmd === 15 && v === 242) delay = this.speed >> 1;
			}
			if (delay && delay < this.speed && (cell.note || cell.inst)) c.delayed = {
				tick: delay,
				note: cell.note,
				inst: cell.inst,
				porta,
				chord: cell.chord ?? 0
			};
			else this.noteOn(c, t, cell.note, cell.inst, porta, triggers, cell.chord ?? 0);
			for (let p = 0; p < cell.cmd.length; p++) this.lineCommand(c, t, cell.cmd[p], cell.val[p], !!cell.note, triggers);
			if (!f.ptSlides) this.slides(c, cell.cmd, cell.val, true);
		});
	}
	noteOn(c, t, note, instNo, porta, triggers, chord = 0) {
		if (instNo) {
			c.inst = instNo;
			const inst = this.inst(c);
			c.volume = inst?.volume ?? 64;
			c.finetune = inst?.finetune ?? 0;
		}
		if (note === 128) {
			c.on = false;
			triggers.set(t, -1);
			return;
		}
		if (!note) return;
		const inst = this.inst(c);
		const semi = this.semiOf(note, inst);
		const period = periodOf(semi, c.finetune);
		if (porta && c.on) {
			c.target = period;
			return;
		}
		c.semi = semi;
		c.chord = chord;
		c.period = c.target = period;
		c.vibPos = c.tremPos = 0;
		c.age = 0;
		if (playable(inst)) {
			c.on = true;
			triggers.set(t, 0);
		} else {
			c.on = false;
			triggers.set(t, -1);
		}
	}
	lineCommand(c, t, cmd, v, hasNote, triggers) {
		const f = this.song.flags;
		switch (cmd) {
			case 3:
				if (v) c.portaSpeed = v;
				break;
			case 4:
				if (v >> 4) c.vibSpeed = v >> 4;
				if (v & 15) c.vibDepth = v & 15;
				c.vibShift = 6;
				break;
			case 20:
				if (v >> 4) c.vibSpeed = v >> 4;
				if (v & 15) c.vibDepth = v & 15;
				c.vibShift = 7;
				break;
			case 7:
				if (v >> 4) c.tremSpeed = v >> 4;
				if (v & 15) c.tremDepth = v & 15;
				break;
			case 9:
				if (v > 0 && v <= 32) this.speed = v;
				break;
			case 11:
				this.jumpTo = v;
				this.breakTo ??= 0;
				break;
			case 12: {
				let vol;
				if (f.vol7bit) vol = (v & 127) + 1 >> 1;
				else if (f.volHex) vol = Math.min(64, v & 127);
				else vol = v < 153 ? (v >> 4) * 10 + (v & 15) : 64;
				c.volume = Math.min(64, vol);
				break;
			}
			case 15:
				this.cmd0F(c, t, v, triggers);
				break;
			case 17:
				c.period = this.clampPeriod(c.period - (v & 15));
				break;
			case 18:
				c.period = this.clampPeriod(c.period + (v & 15));
				break;
			case 21:
				c.finetune = (v & 15) > 7 ? (v & 15) - 16 : v & 15;
				break;
			case 22:
				if ((v & 15) === 0) c.loopLine = this.line;
				else if (c.loopCount === 0) {
					c.loopCount = v & 15;
					this.breakTo = c.loopLine;
					this.jumpTo = -1;
				} else if (--c.loopCount > 0) {
					this.breakTo = c.loopLine;
					this.jumpTo = -1;
				}
				break;
			case 24:
				c.cutAt = Math.min(15, v);
				if (c.cutAt === 0) c.volume = 0;
				break;
			case 25:
				if (v) c.offsetMem = v * 256;
				if (hasNote && triggers.get(t) === 0) triggers.set(t, c.offsetMem);
				break;
			case 26:
				c.volume = Math.min(64, c.volume + (v & 15));
				break;
			case 27:
				c.volume = Math.max(0, c.volume - (v & 15));
				break;
			case 29:
				this.breakTo = v;
				break;
			case 30:
				if (this.delayLines === 0 && v) this.delayLines = Math.min(15, v) + 1;
				break;
			case 31:
				c.retrig = v & 15;
				break;
			case 46: {
				const s = v > 127 ? v - 256 : v;
				if (s >= -16 && s <= 16) c.pan = s / 16;
				break;
			}
		}
	}
	cmd0F(c, t, v, triggers) {
		if (v === 0) this.breakTo = 0;
		else if (v <= 240) {
			if (this.song.tempoMode === "pt") {
				if (v >= 32) this.tempo = v;
			} else if (v < 3) this.bpmOverride = 112;
			else {
				this.tempo = v;
				this.bpmOverride = null;
			}
		} else if (v === 241) c.retrig = Math.max(1, this.speed >> 1);
		else if (v === 243) c.retrig = Math.max(1, Math.floor(this.speed / 3));
		else if (v === 248) this.song.flags.filter = false;
		else if (v === 249) this.song.flags.filter = true;
		else if (v === 254) this.stopped = true;
		else if (v === 255) {
			c.on = false;
			triggers.set(t, -1);
		}
	}
	/** the ticks after the first: slides, vibrato, arpeggio, retrigger, cut, delayed notes */
	effects(triggers) {
		this.cells().forEach((cell, t) => {
			const c = this.chans[t];
			if (!c) return;
			if (c.delayed && c.delayed.tick === this.tick) {
				const d = c.delayed;
				c.delayed = null;
				this.noteOn(c, t, d.note, d.inst, d.porta, triggers, d.chord);
			}
			if (c.cutAt === this.tick) c.volume = 0;
			if (c.retrig && this.tick % c.retrig === 0 && c.on) {
				c.age = 0;
				triggers.set(t, 0);
			}
			this.slides(c, cell.cmd, cell.val, false);
		});
	}
	/** slides on this tick (`first`: OctaMED's own mode also slides on a line's first tick) */
	slides(c, cmds, vals, first) {
		for (let p = 0; p < cmds.length; p++) {
			const cmd = cmds[p], v = vals[p];
			switch (cmd) {
				case 1:
					c.period = this.clampPeriod(c.period - v);
					break;
				case 2:
					c.period = this.clampPeriod(c.period + v);
					break;
				case 3:
					this.toward(c);
					break;
				case 5:
					this.toward(c);
					this.volSlide(c, v);
					break;
				case 6:
					if (!first) this.vibrato(c);
					this.volSlide(c, v);
					break;
				case 10:
				case 13:
					this.volSlide(c, v);
					break;
				case 4:
				case 20:
					if (!first) this.vibrato(c);
					break;
				case 7: if (!first) c.tremPos = c.tremPos + c.tremSpeed & 63;
			}
		}
	}
	toward(c) {
		if (!c.target || !c.portaSpeed) return;
		if (c.period < c.target) c.period = Math.min(c.target, c.period + c.portaSpeed);
		else if (c.period > c.target) c.period = Math.max(c.target, c.period - c.portaSpeed);
	}
	volSlide(c, v) {
		if (v >> 4) c.volume = Math.min(64, c.volume + (v >> 4));
		else c.volume = Math.max(0, c.volume - (v & 15));
	}
	vibrato(c) {
		c.vibPos = c.vibPos + c.vibSpeed & 63;
	}
	clampPeriod(p) {
		return this.song.tempoMode === "pt" ? Math.max(113, Math.min(856, p)) : Math.max(28, Math.min(6848, p));
	}
	/** what each voice plays now, as events (only what changed) */
	voices(events, triggers) {
		const s = this.song;
		this.chans.forEach((c, voice) => {
			const trig = triggers.get(voice);
			const muted = this.opts.muted?.has(voice);
			if (trig === -1 || !c.on && c.sent.volume !== 0 && c.sent.volume !== -1) {
				events.push({
					voice,
					stop: true
				});
				c.sent = {
					rate: -1,
					volume: 0,
					pan: -2
				};
				return;
			}
			if (!c.on) return;
			const inst = this.inst(c);
			if (!inst) return;
			let period = c.period;
			for (const [cmd, v] of this.cellCmds(voice)) {
				if (cmd === 0 && v) {
					const k = this.tick % 3;
					if (k) period = periodOf(c.semi + (k === 1 ? v >> 4 : v & 15), c.finetune);
				}
				if ((cmd === 4 || cmd === 20 || cmd === 6) && c.vibDepth) period += SINE[c.vibPos & 31] * (c.vibPos & 32 ? -1 : 1) * c.vibDepth >> c.vibShift;
			}
			let vol = c.volume;
			if (this.cellCmds(voice).some(([cmd]) => cmd === 7) && c.tremDepth) vol = Math.max(0, Math.min(64, vol + (SINE[c.tremPos & 31] * (c.tremPos & 32 ? -1 : 1) * c.tremDepth >> 6)));
			let env = 1;
			if (inst.hold > 0) {
				if (c.age >= inst.hold) env = inst.decay ? Math.max(0, 1 - (c.age - inst.hold + 1) * inst.decay / 64) : 0;
			}
			c.age++;
			const rate = PAULA_CLOCK / Math.max(1, period);
			const volume = muted ? 0 : vol / 64 * env * inst.gain * ((s.trackVolume[voice] ?? 64) / 64) * (s.masterVolume / 64) * this.mix;
			const ev = { voice };
			let any = false;
			if (trig !== void 0 && trig >= 0) {
				ev.play = c.inst - 1;
				ev.offset = trig;
				const chord = chordNotes(s, c.chord);
				if (chord.length) ev.chord = chord;
				any = true;
			}
			if (any || Math.abs(rate - c.sent.rate) > 1e-6) ev.rate = rate, any = true;
			if (any || Math.abs(volume - c.sent.volume) > 1e-6) ev.volume = volume, any = true;
			if (any || c.pan !== c.sent.pan) ev.pan = c.pan, any = true;
			if (any) {
				events.push(ev);
				c.sent = {
					rate,
					volume,
					pan: c.pan
				};
			}
		});
	}
	cellCmds(t) {
		const cell = this.cells()[t];
		if (!cell) return [];
		return cell.cmd.map((cmd, i) => [cmd, cell.val[i]]);
	}
	/** after a line: the next one (breaks, jumps, loops, the block's end, the song's end) */
	advance(out) {
		const seqLen = this.song.sequence.length;
		const lines = this.song.blocks[this.block]?.lines ?? 64;
		if (this.opts.loopBlock) {
			if (this.jumpTo === -1 && this.breakTo !== null) this.line = this.breakTo;
			else if (this.breakTo !== null || this.jumpTo !== null) this.line = 0;
			else this.line = (this.line + 1) % lines;
		} else if (this.jumpTo === -1 && this.breakTo !== null) this.line = this.breakTo;
		else if (this.jumpTo !== null && this.jumpTo >= 0) {
			if (this.jumpTo <= this.seq) out.wrapped = true;
			this.seq = this.jumpTo < seqLen ? this.jumpTo : 0;
			this.line = this.breakTo ?? 0;
		} else if (this.breakTo !== null) {
			this.next(out);
			this.line = this.breakTo;
		} else if (++this.line >= lines) {
			this.next(out);
			this.line = 0;
		}
		const now = this.song.blocks[this.block]?.lines ?? 64;
		if (this.line >= now) this.line = 0;
		this.breakTo = this.jumpTo = null;
	}
	next(out) {
		if (++this.seq >= this.song.sequence.length) {
			this.seq = Math.min(this.song.restart, this.song.sequence.length - 1);
			out.wrapped = true;
		}
	}
};
/** How long the song lasts once through (seconds), and its lines — by playing it silently. */
function songLength(song, maxSeconds = 3600) {
	const p = new Player(song);
	let seconds = 0;
	let lines = 0;
	while (seconds < maxSeconds) {
		const t = p.step();
		if (t.line) lines++;
		seconds += t.seconds;
		if (t.wrapped || t.ended) break;
	}
	return {
		seconds,
		lines
	};
}
// src/dsp/voice.ts
/**
* A sample: read at `rate` frames a second, looped (ping-pong too), stepped
* like the Amiga's Paula (nearest frame, its grit) or smooth (linear).
*/
var SampleVoice = class {
	constructor(outRate) {
		_defineProperty(this, "outRate", void 0);
		_defineProperty(this, "on", false);
		_defineProperty(this, "paula", true);
		_defineProperty(this, "data", /* @__PURE__ */ new Float32Array(0));
		_defineProperty(this, "loopStart", 0);
		_defineProperty(this, "loopEnd", 0);
		_defineProperty(this, "pingPong", false);
		_defineProperty(this, "pos", 0);
		_defineProperty(this, "dir", 1);
		_defineProperty(this, "step", 1);
		_defineProperty(this, "gl", 0);
		_defineProperty(this, "gr", 0);
		this.outRate = outRate;
	}
	start(n) {
		const i = n.instrument;
		this.data = i.data;
		this.loopStart = i.loopLength > 2 ? i.loopStart : 0;
		this.loopEnd = i.loopLength > 2 ? Math.min(i.data.length, i.loopStart + i.loopLength) : 0;
		this.pingPong = i.pingPong && this.loopEnd > 0;
		this.pos = Math.max(0, n.offset);
		this.dir = 1;
		this.step = Math.max(0, n.rate) / this.outRate;
		this.on = this.pos < this.data.length;
	}
	set(rate, volume, pan) {
		this.step = Math.max(0, rate) / this.outRate;
		const v = Math.max(0, Math.min(1, volume));
		this.gl = v * Math.min(1, 1 - pan);
		this.gr = v * Math.min(1, 1 + pan);
	}
	stop() {
		this.on = false;
	}
	render(left, right, from, to) {
		if (!this.on) return;
		const d = this.data;
		const loops = this.loopEnd > this.loopStart;
		const end = loops ? this.loopEnd : d.length;
		const loopLen = this.loopEnd - this.loopStart;
		let pos = this.pos;
		for (let i = from; i < to; i++) {
			if (this.dir > 0 && pos >= end) {
				if (!loops) return void (this.on = false);
				if (this.pingPong) this.dir = -1, pos = end - 1 - (pos - end);
				else pos = this.loopStart + (pos - this.loopStart) % loopLen;
			} else if (this.dir < 0 && pos < this.loopStart) this.dir = 1, pos = this.loopStart + (this.loopStart - pos);
			const k = pos | 0;
			let x = d[k] ?? 0;
			if (!this.paula) {
				const k1 = k + this.dir;
				const y = k1 >= end ? loops ? d[this.loopStart] : x : k1 < 0 ? x : d[k1];
				x += ((y ?? x) - x) * Math.abs(pos - k);
			}
			left[i] += x * this.gl;
			right[i] += x * this.gr;
			pos += this.step * this.dir;
		}
		this.pos = pos;
	}
};
/** The voice an instrument plays with: a sample's, or a synth's (it releases its notes instead of cutting them). */
function voiceFor(instrument, outRate, paula) {
	if (instrument.kind === "analog") return new AnalogVoice(outRate);
	if (instrument.kind === "fm") return new FmVoice(outRate);
	if (instrument.kind === "drums") return new DrumVoice(outRate);
	if (instrument.kind === "chip") return new ChipVoice(outRate);
	const v = new SampleVoice(outRate);
	v.paula = paula;
	return v;
}
// src/dsp/limiter.ts
/**
* breakerMED — the last thing on the mix: a peak limiter, so a louder song never
* clips. Below the ceiling it does nothing; a peak over it turns the gain down at
* once (the same gain on both sides, no distortion), and the gain comes back slowly.
*/
var Limiter = class Limiter {
	constructor(rate, releaseSeconds = .15) {
		_defineProperty(this, "gain", 1);
		_defineProperty(this, "back", void 0);
		this.back = 1 - Math.exp(-1 / (releaseSeconds * rate));
	}
	process(left, right, from, to) {
		const c = Limiter.CEILING;
		let g = this.gain;
		for (let i = from; i < to; i++) {
			const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
			const want = peak > c ? c / peak : 1;
			g = want < g ? want : g + (want - g) * this.back;
			left[i] *= g;
			right[i] *= g;
		}
		this.gain = g;
	}
};
_defineProperty(Limiter, "CEILING", .891);
// src/render.ts
/**
* breakerMED — the renderer: the song turned into sound, frame by frame, here
* in the module (the deck only plays what we hand it: ib.audio.stream). The
* replayer says what each track does on each tick; the renderer starts and
* changes the voices exactly on the tick's first frame and mixes them.
*
* The same code plays the song, previews the keys (a few voices past the
* tracks) and, later, writes the exports (a rate of our choosing, as fast as
* the computer goes, one track alone for a stem).
*/
/** keys played on the piano: a few voices of their own, in turn */
var PREVIEWS = 4;
/** a key played alone: about as loud as a note of the song */
var PREVIEW_GAIN = .7;
var Renderer = class {
	constructor(song, rate, paula = true) {
		_defineProperty(this, "song", void 0);
		_defineProperty(this, "rate", void 0);
		_defineProperty(this, "paula", void 0);
		_defineProperty(
			this,
			/** frames written so far */
			"frame",
			0
		);
		_defineProperty(
			this,
			/** where each line began (the page follows the one being heard) */
			"marks",
			[]
		);
		_defineProperty(this, "ended", false);
		_defineProperty(this, "player", null);
		_defineProperty(this, "voices", []);
		_defineProperty(this, "previews", []);
		_defineProperty(
			this,
			/** voices still releasing after their track moved on (a synth's tail) */
			"tails",
			[]
		);
		_defineProperty(
			this,
			/** each track's chord: the extra voices over its note, and their intervals */
			"chordVoices",
			[]
		);
		_defineProperty(this, "chordSteps", []);
		_defineProperty(this, "nextPreview", 0);
		_defineProperty(
			this,
			/** the A500's "LED" filter: a 12 dB low-pass at ~3.3 kHz, on when the song says (0FF9 / med filter on) */
			"led",
			{
				b0: 0,
				b1: 0,
				b2: 0,
				a1: 0,
				a2: 0,
				x: [
					0,
					0,
					0,
					0
				],
				y: [
					0,
					0,
					0,
					0
				]
			}
		);
		_defineProperty(
			this,
			/** frames left in the current tick (and the fraction carried, so ticks don't drift) */
			"tickLeft",
			0
		);
		_defineProperty(
			this,
			/** the mix's last stage: loud, never clipping */
			"limiter",
			void 0
		);
		_defineProperty(
			this,
			/** the limiter on (tests of the echo or the mix turn it off to measure them) */
			"limit",
			true
		);
		_defineProperty(this, "carry", 0);
		_defineProperty(
			this,
			/** OctaMED's echo: a delay line a side, fed back softer each time (cross: from one side to the other) */
			"echoL",
			null
		);
		_defineProperty(this, "echoR", null);
		_defineProperty(this, "echoAt", 0);
		this.song = song;
		this.rate = rate;
		this.paula = paula;
		this.limiter = new Limiter(rate);
		const w = Math.tan(Math.PI * Math.min(3275, rate * .45) / rate);
		const n = 1 / (1 + Math.SQRT2 * w + w * w);
		this.led.b0 = w * w * n;
		this.led.b1 = 2 * this.led.b0;
		this.led.b2 = this.led.b0;
		this.led.a1 = 2 * (w * w - 1) * n;
		this.led.a2 = (1 - Math.SQRT2 * w + w * w) * n;
	}
	/** Play from a position (the song, or one block again and again). */
	play(seq, line, opts = {}) {
		this.player = new Player(this.song, opts);
		this.player.jump(seq, line);
		this.tickLeft = 0;
		this.carry = 0;
		this.ended = false;
		this.stopAll();
	}
	stop() {
		this.player = null;
		this.stopAll();
	}
	/** Everything quiet now: no song, no note ringing, no echo (the deck silenced us). */
	silence() {
		this.player = null;
		this.voices = [];
		this.tails = [];
		this.chordVoices = [];
		this.chordSteps = [];
		this.previews = [];
		this.echoL = this.echoR = null;
	}
	stopAll() {
		for (const v of this.voices) v?.stop();
		for (const list of this.chordVoices) for (const v of list ?? []) v.stop();
	}
	/** The song ends here, but what's ringing keeps ringing (an export's tail). */
	finish() {
		this.player = null;
	}
	get playing() {
		return !!this.player && !this.ended;
	}
	/** something to hear: the song, or a key still ringing */
	get busy() {
		return this.playing || this.previews.some((p) => p?.voice.on) || this.voices.some((v) => v?.on) || this.tails.length > 0 || this.chordVoices.some((l) => l?.some((v) => v.on)) || this.echoing();
	}
	/** A key played now: instrument `inst` at `rate`, for `seconds` at most (no key-up from the deck). */
	preview(inst, rate, seconds = .6) {
		const instrument = this.song.instruments[inst];
		if (!instrument || instrument.kind === "empty") return;
		if (instrument.kind === "drums") seconds = 10;
		const slot = this.nextPreview++ % PREVIEWS;
		const voice = voiceFor(instrument, this.rate, this.paula);
		voice.start({
			instrument,
			rate,
			offset: 0
		});
		voice.set(rate, PREVIEW_GAIN * instrument.gain * (instrument.volume / 64), 0);
		this.previews[slot] = {
			voice,
			until: this.frame + Math.round(seconds * this.rate)
		};
	}
	/** The next `n` frames, added into left / right (they start at zero). */
	render(left, right, n = left.length) {
		let at = 0;
		while (at < n) {
			if (this.player && !this.ended && this.tickLeft <= 0) this.tick(at);
			const span = this.player && !this.ended ? Math.min(n - at, Math.max(1, this.tickLeft)) : n - at;
			for (const v of this.voices) v?.render(left, right, at, at + span);
			for (const list of this.chordVoices) for (const v of list ?? []) v.render(left, right, at, at + span);
			for (const v of this.tails) v.render(left, right, at, at + span);
			if (this.tails.length) this.tails = this.tails.filter((v) => v.on);
			for (const p of this.previews) {
				if (!p) continue;
				if (!p.released && p.until <= this.frame + at) p.voice.stop(), p.released = true;
				if (p.voice.on) p.voice.render(left, right, at, at + span);
			}
			if (this.song.flags.filter) this.filter(left, right, at, at + span);
			if (this.song.echo) this.echo(left, right, at, at + span, this.song.echo);
			else if (this.echoL) this.echoL = this.echoR = null;
			if (this.limit) this.limiter.process(left, right, at, at + span);
			at += span;
			this.tickLeft -= span;
		}
		this.frame += n;
	}
	echo(left, right, from, to, e) {
		const size = Math.ceil(ECHO_MAX_MS / 1e3 * this.rate) + 1;
		if (!this.echoL) this.echoL = new Float32Array(size), this.echoR = new Float32Array(size);
		const bl = this.echoL, br = this.echoR;
		const delay = Math.max(1, Math.min(size - 1, Math.round(e.ms / 1e3 * this.rate)));
		const g = 2 ** -e.depth;
		const cross = e.type === "cross";
		let w = this.echoAt;
		for (let i = from; i < to; i++) {
			const r = (w - delay + size) % size;
			const dl = bl[r], dr = br[r];
			const yl = left[i] + dl, yr = right[i] + dr;
			left[i] = yl;
			right[i] = yr;
			bl[w] = (cross ? yr : yl) * g;
			br[w] = (cross ? yl : yr) * g;
			w = (w + 1) % size;
		}
		this.echoAt = w;
	}
	/** something still echoing (the song stopped, the echo rings on) */
	echoing() {
		if (!this.song.echo || !this.echoL) return false;
		for (let i = 0; i < this.echoL.length; i += 64) if (Math.abs(this.echoL[i]) > 1e-4 || Math.abs(this.echoR[i]) > 1e-4) return true;
		return false;
	}
	filter(left, right, from, to) {
		const f = this.led;
		const [xl1, xl2, yl1, yl2] = [
			f.x[0],
			f.x[1],
			f.y[0],
			f.y[1]
		];
		let a = xl1, b = xl2, c = yl1, d = yl2;
		for (let i = from; i < to; i++) {
			const x = left[i];
			const y = f.b0 * x + f.b1 * a + f.b2 * b - f.a1 * c - f.a2 * d;
			b = a, a = x, d = c, c = y;
			left[i] = y;
		}
		f.x[0] = a, f.x[1] = b, f.y[0] = c, f.y[1] = d;
		let e = f.x[2], g = f.x[3], h = f.y[2], k = f.y[3];
		for (let i = from; i < to; i++) {
			const x = right[i];
			const y = f.b0 * x + f.b1 * e + f.b2 * g - f.a1 * h - f.a2 * k;
			g = e, e = x, k = h, h = y;
			right[i] = y;
		}
		f.x[2] = e, f.x[3] = g, f.y[2] = h, f.y[3] = k;
	}
	tick(at) {
		const t = this.player.step();
		if (t.line) this.marks.push({
			frame: this.frame + at,
			...t.line
		});
		for (const e of t.events) this.apply(e);
		if (t.ended) {
			this.ended = true;
			return;
		}
		const exact = t.seconds * this.rate + this.carry;
		this.tickLeft = Math.max(1, Math.floor(exact));
		this.carry = exact - this.tickLeft;
		if (this.marks.length > 512) this.marks.splice(0, this.marks.length - 256);
	}
	apply(e) {
		if (e.stop) {
			this.voices[e.voice]?.stop();
			for (const v of this.chordVoices[e.voice] ?? []) v.stop();
			return;
		}
		if (e.play !== void 0) {
			const instrument = this.song.instruments[e.play];
			if (!instrument) return;
			const old = this.voices[e.voice];
			if (old?.on && instrument.kind === "analog" && old.instrument === instrument && (instrument.synth?.glide ?? 0) > 0) old.start({
				instrument,
				rate: e.rate ?? 8363,
				offset: 0
			});
			else {
				if (old?.on && old.rings) {
					if (!(old instanceof DrumVoice)) old.stop();
					if (old instanceof DrumVoice && instrument.kind === "drums" && old.chokedBy(drumOf(e.rate ?? 8363, 16574.27570093458))) old.kill();
					if (old.on && this.tails.length < 32) this.tails.push(old);
				}
				const v = voiceFor(instrument, this.rate, this.paula);
				v.instrument = instrument;
				v.start({
					instrument,
					rate: e.rate ?? 8363,
					offset: e.offset ?? 0
				});
				this.voices[e.voice] = v;
			}
			for (const old of this.chordVoices[e.voice] ?? []) {
				if (!old.on || !old.rings) continue;
				if (!(old instanceof DrumVoice || old instanceof Strummed && old.inner instanceof DrumVoice)) old.stop();
				if (old.on && this.tails.length < 32) this.tails.push(old);
			}
			let steps = (e.chord ?? []).slice(0, 5);
			const main = this.voices[e.voice];
			if (steps.length && main instanceof ChipVoice && (instrument.chip?.arp ?? 0) > 0) {
				main.arpeggio(steps);
				steps = [];
			}
			this.chordSteps[e.voice] = steps;
			const strum = Math.round((this.song.trackStrum?.[e.voice] ?? 0) / 1e3 * this.rate);
			const order = steps.map((st, i) => ({
				st,
				i
			})).sort((a, b) => a.st - b.st);
			this.chordVoices[e.voice] = steps.map((st, i) => {
				const cv = voiceFor(instrument, this.rate, this.paula);
				cv.start({
					instrument,
					rate: (e.rate ?? 8363) * 2 ** (st / 12),
					offset: e.offset ?? 0
				});
				if (!strum) return cv;
				const rank = order.findIndex((o) => o.i === i), below = order.filter((o) => o.st < 0).length;
				return rank < below ? cv : new Strummed(cv, (rank - below + 1) * strum);
			});
		}
		const v = this.voices[e.voice];
		if (!v) return;
		const s = v;
		s.lastRate = e.rate ?? s.lastRate ?? 8363;
		s.lastVol = e.volume ?? s.lastVol ?? 0;
		s.lastPan = e.pan ?? s.lastPan ?? 0;
		const chord = this.chordVoices[e.voice] ?? [];
		const k = chord.length ? 1 / Math.sqrt(1 + chord.length) : 1;
		v.set(s.lastRate, s.lastVol * k, s.lastPan);
		chord.forEach((cv, i) => cv.set(s.lastRate * 2 ** ((this.chordSteps[e.voice]?.[i] ?? 0) / 12), s.lastVol * k, s.lastPan));
	}
};
/** A chord's note that starts `wait` frames late (a strum): silent until then, the same voice after. */
var Strummed = class {
	constructor(inner, wait) {
		_defineProperty(this, "inner", void 0);
		_defineProperty(this, "wait", void 0);
		_defineProperty(
			this,
			/** let go before it was heard: it never will be */
			"dead",
			false
		);
		this.inner = inner;
		this.wait = wait;
	}
	get on() {
		return !this.dead && (this.wait > 0 || this.inner.on);
	}
	get rings() {
		return this.inner.rings;
	}
	start(n) {
		this.inner.start(n);
	}
	set(rate, volume, pan) {
		this.inner.set(rate, volume, pan);
	}
	stop() {
		if (this.wait > 0) this.dead = true;
		this.inner.stop();
	}
	render(left, right, from, to) {
		if (this.dead) return;
		if (this.wait >= to - from) return void (this.wait -= to - from);
		const start = from + this.wait;
		this.wait = 0;
		this.inner.render(left, right, start, to);
	}
};
// src/export.ts
/**
* breakerMED — exports: the song computed again, here, at the rate you choose
* (independent of the sound card), as fast as the computer goes, then written
* as WAV (16 / 24 bits, 32-bit float), AIFF or FLAC — or, through the deck's
* encoder pack (`encoders install`, then ib.audio.encode), MP3, M4A, OGG or Opus.
* The master, or one track alone (a stem): the same renderer as what you hear,
* so the file is what you heard.
*/
var RATES = [
	22050,
	32e3,
	44100,
	48e3,
	88200,
	96e3
];
/** the formats the deck's encoder pack makes, their qualities (the first is the default) */
var QUALITIES = {
	mp3: [
		"v0",
		"v2",
		"128",
		"192",
		"256",
		"320"
	],
	m4a: [
		"256",
		"192",
		"128"
	],
	ogg: [
		"q6",
		"q4",
		"q8"
	],
	opus: [
		"128",
		"96",
		"160"
	]
};
var isLossy = (f) => f in QUALITIES;
/** a file name's format: .wav .aif .aiff .flac .mp3 .m4a .ogg .opus (none: WAV) */
function formatOf(path) {
	const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
	if (!ext) return "wav";
	if (ext === "aif" || ext === "aiff") return "aiff";
	return ext === "wav" || ext === "flac" || isLossy(ext) ? ext : null;
}
/** the extension a format's files get */
var extOf = (f) => f === "aiff" ? "aif" : f;
/** what a format can do (`quality`: only for MP3, M4A, OGG, Opus; "" = the default) */
function checkFormat(format, bits, rate, quality = "") {
	if (format === "flac" && bits === 32) return "FLAC goes up to 24 bits (32-bit float: WAV or AIFF)";
	if (!RATES.includes(rate)) return `a rate among ${RATES.join(", ")}`;
	if (isLossy(format)) {
		if (rate > 48e3) return `${format.toUpperCase()} goes up to 48000 Hz`;
		if (quality && !QUALITIES[format].includes(quality.toLowerCase())) return `${format.toUpperCase()} quality ${QUALITIES[format].join(", ")} (default ${QUALITIES[format][0]})`;
	} else if (quality) return "--quality is for MP3, M4A, OGG and Opus (WAV, AIFF, FLAC: --bits)";
	return null;
}
/** what an export in this format is, for the last line ("MP3 · v0 · 48000 Hz") */
function describe(format, bits, rate, quality = "") {
	if (!isLossy(format)) return `${format.toUpperCase()} · ${bits === 32 ? "32-bit float" : `${bits} bits`} · ${rate} Hz`;
	const q = (quality || QUALITIES[format][0]).toLowerCase();
	const shown = /^\d+$/.test(q) ? `${q} kbps` : format === "mp3" ? `VBR ${q.toUpperCase()}` : `quality ${q.slice(1)}`;
	return `${format.toUpperCase()} · ${shown} · ${format === "opus" ? 48e3 : rate} Hz`;
}
/** left and right as one interleaved array (what the encoder pack reads) */
function interleave(pcm) {
	const [l, r = l] = pcm.channels;
	const out = new Float32Array(l.length * 2);
	for (let i = 0; i < l.length; i++) out[2 * i] = l[i], out[2 * i + 1] = r[i];
	return out;
}
/** why a lossy export can't happen here (null: it can) */
async function encoderProblem(audio, format) {
	if (!audio.encode || !audio.encoders) return `${format.toUpperCase()} needs a newer ICEBREAKER (with the encoder pack) — WAV, AIFF and FLAC work here`;
	const e = await audio.encoders();
	if (!e.supported) return `there's no encoder pack for this computer yet — WAV, AIFF and FLAC work here`;
	if (!e.installed) return `${format.toUpperCase()} needs the deck's encoder pack: run \`encoders install\` (once, ~3 MB), then export again`;
	return null;
}
/** an MP3 / M4A / OGG / Opus file's bytes, through the deck's encoder pack */
async function encodeLossy(audio, pcm, format, quality, title) {
	return audio.encode(interleave(pcm), {
		format,
		quality: quality.toLowerCase(),
		rate: pcm.rate,
		channels: 2,
		title
	});
}
/** The song as sound: once through, plus its tail. `onProgress(0…1)`; it yields now and then. */
async function renderSong(song, o, onProgress) {
	const r = new Renderer(song, o.rate, o.paula);
	const muted = new Set(o.muted ?? []);
	if (o.solo?.length) {
		for (let t = 0; t < song.tracks; t++) if (!o.solo.includes(t)) muted.add(t);
	}
	r.play(0, 0, { muted });
	const body = Math.ceil(songLength(song).seconds * o.rate);
	const tail = Math.round((o.tail ?? 1.5) * o.rate);
	const total = body + tail;
	const left = new Float32Array(total), right = new Float32Array(total);
	const CHUNK = 8192;
	let lastYield = 0;
	for (let at = 0, n = 0; at < total; at += n) {
		if (at === body) r.finish();
		n = Math.min(CHUNK, at < body ? body - at : total - at);
		const l = new Float32Array(n), rr = new Float32Array(n);
		r.render(l, rr, n);
		left.set(l, at);
		right.set(rr, at);
		if (at - lastYield > o.rate / 2) {
			lastYield = at;
			onProgress?.(at / total);
			await new Promise((ok) => setTimeout(ok, 0));
		}
	}
	const fade = Math.min(tail, Math.round(.5 * o.rate));
	for (let i = 0; i < fade; i++) {
		const g = 1 - i / fade;
		left[total - fade + i] *= g;
		right[total - fade + i] *= g;
	}
	if (o.normalize) {
		let peak = 0;
		for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
		if (peak > 1e-6) {
			const g = .966 / peak;
			for (let i = 0; i < total; i++) left[i] *= g, right[i] *= g;
		}
	}
	onProgress?.(1);
	return {
		rate: o.rate,
		channels: [left, right]
	};
}
/** 16 bits: a whisper of noise (TPDF dither) so quiet passages don't turn to grit — unless you asked for grit */
function dither16(pcm) {
	let seed = 22222;
	const rnd = () => (seed = seed * 1103515245 + 12345 & 2147483647) / 2147483647;
	const lsb = 1 / 32768;
	for (const c of pcm.channels) for (let i = 0; i < c.length; i++) c[i] += (rnd() - rnd()) * lsb;
}
function encode(pcm, format, bits, dither = true) {
	if (bits === 16 && dither) dither16(pcm);
	if (format === "aiff") return writeAiff(pcm, bits);
	if (format === "flac") return writeFlac(pcm, bits === 32 ? 24 : bits);
	return writeWav(pcm, bits);
}
/** Does this track play anything (a stem worth writing)? */
function trackUsed(song, t) {
	const used = new Set(song.sequence);
	return song.blocks.some((b, n) => used.has(n) && b.cells.some((row) => !!row[t]?.note));
}
// src/screens.ts
var SCREENS = [
	{
		id: "block",
		label: "BLOCK",
		short: "BLK",
		key: "B"
	},
	{
		id: "instrument",
		label: "INSTRUMENT",
		short: "INST",
		key: "I"
	},
	{
		id: "song",
		label: "SONG",
		short: "SONG",
		key: "S"
	},
	{
		id: "export",
		label: "EXPORT",
		short: "EXP",
		key: "E"
	},
	{
		id: "guide",
		label: "? GUIDE",
		short: "?",
		key: "?"
	}
];
var FORMATS = [
	"wav",
	"aiff",
	"flac",
	"mp3",
	"m4a",
	"ogg",
	"opus"
];
var WHAT = [
	"master",
	"master + stems",
	"stems only"
];
var newExportChoices = () => ({
	path: "",
	format: "wav",
	rate: 48e3,
	bits: 24,
	quality: "",
	what: "master + stems",
	normalize: false,
	tail: 1.5
});
/** the `med export` line the choices make */
function exportLine(x, q) {
	const lossy = isLossy(x.format);
	const parts = ["med export", q(`${(x.path.trim() || "songs/untitled").replace(/\.(wav|aiff?|flac|mp3|m4a|ogg|opus)$/i, "")}.${extOf(x.format)}`)];
	if (x.format !== "opus" && x.rate !== 48e3) parts.push(`--rate ${x.rate}`);
	if (lossy) {
		if (x.quality && x.quality !== QUALITIES[x.format][0]) parts.push(`--quality ${x.quality}`);
	} else if (x.bits !== (x.format === "flac" ? 16 : 24)) parts.push(`--bits ${x.bits}`);
	if (x.what === "master + stems") parts.push("--stems");
	if (x.what === "stems only") parts.push("--only-stems");
	if (x.normalize) parts.push("--normalize");
	if (x.tail !== 1.5) parts.push(`--tail ${x.tail}`);
	return parts.join(" ");
}
/** keep the choices possible: FLAC has no 32 bits, lossy formats stop at 48 kHz, Opus is 48 kHz, a quality of the format */
function fixChoices(x) {
	if (x.format === "flac" && x.bits === 32) x.bits = 24;
	if (isLossy(x.format)) {
		if (x.rate > 48e3) x.rate = 48e3;
		if (x.format === "opus") x.rate = 48e3;
		const qs = QUALITIES[x.format];
		if (!qs.includes(x.quality)) x.quality = qs[0];
	}
}
var cycle = (list, v, d) => list[((list.indexOf(v) + d) % list.length + list.length) % list.length];
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function makeScreens(ib, engine, st) {
	const { BOLD, t, q, truncate } = ib.lib;
	const run = (line) => void ib.shell.run(line);
	/** is the encoder pack there? asked once in a while (the EXPORT screen says so for MP3…) */
	let encoders = "unknown";
	let askedAt = 0;
	const askEncoders = () => {
		if (Date.now() - askedAt < 5e3) return;
		askedAt = Date.now();
		const a = ib.audio;
		if (!a.encoders || !a.encode) return void (encoders = "old");
		a.encoders().then((e) => (encoders = e.installed ? "ready" : e.supported ? "missing" : "none", ib.ui.redraw())).catch(() => encoders = "unknown");
	};
	/** a setting of the song changed through the editor (undoable); `merge`: a nudge, one undo for a run of them */
	const set = (label, fn, merge = true) => st.editor?.settings(label, fn, merge);
	const rename = async (tr) => {
		const s = st.song;
		const name = await ib.ui.prompt(t("track name"), {
			initial: s.trackNames[tr] ?? "",
			placeholder: `${t("track")} ${tr + 1}`
		});
		if (name !== null) run(`med track ${tr + 1} name ${q(name.trim())}`);
	};
	const songRows = (s) => {
		const f = s.flags;
		const echo = s.echo;
		return [
			{
				label: t("title"),
				value: () => s.title || "—",
				activate: () => void ib.ui.prompt(t("the song's title"), { initial: s.title }).then((v) => v !== null && (set("title", (x) => x.title = v.replace(/[\u0000-\u001f]/g, "").slice(0, 60), false), ib.ui.redraw()))
			},
			{
				label: t("tempo"),
				value: () => `${s.tempoMode === "spd" ? `SPD ${s.tempo}` : `${s.tempo} BPM`} (${ptBpmOf(s.tempoMode, s.tempo, s.lpb, f.eightChannel, f.hardwareMix).toFixed(0)})`,
				nudge: (d, big) => set("tempo", (x) => x.tempo = clamp(x.tempo + d * (big ? 10 : 1), 1, 255))
			},
			{
				label: t("speed"),
				value: () => `${s.speed} ${t("ticks a line")}`,
				nudge: (d) => set("speed", (x) => x.speed = clamp(x.speed + d, 1, 32))
			},
			{
				label: t("lines a beat"),
				value: () => String(s.lpb),
				nudge: (d) => set("lines a beat", (x) => x.lpb = clamp(x.lpb + d, 1, 32))
			},
			{
				label: t("swing"),
				value: () => s.swing ? `${s.swing}` : t("straight"),
				nudge: (d, big) => set("swing", (x) => {
					const v = clamp((x.swing ?? 0) + d * (big ? 25 : 5), 0, 100);
					if (v) x.swing = v;
					else delete x.swing;
				}),
				tip: t("every other line longer: 50 a lazy shuffle, 100 triplets")
			},
			{
				label: t("tracks"),
				value: () => `${s.tracks}`,
				nudge: (d) => s.tracks + d >= 1 && s.tracks + d <= 16 && run(`med tracks ${s.tracks + d}`)
			},
			{
				label: t("echo"),
				value: () => echo ? t(echo.type) : t("off"),
				nudge: (d) => set("echo", (x) => {
					const next = cycle([
						"off",
						"normal",
						"cross"
					], echo?.type ?? "off", d);
					if (next === "off") delete x.echo;
					else x.echo = cleanEcho({
						type: next,
						ms: echo?.ms ?? 250,
						depth: echo?.depth ?? 2
					});
				})
			},
			...echo ? [{
				label: `  ${t("delay")}`,
				value: () => `${echo.ms} ms`,
				nudge: (d, big) => set("echo delay", (x) => x.echo && (x.echo.ms = clamp(x.echo.ms + d * (big ? 100 : 10), 1, 2e3)))
			}, {
				label: `  ${t("depth")}`,
				value: () => `${echo.depth} (${echo.depth <= 2 ? t("long") : echo.depth >= 5 ? t("short") : t("medium")})`,
				nudge: (d) => set("echo depth", (x) => x.echo && (x.echo.depth = clamp(x.echo.depth + d, 1, 6)))
			}] : [],
			{
				label: t("LED filter"),
				value: () => f.filter ? t("on") : t("off"),
				nudge: () => set("LED filter", (x) => x.flags.filter = !x.flags.filter, false),
				activate: () => set("LED filter", (x) => x.flags.filter = !x.flags.filter, false)
			}
		];
	};
	/** the tracks table's columns */
	const COLS = [
		"name",
		"vol",
		"pan",
		"strum",
		"mute",
		"solo"
	];
	const nudgeTrack = (tr, col, d, big) => {
		const s = st.song, e = st.editor;
		const key = COLS[col];
		if (key === "vol") e.setTrack(tr, { volume: (s.trackVolume[tr] ?? 64) + d * (big ? 8 : 1) }, true);
		else if (key === "pan") e.setTrack(tr, { pan: (s.trackPan[tr] ?? 0) + d * (big ? .25 : .05) }, true);
		else if (key === "strum") e.setTrack(tr, { strum: (s.trackStrum?.[tr] ?? 0) + d * (big ? 50 : 5) }, true);
		else if (key === "mute" || key === "solo") run(`med ${key} ${tr + 1}`);
	};
	const activateTrack = (tr, col) => {
		const key = COLS[col];
		if (key === "name") rename(tr);
		else if (key === "mute" || key === "solo") run(`med ${key} ${tr + 1}`);
	};
	const drawSong = (ui, r, focused) => {
		const c = ui.c;
		const s = st.song;
		const count = (n, one, many) => `${n} ${t(n === 1 ? one : many)}`;
		const inner = ui.box(r, {
			title: `${t("SONG")} · ${count(s.sequence.length, "position", "positions")} · ${count(s.blocks.length, "block", "blocks")}`,
			focused
		});
		const rows = songRows(s);
		const total = rows.length + s.tracks;
		st.songRow = clamp(st.songRow, 0, total - 1);
		st.songCol = clamp(st.songCol, 0, COLS.length - 1);
		const labelW = 14;
		let y = inner.y;
		const top = inner.y + inner.h;
		rows.forEach((row, i) => {
			if (y >= top) return;
			const on = i === st.songRow;
			ui.text(inner.x + 1, y, truncate(row.label, 13), { fg: on ? c.fg : c.muted });
			let x = inner.x + 1 + labelW;
			if (row.nudge) x += ui.button(x, y, "‹", () => (st.songRow = i, row.nudge(-1, false)), { quiet: true });
			x = ui.text(x, y, ` ${row.value()} `, {
				fg: on ? c.accent : c.fg,
				attrs: on ? BOLD : 0
			});
			if (row.nudge) ui.button(x, y, "›", () => (st.songRow = i, row.nudge(1, false)), { quiet: true });
			if (on && focused) ui.tint({
				x: inner.x,
				y,
				w: labelW,
				h: 1
			}, void 0, c.highlight);
			ui.hit({
				x: inner.x,
				y,
				w: labelW,
				h: 1
			}, {
				onClick: () => st.songRow = i,
				onDouble: () => row.activate?.(),
				onWheel: (d) => row.nudge?.(d > 0 ? -1 : 1, false),
				tip: row.tip
			});
			y++;
		});
		y++;
		if (y >= top) return;
		const nameW = Math.max(8, Math.min(18, inner.w - 40));
		const colX = [
			inner.x + 4,
			inner.x + 5 + nameW,
			inner.x + 11 + nameW,
			inner.x + 18 + nameW,
			inner.x + 26 + nameW,
			inner.x + 31 + nameW
		];
		COLS.forEach((k, i) => ui.text(colX[i], y, t(k), { fg: st.songRow >= rows.length && st.songCol === i ? c.accent : c.subtle }));
		y++;
		const rowsLeft = top - y;
		const cur = st.songRow - rows.length;
		const scroll = Math.max(0, Math.min(s.tracks - rowsLeft, cur - rowsLeft + 1));
		for (let tr = scroll; tr < s.tracks && y < top; tr++, y++) {
			const here = tr === cur;
			const muted = engine.muted.has(tr);
			const solo = engine.muted.size === s.tracks - 1 && !muted;
			const pan = s.trackPan[tr] ?? 0;
			const cells = [
				truncate(trackName(s, tr), nameW),
				String(s.trackVolume[tr] ?? 64),
				pan === 0 ? "C" : `${pan < 0 ? "L" : "R"}${Math.round(Math.abs(pan) * 100)}`,
				s.trackStrum?.[tr] ? `${s.trackStrum[tr]} ms` : "—",
				muted ? "×" : "·",
				solo ? "S" : "·"
			];
			ui.text(inner.x + 1, y, String(tr + 1).padStart(2), { fg: c.faint });
			cells.forEach((v, i) => {
				const on = here && st.songCol === i;
				const fg = i === 0 ? muted ? c.faint : c.fg : i === 4 && muted ? c.warning : i === 5 && solo ? c.success : c.muted;
				ui.text(colX[i], y, v, {
					fg: on ? c.accent : fg,
					attrs: on ? BOLD : 0
				}, (colX[i + 1] ?? inner.x + inner.w) - colX[i] - 1);
				if (on && focused) ui.tint({
					x: colX[i] - 1,
					y,
					w: (colX[i + 1] ?? colX[i] + 6) - colX[i],
					h: 1
				}, void 0, c.highlight);
				ui.hit({
					x: colX[i] - 1,
					y,
					w: (colX[i + 1] ?? colX[i] + 6) - colX[i],
					h: 1
				}, {
					onClick: () => (st.songRow = rows.length + tr, st.songCol = i, i >= 4 && activateTrack(tr, i)),
					onDouble: () => i === 0 && activateTrack(tr, 0),
					onWheel: (d) => i >= 1 && i <= 3 && nudgeTrack(tr, i, d > 0 ? -1 : 1, false),
					tip: i === 0 ? t("double-click: rename") : i <= 3 ? t("wheel or ⇧←→: change") : t("click: switch")
				});
			});
		}
	};
	const keySong = (k) => {
		const s = st.song;
		const rows = songRows(s);
		const total = rows.length + s.tracks;
		const tr = st.songRow - rows.length;
		switch (k.key) {
			case "up": return st.songRow = Math.max(0, st.songRow - 1), true;
			case "down": return st.songRow = Math.min(total - 1, st.songRow + 1), true;
			case "left":
			case "right": {
				const d = k.key === "left" ? -1 : 1;
				if (tr < 0) return rows[st.songRow].nudge?.(d, k.shift), true;
				if (k.shift) return nudgeTrack(tr, st.songCol, d, false), true;
				return st.songCol = clamp(st.songCol + d, 0, COLS.length - 1), true;
			}
			case "enter":
				if (tr < 0) rows[st.songRow].activate?.();
				else activateTrack(tr, st.songCol);
				return true;
		}
		return false;
	};
	/** the file: the song's own name (its folder too) until you choose another */
	const ensurePath = () => {
		const x = st.exp;
		if (!x.path.trim()) x.path = (st.path || "songs/untitled").replace(/\.(bmed|med|mod)$/i, "").replace(/\.[^./]+$/, "") || "songs/untitled";
	};
	const expRows = () => {
		ensurePath();
		const x = st.exp;
		const lossy = isLossy(x.format);
		return [
			{
				label: t("file"),
				value: () => `${x.path.replace(/\.[a-z0-9]+$/i, "")}.${extOf(x.format)}`,
				activate: () => void ib.ui.prompt(t("export to"), { initial: x.path }).then((v) => v && (x.path = v.trim(), ib.ui.redraw()))
			},
			{
				label: t("format"),
				value: () => x.format.toUpperCase() + (lossy ? ` (${t("encoder pack")})` : ""),
				nudge: (d) => (x.format = cycle(FORMATS, x.format, d), fixChoices(x))
			},
			{
				label: t("rate"),
				value: () => `${x.rate} Hz`,
				nudge: (d) => {
					if (x.format === "opus") return;
					const ok = lossy ? RATES.filter((r) => r <= 48e3) : RATES;
					x.rate = cycle(ok, ok.includes(x.rate) ? x.rate : 48e3, d);
				}
			},
			lossy ? {
				label: t("quality"),
				value: () => describe(x.format, x.bits, x.rate, x.quality).split(" · ")[1],
				nudge: (d) => x.quality = cycle(QUALITIES[x.format], x.quality, d)
			} : {
				label: t("bits"),
				value: () => x.bits === 32 ? t("32-bit float") : `${x.bits} bits`,
				nudge: (d) => x.bits = cycle(x.format === "flac" ? [16, 24] : [
					16,
					24,
					32
				], x.bits, d)
			},
			{
				label: t("tracks"),
				value: () => t(x.what),
				nudge: (d) => x.what = cycle(WHAT, x.what, d)
			},
			{
				label: t("normalize"),
				value: () => x.normalize ? t("on (-0.3 dB)") : t("off"),
				nudge: () => x.normalize = !x.normalize,
				activate: () => x.normalize = !x.normalize
			},
			{
				label: t("tail"),
				value: () => `${x.tail} s`,
				nudge: (d) => x.tail = clamp(Math.round((x.tail + d * .5) * 2) / 2, 0, 10)
			}
		];
	};
	/** what the last export did, shown under the button */
	let last = null;
	const doExport = () => {
		const x = st.exp;
		if (last?.kind === "busy") return;
		if (isLossy(x.format) && encoders !== "ready") {
			askedAt = 0;
			askEncoders();
		}
		const line = exportLine(x, q);
		last = {
			text: t("exporting… (the LOG shows each file)"),
			kind: "busy",
			line
		};
		ib.shell.run(line).then((code) => last = code === 0 ? {
			text: `✓ ${t("exported")}: ${line.replace(/^med export /, "")}`,
			kind: "ok",
			line
		} : {
			text: t("✗ the export failed: the LOG says why"),
			kind: "error",
			line
		}).catch((e) => last = {
			text: `✗ ${String(e?.message ?? e)}`,
			kind: "error",
			line
		}).finally(() => ib.ui.redraw());
	};
	const drawExport = (ui, r, focused) => {
		const c = ui.c;
		ensurePath();
		const x = st.exp;
		fixChoices(x);
		if (isLossy(x.format)) askEncoders();
		const inner = ui.box(r, {
			title: t("EXPORT"),
			focused
		});
		const rows = expRows();
		st.expRow = clamp(st.expRow, 0, rows.length);
		const labelW = 12;
		let y = inner.y;
		rows.forEach((row, i) => {
			const on = i === st.expRow;
			ui.text(inner.x + 1, y, row.label, { fg: on ? c.fg : c.muted });
			let xx = inner.x + 1 + labelW;
			if (row.nudge) xx += ui.button(xx, y, "‹", () => (st.expRow = i, row.nudge(-1, false)), { quiet: true });
			xx = ui.text(xx, y, ` ${row.value()} `, {
				fg: on ? c.accent : c.fg,
				attrs: on ? BOLD : 0
			}, inner.x + inner.w - xx - 2);
			if (row.nudge) ui.button(xx, y, "›", () => (st.expRow = i, row.nudge(1, false)), { quiet: true });
			if (on && focused) ui.tint({
				x: inner.x,
				y,
				w: labelW,
				h: 1
			}, void 0, c.highlight);
			ui.hit({
				x: inner.x,
				y,
				w: labelW,
				h: 1
			}, {
				onClick: () => st.expRow = i,
				onDouble: () => row.activate?.(),
				onWheel: (d) => row.nudge?.(d > 0 ? -1 : 1, false)
			});
			y++;
		});
		y++;
		ui.text(inner.x + 1, y++, describe(x.format, x.bits, x.rate, x.quality) + (x.normalize ? ` · ${t("normalized")}` : ""), { fg: c.subtle });
		if (isLossy(x.format) && encoders !== "ready" && encoders !== "unknown") {
			const why = encoders === "missing" ? t("needs the encoder pack: run `encoders install` in the shell (once, ~3 MB)") : encoders === "old" ? t("needs a newer ICEBREAKER (0.5.5+): WAV, AIFF and FLAC work here") : t("no encoder pack for this computer yet");
			ui.text(inner.x + 1, y++, truncate(why, inner.w - 2), { fg: c.warning });
		}
		y++;
		const bx = inner.x + 1;
		const on = st.expRow === rows.length;
		ui.button(bx, y, ` ▶ ${t("EXPORT")} `, doExport, {
			cmd: exportLine(x, q),
			selected: on && focused,
			tip: exportLine(x, q)
		});
		y += 2;
		if (last && last.kind !== "busy" && last.line !== exportLine(x, q)) last = null;
		if (last && y < inner.y + inner.h) ui.text(inner.x + 1, y++, truncate(last.text, inner.w - 2), { fg: last.kind === "ok" ? c.success : last.kind === "error" ? c.error : c.accent });
		if (y < inner.y + inner.h) ui.text(inner.x + 1, y, truncate(exportLine(x, q), inner.w - 2), { fg: c.faint });
	};
	const keyExport = (k) => {
		const rows = expRows();
		switch (k.key) {
			case "up": return st.expRow = Math.max(0, st.expRow - 1), true;
			case "down": return st.expRow = Math.min(rows.length, st.expRow + 1), true;
			case "left":
			case "right":
				if (st.expRow < rows.length) rows[st.expRow].nudge?.(k.key === "left" ? -1 : 1, k.shift), fixChoices(st.exp);
				return true;
			case "enter":
				if (st.expRow === rows.length) doExport();
				else rows[st.expRow].activate?.();
				return true;
		}
		return false;
	};
	/** the tabs over the right side: one line */
	/**
	* The tabs: wide, then tight, then short names when the side is narrow, so all four
	* always show. No tooltip: it would cover the screen's first line (a kit's, the
	* presets); the keys are written at the end when there's room.
	*/
	const drawTabs = (ui, x, y, w) => {
		const c = ui.c;
		const fit = (labels) => labels.reduce((n, l) => n + l.length + 2, 0) <= w;
		const names = SCREENS.map((s) => t(s.label));
		const labels = [
			names.map((l) => ` ${l} `),
			names,
			SCREENS.map((s) => t(s.short))
		].find(fit) ?? SCREENS.map((s) => s.key);
		const open = (s) => () => (s === "guide" && st.screen !== "guide" && (st.back = st.screen), st.screen = s);
		let xx = x;
		SCREENS.forEach((s, i) => xx += ui.button(xx, y, labels[i], open(s.id), {
			selected: st.screen === s.id,
			quiet: st.screen !== s.id
		}));
		if (xx + 18 < x + w) ui.textRight(x + w - 1, y, "alt B · I · S · E · ?", { fg: c.faint });
	};
	return {
		drawSong,
		keySong,
		drawExport,
		keyExport,
		drawTabs
	};
}
// src/guide.ts
/** the effect commands, as the replayer plays them (replayer.ts) */
var EFFECTS = [
	["00xy", "arpeggio: the note, +x, +y semitones, very fast (a chord on one track)"],
	["01xx / 02xx", "slide the pitch up / down (xx: how fast)"],
	["03xx", "slide to the note written (xx: speed) — a portamento"],
	["04xy", "vibrato (x speed, y depth, twice ProTracker's)"],
	["05xy / 06xy", "03 / 04 going on, with a volume slide"],
	["07xy", "tremolo: the volume wobbles (x speed, y depth)"],
	["09xx", "speed: ticks a line (01–20)"],
	["0Axy / 0Dxy", "volume slide (x up, y down)"],
	["0Bxx", "jump to position xx of the sequence"],
	["0Cxx", "volume (decimal 00–64, or hex in hex mode)"],
	["0Fxx", "tempo · 0F00 next block · F1 note twice · F2 half a line late · F3 three times · FE stop · FF note off"],
	["11x / 12x", "fine slide up / down"],
	["14xy", "vibrato, ProTracker's depth"],
	["15x", "finetune (-8…7)"],
	["16x", "loop: 1600 marks the start, 16x plays it x more times"],
	["18x", "cut the note at tick x"],
	["19xx", "start xx × 256 frames into the sample"],
	["1Ax / 1Bx", "fine volume up / down"],
	["1Dxx", "next block, at line xx"],
	["1Ex", "play the line x more times"],
	["1Fxy", "note x ticks late · y: again every y ticks"],
	["2Exx", "pan (F0 left … 00 middle … 10 right)"]
];
/** the guide, part by part: [what you press or type, what it does] */
var GUIDE = [
	{
		title: "START",
		rows: [
			["med new", "a new song: 8 tracks, drums and synths, a beat ready to play"],
			["med new --chip", "a chiptune song: 2 pulses, a triangle, a noise (NES-style)"],
			["med open", "open a .med, .mod or .bmed of the vault"],
			["med demo", "the demo song"],
			["med save", "save (a new song becomes a .bmed in songs/)"],
			["enter", "play the song from the cursor · ⇧enter: this block, again and again"],
			["space", "stop · when stopped: EDIT MODE on / off"]
		]
	},
	{
		title: "EDIT MODE (space: the line turns red, ● EDIT at the top)",
		rows: [
			["the letter keys", "a piano: Z S X D C V… (bottom row) and Q 2 W 3 E R… (top row), by place"],
			["`", "note off (^^^): the note stops, a synth releases"],
			["0–9 A–F", "the hex columns: the instrument (2 digits), the chord, the command (4)"],
			["delete · ⌫", "clear the column · delete the line (⇧: in every track)"],
			["alt enter", "insert a line (⇧: in every track)"],
			["alt ↑↓ · alt ←→", "the octave · the instrument the keys play"],
			["alt 0–9", "the step: lines the cursor moves after a note"],
			["⇧ arrows · drag", "select · alt C / X / V copy cut paste · alt Q / A transpose"],
			["⌘Z · ⌘⇧Z", "undo · redo (notes, instruments, settings, mutes)"]
		]
	},
	{
		title: "A CELL: C-3 01 . 0C20",
		rows: [
			["C-3", "the note (C-1 … B-7) · ^^^ a note off"],
			["01", "the instrument (01–3F, the list on the left)"],
			[".", "the chord (1–F of the song's table: med chords), when the song has chords"],
			["0C20", "an effect: the command (0C) and its value (20) — the list below"]
		]
	},
	{
		title: "EFFECTS (the last 4 hex digits of a cell: command, value)",
		rows: EFFECTS
	},
	{
		title: "THE SAMPLER (your own sounds)",
		rows: [
			["med sampler", "load a sound into a free instrument (a list of the vault's sounds)"],
			["INSTRUMENT tab", "on a free slot: “sampler · load a sound…”; on a sound: chop, stretch, fade, loop…"],
			["med sample <n> load", "a .wav .aif .iff .mp3 .m4a .ogg… of the vault into instrument n"],
			["med sample <n> chop 8", "8 slices, each a new instrument · chop onsets: a slice an attack"],
			["med bounce", "this block, rendered into a new instrument"],
			["med pack", "the starter sounds, recorded by people: which are there (med pack load <name>)"]
		]
	},
	{
		title: "SCREENS (the tabs, or alt B I S E, ? for this guide)",
		rows: [
			["BLOCK", "the notes, track by track"],
			["INSTRUMENT", "the instrument the keys play: a sound's tools, a synth's settings, a drum kit"],
			["SONG", "tempo, swing, echo, tracks: name, volume, pan, strum, mute, solo"],
			["EXPORT", "WAV, AIFF, FLAC, MP3, M4A, OGG, Opus, with each track apart"],
			["right-click", "a menu on a cell, a track's name, a position, an instrument"],
			["med -h", "every command (all the mouse does, the shell does too)"]
		]
	}
];
/** every row of the guide, flat: a part's title, then its rows */
var lines = () => GUIDE.flatMap((p, i) => [
	...i ? [{ title: "" }] : [],
	{ title: p.title },
	...p.rows.map(([keys, what]) => ({
		keys,
		what
	}))
]);
function makeGuide(ib) {
	const { BOLD, t, truncate } = ib.lib;
	let scroll = 0;
	let height = 10;
	const draw = (ui, r, focused) => {
		const c = ui.c;
		const inner = ui.box(r, {
			title: t("GUIDE"),
			focused
		});
		const all = lines();
		height = Math.max(1, inner.h - 1);
		scroll = Math.max(0, Math.min(scroll, all.length - height));
		const keyW = Math.min(22, Math.max(10, Math.floor(inner.w / 3)));
		for (let k = 0; k < height && scroll + k < all.length; k++) {
			const row = all[scroll + k], y = inner.y + k;
			if ("title" in row) ui.text(inner.x + 1, y, row.title ? t(row.title) : "", {
				fg: c.accent,
				attrs: BOLD
			}, inner.w - 2);
			else {
				ui.text(inner.x + 2, y, truncate(row.keys, keyW - 1), { fg: /^[0-9A-F]{2}/.test(row.keys) ? c.accentAlt : c.fg });
				ui.text(inner.x + 2 + keyW, y, t(row.what), { fg: c.muted }, inner.w - keyW - 3);
			}
		}
		ui.hit(inner, { onWheel: (d) => scroll += Math.sign(d) * 3 });
		const more = all.length > height ? ` ${scroll + 1}–${Math.min(all.length, scroll + height)}/${all.length} · ↑↓ ` : " ";
		ui.text(inner.x + 1, inner.y + inner.h - 1, `${t("? or esc: back")} ·${more}· med guide · med effects`, { fg: c.subtle }, inner.w - 2);
	};
	const key = (k) => {
		switch (k.key) {
			case "up": return scroll = Math.max(0, scroll - 1), true;
			case "down": return scroll += 1, true;
			case "pageup": return scroll = Math.max(0, scroll - height), true;
			case "pagedown":
			case "space": return scroll += height, true;
			case "home": return scroll = 0, true;
			case "end": return scroll = 9999, true;
		}
		return false;
	};
	/** the guide as text, for the shell */
	const text = () => GUIDE.map((p) => `${p.title}\n${p.rows.map(([a, b]) => `  ${a.padEnd(22)} ${b}`).join("\n")}`).join("\n\n") + "\n";
	return {
		draw,
		key,
		text,
		top: () => scroll = 0
	};
}
// src/start.ts
/** the logo, in half blocks: our own letters, 3 rows high */
var FONT = {
	B: [
		"█▀▄",
		"█▀▄",
		"▀▀ "
	],
	R: [
		"█▀▄",
		"█▀▄",
		"▀ ▀"
	],
	E: [
		"█▀▀",
		"█▀▀",
		"▀▀▀"
	],
	A: [
		"▄▀▄",
		"█▀█",
		"▀ ▀"
	],
	K: [
		"█ █",
		"█▀▄",
		"▀ ▀"
	],
	M: [
		"█▄ ▄█",
		"█ ▀ █",
		"▀   ▀"
	],
	D: [
		"█▀▄",
		"█ █",
		"▀▀ "
	]
};
var WORD = "BREAKERMED";
/** the logo's 3 rows */
var LOGO = [
	0,
	1,
	2
].map((row) => [...WORD].map((ch) => FONT[ch][row]).join(" "));
/** how long the logo takes to build itself (ms) */
var INTRO_MS = 1100;
var NOISE = "░▒▓█▚▞";
var START = [
	{
		key: "N",
		label: "new song",
		cmd: "med new",
		tip: "8 tracks, drums and synths, a beat ready: ⏎ plays it, space to write"
	},
	{
		key: "O",
		label: "open…",
		cmd: "med open",
		tip: "a .med, .mod or .bmed of the vault"
	},
	{
		key: "D",
		label: "demo",
		cmd: "med demo",
		tip: "listen to the demo song"
	},
	{
		key: "?",
		label: "guide",
		cmd: "med guide",
		tip: "the keys, the edit mode, the effects in hex, the sampler"
	},
	{
		key: "C",
		label: "chiptune song",
		cmd: "med new --chip",
		tip: "2 pulses, a triangle, a noise: an old console's sound"
	},
	{
		key: "S",
		label: "sampler",
		cmd: "med sampler",
		tip: "your own sounds: load one into an instrument"
	}
];
function makeStart(ib) {
	const { BOLD, t, mix } = ib.lib;
	const run = (line) => void ib.shell.run(line);
	/** when the logo started building (the first time the page is drawn) */
	let since = 0;
	let row = 0;
	const draw = (ui, r, error) => {
		const c = ui.c;
		const now = performance.now();
		if (!since) since = now;
		const p = Math.min(1, (now - since) / INTRO_MS);
		if (p < 1) ui.animate(33);
		const w = LOGO[0].length;
		const boxW = Math.min(r.w - 2, 46), boxH = 9;
		const tall = r.h >= LOGO.length + boxH + 5;
		let y = r.y + Math.max(1, Math.floor((r.h - (tall ? LOGO.length + 3 : 0) - boxH) / 2));
		if (tall && w <= r.w - 2) {
			const x0 = r.x + Math.floor((r.w - w) / 2);
			for (let k = 0; k < LOGO.length; k++) [...LOGO[k]].forEach((ch, i) => {
				if (ch === " ") return;
				const at = i / w * .75;
				if (p < at) return;
				const settled = p >= at + .25;
				const glyph = settled ? ch : NOISE[(i * 7 + k * 3 + Math.floor(now / 40)) % 6];
				ui.text(x0 + i, y + k, glyph, {
					fg: mix(c.accent, c.accentAlt, i / w),
					attrs: settled ? BOLD : 0
				});
			});
			const sub = `β · ${t("tracker: notes, samples, synths, chiptune")}`;
			const shown = sub.slice(0, Math.max(0, Math.round((p - .6) / .4 * sub.length)));
			ui.textCenter(r, y + LOGO.length + 1, shown, { fg: c.muted });
			y += LOGO.length + 3;
		} else ui.textCenter(r, y++, "BreakerMED β", {
			fg: c.accent,
			attrs: BOLD
		});
		const box = {
			x: r.x + Math.floor((r.w - boxW) / 2),
			y,
			w: boxW,
			h: boxH
		};
		const inner = ui.box(box, {
			title: t("START"),
			focused: true
		});
		const colW = Math.floor((inner.w - 2) / 2);
		row = Math.max(0, Math.min(START.length - 1, row));
		START.forEach((ch, i) => {
			const col = i % 2, line = Math.floor(i / 2);
			const bx = inner.x + 1 + col * colW, by = inner.y + line * 2 + (i >= 4 ? 1 : 0);
			if (by >= inner.y + inner.h) return;
			const label = `${ch.key}  ${t(ch.label)}`.padEnd(Math.max(0, colW - 3));
			ui.button(bx, by, label, () => run(ch.cmd), {
				cmd: ch.cmd,
				tip: t(ch.tip),
				selected: i === row,
				quiet: i >= 4 && i !== row
			});
		});
		ui.text(inner.x + 1, inner.y + inner.h - 1, t("N O D ? C S, or the arrows and ⏎"), { fg: c.subtle }, inner.w - 2);
		if (error) ui.textCenter(r, box.y + box.h + 1, error, { fg: c.error });
	};
	const key = (k) => {
		const letter = k.key.length === 1 ? k.key.toUpperCase() : "";
		const hit = START.find((ch) => ch.key === letter);
		if (hit && !k.alt && !k.ctrl && !k.meta) return run(hit.cmd), true;
		switch (k.key) {
			case "up": return row = Math.max(0, row - 2), true;
			case "down": return row = Math.min(START.length - 1, row + 2), true;
			case "left": return row = Math.max(0, row - 1), true;
			case "right": return row = Math.min(START.length - 1, row + 1), true;
			case "enter": return run(START[row].cmd), true;
		}
		return false;
	};
	return {
		draw,
		key
	};
}
// src/app.ts
/**
* ⌘Z / ⌘⇧Z (and med undo / redo): if it takes away the instrument the keys
* play (a load, a chop, a bounce undone), the keys go to the nearest one left.
*/
function undoRedo(st, redo) {
	const s = st.song, e = st.editor;
	if (!s || !e) return null;
	const had = s.instruments[st.inst] && s.instruments[st.inst].kind !== "empty";
	const label = redo ? e.redo() : e.undo();
	const now = s.instruments[st.inst];
	if (had && (!now || now.kind === "empty")) {
		let k = Math.min(st.inst, s.instruments.length - 1);
		while (k > 0 && s.instruments[k]?.kind === "empty") k--;
		st.inst = Math.max(0, k);
	}
	return label;
}
function newState() {
	return {
		song: null,
		editor: null,
		path: "",
		seq: 0,
		line: 0,
		track: 0,
		col: 0,
		inst: 0,
		octave: 2,
		edit: false,
		step: 1,
		sel: null,
		clip: null,
		error: "",
		screen: "block",
		back: "block",
		songRow: 0,
		songCol: 0,
		exp: newExportChoices(),
		expRow: 0,
		synthRow: 0,
		drumRow: 0,
		drumCol: 0
	};
}
/** a cell's width: "C-3 01 0C20" and 5 more a command page; where each column starts in it */
/** a cell's width: "C-3 01 0C20", and " 3" when the chord column shows */
var cellW = (pages, chords) => 6 + (chords ? 2 : 0) + pages * 5;
/** where a column sits in its cell */
var colX = (col, chords) => col === 0 ? 0 : col <= 2 ? 3 + col : col === 3 ? 7 : (chords ? 9 : 7) + Math.floor((col - 4) / 4) * 5 + (col - 4) % 4;
var colW = (col) => col === 0 ? 3 : 1;
var LEFT = 22;
var HEX = "0123456789abcdef";
/** the same settings (keys in any order): which preset or kit an instrument is right now */
var stable = (v) => v && typeof v === "object" ? Array.isArray(v) ? `[${v.map(stable).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${k}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v);
function makeApp(ib, engine, st) {
	const { BOLD, t, truncate, ListView, mix, q } = ib.lib;
	const run = (line) => void ib.shell.run(line);
	const seqList = new ListView();
	const instList = new ListView();
	seqList.cmdOf = (i) => `med pos ${hex(i)}`;
	seqList.onActivate = (i) => run(`med play song ${hex(i)}`);
	seqList.menuOf = (i) => [
		{
			label: t("play from here"),
			cmd: `med play song ${hex(i)}`
		},
		"-",
		{
			label: t("insert a new block here"),
			cmd: `med seq new ${hex(i)}`
		},
		{
			label: t("insert a copy of this block"),
			cmd: `med seq copy ${hex(i)}`
		},
		{
			label: t("remove this position"),
			cmd: `med seq rm ${hex(i)}`,
			danger: true
		}
	];
	const screens = makeScreens(ib, engine, st);
	const guide = makeGuide(ib);
	const start = makeStart(ib);
	/** ? : the guide, and back to where you were */
	const toggleGuide = () => {
		if (st.screen === "guide") st.screen = st.back === "guide" ? "block" : st.back;
		else st.back = st.screen, st.screen = "guide";
	};
	instList.onSelect = (i) => st.inst = i;
	instList.menuOf = (i) => {
		const n = hex(i + 1);
		const ins = st.song?.instruments[i];
		const empty = !ins || ins.kind === "empty";
		return [
			{
				label: t("open it (INSTRUMENT)"),
				hint: "alt I",
				run: () => (st.inst = i, st.screen = "instrument")
			},
			...empty ? [] : [{
				label: t("play it"),
				run: () => preview(st.octave * 12, i)
			}],
			"-",
			{
				label: t("sampler: load a sound…"),
				cmd: `med sample ${n} load`
			},
			{
				label: t("analog synth"),
				cmd: `med synth ${n} new`
			},
			{
				label: t("FM synth"),
				cmd: `med fm ${n} new`
			},
			{
				label: t("chip synth"),
				cmd: `med chip ${n} new 2a03-lead`
			},
			{
				label: t("drum machine"),
				cmd: `med drums ${n} new`
			}
		];
	};
	instList.onActivate = (i) => preview(st.octave * 12, i);
	/** first track shown (the page scrolls sideways when they don't fit) */
	let firstTrack = 0;
	/** where the block was drawn (mouse → cell) */
	let geo = null;
	let anchor = null;
	const song = () => st.song;
	const blockNo = () => st.song?.sequence[st.seq] ?? 0;
	const block = () => st.song?.blocks[blockNo()];
	const ed = () => st.editor;
	const preview = (semi, inst = st.inst) => {
		const s = st.song;
		const ins = s?.instruments[inst];
		if (!s || !ins || ins.kind === "empty") return;
		if (ins.kind === "drums") st.drumRow = ((semi + ins.transpose + s.transpose) % 12 + 12) % 12;
		const rate = PAULA_CLOCK / periodOf(semi + ins.transpose + s.transpose, ins.finetune);
		engine.preview(inst, rate).catch((e) => ib.ui.notify(String(e?.message ?? e), "error"));
	};
	const clampCursor = () => {
		const s = song(), b = block();
		if (!s || !b) return;
		st.line = Math.max(0, Math.min(b.lines - 1, st.line));
		st.track = Math.max(0, Math.min(s.tracks - 1, st.track));
		st.col = Math.max(0, Math.min(colsOf(b.pages) - 1, st.col));
	};
	const moveLine = (d) => (st.line += d, clampCursor());
	/** ←→ go column by column, into the next track at a cell's edge */
	const moveCol = (d) => {
		const s = song(), b = block();
		if (!s || !b) return;
		const n = colsOf(b.pages);
		let c = st.col + d, tr = st.track;
		if (c === 3 && !s.chordColumn) c += d;
		if (c < 0) tr = (tr - 1 + s.tracks) % s.tracks, c = n - 1;
		else if (c >= n) tr = (tr + 1) % s.tracks, c = 0;
		st.col = c;
		st.track = tr;
	};
	/** ⇧ + arrows: the selection grows from where it started */
	const extend = (dl, dt) => {
		anchor ??= {
			line: st.line,
			track: st.track
		};
		st.line += dl;
		st.track += dt;
		clampCursor();
		st.sel = {
			block: blockNo(),
			line0: Math.min(anchor.line, st.line),
			line1: Math.max(anchor.line, st.line),
			track0: Math.min(anchor.track, st.track),
			track1: Math.max(anchor.track, st.track)
		};
	};
	const unselect = () => (st.sel = null, anchor = null);
	/** what an operation works on: the selection, or the cell under the cursor */
	const target = () => st.sel && st.sel.block === blockNo() ? st.sel : {
		block: blockNo(),
		line0: st.line,
		line1: st.line,
		track0: st.track,
		track1: st.track
	};
	const advance = () => moveLine(st.step);
	const typeNote = (note) => {
		const e = ed();
		if (!e) return;
		e.writeNote(blockNo(), st.line, st.track, note, note === 128 ? 0 : st.inst + 1);
		advance();
	};
	const copy = () => {
		const e = ed();
		if (e) st.clip = e.copy(target()), ib.ui.notify(t("copied"));
	};
	const cut = () => {
		const e = ed();
		if (e) st.clip = e.cut(target()), unselect();
	};
	const paste = () => {
		const e = ed();
		if (e && st.clip) e.paste(blockNo(), st.line, st.track, st.clip);
	};
	/** the chord under the cursor, named (the column shows only its digit) */
	const chordHere = () => {
		const s = st.song, cell = block()?.cells[st.line]?.[st.track];
		if (!s?.chordColumn || !cell) return "";
		const n = cell.chord ?? 0;
		return n ? ` · ${t("chord")} ${n.toString(16).toUpperCase()} ${chordsOf(s)[n - 1]?.name ?? ""}` : st.col === 3 ? ` · ${t("chord")}: 1–F (med chords)` : "";
	};
	const transpose = (semis) => ed()?.transpose(target(), semis);
	const say = (label, what) => ib.ui.notify(label ? `${what}: ${t(label)}` : t("nothing to undo"));
	/** The INSTRUMENT screen: the sound drawn in braille dots (the loop lit), what it is, a button a tool. */
	const drawInstrument = (ui, r, focused) => {
		const c = ui.c;
		const s = st.song;
		const ins = s.instruments[st.inst];
		const n = hex(st.inst + 1);
		const inner = ui.box(r, {
			title: `${t("INSTRUMENT")} ${n}${ins?.name ? ` · ${ins.name}` : ""}`,
			focused
		});
		const sk = synthOf(ins);
		if (sk && ins && settingsOf(ins, sk)) return drawSynth(ui, inner, focused, sk);
		if (ins?.kind === "drums" && ins.drums) return drawDrums(ui, inner, focused);
		if (!ins || ins.kind === "empty" || !ins.data.length) {
			ui.text(inner.x + 1, inner.y + 1, t("empty — load a sound, or make a synth:"), { fg: c.muted }, inner.w - 2);
			const choices = [
				[
					"sampler · load a sound…",
					`med sample ${n} load`,
					"your own sound: a .wav, .aif, .iff, .mp3, .m4a, .ogg… of the vault (chop, stretch, loop it after)"
				],
				[
					"analog synth",
					`med synth ${n} new`,
					"two oscillators, a filter, two envelopes, an LFO"
				],
				[
					"FM synth",
					`med fm ${n} new`,
					"two sine waves, one bending the other: pianos, bells, basses"
				],
				[
					"chip synth",
					`med chip ${n} new 2a03-lead`,
					"old consoles' sound chips, for chiptune: NES, Game Boy, C64, AY, SN76489, PC Engine-style"
				],
				[
					"drum machine",
					`med drums ${n} new`,
					"twelve drums, one a note: C kick, D snare, E hat…"
				]
			];
			let x = inner.x + 1, y = inner.y + 3;
			for (const [label, cmd, tip] of choices) {
				if (x + t(label).length + 2 > inner.x + inner.w - 1) x = inner.x + 1, y += 2;
				x += ui.button(x, y, t(label), () => {}, {
					cmd,
					tip: t(tip)
				}) + 1;
			}
			return;
		}
		const waveH = Math.max(3, Math.min(10, inner.h - 9));
		const W = inner.w - 2;
		const d = ins.data;
		const cols = W * 2, rows = waveH * 4;
		const loopA = ins.loopLength ? ins.loopStart : -1, loopB = ins.loopLength ? ins.loopStart + ins.loopLength : -1;
		for (let cx = 0; cx < W; cx++) {
			const cells = new Array(waveH).fill(0);
			let inLoop = false;
			for (let sub = 0; sub < 2; sub++) {
				const col = cx * 2 + sub;
				const a = Math.floor(col / cols * d.length), b = Math.max(a + 1, Math.floor((col + 1) / cols * d.length));
				let lo = 1, hi = -1;
				for (let i = a; i < b && i < d.length; i++) lo = Math.min(lo, d[i]), hi = Math.max(hi, d[i]);
				if (a >= loopA && a < loopB) inLoop = true;
				const top = Math.max(0, Math.min(rows - 1, Math.floor((1 - hi) / 2 * rows)));
				const bot = Math.max(0, Math.min(rows - 1, Math.floor((1 - lo) / 2 * rows)));
				for (let y = top; y <= bot; y++) {
					const row = y % 4;
					const bit = row === 3 ? sub ? 7 : 6 : sub ? 3 + row : row;
					cells[Math.floor(y / 4)] |= 1 << bit;
				}
			}
			cells.forEach((bits, k) => bits && ui.text(inner.x + 1 + cx, inner.y + k, String.fromCharCode(10240 + bits), { fg: inLoop ? c.accentAlt : c.accent }));
		}
		let y = inner.y + waveH;
		const secs = d.length / (16574 * (ins.transpose >= 12 ? 2 : 1));
		ui.text(inner.x + 1, y++, `${d.length} ${t("frames")} · ~${secs.toFixed(2)} s ${t("at C-3")} · vol ${ins.volume} · fine ${ins.finetune} · ${t("transpose")} ${ins.transpose}${ins.loopLength ? ` · ${t("loop")} ${ins.loopStart}+${ins.loopLength}${ins.pingPong ? " ↔" : ""}` : ""}${s.flags.filter ? ` · ${t("LED filter")}` : ""}`, { fg: c.muted }, inner.w - 2);
		y++;
		const tools = [
			[
				"load…",
				`med sample ${n} load`,
				"replace this sound with a file of the vault"
			],
			[
				"chop 4",
				`med sample ${n} chop 4`,
				"4 equal slices → new instruments"
			],
			[
				"chop 8",
				`med sample ${n} chop 8`,
				"8 equal slices → new instruments"
			],
			[
				"chop at attacks",
				`med sample ${n} chop onsets`,
				"a slice at each attack"
			],
			[
				"stretch ×2",
				`med sample ${n} stretch 2`,
				"twice as long, same pitch (Amiga grains)"
			],
			[
				"stretch ×½",
				`med sample ${n} stretch 0.5`,
				"half as long, same pitch"
			],
			[
				"fade in",
				`med sample ${n} fade in`,
				""
			],
			[
				"fade out",
				`med sample ${n} fade out`,
				""
			],
			[
				"pitch +12",
				`med sample ${n} pitch 12`,
				"an octave up (half the frames)"
			],
			[
				"pitch −12",
				`med sample ${n} pitch -12`,
				"an octave down"
			],
			[
				"reverse",
				`med sample ${n} reverse`,
				""
			],
			[
				"8-bit",
				`med sample ${n} crush 8`,
				"destructive 8 bits: the grit"
			],
			[
				"4-bit ×2",
				`med sample ${n} crush 4 2`,
				"4 bits, half the rate: more grit"
			],
			[
				"normalize",
				`med sample ${n} normalize`,
				""
			],
			[
				"trim",
				`med sample ${n} trim`,
				"remove the silence at both ends"
			],
			[
				"loop off",
				`med sample ${n} loop off`,
				""
			],
			[
				"ping-pong",
				`med sample ${n} loop pingpong`,
				"the loop goes back and forth"
			],
			[
				"bounce block",
				"med bounce",
				"this block, rendered into a new instrument"
			],
			[
				s.flags.filter ? "LED filter off" : "LED filter on",
				`med filter ${s.flags.filter ? "off" : "on"}`,
				"the A500's low-pass (0FF9 / 0FF8)"
			]
		];
		let x = inner.x + 1;
		for (const [label, cmd, tip] of tools) {
			const w = label.length + 2;
			if (x + w > inner.x + inner.w - 1) x = inner.x + 1, y++;
			if (y >= inner.y + inner.h) break;
			x += ui.button(x, y, t(label), () => {}, {
				cmd,
				tip: tip ? t(tip) : void 0
			}) + 1;
		}
		ui.text(inner.x + 1, inner.y + inner.h - 1, t("the keys play it · alt ←→ another · alt B the block · med sample -h"), { fg: c.subtle }, inner.w - 2);
	};
	/** one step of a synth setting (←→, the ‹ › buttons, the wheel): straight to the editor, undoable */
	const nudge = (row, dir, big = false) => {
		const sk = synthOf(st.song?.instruments[st.inst]);
		const def = sk?.params[row];
		if (sk && def) ed()?.instrument(st.inst, def.label, (i) => {
			const p = settingsOf(i, sk);
			if (p) nudgeIn(sk.params, p, def.key, dir, big);
		}, true);
	};
	/** A synth's settings (analog or FM): a row each (‹ value ›), the presets above. */
	const drawSynth = (ui, inner, focused, sk) => {
		const c = ui.c;
		const n = hex(st.inst + 1);
		const p = settingsOf(st.song.instruments[st.inst], sk);
		const PARAMS = sk.params;
		let x = inner.x + 1;
		ui.text(x, inner.y, t("preset"), { fg: c.muted });
		x += t("preset").length + 2;
		const list = sk.presetsFor?.(p) ?? sk.presets;
		const now = stable(p);
		for (const [k, name] of list.entries()) {
			const room = inner.x + inner.w - 1 - (k < list.length - 1 ? 4 : 0);
			if (x + name.length + 2 > room) {
				ui.button(x, inner.y, "…", () => {}, {
					cmd: `med ${sk.cmd} presets`,
					quiet: true,
					tip: `${list.slice(k).join(" · ")} · med ${sk.cmd} ${n} preset <name>`
				});
				break;
			}
			const on = stable(sk.preset(name)) === now;
			if (on) ui.text(x - 1, inner.y, "▸", { fg: c.accent });
			x += ui.button(x, inner.y, name, () => {}, {
				cmd: `med ${sk.cmd} ${n} preset ${name}`,
				quiet: !on
			}) + 1;
		}
		const top = inner.y + 2;
		const h = Math.max(1, inner.h - 3);
		const colW = 36;
		const cols = Math.max(1, Math.min(2, Math.floor((inner.w - 1) / colW)));
		const perCol = Math.ceil(PARAMS.length / cols);
		const scroll = perCol > h ? Math.max(0, Math.min(perCol - h, st.synthRow % perCol - Math.floor(h / 2))) : 0;
		st.synthRow = Math.max(0, Math.min(PARAMS.length - 1, st.synthRow));
		PARAMS.forEach((def, i) => {
			const col = Math.floor(i / perCol), row = i % perCol - scroll;
			if (row < 0 || row >= h) return;
			const x0 = inner.x + 1 + col * colW, y = top + row;
			const on = i === st.synthRow;
			ui.text(x0, y, t(def.label).padEnd(18).slice(0, 18), { fg: on ? c.fg : c.muted });
			ui.button(x0 + 19, y, "‹", () => (st.synthRow = i, nudge(i, -1)), { quiet: !on });
			ui.text(x0 + 23, y, showIn(p, def).padEnd(9).slice(0, 9), { fg: on ? c.accent : c.fg });
			ui.button(x0 + 32, y, "›", () => (st.synthRow = i, nudge(i, 1)), { quiet: !on });
			ui.hit({
				x: x0,
				y,
				w: 18,
				h: 1
			}, {
				onClick: () => st.synthRow = i,
				onWheel: (d) => nudge(i, d < 0 ? 1 : -1)
			});
			ui.hit({
				x: x0 + 22,
				y,
				w: 10,
				h: 1
			}, {
				onClick: () => st.synthRow = i,
				onWheel: (d) => nudge(i, d < 0 ? 1 : -1)
			});
			if (on && focused) ui.tint({
				x: x0,
				y,
				w: 18,
				h: 1
			}, void 0, c.highlight);
		});
		ui.text(inner.x + 1, inner.y + inner.h - 1, t("the keys play it · ↑↓ a setting · ←→ change it (⇧ more) · med -h"), { fg: c.subtle }, inner.w - 2);
	};
	/** one step of a drum's setting (⇧←→, the ‹ › buttons, the wheel); the kit's grit */
	const nudgeKit = (drum, col, dir, big = false) => {
		const key = DRUM_SETTINGS[col]?.key;
		if (key) ed()?.instrument(st.inst, `${DRUM_NAMES[drum]} ${key}`, (i) => i.drums && nudgeDrum(i.drums, drum, key, dir, big), true);
	};
	const nudgeGrit = (what, dir) => ed()?.instrument(st.inst, "grit", (i) => {
		if (!i.drums) return;
		i.drums[what] = Math.max(1, Math.min(16, i.drums[what] + dir));
	}, true);
	/** The drum machine: its kits above, then a row a drum (its note, its name, four settings). */
	const drawDrums = (ui, inner, focused) => {
		const c = ui.c;
		const n = hex(st.inst + 1);
		const kit = st.song.instruments[st.inst].drums;
		let x = inner.x + 1;
		ui.text(x, inner.y, t("kit"), { fg: c.muted });
		x += t("kit").length + 2;
		const now = stable(kit);
		const kits = Object.keys(DRUM_KITS);
		for (const [k, name] of kits.entries()) {
			if (x + name.length + 2 > inner.x + inner.w - 1 - (k < kits.length - 1 ? 4 : 0)) {
				ui.button(x, inner.y, "…", () => {}, {
					cmd: "med drums kits",
					quiet: true,
					tip: `${kits.slice(k).join(" · ")} · med drums ${n} kit <name>`
				});
				break;
			}
			const on = stable(drumKit(name)) === now;
			if (on) ui.text(x - 1, inner.y, "▸", { fg: c.accent });
			x += ui.button(x, inner.y, name, () => {}, {
				cmd: `med drums ${n} kit ${name}`,
				quiet: !on
			}) + 1;
		}
		const gy = inner.y + 1;
		x = inner.x + 1;
		ui.text(x, gy, t("grit"), { fg: c.muted });
		x += t("grit").length + 1;
		x += ui.button(x, gy, "‹", () => nudgeGrit("bits", -1), { quiet: true });
		x = ui.text(x, gy, ` ${kit.bits >= 16 ? t("clean") : `${kit.bits} bits`} `, { fg: kit.bits < 16 ? c.warning : c.fg });
		x += ui.button(x, gy, "›", () => nudgeGrit("bits", 1), { quiet: true }) + 1;
		x += ui.button(x, gy, "‹", () => nudgeGrit("hold", -1), { quiet: true });
		x = ui.text(x, gy, ` ×${kit.hold} `, { fg: kit.hold > 1 ? c.warning : c.fg });
		ui.button(x, gy, "›", () => nudgeGrit("hold", 1), { quiet: true });
		const wide = inner.w >= 66;
		const cellW = wide ? 12 : 7;
		const x0 = inner.x + 1, valX = x0 + 16;
		ui.text(x0, inner.y + 2, "♪", { fg: c.subtle });
		ui.text(x0 + 4, inner.y + 2, t("drum"), { fg: c.subtle });
		DRUM_SETTINGS.forEach((s, k) => ui.text(valX + k * cellW + (wide ? 3 : 0), inner.y + 2, t(s.key), { fg: k === st.drumCol ? c.accent : c.subtle }));
		st.drumRow = Math.max(0, Math.min(11, st.drumRow));
		st.drumCol = Math.max(0, Math.min(3, st.drumCol));
		const rows = Math.max(1, inner.h - 4);
		const scroll = Math.max(0, Math.min(12 - rows, st.drumRow - rows + 1));
		kit.drums.forEach((d, i) => {
			const y = inner.y + 3 + i - scroll;
			if (y < inner.y + 3 || y >= inner.y + inner.h - 1) return;
			const on = i === st.drumRow;
			ui.text(x0, y, DRUM_NOTES[i], { fg: c.muted });
			ui.text(x0 + 4, y, t(DRUM_NAMES[i]).padEnd(11).slice(0, 11), { fg: on ? c.fg : c.muted });
			if (on && focused) ui.tint({
				x: x0,
				y,
				w: 15,
				h: 1
			}, void 0, c.highlight);
			DRUM_SETTINGS.forEach((s, k) => {
				const v = d[s.key];
				const text = s.key === "tune" ? `${v > 0 ? "+" : ""}${v}` : s.key === "decay" ? v.toFixed(1) : v.toFixed(2);
				const cx = valX + k * cellW;
				const sel = on && k === st.drumCol;
				if (wide) {
					ui.button(cx, y, "‹", () => (st.drumRow = i, st.drumCol = k, nudgeKit(i, k, -1)), { quiet: !sel });
					ui.text(cx + 3, y, text.padStart(5), { fg: sel ? c.accent : c.fg });
					ui.button(cx + 8, y, "›", () => (st.drumRow = i, st.drumCol = k, nudgeKit(i, k, 1)), { quiet: !sel });
				} else ui.text(cx, y, text.padStart(5), {
					fg: sel ? c.accent : c.fg,
					bg: sel ? c.highlight : void 0
				});
				ui.hit({
					x: cx + (wide ? 3 : 0),
					y,
					w: 5,
					h: 1
				}, {
					onClick: () => (st.drumRow = i, st.drumCol = k),
					onWheel: (dl) => nudgeKit(i, k, dl < 0 ? 1 : -1)
				});
			});
			ui.hit({
				x: x0,
				y,
				w: 15,
				h: 1
			}, { onClick: () => st.drumRow = i });
		});
		ui.text(inner.x + 1, inner.y + inner.h - 1, t("keys: one drum a note · ↑↓ a drum · ←→ a setting · ⇧←→ change it"), { fg: c.subtle }, inner.w - 2);
	};
	/** a track's new name, asked in a window (the command does it) */
	const rename = async (tr) => {
		const s = song();
		if (!s) return;
		const name = await ib.ui.prompt(t("TRACK NAME"), {
			initial: s.trackNames[tr] ?? "",
			placeholder: `${t("track")} ${tr + 1}`
		});
		if (name !== null) run(`med track ${tr + 1} name ${q(name.trim())}`);
	};
	/** the right-click menu on a cell: the cursor goes there first (a selection holding it stays) */
	const cellMenu = (line, track) => {
		if (!(!!st.sel && st.sel.block === blockNo() && line >= st.sel.line0 && line <= st.sel.line1 && track >= st.sel.track0 && track <= st.sel.track1)) unselect();
		st.line = line;
		st.track = track;
		return menuEntries(line, track);
	};
	const menuEntries = (line, track) => [
		{
			label: t("play from here"),
			run: () => run(`med play song ${hex(st.seq)} ${hex(line)}`)
		},
		"-",
		{
			label: t("copy"),
			hint: "alt C",
			cmd: "med copy"
		},
		{
			label: t("cut"),
			hint: "alt X",
			cmd: "med cut"
		},
		{
			label: t("paste"),
			hint: "alt V",
			cmd: "med paste",
			disabled: !st.clip
		},
		{
			label: t("clear"),
			hint: "del",
			cmd: "med clear"
		},
		"-",
		{
			label: t("transpose up"),
			hint: "alt Q",
			cmd: "med transpose 1"
		},
		{
			label: t("transpose down"),
			hint: "alt A",
			cmd: "med transpose -1"
		},
		{
			label: t("an octave up"),
			hint: "⇧ alt Q",
			cmd: "med transpose 12"
		},
		{
			label: t("an octave down"),
			hint: "⇧ alt A",
			cmd: "med transpose -12"
		},
		"-",
		{
			label: t("insert a line"),
			hint: "alt ⏎",
			cmd: "med line insert"
		},
		{
			label: t("delete the line"),
			hint: "⌫",
			cmd: "med line delete"
		},
		{
			label: t("mute / unmute this track"),
			cmd: `med mute ${track + 1}`
		},
		{
			label: st.edit ? t("edit mode off") : t("edit mode on"),
			hint: "space",
			cmd: `med edit ${st.edit ? "off" : "on"}`
		},
		"-",
		{
			label: t("save"),
			hint: "med save",
			cmd: "med save"
		},
		{
			label: t("export (WAV + tracks)"),
			hint: "med export",
			cmd: "med export --stems"
		},
		{
			label: t("export…"),
			hint: "alt E",
			cmd: "med screen export"
		},
		{
			label: t("the song's settings"),
			hint: "alt S",
			cmd: "med screen song"
		},
		{
			label: t("sampler: load a sound…"),
			cmd: "med sampler"
		},
		{
			label: t("the guide"),
			hint: "?",
			cmd: "med guide"
		}
	];
	/** the cell (and column) under the mouse, from where the block was drawn */
	const cellAt = (mx, my) => {
		const g = geo, b = block();
		if (!g || !b) return null;
		const k = Math.floor((mx - g.x - g.numW) / g.cw);
		const line = g.top + (my - g.y);
		if (k < 0 || k >= g.fits || line < 0 || line >= b.lines) return null;
		const inCell = mx - g.x - g.numW - k * g.cw;
		let col = 0;
		const chords = !!st.song?.chordColumn;
		for (let c = 0; c < colsOf(b.pages); c++) if ((c !== 3 || chords) && inCell >= colX(c, chords)) col = c;
		return {
			line,
			track: firstTrack + k,
			col
		};
	};
	return {
		kind: "breakermed",
		key: "breakermed",
		rawKeys: true,
		title: () => st.song ? `♫ ${st.path.split("/").pop()}${st.editor?.dirty ? " ●" : ""}` : "BreakerMED",
		dirty: () => !!st.editor?.dirty,
		status: () => st.song ? `${t("ins")} ${hex(st.inst + 1)} · ${t("oct")} ${st.octave + 1} · ${t("step")} ${st.step}${chordHere()} ${engine.playing ? "" : ` · ⏎ ${t("play")}`} · ${t("space")} ${engine.playing ? t("stop") : t("edit")} · esc ${t("leave")}` : `N ${t("new song")} · O ${t("open…")} · D ${t("demo")} · ? ${t("guide")}`,
		render(ui, r, focused) {
			const c = ui.c;
			const s = st.song;
			const now = engine.current();
			if (engine.playing) ui.animate(16);
			if (now) {
				st.seq = now.seq;
				st.line = now.line;
			}
			const name = s ? s.title || st.path.split("/").pop() || "" : "";
			let x = ui.text(r.x + 1, r.y, "BreakerMED", {
				fg: c.accent,
				attrs: BOLD
			});
			x = ui.text(x + 1, r.y, "β", { fg: c.warning });
			if (s) {
				const f = s.flags;
				const bpm = ptBpmOf(s.tempoMode, s.tempo, s.lpb, f.eightChannel, f.hardwareMix);
				const state = engine.playing ? engine.mode === "block" ? "▶ BLOCK" : "▶ SONG" : st.edit ? ` ● ${t("EDIT")} ` : "■ STOP";
				const parts = [
					[0, `${s.tempoMode === "spd" ? `SPD ${s.tempo}` : `${s.tempo} BPM`} (${bpm.toFixed(0)})`],
					[3, `${t("speed")} ${hex(s.speed)}`],
					[2, `${t("oct")} ${st.octave + 1}`],
					[4, `${t("step")} ${st.step}`],
					[6, s.format],
					[5, engine.paula ? "PAULA" : "SMOOTH"],
					...s.echo ? [[1, `${t("ECHO")} ${s.echo.ms}`]] : []
				];
				const space = r.w - 2 - (x - r.x) - state.length - 6;
				let shown = parts;
				const width = (list) => list.reduce((n, [, p]) => n + p.length + 2, 0);
				for (let drop = 6; drop >= 0 && width(shown) > space; drop--) shown = shown.filter(([k]) => k < drop);
				const rest = shown.length ? `  ${shown.map(([, p]) => p).join("  ")}` : "";
				const rx = rest ? ui.textRight(r.x + r.w - 1, r.y, rest, { fg: engine.playing ? c.success : c.muted }) : r.x + r.w - 1;
				const room = ui.textRight(rx, r.y, state, st.edit && !engine.playing ? {
					fg: c.bg,
					bg: c.error,
					attrs: BOLD
				} : { fg: engine.playing ? c.success : c.muted }) - (x + 2) - 1;
				if (room >= 3) ui.text(x + 2, r.y, truncate(name, room), { fg: c.fg }, room);
			}
			if (!s) {
				const page = {
					x: r.x,
					y: r.y + 1,
					w: r.w,
					h: r.h - 1
				};
				return st.screen === "guide" ? guide.draw(ui, page, focused) : start.draw(ui, page, st.error);
			}
			clampCursor();
			const body = {
				x: r.x,
				y: r.y + 1,
				w: r.w,
				h: r.h - 1
			};
			const leftW = Math.min(LEFT, Math.floor(body.w / 3));
			const seqH = Math.max(5, Math.floor(body.h * .45));
			const seqBox = ui.box({
				x: body.x,
				y: body.y,
				w: leftW,
				h: seqH
			}, {
				title: t("SEQUENCE"),
				focused: false
			});
			seqList.items = s.sequence.map((_, i) => i);
			if (seqList.selected !== st.seq) seqList.select(st.seq);
			seqList.render(ui, seqBox, false, (i, row, sel) => {
				const b = s.blocks[s.sequence[i]];
				ui.text(row.x, row.y, `${hex(i)} ${hex(s.sequence[i], 3)} ${b?.name ?? ""}`, {
					fg: sel ? c.accent : c.muted,
					attrs: sel ? BOLD : 0
				}, row.w);
			});
			const instBox = ui.box({
				x: body.x,
				y: body.y + seqH,
				w: leftW,
				h: body.h - seqH
			}, {
				title: t("INSTRUMENTS"),
				focused: false
			});
			instList.items = Array.from({ length: Math.min(63, Math.max(s.instruments.length + 1, st.inst + 1)) }, (_, i) => i);
			if (instList.selected !== st.inst) instList.select(st.inst);
			instList.render(ui, instBox, false, (i, row, sel) => {
				const ins = s.instruments[i] ?? {
					kind: "empty",
					name: ""
				};
				const empty = ins.kind === "empty";
				const tag = ins.kind === "chip" ? "▚" : ins.kind === "synth" || ins.kind === "analog" || ins.kind === "fm" ? "∿" : ins.kind === "drums" ? "▪" : ins.kind === "hybrid" ? "≈" : "";
				const label = ins.name || (empty ? i >= s.instruments.length ? `· ${t("free")}` : "·" : t("(no name)"));
				ui.text(row.x, row.y, `${hex(i + 1)} ${tag}${label}`, {
					fg: sel ? c.accent : empty ? c.faint : c.fg,
					attrs: sel ? BOLD : 0
				}, row.w);
			});
			screens.drawTabs(ui, body.x + leftW, body.y, body.w - leftW);
			const right = {
				x: body.x + leftW,
				y: body.y + 1,
				w: body.w - leftW,
				h: body.h - 1
			};
			if (st.screen === "instrument") return drawInstrument(ui, right, focused);
			if (st.screen === "song") return screens.drawSong(ui, right, focused);
			if (st.screen === "export") return screens.drawExport(ui, right, focused);
			if (st.screen === "guide") return guide.draw(ui, right, focused);
			const bn = blockNo();
			const b = s.blocks[bn];
			const inner = ui.box(right, {
				title: `${t("BLOCK")} ${hex(bn, 3)}${b?.name ? ` · ${b.name}` : ""} · ${t("line")} ${hex(st.line)}/${hex((b?.lines ?? 1) - 1)}`,
				focused
			});
			if (!b) return;
			const badge = engine.playing ? ` ${t("space: stop")} ` : st.edit ? ` ● ${t("EDIT")} · ${t("space: stop editing")} ` : ` ${t("space: edit mode")} `;
			if (right.w > badge.length + 30) ui.textRight(right.x + right.w - 2, right.y, badge, st.edit && !engine.playing ? {
				fg: c.bg,
				bg: c.error,
				attrs: BOLD
			} : { fg: engine.playing ? c.success : c.warning });
			const chords = !!s.chordColumn;
			if (!chords && st.col === 3) st.col = 4;
			const cw = cellW(b.pages, chords) + 1;
			const numW = 4;
			const fits = Math.max(1, Math.floor((inner.w - numW) / cw));
			if (st.track < firstTrack) firstTrack = st.track;
			if (st.track >= firstTrack + fits) firstTrack = st.track - fits + 1;
			firstTrack = Math.max(0, Math.min(firstTrack, Math.max(0, s.tracks - fits)));
			ui.hit(inner, { onWheel: (d) => moveLine(Math.sign(d) * 2) });
			for (let k = 0; k < fits && firstTrack + k < s.tracks; k++) {
				const tr = firstTrack + k;
				const muted = engine.muted.has(tr);
				const hx = inner.x + numW + k * cw;
				const name = s.trackNames[tr]?.trim() || `${t("track")} ${tr + 1}`;
				ui.text(hx, inner.y, `${muted ? "×" : "▪"} ${truncate(name, cw - 3)}`, {
					fg: muted ? c.faint : tr === st.track ? c.accent : c.subtle,
					attrs: tr === st.track ? BOLD : 0
				}, cw - 1);
				ui.hit({
					x: hx,
					y: inner.y,
					w: cw - 1,
					h: 1
				}, {
					onClick: () => st.track = tr,
					onDouble: () => void rename(tr),
					tip: t("double-click: rename · right-click: mute, solo"),
					menu: () => [
						{
							label: t("rename…"),
							run: () => void rename(tr)
						},
						{
							label: muted ? t("unmute") : t("mute"),
							cmd: `med mute ${tr + 1}`
						},
						{
							label: t("solo"),
							cmd: `med solo ${tr + 1}`
						}
					]
				});
			}
			if (firstTrack > 0) {
				ui.text(inner.x, inner.y, `‹${firstTrack}`, {
					fg: c.accent,
					attrs: BOLD
				});
				ui.hit({
					x: inner.x,
					y: inner.y,
					w: 3,
					h: 1
				}, {
					onClick: () => st.track = firstTrack - 1,
					tip: t("more tracks to the left")
				});
			}
			const after = s.tracks - (firstTrack + fits);
			if (after > 0) {
				const label = `${after}›`;
				ui.textRight(inner.x + inner.w, inner.y, label, {
					fg: c.accent,
					attrs: BOLD
				});
				ui.hit({
					x: inner.x + inner.w - label.length,
					y: inner.y,
					w: label.length,
					h: 1
				}, {
					onClick: () => st.track = firstTrack + fits,
					tip: t("more tracks to the right")
				});
			}
			const rows = inner.h - 1;
			const mid = Math.floor(rows / 2);
			geo = {
				x: inner.x,
				y: inner.y + 1,
				w: inner.w,
				h: rows,
				numW,
				cw,
				top: st.line - mid,
				fits
			};
			const sel = st.sel && st.sel.block === bn ? st.sel : null;
			for (let k = 0; k < rows; k++) {
				const line = st.line - mid + k;
				const y = inner.y + 1 + k;
				if (line < 0 || line >= b.lines) continue;
				const here = line === st.line;
				const beat = line % Math.max(1, s.lpb) === 0;
				const bg = here ? engine.playing ? mix(c.panel, c.accent, .28) : st.edit ? mix(c.panel, c.error, .22) : c.highlight : beat ? c.panelAlt : void 0;
				if (bg !== void 0) ui.fill({
					x: inner.x,
					y,
					w: inner.w,
					h: 1
				}, { bg });
				ui.text(inner.x, y, hex(line, 3), {
					fg: here ? c.accent : beat ? c.muted : c.faint,
					bg
				});
				for (let j = 0; j < fits && firstTrack + j < s.tracks; j++) {
					const tr = firstTrack + j;
					const cell = b.cells[line][tr];
					const cx = inner.x + numW + j * cw;
					const dim = engine.muted.has(tr);
					const inSel = !!sel && line >= sel.line0 && line <= sel.line1 && tr >= sel.track0 && tr <= sel.track1;
					const cbg = inSel ? mix(c.panel, c.accentAlt, .35) : bg;
					if (inSel) ui.fill({
						x: cx,
						y,
						w: cw - 1,
						h: 1
					}, { bg: cbg });
					let xx = ui.text(cx, y, noteName(cell.note), {
						fg: dim ? c.faint : cell.note === 128 ? c.warning : cell.note ? c.fg : c.faint,
						bg: cbg,
						attrs: cell.note ? BOLD : 0
					});
					xx = ui.text(xx + 1, y, cell.inst ? hex(cell.inst) : "..", {
						fg: dim ? c.faint : cell.inst ? c.accent : c.faint,
						bg: cbg
					});
					if (chords) xx = ui.text(xx + 1, y, cell.chord ? cell.chord.toString(16).toUpperCase() : ".", {
						fg: dim ? c.faint : cell.chord ? c.warning : c.faint,
						bg: cbg
					});
					for (let p = 0; p < b.pages; p++) {
						const has = cell.cmd[p] || cell.val[p];
						xx = ui.text(xx + 1, y, has ? `${hex(cell.cmd[p])}${hex(cell.val[p])}` : "....", {
							fg: dim ? c.faint : has ? c.accentAlt : c.faint,
							bg: cbg
						});
					}
					if (here && tr === st.track && focused) ui.tint({
						x: cx + colX(st.col, chords),
						y,
						w: colW(st.col),
						h: 1
					}, c.bg, st.edit ? c.error : c.accent);
					ui.hit({
						x: cx,
						y,
						w: cw - 1,
						h: 1
					}, {
						onClick: (m) => {
							const at = cellAt(m.x, m.y);
							unselect();
							st.line = line;
							st.track = tr;
							if (at) st.col = at.col;
							anchor = {
								line,
								track: tr
							};
						},
						onDrag: (m) => {
							const at = cellAt(m.x, m.y);
							if (!at || !anchor) return;
							st.line = at.line;
							st.track = at.track;
							st.sel = {
								block: bn,
								line0: Math.min(anchor.line, at.line),
								line1: Math.max(anchor.line, at.line),
								track0: Math.min(anchor.track, at.track),
								track1: Math.max(anchor.track, at.track)
							};
						},
						onWheel: (d) => moveLine(Math.sign(d) * 2),
						menu: () => cellMenu(line, tr)
					});
				}
			}
		},
		onKey(k) {
			const s = st.song;
			const e = ed();
			if ((k.key === "?" || k.key === "/" && k.shift || k.code === "Slash" && k.shift) && !k.ctrl && !k.meta || k.alt && k.code === "KeyG") return toggleGuide(), true;
			if (st.screen === "guide") {
				if (k.key === "backspace" || k.key === "escape") return toggleGuide(), true;
				if (guide.key(k)) return true;
				if (!s) return false;
			}
			if (!s) return start.key(k);
			if (s && (st.screen === "song" || st.screen === "export") && !k.alt && !k.ctrl && !k.meta) {
				if (st.screen === "song" ? screens.keySong(k) : screens.keyExport(k)) return true;
				const semi = k.key === "space" ? null : pianoKey(k.code);
				if (semi !== null) return !k.repeat && preview(st.octave * 12 + semi), true;
			}
			if (k.key === "enter" && !k.alt) return run(k.shift ? `med play block ${hex(st.seq)} ${hex(st.line)}` : `med play song ${hex(st.seq)} ${hex(st.line)}`), true;
			if (k.key === "space") {
				if (engine.playing) run("med stop");
				else run(`med edit ${st.edit ? "off" : "on"}`);
				return true;
			}
			if (!s || !e) return false;
			if (k.ctrl && (k.key === "z" || k.code === "KeyZ")) return say(undoRedo(st, k.shift), t(k.shift ? "redone" : "undone")), true;
			if (k.alt) {
				const digit = /^Digit(\d)$/.exec(k.code);
				if (digit) return st.step = +digit[1], true;
				switch (k.code) {
					case "KeyI": return st.screen = "instrument", true;
					case "KeyB": return st.screen = "block", true;
					case "KeyS": return st.screen = "song", true;
					case "KeyE": return st.screen = "export", true;
					case "ArrowUp": return st.octave = Math.min(7, st.octave + 1), true;
					case "ArrowDown": return st.octave = Math.max(0, st.octave - 1), true;
					case "ArrowLeft": return st.inst = Math.max(0, st.inst - 1), true;
					case "ArrowRight": return st.inst = Math.min(62, s.instruments.length, st.inst + 1), true;
					case "KeyC": return copy(), true;
					case "KeyX": return cut(), true;
					case "KeyV": return paste(), true;
					case "KeyQ": return transpose(k.shift ? 12 : 1), true;
					case "KeyA": return transpose(k.shift ? -12 : -1), true;
					case "Enter": return e.insertLine(blockNo(), st.line, k.shift ? [...Array(s.tracks).keys()] : [st.track]), true;
				}
				return false;
			}
			if (st.screen === "instrument" && s.instruments[st.inst]?.kind === "drums" && !k.ctrl && !k.meta) switch (k.key) {
				case "up": return st.drumRow = Math.max(0, st.drumRow - 1), true;
				case "down": return st.drumRow = Math.min(11, st.drumRow + 1), true;
				case "left": return k.shift ? nudgeKit(st.drumRow, st.drumCol, -1) : st.drumCol = Math.max(0, st.drumCol - 1), true;
				case "right": return k.shift ? nudgeKit(st.drumRow, st.drumCol, 1) : st.drumCol = Math.min(3, st.drumCol + 1), true;
			}
			const sk = st.screen === "instrument" ? synthOf(s.instruments[st.inst]) : void 0;
			if (sk && !k.ctrl && !k.meta) switch (k.key) {
				case "up": return st.synthRow = Math.max(0, st.synthRow - 1), true;
				case "down": return st.synthRow = Math.min(sk.params.length - 1, st.synthRow + 1), true;
				case "left": return nudge(st.synthRow, -1, k.shift), true;
				case "right": return nudge(st.synthRow, 1, k.shift), true;
			}
			if (k.shift) switch (k.key) {
				case "up": return extend(-1, 0), true;
				case "down": return extend(1, 0), true;
				case "left": return extend(0, -1), true;
				case "right": return extend(0, 1), true;
			}
			switch (k.key) {
				case "up": return unselect(), moveLine(-1), true;
				case "down": return unselect(), moveLine(1), true;
				case "pageup": return moveLine(-16), true;
				case "pagedown": return moveLine(16), true;
				case "home": return st.line = 0, true;
				case "end": return moveLine(9999), true;
				case "left": return unselect(), moveCol(-1), true;
				case "right": return unselect(), moveCol(1), true;
				case "delete":
					if (st.sel) e.clearSelection(st.sel), unselect();
					else e.clear(blockNo(), st.line, st.track, st.col), st.edit && advance();
					return true;
				case "backspace":
					e.deleteLine(blockNo(), st.line, k.shift ? [...Array(s.tracks).keys()] : [st.track]);
					return true;
			}
			if (k.ctrl || k.meta) return false;
			const kind = colKind(st.col).kind;
			if (st.edit && kind !== "note") {
				const d = /^Digit(\d)$/.exec(k.code)?.[1] ?? (k.key.length === 1 && HEX.includes(k.key.toLowerCase()) ? k.key.toLowerCase() : null);
				if (d !== null) {
					e.writeHex(blockNo(), st.line, st.track, st.col, HEX.indexOf(d));
					const k = colKind(st.col);
					if (k.kind === "chord") {
						if (HEX.indexOf(d)) s.chordColumn = true;
						advance();
					} else if (k.kind === "inst") {
						if (k.digit === 0) st.col++;
						else st.col--, advance();
					} else if (k.kind === "cmd" || k.kind === "val" && k.digit === 0) st.col++;
					else st.col -= 3, advance();
					return true;
				}
			}
			if (st.edit && kind === "note" && (k.code === "Backquote" || k.code === "IntlBackslash")) return typeNote(128), true;
			const semi = pianoKey(k.code);
			if (semi !== null) {
				if (k.repeat) return true;
				preview(st.octave * 12 + semi);
				if (st.edit && kind === "note") typeNote(st.octave * 12 + semi + 1);
				return true;
			}
			return false;
		},
		onText(text) {
			if (text !== "?") return false;
			toggleGuide();
			return true;
		},
		onAction(a) {
			switch (a) {
				case "up": return moveLine(-1), true;
				case "down": return moveLine(1), true;
				case "left": return moveCol(-1), true;
				case "right": return moveCol(1), true;
				case "page-up": return moveLine(-16), true;
				case "page-down": return moveLine(16), true;
				case "confirm": return run(engine.playing ? "med stop" : `med play song ${hex(st.seq)} ${hex(st.line)}`), true;
			}
			return false;
		},
		menu: () => st.song ? cellMenu(st.line, st.track) : [
			{
				label: t("a new song"),
				hint: "N",
				cmd: "med new"
			},
			{
				label: t("open a song…"),
				hint: "O",
				cmd: "med open"
			},
			{
				label: t("the demo song"),
				hint: "D",
				cmd: "med demo"
			},
			{
				label: t("the guide"),
				hint: "?",
				cmd: "med guide"
			},
			{
				label: t("a chiptune song"),
				hint: "C",
				cmd: "med new --chip"
			},
			{
				label: t("sampler: load a sound…"),
				hint: "S",
				cmd: "med sampler"
			}
		]
	};
}
// src/format/bytes.ts
/**
* Reading and writing big-endian files (the Amiga's order), bounds-checked:
* a broken or hostile file throws a clear error, never reads past its end.
*/
var Reader = class {
	constructor(b) {
		_defineProperty(this, "b", void 0);
		_defineProperty(this, "pos", 0);
		this.b = b;
	}
	get length() {
		return this.b.length;
	}
	can(n, at = this.pos) {
		return at >= 0 && n >= 0 && at + n <= this.b.length;
	}
	need(n, at = this.pos, what = "data") {
		if (!this.can(n, at)) throw new Error(`the file ends too early (${what} at ${at})`);
	}
	seek(at) {
		if (at < 0 || at > this.b.length) throw new Error(`a pointer leads out of the file (${at})`);
		this.pos = at;
		return this;
	}
	u8() {
		this.need(1);
		return this.b[this.pos++];
	}
	s8() {
		const v = this.u8();
		return v > 127 ? v - 256 : v;
	}
	u16() {
		this.need(2);
		const v = this.b[this.pos] << 8 | this.b[this.pos + 1];
		this.pos += 2;
		return v;
	}
	s16() {
		const v = this.u16();
		return v > 32767 ? v - 65536 : v;
	}
	u32() {
		this.need(4);
		const v = (this.b[this.pos] << 24 >>> 0) + (this.b[this.pos + 1] << 16) + (this.b[this.pos + 2] << 8) + this.b[this.pos + 3];
		this.pos += 4;
		return v;
	}
	bytes(n) {
		this.need(n);
		const out = this.b.subarray(this.pos, this.pos + n);
		this.pos += n;
		return out;
	}
	/** a fixed-size text field (stops at the first 0), Latin-1 like the Amiga's */
	text(n) {
		const raw = this.bytes(n);
		let s = "";
		for (const c of raw) {
			if (!c) break;
			s += c < 32 ? " " : String.fromCharCode(c);
		}
		return s.trimEnd();
	}
};
/** Signed 8-bit sample bytes → floats. */
function s8ToFloats(raw) {
	const out = new Float32Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = (raw[i] > 127 ? raw[i] - 256 : raw[i]) / 128;
	return out;
}
/** Signed 16-bit big-endian sample bytes → floats. */
function s16beToFloats(raw) {
	const out = new Float32Array(raw.length >> 1);
	for (let i = 0; i < out.length; i++) {
		const v = raw[2 * i] << 8 | raw[2 * i + 1];
		out[i] = (v > 32767 ? v - 65536 : v) / 32768;
	}
	return out;
}
/** OctaMED's "delta" samples: each byte is the difference from the previous one. */
function undelta8(raw) {
	const out = new Uint8Array(raw.length);
	let acc = 0;
	for (let i = 0; i < raw.length; i++) out[i] = acc = acc + raw[i] & 255;
	return out;
}
var Writer = class {
	constructor() {
		_defineProperty(this, "buf", /* @__PURE__ */ new Uint8Array(1024));
		_defineProperty(this, "pos", 0);
	}
	room(n) {
		if (this.pos + n <= this.buf.length) return;
		let size = this.buf.length * 2;
		while (size < this.pos + n) size *= 2;
		const next = new Uint8Array(size);
		next.set(this.buf.subarray(0, this.pos));
		this.buf = next;
	}
	u8(v) {
		this.room(1);
		this.buf[this.pos++] = v & 255;
		return this;
	}
	u16(v) {
		return this.u8(v >> 8).u8(v);
	}
	u32(v) {
		return this.u16(v >>> 16 & 65535).u16(v & 65535);
	}
	bytes(b) {
		this.room(b.length);
		this.buf.set(b, this.pos);
		this.pos += b.length;
		return this;
	}
	/** a fixed-size text field, padded with zeros */
	text(s, n) {
		for (let i = 0; i < n; i++) this.u8(i < s.length ? Math.min(255, s.charCodeAt(i)) : 0);
		return this;
	}
	zeros(n) {
		this.room(n);
		this.buf.fill(0, this.pos, this.pos + n);
		this.pos += n;
		return this;
	}
	/** go back and write a 32-bit value (a pointer known later) */
	patch32(at, v) {
		const here = this.pos;
		this.pos = at;
		this.u32(v);
		this.pos = here;
	}
	align(n = 2) {
		while (this.pos % n) this.u8(0);
		return this;
	}
	done() {
		return this.buf.slice(0, this.pos);
	}
};
/** Floats → signed 8-bit bytes (rounded, clipped). */
function floatsToS8(f) {
	const out = new Uint8Array(f.length);
	for (let i = 0; i < f.length; i++) out[i] = Math.max(-128, Math.min(127, Math.round(f[i] * 128))) & 255;
	return out;
}
/** Floats → signed 16-bit big-endian bytes. */
function floatsToS16be(f) {
	const out = new Uint8Array(f.length * 2);
	for (let i = 0; i < f.length; i++) {
		const v = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32768))) & 65535;
		out[2 * i] = v >> 8;
		out[2 * i + 1] = v & 255;
	}
	return out;
}
// src/format/med.ts
/**
* OctaMED .med files (MMD0, MMD1, MMD2, MMD3): reading. Writing comes with
* step 3.
*
* The layout is public: Teijo Kinnunen's MED-FORM.TXT describes MMD0 / MMD1,
* and the rest (MMD2's sections and play sequences, MMD3, the command pages,
* the tempo modes, the octave folding of the Amiga's four voices) was checked
* against libopenmpt's reader (Load_med.cpp, BSD-3-Clause, docs/CREDITS.md).
* This is our own code: one structure after the other, every pointer
* checked against the file's length.
*
* Not read yet: packed (ADPCM) samples, MIDI, several songs in one file (the
* first is read), MMD2's play-sequence commands (stop / jump).
*/
function isMed(b) {
	return b.length >= 52 && b[0] === 77 && b[1] === 77 && b[2] === 68 && b[3] >= 48 && b[3] <= 51;
}
function readMed(bytes) {
	if (!isMed(bytes)) throw new Error("not an OctaMED file (no MMD0–MMD3 header)");
	const r = new Reader(bytes);
	r.seek(3);
	const h = {
		version: r.u8() - 48,
		songOffset: 0,
		blockArr: 0,
		sampleArr: 0,
		expData: 0
	};
	r.u32();
	h.songOffset = r.u32();
	r.u32();
	h.blockArr = r.u32();
	r.u32();
	h.sampleArr = r.u32();
	r.u32();
	h.expData = r.u32();
	r.seek(h.songOffset);
	const sampleHeads = Array.from({ length: 63 }, () => ({
		loopStart: r.u16() * 2,
		loopLength: r.u16() * 2,
		midiChannel: r.u8(),
		midiPreset: r.u8(),
		volume: r.u8(),
		transpose: r.s8()
	}));
	const numBlocks = r.u16();
	const songLength = r.u16();
	const songArea = r.pos;
	r.seek(songArea + 256);
	const defaultTempo = r.u16();
	const playTranspose = r.s8();
	const flags = r.u8();
	const flags2 = r.u8();
	const tempo2 = r.u8();
	const trackVol16 = Array.from(r.bytes(16));
	const masterVol = r.u8();
	const numSamples = r.u8();
	if (numSamples > 63 || numBlocks > 32767) throw new Error("not a valid OctaMED song (too many instruments or blocks)");
	const hardwareMix = h.version < 2 || !(flags2 & 128);
	const bpmMode = !!(flags2 & 32);
	const tempoMode = bpmMode ? "bpm" : "spd";
	let sequence = [];
	let tracks = 4;
	let trackVolume = [];
	let trackPan = null;
	let echo;
	if (h.version < 2) {
		r.seek(songArea);
		sequence = Array.from(r.bytes(256)).slice(0, Math.min(256, songLength));
		trackVolume = trackVol16;
	} else {
		r.seek(songArea);
		const playSeqTable = r.u32();
		const sectionTable = r.u32();
		const trackVols = r.u32();
		const numTracks = r.u16();
		const numPlaySeqs = r.u16();
		const trackPanOffset = r.u32();
		const flags3 = r.u32();
		r.u16();
		r.u16();
		const echoType = r.u8(), echoDepth = r.u8(), echoLen = r.u16();
		if (!hardwareMix && (echoType === 1 || echoType === 2)) echo = cleanEcho({
			type: echoType === 2 ? "cross" : "normal",
			ms: echoLen || 250,
			depth: echoDepth || 2
		});
		if (numTracks < 1 || numTracks > 64) throw new Error(`not a valid OctaMED song (${numTracks} tracks)`);
		tracks = numTracks;
		if (trackVols && r.can(numTracks, trackVols)) trackVolume = Array.from(r.seek(trackVols).bytes(numTracks));
		if ((!hardwareMix && !!(flags3 & 2) || h.version > 2) && trackPanOffset && r.can(numTracks, trackPanOffset)) {
			r.seek(trackPanOffset);
			trackPan = Array.from({ length: numTracks }, () => Math.max(-16, Math.min(16, r.s8())) / 16);
		}
		if (sectionTable && r.can(songLength * 2, sectionTable)) {
			r.seek(sectionTable);
			const sections = Array.from({ length: songLength }, () => r.u16());
			for (const sec of sections) {
				if (sec >= numPlaySeqs || !r.can(4, playSeqTable + sec * 4)) continue;
				const at = r.seek(playSeqTable + sec * 4).u32();
				if (!r.can(42, at)) continue;
				r.seek(at + 40);
				const length = r.u16();
				for (let i = 0; i < length && r.can(2); i++) {
					const b = r.u16();
					if (b < 32768) sequence.push(b);
				}
			}
		}
	}
	const blocks = [];
	for (let n = 0; n < numBlocks; n++) {
		if (!r.can(4, h.blockArr + n * 4)) break;
		const at = r.seek(h.blockArr + n * 4).u32();
		if (!at || !r.can(2, at)) {
			blocks.push(newBlock(tracks, 64));
			continue;
		}
		r.seek(at);
		if (h.version < 1) {
			const t = r.u8();
			const lines = r.u8() + 1;
			tracks = Math.max(tracks, t);
			const block = newBlock(t, lines, 1);
			for (let l = 0; l < lines; l++) for (let k = 0; k < t; k++) {
				if (!r.can(3)) break;
				const b0 = r.u8(), b1 = r.u8(), b2 = r.u8();
				const c = block.cells[l][k];
				c.note = b0 & 63;
				c.inst = b1 >> 4 | (b0 & 128) >> 3 | (b0 & 64) >> 1;
				c.cmd[0] = b1 & 15;
				c.val[0] = b2;
			}
			blocks.push(block);
			continue;
		}
		const t = r.u16();
		const lines = r.u16() + 1;
		const info = r.u32();
		const cellsAt = r.pos;
		if (t < 1 || t > 64 || lines > 3200) throw new Error(`block ${n}: ${t} tracks × ${lines} lines`);
		tracks = Math.max(tracks, t);
		let name = "";
		let pages = [];
		if (info && r.can(20, info)) {
			r.seek(info);
			r.u32();
			const nameOffset = r.u32();
			const nameLength = r.u32();
			const pageTable = r.u32();
			if (nameOffset && nameLength && r.can(Math.min(nameLength, 255), nameOffset)) name = r.seek(nameOffset).text(Math.min(nameLength, 255));
			if (pageTable && r.can(4, pageTable)) {
				r.seek(pageTable);
				const count = r.u16();
				r.u16();
				for (let i = 0; i < count && r.can(4); i++) pages.push(r.u32());
			}
		}
		pages = pages.slice(0, 15);
		const block = newBlock(t, lines, 1 + pages.length, name);
		r.seek(cellsAt);
		for (let l = 0; l < lines; l++) for (let k = 0; k < t; k++) {
			if (!r.can(4)) break;
			const b0 = r.u8(), b1 = r.u8(), b2 = r.u8(), b3 = r.u8();
			const c = block.cells[l][k];
			c.note = b0 === 128 ? 128 : b0 & 127;
			c.inst = b1 & 63;
			c.cmd[0] = b2;
			c.val[0] = b3;
		}
		pages.forEach((p, i) => {
			if (!p || !r.can(t * lines * 2, p)) return;
			r.seek(p);
			for (let l = 0; l < lines; l++) for (let k = 0; k < t; k++) {
				const c = block.cells[l][k];
				c.cmd[i + 1] = r.u8();
				c.val[i + 1] = r.u8();
			}
		});
		blocks.push(block);
	}
	for (const b of blocks) for (const row of b.cells) while (row.length < tracks) row.push({
		note: 0,
		inst: 0,
		cmd: new Array(b.pages).fill(0),
		val: new Array(b.pages).fill(0)
	});
	const exp = readExp(r, h.expData);
	const instruments = [];
	for (let i = 0; i < numSamples; i++) {
		const head = sampleHeads[i];
		const inst = emptyInstrument();
		inst.volume = Math.min(64, head.volume);
		inst.transpose = head.transpose;
		inst.loopStart = head.loopStart;
		inst.loopLength = head.loopLength > 2 ? head.loopLength : 0;
		const ext = exp.instrExt(i);
		if (ext) {
			inst.hold = ext.hold;
			inst.decay = ext.decay;
			inst.finetune = Math.max(-8, Math.min(7, ext.finetune));
			if (ext.volume !== void 0) inst.gain = (ext.volume + 1) / 128;
		}
		inst.name = exp.instrName(i);
		const at = h.sampleArr && r.can(4, h.sampleArr + i * 4) ? r.seek(h.sampleArr + i * 4).u32() : 0;
		if (at && r.can(6, at)) readInstrumentData(r, at, inst, h.version);
		if (ext && inst.kind === "sample") {
			if (ext.loopLength !== void 0) {
				inst.loopStart = ext.loopStart ?? 0;
				inst.loopLength = ext.loopLength;
			}
			if (ext.flags !== void 0) {
				if (!(ext.flags & 1)) inst.loopLength = 0;
				inst.pingPong = !!(ext.flags & 8);
				if (ext.flags & 4) inst.gain = 0;
			}
		}
		if (inst.loopStart + inst.loopLength > inst.data.length) inst.loopLength = Math.max(0, inst.data.length - inst.loopStart);
		if (inst.loopLength <= 2) inst.loopStart = 0, inst.loopLength = 0;
		instruments.push(inst);
	}
	const song = {
		title: exp.songName,
		format: `MMD${h.version}`,
		tracks,
		blocks,
		sequence: sequence.filter((b) => b < blocks.length),
		restart: 0,
		instruments,
		tempoMode,
		tempo: defaultTempo,
		speed: Math.max(1, Math.min(32, tempo2 || 6)),
		lpb: bpmMode ? 1 + (flags2 & 31) : 4,
		transpose: playTranspose,
		noteShift: h.version > 2 ? -24 : 0,
		masterVolume: masterVol ? Math.min(64, masterVol) : 64,
		trackVolume: Array.from({ length: tracks }, (_, i) => Math.max(0, Math.min(64, trackVolume[i] ?? 64))),
		trackPan: trackPan && trackPan.length === tracks ? trackPan : amigaPan(tracks),
		trackNames: new Array(tracks).fill(""),
		flags: {
			volHex: !!(flags & 16),
			vol7bit: h.version > 2,
			ptSlides: !!(flags & 32),
			eightChannel: !!(flags & 64),
			hardwareMix,
			filter: !!(flags & 1)
		}
	};
	if (!song.sequence.length) song.sequence = [0];
	if (!song.blocks.length) song.blocks.push(newBlock(tracks));
	if (echo) song.echo = echo;
	return song;
}
/** The expansion data: instrument names and extras, the song's name. */
function readExp(r, at) {
	const out = {
		songName: "",
		instrExt: (_i) => null,
		instrName: (_i) => ""
	};
	if (!at || !r.can(52, at)) return out;
	r.seek(at + 4);
	const extAt = r.u32();
	const extEntries = r.u16();
	const extSize = r.u16();
	r.u32();
	r.u32();
	const infoAt = r.u32();
	const infoEntries = r.u16();
	const infoSize = r.u16();
	r.seek(at + 44);
	const nameAt = r.u32();
	const nameLength = r.u32();
	if (nameAt && nameLength && r.can(Math.min(nameLength, 255), nameAt)) out.songName = r.seek(nameAt).text(Math.min(nameLength, 255));
	out.instrExt = (i) => {
		if (!extAt || i >= extEntries || extSize < 4 || !r.can(extSize, extAt + i * extSize)) return null;
		r.seek(extAt + i * extSize);
		const e = {
			hold: r.u8(),
			decay: r.u8(),
			finetune: (r.u8(), r.s8())
		};
		if (extSize > 5) {
			r.u8();
			e.flags = r.u8();
		}
		if (extSize >= 18) {
			r.seek(extAt + i * extSize + 10);
			e.loopStart = r.u32();
			e.loopLength = r.u32();
		}
		if (extSize >= 19) e.volume = r.u8();
		return e;
	};
	out.instrName = (i) => infoAt && i < infoEntries && infoSize > 0 && r.can(Math.min(40, infoSize), infoAt + i * infoSize) ? r.seek(infoAt + i * infoSize).text(Math.min(40, infoSize)) : "";
	return out;
}
/** An instrument's sound: a sample (8 / 16 bits, mono / stereo, delta, several octaves), a synth or a hybrid. */
function readInstrumentData(r, at, inst, version) {
	r.seek(at);
	const length = r.u32();
	const type = r.s16();
	if (type === -1 || type === -2) {
		if (!r.can(272)) return;
		r.u32();
		const loopStart = r.u16() * 2;
		const loopLength = r.u16() * 2;
		const volLen = Math.min(128, r.u16());
		const waveLen = Math.min(128, r.u16());
		inst.volSpeed = r.u8();
		inst.waveSpeed = r.u8();
		const numWaves = r.u16();
		const volTable = Array.from(r.bytes(128));
		const waveTable = Array.from(r.bytes(128));
		inst.volTable = volTable.slice(0, volLen);
		inst.waveTable = waveTable.slice(0, waveLen);
		if (numWaves > 64) return;
		const offsets = Array.from({ length: numWaves }, () => r.can(4) ? r.u32() : 0);
		inst.waves = [];
		offsets.forEach((o, i) => {
			if (o <= 278 || !r.can(2, at + o)) return void inst.waves.push(/* @__PURE__ */ new Float32Array(0));
			r.seek(at + o);
			if (type === -2 && i === 0) {
				const len = r.u32();
				r.s16();
				inst.waves.push(r.can(len) ? s8ToFloats(r.bytes(len)) : /* @__PURE__ */ new Float32Array(0));
			} else {
				const len = r.u16() * 2;
				inst.waves.push(r.can(len) ? s8ToFloats(r.bytes(len)) : /* @__PURE__ */ new Float32Array(0));
			}
		});
		inst.kind = type === -1 ? "synth" : "hybrid";
		const first = inst.waves[0] ?? /* @__PURE__ */ new Float32Array(0);
		inst.data = first;
		if (type === -1) {
			inst.loopStart = 0;
			inst.loopLength = first.length;
			if (version <= 2) inst.transpose -= 24;
		} else if (loopLength > 2) {
			inst.loopStart = loopStart;
			inst.loopLength = loopLength;
		}
		return;
	}
	if (type < 0 || type & 128) return;
	const octaves = [
		1,
		5,
		3,
		2,
		4,
		6,
		7,
		1
	][type & 15] ?? 1;
	const bits16 = !!(type & 16);
	const stereo = !!(type & 32);
	const delta = !!(type & 64);
	const total = stereo ? length * 2 : length;
	if (!r.can(total)) return;
	let raw = r.bytes(total);
	if (delta && !bits16) raw = undelta8(raw);
	const decode = (b) => bits16 ? s16beToFloats(b) : s8ToFloats(b);
	let left = decode(stereo ? raw.subarray(0, length) : raw);
	inst.right = stereo ? decode(raw.subarray(length)) : void 0;
	if (octaves > 1) {
		const first = Math.floor(left.length / ((1 << octaves) - 1));
		const start = first * ((1 << octaves - 1) - 1);
		left = left.slice(start, start + first * (1 << octaves - 1));
		inst.loopStart *= 1 << octaves - 1;
		inst.loopLength *= 1 << octaves - 1;
		if (octaves >= 5) inst.transpose += 12;
	}
	inst.data = left;
	inst.bits16 = bits16;
	inst.kind = left.length ? "sample" : "empty";
}
// src/format/mod.ts
/**
* ProTracker .mod files: reading (writing comes with step 3). The format is the
* well-known public one: a title, 31 instruments, the order list, a tag
* ("M.K.", "6CHN", "8CHN"…), patterns of 64 lines × 4 bytes a cell, the samples.
* A file without a tag is read as an old 15-instrument SoundTracker module.
*
* Effects are translated into OctaMED's numbering (song.ts), the way OctaMED
* itself reads a .mod: 4 → 14 (ProTracker's vibrato depth), D → 1D (the line in
* hex), Ex → 11/12/15/16/18/1A/1B/1E/1F, F → 09 (speed) or 0F (BPM).
*/
var TAGS4 = /* @__PURE__ */ new Set([
	"M.K.",
	"M!K!",
	"M&K!",
	"FLT4",
	"4CHN",
	"N.T."
]);
/** The tracks a tag means (0: not a tag we know). */
function tracksOfTag(tag) {
	if (TAGS4.has(tag)) return 4;
	if (tag === "FLT8" || tag === "OCTA" || tag === "CD81") return 8;
	let m = /^(\d)CHN$/.exec(tag);
	if (m) return +m[1];
	m = /^(\d\d)C[HN]$/.exec(tag);
	if (m) return +m[1];
	return 0;
}
/** Does it look like a .mod (31 instruments and a tag)? */
function isMod(b) {
	if (b.length < 1084) return false;
	return tracksOfTag(String.fromCharCode(b[1080], b[1081], b[1082], b[1083])) > 0;
}
function readMod(bytes) {
	const r = new Reader(bytes);
	if (bytes.length < 600) throw new Error("too short for a .mod");
	const tag = bytes.length >= 1084 ? String.fromCharCode(bytes[1080], bytes[1081], bytes[1082], bytes[1083]) : "";
	let tracks = tracksOfTag(tag);
	const old = tracks === 0;
	if (old) tracks = 4;
	const numInst = old ? 15 : 31;
	const title = r.text(20);
	const heads = [];
	for (let i = 0; i < numInst; i++) {
		const inst = emptyInstrument();
		inst.name = r.text(22);
		const len = r.u16() * 2;
		const ft = r.u8() & 15;
		inst.finetune = ft > 7 ? ft - 16 : ft;
		inst.volume = Math.min(64, r.u8());
		let ls = r.u16() * 2;
		const ll = r.u16() * 2;
		if (old) ls >>= 1;
		if (ll > 2) {
			inst.loopStart = ls;
			inst.loopLength = ll;
		}
		heads.push({
			inst,
			bytes: len
		});
	}
	const songLength = Math.max(1, Math.min(128, r.u8()));
	let restart = r.u8();
	const orders = Array.from(r.bytes(128));
	if (!old) r.u32();
	const used = orders.slice(0, songLength);
	const numPat = Math.max(...orders.filter((o) => o < 128)) + 1;
	if (restart >= songLength || restart === 127) restart = 0;
	const song = {
		title,
		format: old ? "MOD 15" : `MOD ${tag}`,
		tracks,
		blocks: [],
		sequence: used,
		restart,
		instruments: [],
		tempoMode: "pt",
		tempo: 125,
		speed: 6,
		lpb: 4,
		transpose: 0,
		noteShift: 0,
		masterVolume: 64,
		trackVolume: new Array(tracks).fill(64),
		trackPan: amigaPan(tracks),
		trackNames: new Array(tracks).fill(""),
		flags: {
			volHex: true,
			vol7bit: false,
			ptSlides: true,
			eightChannel: false,
			hardwareMix: true,
			filter: false
		}
	};
	for (let p = 0; p < numPat; p++) {
		const block = newBlock(tracks, 64, 1);
		for (let line = 0; line < 64; line++) for (let t = 0; t < tracks; t++) {
			if (!r.can(4)) break;
			const a = r.u8(), b = r.u8(), c = r.u8(), d = r.u8();
			const period = (a & 15) << 8 | b;
			const cell = block.cells[line][t];
			cell.inst = a & 240 | c >> 4;
			if (cell.inst > 63) cell.inst = 0;
			if (period) cell.note = Math.max(1, semiOfPeriod(period) + 1);
			const [cmd, val] = modToMed(c & 15, d);
			cell.cmd[0] = cmd;
			cell.val[0] = val;
		}
		song.blocks.push(block);
	}
	for (const h of heads) {
		const n = Math.min(h.bytes, Math.max(0, bytes.length - r.pos));
		if (n > 0) {
			h.inst.data = s8ToFloats(r.bytes(n));
			h.inst.kind = "sample";
		}
		if (h.inst.loopStart + h.inst.loopLength > h.inst.data.length) {
			h.inst.loopLength = Math.max(0, h.inst.data.length - h.inst.loopStart);
			if (h.inst.loopLength <= 2) h.inst.loopStart = 0, h.inst.loopLength = 0;
		}
		song.instruments.push(h.inst);
	}
	while (song.instruments.length && song.instruments[song.instruments.length - 1].kind === "empty") song.instruments.pop();
	return song;
}
/** A ProTracker effect as an OctaMED command. Returns [0, 0] for what has none. */
function modToMed(e, p) {
	switch (e) {
		case 0: return p ? [0, p] : [0, 0];
		case 4: return [20, p];
		case 8: return [0, 0];
		case 9: return [25, p];
		case 13: return [29, Math.min(63, (p >> 4) * 10 + (p & 15))];
		case 14: {
			const x = p >> 4, y = p & 15;
			switch (x) {
				case 0: return [15, y ? 248 : 249];
				case 1: return [17, y];
				case 2: return [18, y];
				case 5: return [21, y];
				case 6: return [22, y];
				case 9: return [31, y];
				case 10: return [26, y];
				case 11: return [27, y];
				case 12: return [24, y];
				case 13: return [31, y << 4];
				case 14: return [30, y];
				default: return [0, 0];
			}
		}
		case 15:
			if (p === 0) return [15, 254];
			return p < 32 ? [9, p] : [15, p];
		default: return [e, p];
	}
}
// src/format/index.ts
/** the names songs have: "x.med", "x.mod", and the Amiga's way: "mod.x", "med.x" */
var SONG_EXTS = [
	".med",
	".mod",
	".mmd0",
	".mmd1",
	".mmd2",
	".mmd3"
];
function readSong(bytes, name = "") {
	if (isMed(bytes)) return readMed(bytes);
	if (isMod(bytes) || /\.mod$|(^|\/)mod\./i.test(name)) return readMod(bytes);
	throw new Error("not a .med (MMD0–MMD3) or .mod file");
}
// src/demo.ts
/**
* breakerMED — a little song of our own (our samples, our notes: free to use),
* made as a .mod file in memory so `med demo` plays something right away and
* goes through the same reader as a real file.
*/
var PERIODS = [
	856,
	808,
	762,
	720,
	678,
	640,
	604,
	570,
	538,
	508,
	480,
	453,
	428,
	404,
	381,
	360,
	339,
	320,
	302,
	285,
	269,
	254,
	240,
	226,
	214,
	202,
	190,
	180,
	170,
	160,
	151,
	143,
	135,
	127,
	120,
	113
];
function demoMod() {
	const sq = Array.from({ length: 64 }, (_, i) => i < 32 ? 90 : -90);
	const saw = Array.from({ length: 64 }, (_, i) => Math.round(i * 3.5 - 112));
	const kick = Array.from({ length: 3e3 }, (_, i) => Math.round(120 * Math.exp(-i / 700) * Math.sin(2 * Math.PI * i * (60 + 200 * Math.exp(-i / 150)) / 8287)));
	let seed = 1;
	const rnd = () => (seed = seed * 1103515245 + 12345 & 2147483647) / 2147483647 * 2 - 1;
	const hat = Array.from({ length: 900 }, (_, i) => Math.round(90 * Math.exp(-i / 120) * rnd()));
	const samples = [
		[
			"square",
			sq,
			true,
			40
		],
		[
			"saw bass",
			saw,
			true,
			52
		],
		[
			"kick",
			kick,
			false,
			64
		],
		[
			"hat",
			hat,
			false,
			34
		]
	];
	const w = new Writer();
	w.text("breakerMED demo", 20);
	for (let i = 0; i < 31; i++) {
		const s = samples[i];
		w.text(s ? s[0] : "", 22);
		if (!s) w.u16(0).u8(0).u8(0).u16(0).u16(1);
		else w.u16(s[1].length / 2).u8(0).u8(s[3]).u16(0).u16(s[2] ? s[1].length / 2 : 1);
	}
	const order = [
		0,
		1,
		0,
		2
	];
	w.u8(order.length).u8(127);
	for (let i = 0; i < 128; i++) w.u8(order[i] ?? 0);
	w.text("M.K.", 4);
	const melody = [
		24,
		27,
		31,
		34,
		31,
		27,
		24,
		22,
		24,
		27,
		31,
		29,
		27,
		26,
		24,
		19
	];
	const bass = [
		12,
		12,
		15,
		15,
		17,
		17,
		10,
		10
	];
	for (const variant of [
		0,
		1,
		2
	]) for (let line = 0; line < 64; line++) for (let t = 0; t < 4; t++) {
		let note = -1, inst = 0, e = 0, p = 0;
		if (t === 0 && line % 4 === 0) note = melody[(line / 4 + variant * 3) % 16] - (variant === 2 ? 12 : 0), inst = 1, e = 10, p = 1;
		if (t === 0 && line % 4 === 2 && variant === 1) note = melody[(line / 4 + 5) % 16], inst = 1, e = 4, p = 70;
		if (t === 1 && line % 8 === 0) note = bass[line / 8 % 8], inst = 2;
		if (t === 2 && line % 8 === 0) note = 12, inst = 3;
		if (t === 2 && line % 16 === 12 && variant) note = 12, inst = 3, e = 12, p = 40;
		if (t === 3 && line % 2 === 1) note = 24, inst = 4, e = 12, p = line % 4 === 3 ? 48 : 24;
		if (t === 3 && line === 0 && variant === 0) e = 15, p = 5;
		const per = note >= 0 ? PERIODS[Math.max(0, Math.min(35, note))] : 0;
		w.u8(inst & 240 | per >> 8).u8(per & 255).u8((inst & 15) << 4 | e).u8(p);
	}
	for (const s of samples) for (const v of s[1]) w.u8(v);
	return w.done();
}
/** a note as text: "C-3", "^^^" (off), "---" (none); past octave 9, "N7F" (hex) */
function noteText(n) {
	if (!n) return "---";
	if (n === 128) return "^^^";
	const oct = Math.floor((n - 1) / 12) + 1;
	return oct <= 9 ? `${NOTE_NAMES[(n - 1) % 12]}${oct}` : `N${hex(n)}`;
}
function parseNoteText(s) {
	if (s === "---") return 0;
	if (s === "^^^") return 128;
	if (/^N[0-9A-F]{2}$/i.test(s)) return parseInt(s.slice(1), 16);
	const m = /^([A-G])([#-])(\d)$/.exec(s.toUpperCase());
	if (!m) throw new Error(`song.json: "${s}" isn't a note`);
	const base = {
		C: 0,
		D: 2,
		E: 4,
		F: 5,
		G: 7,
		A: 9,
		B: 11
	}[m[1]];
	return (+m[3] - 1) * 12 + base + (m[2] === "#" ? 1 : 0) + 1;
}
/** The files of a song saved as .bmed (paths relative to its folder). */
function writeBmed(song) {
	const files = [];
	const sampleRate = 8363;
	const wav = (path, data) => {
		files.push({
			path,
			data: writeWav({
				rate: sampleRate,
				channels: [data]
			}, 16)
		});
		return path;
	};
	const instruments = song.instruments.map((ins, i) => {
		const n = String(i + 1).padStart(2, "0");
		const j = {
			name: ins.name,
			kind: ins.kind,
			loopStart: ins.loopStart,
			loopLength: ins.loopLength,
			volume: ins.volume
		};
		if (ins.kind !== "empty" && ins.data.length) j.file = wav(`samples/${n}.wav`, ins.data);
		if (ins.right?.length) j.right = wav(`samples/${n}-right.wav`, ins.right);
		if (ins.waves?.length) j.waves = ins.waves.map((w, k) => wav(`samples/${n}-wave${k}.wav`, w));
		if (ins.pingPong) j.pingPong = true;
		if (ins.gain !== 1) j.gain = ins.gain;
		if (ins.finetune) j.finetune = ins.finetune;
		if (ins.transpose) j.transpose = ins.transpose;
		if (ins.hold) j.hold = ins.hold;
		if (ins.decay) j.decay = ins.decay;
		if (ins.bits16) j.bits16 = true;
		if (ins.kind === "analog") j.synth = ins.synth;
		if (ins.kind === "drums") j.drums = ins.drums;
		if (ins.kind === "fm") j.fm = ins.fm;
		if (ins.kind === "chip") j.chip = ins.chip;
		if (ins.volTable) j.volTable = ins.volTable, j.waveTable = ins.waveTable, j.volSpeed = ins.volSpeed, j.waveSpeed = ins.waveSpeed;
		return j;
	});
	const blocks = song.blocks.map((b) => ({
		name: b.name,
		lines: b.lines,
		pages: b.pages,
		rows: b.cells.map((row) => row.map((c) => {
			let s = `${noteText(c.note)} ${c.inst ? hex(c.inst) : ".."}${c.chord ? `:${c.chord.toString(16).toUpperCase()}` : ""}`;
			for (let p = 0; p < b.pages; p++) s += c.cmd[p] || c.val[p] ? ` ${hex(c.cmd[p])}${hex(c.val[p])}` : " ....";
			return s;
		}).join(" | "))
	}));
	const json = {
		breakermed: 1,
		title: song.title,
		from: song.format,
		tempo: {
			mode: song.tempoMode,
			tempo: song.tempo,
			speed: song.speed,
			lpb: song.lpb
		},
		transpose: song.transpose,
		noteShift: song.noteShift,
		masterVolume: song.masterVolume,
		restart: song.restart,
		flags: song.flags,
		tracks: Array.from({ length: song.tracks }, (_, t) => ({
			name: song.trackNames[t] ?? "",
			volume: song.trackVolume[t] ?? 64,
			pan: song.trackPan[t] ?? 0,
			...song.trackStrum?.[t] ? { strum: song.trackStrum[t] } : {}
		})),
		sequence: song.sequence,
		...song.chords ? { chords: song.chords } : {},
		...song.chordColumn ? { chordColumn: true } : {},
		...song.echo ? { echo: song.echo } : {},
		...song.swing ? { swing: song.swing } : {},
		instruments,
		blocks
	};
	files.unshift({
		path: "song.json",
		data: JSON.stringify(json, null, 1)
	});
	return files;
}
/** Read a .bmed song: its song.json, and a way to read the files next to it. */
async function readBmed(jsonText, readFile) {
	let j;
	try {
		j = JSON.parse(jsonText);
	} catch {
		throw new Error("song.json isn't valid JSON");
	}
	if (typeof j.breakermed !== "number") throw new Error("song.json isn't a breakerMED song");
	if (j.breakermed > 1) throw new Error("this song was saved by a newer breakerMED: update the module");
	const tracks = Math.max(1, Math.min(64, (j.tracks ?? []).length || 4));
	const num = (v, d, lo = -Infinity, hi = Infinity) => typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
	const sample = async (path) => {
		if (!path || typeof path !== "string" || path.includes("..")) return /* @__PURE__ */ new Float32Array(0);
		return readWav(await readFile(path))?.channels[0] ?? /* @__PURE__ */ new Float32Array(0);
	};
	const instruments = [];
	for (const ij of (j.instruments ?? []).slice(0, 63)) {
		const ins = emptyInstrument();
		ins.name = String(ij.name ?? "").slice(0, 40);
		ins.kind = [
			"sample",
			"synth",
			"hybrid",
			"analog",
			"fm",
			"drums",
			"chip",
			"empty"
		].includes(ij.kind) ? ij.kind : "empty";
		ins.data = await sample(ij.file);
		if (ij.right) ins.right = await sample(ij.right);
		if (Array.isArray(ij.waves)) ins.waves = await Promise.all(ij.waves.slice(0, 64).map((w) => sample(w)));
		ins.loopStart = num(ij.loopStart, 0, 0);
		ins.loopLength = num(ij.loopLength, 0, 0);
		ins.pingPong = !!ij.pingPong;
		ins.volume = num(ij.volume, 64, 0, 64);
		ins.gain = num(ij.gain, 1, 0, 1);
		ins.finetune = num(ij.finetune, 0, -8, 7);
		ins.transpose = num(ij.transpose, 0, -48, 48);
		ins.hold = num(ij.hold, 0, 0, 255);
		ins.decay = num(ij.decay, 0, 0, 255);
		ins.bits16 = !!ij.bits16;
		if (Array.isArray(ij.volTable)) ins.volTable = ij.volTable, ins.waveTable = ij.waveTable ?? [], ins.volSpeed = ij.volSpeed, ins.waveSpeed = ij.waveSpeed;
		if (ins.kind === "analog") ins.synth = sanitizeAnalog(ij.synth);
		else if (ins.kind === "drums") ins.drums = sanitizeKit(ij.drums);
		else if (ins.kind === "fm") ins.fm = sanitizeFm(ij.fm);
		else if (ins.kind === "chip") ins.chip = sanitizeChip(ij.chip);
		else if (ins.kind !== "empty" && !ins.data.length) ins.kind = "empty";
		instruments.push(ins);
	}
	const blocks = (j.blocks ?? []).map((bj, n) => {
		const lines = num(bj.lines, 64, 1, 3200);
		const pages = num(bj.pages, 1, 1, 16);
		const b = newBlock(tracks, lines, pages, String(bj.name ?? ""));
		(bj.rows ?? []).slice(0, lines).forEach((row, l) => {
			String(row).split("|").slice(0, tracks).forEach((cellText, t) => {
				const parts = cellText.trim().split(/\s+/);
				const c = emptyCell(pages);
				c.note = parseNoteText(parts[0] ?? "---");
				const [instText, chordText] = (parts[1] ?? "..").split(":");
				c.inst = instText && instText !== ".." ? Math.min(63, parseInt(instText, 16) || 0) : 0;
				const chord = chordText ? parseInt(chordText, 16) : 0;
				if (chord >= 1 && chord <= 15) c.chord = chord;
				for (let p = 0; p < pages; p++) {
					const x = parts[2 + p];
					if (x && x !== "....") {
						if (!/^[0-9a-f]{4}$/i.test(x)) throw new Error(`song.json: block ${n}, line ${l}: "${x}" isn't a command`);
						c.cmd[p] = parseInt(x.slice(0, 2), 16);
						c.val[p] = parseInt(x.slice(2), 16);
					}
				}
				b.cells[l][t] = c;
			});
		});
		return b;
	});
	const song = {
		title: String(j.title ?? ""),
		format: typeof j.from === "string" && /^(MMD[0-3]|MOD .{1,6}|BMED)$/.test(j.from) ? j.from : "BMED",
		tracks,
		blocks: blocks.length ? blocks : [newBlock(tracks)],
		sequence: (Array.isArray(j.sequence) ? j.sequence : [0]).map((x) => num(x, 0, 0)).filter((x) => x < Math.max(1, blocks.length)),
		restart: num(j.restart, 0, 0),
		instruments,
		tempoMode: [
			"pt",
			"spd",
			"bpm"
		].includes(j.tempo?.mode) ? j.tempo.mode : "bpm",
		tempo: num(j.tempo?.tempo, 125, 1, 999),
		speed: num(j.tempo?.speed, 6, 1, 32),
		lpb: num(j.tempo?.lpb, 4, 1, 32),
		transpose: num(j.transpose, 0, -48, 48),
		noteShift: num(j.noteShift, 0, -48, 48),
		masterVolume: num(j.masterVolume, 64, 0, 64),
		trackVolume: Array.from({ length: tracks }, (_, t) => num(j.tracks?.[t]?.volume, 64, 0, 64)),
		trackPan: Array.from({ length: tracks }, (_, t) => num(j.tracks?.[t]?.pan, amigaPan(tracks)[t], -1, 1)),
		trackNames: Array.from({ length: tracks }, (_, t) => String(j.tracks?.[t]?.name ?? "").slice(0, 24)),
		flags: Object.fromEntries(Object.entries({
			volHex: true,
			vol7bit: false,
			ptSlides: false,
			eightChannel: false,
			hardwareMix: true,
			filter: false
		}).map(([k, d]) => [k, typeof j.flags?.[k] === "boolean" ? j.flags[k] : d]))
	};
	if (!song.sequence.length) song.sequence = [0];
	if (j.chordColumn === true) song.chordColumn = true;
	const echo = cleanEcho(j.echo);
	if (echo) song.echo = echo;
	const swing = num(j.swing, 0, 0, 100);
	if (swing) song.swing = swing;
	const strum = Array.from({ length: tracks }, (_, t) => num(j.tracks?.[t]?.strum, 0, 0, 200));
	if (strum.some((x) => x)) song.trackStrum = strum;
	if (Array.isArray(j.chords)) song.chords = DEFAULT_CHORDS.map((d, i) => {
		const x = j.chords[i];
		const notes = Array.isArray(x?.notes) ? x.notes.filter((n) => typeof n === "number" && Number.isInteger(n) && n >= -24 && n <= 24 && n !== 0).slice(0, 5) : [];
		return notes.length ? {
			name: String(x.name ?? "").slice(0, 8),
			notes
		} : {
			name: d.name,
			notes: [...d.notes]
		};
	});
	return song;
}
// src/template.ts
/**
* breakerMED — the "new song" template: 8 named tracks, a drum machine, an analog
* bass, a lead, a pad and an FM e-piano for the chords, and a first bar written so
* that ▶ plays something at once. Everything is computed (no sample to load).
*/
/** the template's tracks, in order (a 9th track and more stay unnamed) */
var TEMPLATE_TRACKS = [
	"kick",
	"snare",
	"hats",
	"bass",
	"lead",
	"pad",
	"chords",
	"fx"
];
/** C-1 = 1: a note's number from its name in octave n ("C", 3) */
var note = (name, octave) => 1 + (octave - 1) * 12 + [
	"C",
	"C#",
	"D",
	"D#",
	"E",
	"F",
	"F#",
	"G",
	"G#",
	"A",
	"A#",
	"B"
].indexOf(name);
function synth(kind, preset) {
	const sk = SYNTHS.find((s) => s.kind === kind);
	const i = {
		...emptyInstrument(),
		kind,
		name: `${sk.cmd} ${preset}`
	};
	i[sk.field] = sk.preset(preset);
	return i;
}
/** the chiptune template's tracks: the NES-style layout */
var CHIP_TRACKS = [
	"pulse 1",
	"pulse 2",
	"triangle",
	"noise"
];
function chip(preset) {
	const i = {
		...emptyInstrument(),
		kind: "chip",
		name: `chip ${preset}`
	};
	i.chip = chipPreset(preset);
	return i;
}
/**
* The chiptune template (`med new --chip`): 4 tracks laid out like the NES's
* (two pulses, a triangle, a noise), its instruments, and a bar written 4 times:
* a lead, an arpeggio carrying the chords, a triangle bass, hats and snares.
*/
function chipSong() {
	const s = newSong(4);
	s.title = "untitled";
	s.chordColumn = true;
	s.trackNames = [...CHIP_TRACKS];
	s.tempo = 150;
	s.instruments = [
		"2a03-lead",
		"2a03-arp",
		"2a03-bass",
		"2a03-snare",
		"2a03-hat",
		"2a03-kick"
	].map(chip);
	const b = s.blocks[0];
	const put = (line, track, n, inst, chord) => {
		for (let at = line; at < b.lines; at += 16) {
			const c = b.cells[at][track];
			c.note = n, c.inst = inst;
			if (chord) c.chord = chord;
		}
	};
	for (const [l, nm, o] of [
		[
			0,
			"E",
			4
		],
		[
			2,
			"G",
			4
		],
		[
			4,
			"A",
			4
		],
		[
			7,
			"G",
			4
		],
		[
			8,
			"E",
			4
		],
		[
			10,
			"D",
			4
		],
		[
			12,
			"C",
			4
		],
		[
			14,
			"D",
			4
		]
	]) put(l, 0, note(nm, o), 1);
	put(0, 1, note("A", 3), 2, 2);
	put(8, 1, note("F", 3), 2, 1);
	for (const [l, nm] of [
		[0, "A"],
		[4, "A"],
		[8, "F"],
		[12, "G"]
	]) put(l, 2, note(nm, 2), 3);
	for (let l = 0; l < 16; l += 2) put(l, 3, note("C", 5), 5);
	for (const l of [4, 12]) put(l, 3, note("C", 4), 4);
	put(0, 3, note("C", 3), 6);
	return s;
}
/** A new song ready to play: `tracks` tracks (8 by default), the template's instruments and a first bar. */
function templateSong(tracks = TEMPLATE_TRACKS.length) {
	const n = Math.max(1, Math.min(16, tracks));
	const s = newSong(n);
	s.title = "untitled";
	s.chordColumn = true;
	s.trackNames = Array.from({ length: n }, (_, t) => TEMPLATE_TRACKS[t] ?? "");
	s.instruments = [
		{
			...emptyInstrument(),
			kind: "drums",
			name: "drums classic",
			drums: drumKit("classic")
		},
		synth("analog", "bass"),
		synth("analog", "lead"),
		synth("analog", "pad"),
		synth("fm", "epiano")
	];
	const b = s.blocks[0];
	const put = (line, track, n, inst, chord) => {
		if (track >= s.tracks) return;
		for (let at = line; at < b.lines; at += 16) {
			const c = b.cells[at][track];
			c.note = n, c.inst = inst;
			if (chord) c.chord = chord;
		}
	};
	for (const l of [
		0,
		6,
		8
	]) put(l, 0, note("C", 3), 1);
	for (const l of [4, 12]) put(l, 1, note("D", 3), 1);
	for (let l = 0; l < 16; l += 2) put(l, 2, note("E", 3), 1);
	put(10, 2, note("F#", 3), 1);
	for (const [l, nm] of [
		[0, "C"],
		[3, "C"],
		[6, "D#"],
		[8, "F"],
		[11, "G"],
		[14, "D#"]
	]) put(l, 3, note(nm, 2), 2);
	put(0, 6, note("C", 3), 5, 2);
	put(8, 6, note("G#", 2), 5, 1);
	return s;
}
/** our imports and bounces: twice that (and the instrument transposed an octave up), for a clean sound */
var HQ_RATE = 3546895 / 214 * 2;
function chop(d, slices) {
	const n = Math.max(1, Math.min(64, Math.floor(slices)));
	const len = Math.floor(d.length / n);
	return Array.from({ length: n }, (_, i) => d.slice(i * len, i === n - 1 ? d.length : (i + 1) * len));
}
/** Where the attacks are: a jump of the short-term energy over the recent average (at most `max`). */
function onsets(d, max = 32, win = 256) {
	const out = [0];
	let avg = 0;
	let last = 0;
	for (let at = 0; at + win <= d.length; at += win) {
		let e = 0;
		for (let i = at; i < at + win; i++) e += d[i] * d[i];
		e /= win;
		if (at > 0 && e > .002 && e > avg * 4 && at - last > win * 8) {
			out.push(at);
			last = at;
			if (out.length >= max) break;
		}
		avg = avg * .9 + e * .1;
	}
	return out;
}
/** Cut at these frames. */
function sliceAt(d, cuts) {
	const c = [...new Set(cuts.filter((x) => x >= 0 && x < d.length))].sort((a, b) => a - b);
	if (!c.length || c[0] !== 0) c.unshift(0);
	return c.map((s, i) => d.slice(s, c[i + 1] ?? d.length)).filter((x) => x.length > 0);
}
/**
* Amiga-style timestretch: the sample cut in grains of `grain` frames, each
* played as it is, repeated or skipped to reach `factor` × the length (2 = twice
* as long, same pitch). No crossfade: the clicks and the stutter are the sound.
*/
function stretch(d, factor, grain = 512) {
	const f = Math.max(.1, Math.min(8, factor));
	const g = Math.max(16, Math.floor(grain));
	const out = new Float32Array(Math.max(1, Math.round(d.length * f)));
	for (let o = 0; o < out.length; o += g) {
		const src = Math.min(d.length - 1, Math.floor(o / f / g) * g);
		for (let i = 0; i < g && o + i < out.length; i++) out[o + i] = d[Math.min(d.length - 1, src + i)];
	}
	return out;
}
function fade(d, dir, frames = d.length) {
	const out = d.slice();
	const n = Math.max(1, Math.min(d.length, Math.floor(frames)));
	for (let i = 0; i < n; i++) {
		const g = i / n;
		if (dir === "in") out[i] *= g;
		else out[d.length - 1 - i] *= g;
	}
	return out;
}
/** Resample by `ratio` (2 = an octave up: half the frames). Stepped (nearest, Paula's way) or linear. */
function resample(d, ratio, smooth = false) {
	const r = Math.max(1 / 16, Math.min(16, ratio));
	const out = new Float32Array(Math.max(1, Math.floor(d.length / r)));
	for (let i = 0; i < out.length; i++) {
		const p = i * r;
		const k = Math.floor(p);
		out[i] = smooth && k + 1 < d.length ? d[k] + (d[k + 1] - d[k]) * (p - k) : d[Math.min(d.length - 1, k)];
	}
	return out;
}
/** a pitch change in semitones */
var pitch = (d, semitones, smooth = false) => resample(d, 2 ** (semitones / 12), smooth);
function reverse(d) {
	return d.slice().reverse();
}
/** Fewer bits (1–16) and a lower rate (every `hold` frames the same value): destructive, the real 8-bit grit. */
function crush(d, bits = 8, hold = 1) {
	const b = Math.max(1, Math.min(16, Math.floor(bits)));
	const h = Math.max(1, Math.min(64, Math.floor(hold)));
	const steps = 2 ** (b - 1);
	const out = new Float32Array(d.length);
	let v = 0;
	for (let i = 0; i < d.length; i++) {
		if (i % h === 0) v = Math.round(d[i] * steps) / steps;
		out[i] = Math.max(-1, Math.min(1, v));
	}
	return out;
}
function normalize(d, peak = 1) {
	let m = 0;
	for (const x of d) m = Math.max(m, Math.abs(x));
	if (m < 1e-6) return d.slice();
	const g = peak / m;
	return d.map((x) => x * g);
}
/** The silence at both ends removed (below `threshold`). Returns the frames and where they started. */
function trim(d, threshold = .004) {
	let a = 0, b = d.length - 1;
	while (a < d.length && Math.abs(d[a]) < threshold) a++;
	while (b > a && Math.abs(d[b]) < threshold) b--;
	return a > b ? {
		data: /* @__PURE__ */ new Float32Array(0),
		start: 0
	} : {
		data: d.slice(a, b + 1),
		start: a
	};
}
/** Mono from any number of channels (their average), resampled to `to` frames a second. */
function toMono(channels, rate, to) {
	const n = channels[0]?.length ?? 0;
	const mono = new Float32Array(n);
	for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
	return Math.abs(rate - to) < .5 ? mono : resample(mono, rate / to, true);
}
// src/format/iff.ts
var FIB = [
	-34,
	-21,
	-13,
	-8,
	-5,
	-3,
	-2,
	-1,
	0,
	1,
	2,
	3,
	5,
	8,
	13,
	21
];
function read8svx(b) {
	if (b.length < 12) return null;
	const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
	if (tag(0) !== "FORM" || tag(8) !== "8SVX") return null;
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let oneShot = 0, repeat = 0, rate = 8363, comp = 0, volume = 64, name = "", body = null;
	for (let o = 12; o + 8 <= b.length;) {
		const id = tag(o), len = v.getUint32(o + 4);
		const end = Math.min(b.length, o + 8 + len);
		if (id === "VHDR" && len >= 20) {
			oneShot = v.getUint32(o + 8);
			repeat = v.getUint32(o + 12);
			rate = v.getUint16(o + 20) || 8363;
			comp = b[o + 23];
			volume = Math.round(v.getUint32(o + 24) / 65536 * 64);
		} else if (id === "NAME") name = String.fromCharCode(...b.subarray(o + 8, end)).replace(/\0.*$/, "");
		else if (id === "BODY") body = b.subarray(o + 8, end);
		o += 8 + len + (len & 1);
	}
	if (!body) return null;
	let frames;
	if (comp === 1) {
		frames = new Int8Array((body.length - 2) * 2);
		let x = body[1] << 24 >> 24;
		for (let i = 2, k = 0; i < body.length; i++) {
			x = Math.max(-128, Math.min(127, x + FIB[body[i] >> 4]));
			frames[k++] = x;
			x = Math.max(-128, Math.min(127, x + FIB[body[i] & 15]));
			frames[k++] = x;
		}
	} else frames = new Int8Array(body.buffer, body.byteOffset, body.length);
	const len = Math.min(frames.length, oneShot + repeat || frames.length);
	const data = Float32Array.from(frames.subarray(0, len), (x) => x / 128);
	return {
		rate,
		channels: [data],
		name,
		loopStart: repeat ? oneShot : 0,
		loopLength: repeat,
		volume: Math.max(0, Math.min(64, volume))
	};
}
// src/format/sample.ts
/**
* One way to read a sound file into an instrument: WAV, AIFF, IFF 8SVX (our
* own readers), anything else (MP3, M4A, OGG…) through the system's decoder
* (ib.audio.decode). The sound becomes mono at HQ_RATE, the instrument an
* octave up, so C-3 plays it as recorded.
*/
var SAMPLE_EXTS = [
	".wav",
	".aif",
	".aiff",
	".aifc",
	".iff",
	".8svx",
	".mp3",
	".m4a",
	".aac",
	".ogg",
	".oga",
	".opus",
	".flac",
	".caf"
];
async function readSample(bytes, name, decode, amiga = false) {
	const inst = emptyInstrument();
	inst.name = (name.split("/").pop() ?? name).replace(/\.[^.]+$/, "").slice(0, 40);
	let pcm = readWav(bytes) ?? readAiff(bytes);
	const iff = pcm ? null : read8svx(bytes);
	if (iff) {
		pcm = iff;
		if (iff.name) inst.name = iff.name.slice(0, 40);
		inst.volume = iff.volume || 64;
	}
	if (!pcm) {
		if (!decode) throw new Error("not a WAV, AIFF or IFF file");
		pcm = await decode(bytes);
	}
	const to = amiga ? HQ_RATE / 2 : HQ_RATE;
	inst.data = toMono(pcm.channels, pcm.rate, to);
	if (!amiga) inst.transpose = 12;
	if (iff?.loopLength) {
		const k = to / iff.rate;
		inst.loopStart = Math.round(iff.loopStart * k);
		inst.loopLength = Math.round(iff.loopLength * k);
	}
	inst.kind = inst.data.length ? "sample" : "empty";
	return inst;
}
// src/commands-sample.ts
var SAMPLE_USAGE = [
	"med sample <n|.> load [file] [--amiga]   a sound file of the vault (wav, aif, iff/8svx, mp3, m4a, ogg…)",
	"med sample <n|.> chop <slices> | chop onsets    slices become new instruments",
	"med sample <n|.> stretch <×> [grain]     longer / shorter, same pitch, the Amiga way (it grinds)",
	"med sample <n|.> fade in|out [ms] · pitch <semitones> [--smooth] · reverse",
	"med sample <n|.> crush [bits] [hold]     destructive 8-bit (default) and lower rate (hold > 1)",
	"med sample <n|.> normalize · trim · loop <start> <length> | off | pingpong",
	"med sample <n|.> name <text> · vol <0–64> · fine <-8…7> · transpose <semitones> · clear · info",
	"med bounce [--tracks 1,3] [--song]       the block (or the song) rendered into a new instrument",
	"med filter on|off                        the A500's LED filter (also 0FF9 / 0FF8)"
];
async function sampleCommand(ib, st, ctx, rest, flags) {
	const { fmt } = ib.lib;
	const song = st.song;
	const e = st.editor;
	if (!song || !e) return ctx.err("no song loaded (med open <file>)\n"), 1;
	const [which, op, ...args] = rest;
	const n = which === "." || which === void 0 ? st.inst : parseInt(which, 16) - 1;
	if (!(n >= 0 && n < 63)) return ctx.err("med sample <01–3F | .> <tool> … (med -h)\n"), 1;
	while (song.instruments.length <= n) song.instruments.push(emptyInstrument());
	const ins = song.instruments[n];
	const name = `${hex(n + 1)} ${ins.name || "(no name)"}`;
	const needSound = () => {
		if (!ins.data.length) throw new Error(`instrument ${hex(n + 1)} is empty (med sample ${hex(n + 1)} load <file>)`);
	};
	const ms = (x, d) => Math.round((x !== void 0 ? parseFloat(x) : d) / 1e3 * HQ_RATE);
	const change = (label, fn) => {
		needSound();
		e.instrument(n, label, fn);
		ctx.out(`${fmt.green("✓")} ${name}: ${label}\n`);
	};
	switch (op) {
		case void 0:
		case "info": {
			const secs = ins.data.length / HQ_RATE * (ins.transpose >= 12 ? 1 : 2);
			ctx.out(`${name} · ${ins.kind} · ${ins.data.length} frames (~${secs.toFixed(2)} s at C-3) · vol ${ins.volume} · fine ${ins.finetune} · transpose ${ins.transpose}${ins.loopLength ? ` · loop ${ins.loopStart}+${ins.loopLength}${ins.pingPong ? " ping-pong" : ""}` : ""}\n`);
			return 0;
		}
		case "load": {
			let file = args.join(" ");
			if (!file) {
				const found = [];
				const walk = async (dir, depth) => {
					if (depth > 4 || found.length > 300) return;
					for (const x of await ib.vault.list(dir).catch(() => [])) if (x.isDir) {
						if (!x.name.startsWith(".") && !x.name.endsWith(".bmed")) await walk(x.path, depth + 1);
					} else if (SAMPLE_EXTS.some((ext) => x.name.toLowerCase().endsWith(ext))) found.push(x.path);
				};
				await walk("", 0);
				if (!found.length) return ctx.err("no sound file in the vault (drop a .wav, .aif, .mp3… in it)\n"), 1;
				const i = await ib.ui.choose("LOAD A SOUND", found.map((p) => ({ label: p })));
				if (i === null) return 1;
				file = found[i];
			} else file = ctx.resolve(file);
			const loaded = await readSample(await ib.vault.readBytes(file), file, (b) => ib.audio.decode(b), !!flags.amiga);
			e.addInstruments([loaded], n);
			st.inst = n;
			ctx.out(`${fmt.green("✓")} ${hex(n + 1)} ${loaded.name}: ${loaded.data.length} frames${flags.amiga ? " (Amiga rate)" : ""}\n`);
			return 0;
		}
		case "chop": {
			needSound();
			const parts = args[0] === "onsets" ? sliceAt(ins.data, onsets(ins.data)) : chop(ins.data, parseInt(args[0] ?? "4", 10) || 4);
			const made = e.addInstruments(parts.map((d, k) => ({
				...ins,
				name: `${ins.name || "slice"} ${k + 1}`.slice(0, 40),
				data: d,
				loopStart: 0,
				loopLength: 0,
				pingPong: false
			})));
			ctx.out(`${fmt.green("✓")} ${name}: ${made.length} slice(s) → ${made.map((k) => hex(k + 1)).join(" ")}${made.length < parts.length ? fmt.dim(` (${parts.length - made.length} didn't fit: 63 instruments at most)`) : ""}\n`);
			return 0;
		}
		case "stretch": {
			const f = parseFloat(args[0] ?? "2");
			if (!(f > 0)) return ctx.err("med sample <n> stretch <factor, e.g. 2 or 0.5> [grain]\n"), 1;
			change(`stretch ×${f}`, (i) => i.data = stretch(i.data, f, parseInt(args[1] ?? "512", 10) || 512));
			return 0;
		}
		case "fade": {
			const dir = args[0] === "in" ? "in" : args[0] === "out" ? "out" : null;
			if (!dir) return ctx.err("med sample <n> fade in|out [ms]\n"), 1;
			change(`fade ${dir}`, (i) => i.data = fade(i.data, dir, args[1] ? ms(args[1], 0) : i.data.length));
			return 0;
		}
		case "pitch": {
			const s = parseFloat(args[0] ?? "");
			if (!Number.isFinite(s)) return ctx.err("med sample <n> pitch <semitones> [--smooth]\n"), 1;
			change(`pitch ${s > 0 ? "+" : ""}${s}`, (i) => {
				const k = 2 ** (s / 12);
				i.data = pitch(i.data, s, !!flags.smooth);
				i.loopStart = Math.round(i.loopStart / k);
				i.loopLength = Math.round(i.loopLength / k);
			});
			return 0;
		}
		case "reverse":
			change("reverse", (i) => (i.data = reverse(i.data), i.loopLength = 0));
			return 0;
		case "crush": {
			const bits = parseInt(args[0] ?? "8", 10) || 8, hold = parseInt(args[1] ?? "1", 10) || 1;
			change(`crush ${bits} bits${hold > 1 ? ` ×${hold}` : ""}`, (i) => i.data = crush(i.data, bits, hold));
			return 0;
		}
		case "normalize":
			change("normalize", (i) => i.data = normalize(i.data));
			return 0;
		case "trim":
			change("trim", (i) => {
				const r = trim(i.data);
				i.data = r.data;
				i.loopStart = Math.max(0, i.loopStart - r.start);
			});
			return 0;
		case "loop":
			if (args[0] === "off") change("no loop", (i) => (i.loopStart = 0, i.loopLength = 0, i.pingPong = false));
			else if (args[0] === "pingpong") change("ping-pong loop", (i) => (i.pingPong = !i.pingPong, i.loopLength || (i.loopStart = 0, i.loopLength = i.data.length)));
			else {
				const a = parseInt(args[0] ?? "", 10), b = parseInt(args[1] ?? "", 10);
				if (!(a >= 0 && b > 2)) return ctx.err("med sample <n> loop <start> <length> | off | pingpong\n"), 1;
				change(`loop ${a}+${b}`, (i) => (i.loopStart = a, i.loopLength = b));
			}
			return 0;
		case "name":
			e.instrument(n, "name", (i) => i.name = args.join(" ").slice(0, 40));
			return 0;
		case "vol":
		case "fine":
		case "transpose": {
			const v = parseInt(args[0] ?? "", 10);
			const [lo, hi] = op === "vol" ? [0, 64] : op === "fine" ? [-8, 7] : [-48, 48];
			if (!(v >= lo && v <= hi)) return ctx.err(`med sample <n> ${op} ${lo}…${hi}\n`), 1;
			e.instrument(n, op, (i) => op === "vol" ? i.volume = v : op === "fine" ? i.finetune = v : i.transpose = v);
			return 0;
		}
		case "clear":
			e.instrument(n, "clear", (i) => Object.assign(i, emptyInstrument()));
			return 0;
		default: return ctx.err(`med sample: unknown "${op}"\n${SAMPLE_USAGE.join("\n")}\n`), 1;
	}
}
/** `med bounce`: the block (or the song) with these tracks, rendered into a new instrument. */
async function bounce(ib, engine, st, ctx, flags) {
	const song = st.song, e = st.editor;
	if (!song || !e) return ctx.err("no song loaded\n"), 1;
	const solo = flags.tracks ? String(flags.tracks).split(",").map((x) => parseInt(x, 10) - 1).filter((t) => t >= 0 && t < song.tracks) : void 0;
	const pcm = await renderSong(flags.song ? song : {
		...song,
		sequence: [song.sequence[st.seq] ?? 0]
	}, {
		rate: Math.round(HQ_RATE),
		bits: 32,
		paula: engine.paula,
		solo,
		muted: engine.muted,
		tail: .25
	});
	const ins = emptyInstrument();
	ins.name = `bounce ${solo ? solo.map((t) => trackName(song, t)).join("+") : "all"}`.slice(0, 40);
	ins.data = toMono(pcm.channels, pcm.rate, pcm.rate);
	ins.transpose = 12;
	ins.kind = "sample";
	const [k] = e.addInstruments([ins]);
	if (k === void 0) return ctx.err("no free instrument (63 at most)\n"), 1;
	st.inst = k;
	ctx.out(`${ib.lib.fmt.green("✓")} ${hex(k + 1)} ${ins.name}: ${ins.data.length} frames (C-3 plays it as it was)\n`);
	return 0;
}
// src/dsp/bake.ts
/**
* breakerMED — our computed instruments turned into samples, for the files
* other trackers read (.mod, .med hold samples only):
*   a synth  → its middle C, held for a while, then released;
*   a kit    → each drum the song plays becomes an instrument of its own, and
*              the notes that played it now play that sample at C-3.
*/
/** a voice played into a new sample: held `hold` seconds, then let go, until silent (`max` seconds) */
function record(v, hold, max) {
	const n = Math.round(HQ_RATE * max);
	const l = new Float32Array(n), r = new Float32Array(n);
	const held = Math.min(n, Math.round(HQ_RATE * hold));
	v.render(l, r, 0, held);
	v.stop();
	v.render(l, r, held, n);
	let end = n;
	while (end > 1 && Math.abs(l[end - 1]) < 1e-4) end--;
	return l.slice(0, Math.max(1, end)).map((x) => Math.max(-1, Math.min(1, x * 2)));
}
var asSample = (from, name, data) => Object.assign(emptyInstrument(), {
	name: name.slice(0, 40),
	volume: from.volume,
	gain: from.gain,
	transpose: 12,
	kind: "sample",
	data
});
/** The synth's sound at C-3: held `hold` seconds, then its release (2 s at most). */
function bakeSynth(ins, hold = .8) {
	const v = ins.kind === "fm" ? new FmVoice(HQ_RATE) : ins.kind === "chip" ? new ChipVoice(HQ_RATE) : new AnalogVoice(HQ_RATE);
	v.start({
		instrument: ins,
		rate: C3_RATE$2,
		offset: 0
	});
	v.set(C3_RATE$2, 1, 0);
	const out = asSample(ins, ins.name, record(v, hold, hold + 2));
	out.transpose = ins.transpose + 12;
	return out;
}
/** One drum of a kit (0 = the kick … 11 = the ride), as a sample. */
function bakeDrum(ins, drum) {
	const v = new DrumVoice(HQ_RATE);
	v.start({
		instrument: ins,
		rate: C3_RATE$2 * 2 ** (drum / 12),
		offset: 0
	});
	v.set(C3_RATE$2, 1, 0);
	return asSample(ins, `${ins.name || "kit"} ${DRUM_NAMES[drum]}`, record(v, 8, 8));
}
/**
* The song with every synth and kit as samples (the song itself isn't
* changed), and how many of each. A kit's drums go to free instrument slots
* (or after the last); the cells that played them are rewritten.
*/
function withSynthsBaked(song) {
	let baked = 0, drums = 0, lost = 0;
	const synth = (i) => i.kind === "analog" || i.kind === "fm" || i.kind === "chip";
	if (!song.instruments.some((i) => synth(i) || i.kind === "drums")) return {
		song,
		baked,
		drums,
		lost
	};
	const instruments = song.instruments.map((i) => synth(i) ? (baked++, bakeSynth(i)) : i);
	const slot = /* @__PURE__ */ new Map();
	const kitOf = (n) => song.instruments[n - 1]?.kind === "drums";
	const blocks = song.blocks.map((b) => {
		const last = [];
		return {
			...b,
			cells: b.cells.map((row) => row.map((c, t) => {
				if (c.inst) last[t] = c.inst;
				const inst = c.inst || last[t];
				if (!c.note || c.note > 120 || !inst || !kitOf(inst)) return c;
				const ins = song.instruments[inst - 1];
				const drum = ((c.note - 1 + ins.transpose + song.transpose) % 12 + 12) % 12;
				const key = `${inst}:${drum}`;
				let n = slot.get(key);
				if (n === void 0) {
					const free = instruments.findIndex((x) => x.kind === "empty");
					n = (free >= 0 ? free : instruments.length) + 1;
					if (n > 63) return lost++, {
						...c,
						note: 0,
						inst: 0
					};
					instruments[n - 1] = bakeDrum(ins, drum);
					slot.set(key, n);
					drums++;
				}
				return {
					...c,
					note: Math.max(1, Math.min(120, 25 - song.transpose)),
					inst: n
				};
			}))
		};
	});
	return {
		song: {
			...song,
			instruments,
			blocks
		},
		baked,
		drums,
		lost
	};
}
// src/commands-synth.ts
var SYNTH_USAGE = [
	"med synth <n|.> new [preset]             the instrument becomes an analog synth (presets: med synth presets)",
	"med fm <n|.> new [preset]                the instrument becomes an FM synth (presets: med fm presets)",
	"med synth|fm <n|.> preset <name> · set <setting> <value> · up|down <setting> · show · settings",
	"med synth|fm <n|.> bake                  the synth as a sample of its C-3 (for the sampler's tools)",
	"med chip <n|.> new [preset]              the instrument becomes a chip synth (2a03 dmg sid ay psg pce · med chip presets)",
	"med chip <n|.> set chip|wave|duty|noise|arp|sweep… <value> · table <32 hex digits>   its own wavetable"
];
/** `med synth …` (the analog synth) and `med fm …` (the FM synth): the same commands, each its own settings */
async function synthCommand(ib, st, ctx, rest, sk) {
	const { fmt } = ib.lib;
	const c = `med ${sk.cmd}`;
	if (rest[0] === "presets" || rest[0] === "settings") {
		ctx.out(rest[0] === "presets" ? sk.kind === "chip" ? CHIPS.map((ch) => `${ch.padEnd(5)} ${CHIP_LIKE[ch]}\n      ${chipPresetsFor(ch).join(" · ")}`).join("\n") + "\n" : `${sk.presets.join(" · ")}\n` : sk.params.map((d) => `  ${d.key.padEnd(15)} ${d.label.padEnd(18)} ${d.choices ? d.choices.join(" | ") : `${d.min}…${d.max}${d.unit ? ` ${d.unit}` : ""}`}`).join("\n") + "\n");
		return 0;
	}
	const song = st.song, e = st.editor;
	if (!song || !e) return ctx.err("no song loaded (med open <file>)\n"), 1;
	const [which, op = "show", ...args] = rest;
	const n = which === "." || which === void 0 ? st.inst : parseInt(which, 16) - 1;
	if (!(n >= 0 && n < 63)) return ctx.err(`${c} <01–3F | .> new|preset|set|show … (med -h)\n`), 1;
	while (song.instruments.length <= n) song.instruments.push(emptyInstrument());
	const ins = song.instruments[n];
	const id = hex(n + 1);
	const own = (i) => settingsOf(i, sk);
	const needSynth = () => {
		if (ins.kind !== sk.kind || !settingsOf(ins, sk)) throw new Error(`instrument ${id} isn't ${sk.what} (${c} ${id} new)`);
	};
	const ours = new RegExp(`^${sk.cmd}( |$)`);
	switch (op) {
		case "new": {
			const name = args[0] ?? "";
			if (name && !sk.presets.includes(name)) return ctx.err(`no preset "${name}": ${sk.presets.join(" · ")}\n`), 1;
			e.instrument(n, `${sk.cmd} ${name || "new"}`, (i) => {
				const keep = i.kind === sk.kind && i.name ? i.name : `${sk.cmd} ${name}`.trim();
				Object.assign(i, emptyInstrument(), {
					kind: sk.kind,
					name: keep
				});
				putSettings(i, sk, sk.preset(name || void 0));
			});
			st.inst = n;
			ctx.out(`${fmt.green("✓")} ${id}: ${sk.what}${name ? ` (${name})` : ""} · play it, or ${c} ${id} ${sk.example}\n`);
			return 0;
		}
		case "preset": {
			needSynth();
			const name = args[0] ?? "";
			if (!sk.presets.includes(name)) return ctx.err(`presets: ${sk.presets.join(" · ")}\n`), 1;
			e.instrument(n, `preset ${name}`, (i) => {
				putSettings(i, sk, sk.preset(name));
				if (ours.test(i.name)) i.name = `${sk.cmd} ${name}`;
			});
			ctx.out(`${fmt.green("✓")} ${id}: ${name}\n`);
			return 0;
		}
		case "set":
		case "up":
		case "down": {
			needSynth();
			const def = findIn(sk.params, args[0] ?? "");
			if (!def) return ctx.err(`${c} ${id} ${op} <setting>${op === "set" ? " <value>" : ""} · settings: ${c} settings\n`), 1;
			if (op === "set" && args[1] === void 0) return ctx.err(`${c} ${id} set ${def.key} <${def.choices ? def.choices.join("|") : `${def.min}…${def.max}`}>\n`), 1;
			if (op === "set") setIn(sk.params, structuredClone(own(ins)), def.key, args[1]);
			e.instrument(n, def.label, (i) => op === "set" ? setIn(sk.params, own(i), def.key, args[1]) : nudgeIn(sk.params, own(i), def.key, op === "up" ? 1 : -1, args[1] === "big"));
			if (op === "set") ctx.out(`${fmt.green("✓")} ${id} ${def.label}: ${showIn(own(song.instruments[n]), def)}\n`);
			return 0;
		}
		case "table": {
			needSynth();
			if (sk.kind !== "chip") return ctx.err(`${c}: unknown "table"\n`), 1;
			const v = parseTable(args.join(""));
			if (!v) return ctx.err(`${c} ${id} table <32 digits: 0–F (4 bits) or 0–V (5 bits)> e.g. 0123456789ABCDEFFEDCBA9876543210\n`), 1;
			e.instrument(n, "wavetable", (i) => i.chip && Object.assign(i.chip, {
				custom: v,
				table: "custom",
				wave: "wave"
			}));
			ctx.out(`${fmt.green("✓")} ${id}: its own wavetable (wave: wave, table: custom)\n`);
			return 0;
		}
		case "bake": {
			needSynth();
			const baked = bakeSynth(ins);
			const [k] = e.addInstruments([{
				...baked,
				name: `${ins.name} (sample)`.slice(0, 40)
			}]);
			if (k === void 0) return ctx.err("no free instrument (63 at most)\n"), 1;
			st.inst = k;
			ctx.out(`${fmt.green("✓")} ${hex(k + 1)}: ${id} as a sample (${baked.data.length} frames)\n`);
			return 0;
		}
		case "show":
		case "info":
			needSynth();
			ctx.out(`${id} ${ins.name || "(no name)"} · ${sk.what.replace(/^an? /, "")}\n` + sk.params.map((d) => `  ${d.label.padEnd(18)} ${showIn(own(ins), d)}`).join("\n") + "\n");
			return 0;
		default: return ctx.err(`${c}: unknown "${op}"\n${SYNTH_USAGE.join("\n")}\n`), 1;
	}
}
var DRUMS_USAGE = [
	"med drums <n|.> new [kit]                the instrument becomes a drum machine (med drums kits: classic punch tight lofi boom house…)",
	"med drums <n|.> kit <name> · set <drum> tune|decay|level|tone <value> · grit <bits> [hold] · show",
	"med drums <n|.> bake <drum>              one drum as a sample · drums: C kick C# rim D snare D# clap E closed hat",
	"                                         F low tom F# open hat G mid tom G# cowbell A high tom A# crash B ride"
];
async function drumsCommand(ib, st, ctx, rest) {
	const { fmt } = ib.lib;
	if (rest[0] === "kits") return ctx.out(`${Object.keys(DRUM_KITS).join(" · ")}\n`), 0;
	const song = st.song, e = st.editor;
	if (!song || !e) return ctx.err("no song loaded (med open <file>)\n"), 1;
	const [which, op = "show", ...args] = rest;
	const n = which === "." || which === void 0 ? st.inst : parseInt(which, 16) - 1;
	if (!(n >= 0 && n < 63)) return ctx.err("med drums <01–3F | .> new|kit|set|grit|show … (med -h)\n"), 1;
	while (song.instruments.length <= n) song.instruments.push(emptyInstrument());
	const ins = song.instruments[n];
	const id = hex(n + 1);
	const needKit = () => {
		if (ins.kind !== "drums" || !ins.drums) throw new Error(`instrument ${id} isn't a drum machine (med drums ${id} new)`);
	};
	const drumArg = (x) => {
		const d = findDrum(x ?? "");
		if (d < 0) throw new Error(`which drum? ${DRUM_NAMES.map((name, i) => `${DRUM_NOTES[i]} ${name}`).join(" · ")}`);
		return d;
	};
	switch (op) {
		case "new":
		case "kit": {
			const name = args[0] ?? (op === "new" ? "classic" : "");
			if (!DRUM_KITS[name]) return ctx.err(`kits: ${Object.keys(DRUM_KITS).join(" · ")}\n`), 1;
			if (op === "kit") needKit();
			e.instrument(n, `kit ${name}`, (i) => {
				if (op === "new") Object.assign(i, emptyInstrument(), {
					kind: "drums",
					name: i.kind === "drums" && i.name ? i.name : `drums ${name}`
				});
				else if (/^drums( |$)/.test(i.name)) i.name = `drums ${name}`;
				i.drums = drumKit(name);
			});
			st.inst = n;
			if (op === "new") ctx.out(`${fmt.green("✓")} ${id}: a drum machine (${name}) · C kick, D snare, E closed hat, F# open hat… one a note of any octave\n`);
			else ctx.out(`${fmt.green("✓")} ${id}: ${name}\n`);
			return 0;
		}
		case "set": {
			needKit();
			const d = drumArg(args[0]);
			const key = DRUM_SETTINGS.find((s) => s.key === args[1])?.key;
			const v = parseFloat(args[2] ?? "");
			if (!key || !Number.isFinite(v)) return ctx.err(`med drums ${id} set <drum> ${DRUM_SETTINGS.map((s) => `${s.key} ${s.min}…${s.max}`).join(" | ")}\n`), 1;
			e.instrument(n, `${DRUM_NAMES[d]} ${key}`, (i) => setDrum(i.drums, d, key, v));
			ctx.out(`${fmt.green("✓")} ${id} ${DRUM_NAMES[d]} ${key}: ${song.instruments[n].drums.drums[d][key]}\n`);
			return 0;
		}
		case "grit": {
			needKit();
			const bits = parseInt(args[0] ?? "", 10), hold = parseInt(args[1] ?? "1", 10);
			if (!(bits >= 1 && bits <= 16) || !(hold >= 1 && hold <= 16)) return ctx.err(`med drums ${id} grit <bits 1–16, 16 = clean> [hold 1–16]\n`), 1;
			e.instrument(n, "grit", (i) => (i.drums.bits = bits, i.drums.hold = hold));
			ctx.out(`${fmt.green("✓")} ${id}: ${bits >= 16 && hold <= 1 ? "clean" : `${bits} bits${hold > 1 ? `, ×${hold}` : ""}`}\n`);
			return 0;
		}
		case "bake": {
			needKit();
			const d = drumArg(args[0]);
			const baked = bakeDrum(ins, d);
			const [k] = e.addInstruments([baked]);
			if (k === void 0) return ctx.err("no free instrument (63 at most)\n"), 1;
			st.inst = k;
			ctx.out(`${fmt.green("✓")} ${hex(k + 1)} ${baked.name}: ${id}'s ${DRUM_NAMES[d]} as a sample (${baked.data.length} frames)\n`);
			return 0;
		}
		case "show":
		case "info": {
			needKit();
			const k = ins.drums;
			ctx.out(`${id} ${ins.name || "(no name)"} · drum machine${k.bits < 16 || k.hold > 1 ? ` · grit ${k.bits} bits ×${k.hold}` : ""}\n       ${"drum".padEnd(11)} tune decay level tone\n` + k.drums.map((d, i) => `  ${DRUM_NOTES[i].padEnd(3)}  ${DRUM_NAMES[i].padEnd(11)} ${String(d.tune).padStart(4)} ${d.decay.toFixed(1).padStart(5)} ${d.level.toFixed(2).padStart(5)} ${d.tone.toFixed(2).padStart(4)}`).join("\n") + "\n");
			return 0;
		}
		default: return ctx.err(`med drums: unknown "${op}"\n${DRUMS_USAGE.join("\n")}\n`), 1;
	}
}
// src/format/write.ts
/**
* Writing .mod (ProTracker) and .med (MMD1, read by OctaMED Pro and later, and
* by OpenMPT): for sharing with other trackers. Our own format (.bmed) keeps
* everything; these keep what they can and say what they couldn't
* (`warnings`): more tracks than ProTracker reads, blocks that aren't 64 lines,
* commands a .mod hasn't got, synths…
*/
/** 0C's value as a hex volume 0–64, whatever the song's convention */
function volumeOf(song, v) {
	if (song.flags.vol7bit) return Math.min(64, (v & 127) + 1 >> 1);
	if (song.flags.volHex) return Math.min(64, v & 127);
	return v < 153 ? Math.min(64, (v >> 4) * 10 + (v & 15)) : 64;
}
/** An OctaMED command as a ProTracker effect, or null when it has none. */
function medToMod(song, cmd, v) {
	switch (cmd) {
		case 0: return v ? [0, v] : null;
		case 1:
		case 2:
		case 3:
		case 5:
		case 6:
		case 7:
		case 10:
		case 11: return [cmd, v];
		case 13: return [10, v];
		case 4: return [4, v & 240 | Math.min(15, (v & 15) * 2)];
		case 20: return [4, v];
		case 9: return v > 0 && v < 32 ? [15, v] : null;
		case 12: return [12, volumeOf(song, v)];
		case 15:
			if (v === 0) return [13, 0];
			if (v <= 240) {
				const bpm = Math.round(ptBpmOf(song.tempoMode, v, song.lpb, song.flags.eightChannel, song.flags.hardwareMix));
				return [15, Math.max(32, Math.min(255, bpm))];
			}
			return {
				241: [14, 147],
				242: [14, 211],
				243: [14, 146],
				248: [14, 1],
				249: [14, 0],
				254: [15, 0],
				255: [14, 192]
			}[v] ?? null;
		case 17: return [14, 16 | v & 15];
		case 18: return [14, 32 | v & 15];
		case 21: return [14, 80 | v & 15];
		case 22: return [14, 96 | v & 15];
		case 24: return [14, 192 | Math.min(15, v)];
		case 25: return [9, v];
		case 26: return [14, 160 | v & 15];
		case 27: return [14, 176 | v & 15];
		case 29: return [13, Math.min(63, v) % 10 | Math.floor(Math.min(63, v) / 10) << 4];
		case 30: return [14, 224 | Math.min(15, v)];
		case 31: return v >> 4 ? [14, 208 | v >> 4] : v & 15 ? [14, 144 | v & 15] : null;
		default: return null;
	}
}
var hasChords = (s) => s.blocks.some((b) => b.cells.some((row) => row.some((c) => c.chord && c.note && c.note !== 128)));
function writeMod(original) {
	const warnings = [];
	const { song, baked, drums, lost } = withSynthsBaked(original);
	if (baked) warnings.push(`${baked} synth(s) written as a sample of their C-3 (a .mod holds samples only)`);
	if (drums) warnings.push(`the drum machine: ${drums} drum(s) written as samples of their own`);
	if (lost) warnings.push(`${lost} drum note(s) left out: no free instrument`);
	if (hasChords(song)) warnings.push("chords: other trackers play only the note written (.bmed keeps them; med bounce keeps a chord's sound)");
	if (song.echo) warnings.push("the echo isn't written (.bmed keeps it; an export keeps its sound)");
	const w = new Writer();
	const tracks = song.tracks;
	if (tracks > 32) warnings.push(`${tracks} tracks: a .mod holds 32 at most — cut`);
	const T = Math.min(32, tracks);
	if (T !== 4) warnings.push(`${T} tracks: ProTracker itself plays 4 (OpenMPT, MilkyTracker… play more)`);
	const tag = T === 4 ? "M.K." : T < 10 ? `${T}CHN` : `${T}CH`;
	w.text(song.title, 20);
	const insts = song.instruments.slice(0, 31);
	if (song.instruments.filter((i) => i.kind !== "empty").length > 31) warnings.push("more than 31 instruments: the rest are left out");
	if (song.instruments.some((i) => i.kind === "synth" || i.kind === "hybrid")) warnings.push("synth instruments are written as their first waveform");
	if (song.instruments.some((i) => i.bits16)) warnings.push("16-bit samples are written in 8 bits");
	const datas = insts.map((i) => i.kind === "empty" ? /* @__PURE__ */ new Float32Array(0) : i.data.length > 131070 ? (warnings.push(`instrument "${i.name}": longer than 128 kB, cut`), i.data.slice(0, 131070)) : i.data);
	for (let i = 0; i < 31; i++) {
		const ins = insts[i];
		const words = (datas[i] ?? /* @__PURE__ */ new Float32Array(0)).length >> 1;
		w.text(ins?.name ?? "", 22).u16(words).u8((ins?.finetune ?? 0) & 15).u8(Math.min(64, ins?.volume ?? 0));
		const ls = ins && ins.loopLength > 2 ? Math.min(words, ins.loopStart >> 1) : 0;
		const ll = ins && ins.loopLength > 2 ? Math.max(1, Math.min(words - ls, ins.loopLength >> 1)) : 1;
		w.u16(ls).u16(ll);
	}
	const seq = song.sequence.slice(0, 128);
	if (song.sequence.length > 128) warnings.push("a .mod's sequence holds 128 positions: the rest is cut");
	const patOf = /* @__PURE__ */ new Map();
	for (const b of seq) if (!patOf.has(b)) patOf.set(b, patOf.size);
	w.u8(seq.length).u8(song.restart < seq.length ? song.restart : 127);
	for (let i = 0; i < 128; i++) w.u8(i < seq.length ? patOf.get(seq[i]) : 0);
	w.text(tag, 4);
	let dropped = 0;
	const first = seq[0];
	const lastInst = new Array(T).fill(0);
	for (const [b] of patOf) {
		const block = song.blocks[b];
		if (block.lines > 64) warnings.push(`block ${b}: ${block.lines} lines, a .mod pattern has 64 — cut`);
		for (let line = 0; line < 64; line++) {
			const free = [];
			const cells = [];
			for (let t = 0; t < T; t++) {
				const c = line < block.lines ? block.cells[line][t] : void 0;
				let period = 0, inst = 0, e = 0, p = 0;
				if (c) {
					inst = c.inst;
					if (c.inst) lastInst[t] = c.inst;
					if (c.note && c.note !== 128) {
						let s = c.note - 1 + song.transpose + song.noteShift + (song.instruments[lastInst[t] - 1]?.transpose ?? 0);
						while (s > 35) s -= 12;
						while (s < 0) s += 12;
						period = Math.round(periodOf(s));
					} else if (c.note === 128) [e, p] = [14, 192];
					for (let k = 0; k < c.cmd.length && !e; k++) {
						if (!c.cmd[k] && !c.val[k]) continue;
						const m = medToMod(song, c.cmd[k], c.val[k]);
						if (m) [e, p] = m;
						else dropped++;
					}
				}
				if (!e && !p) free.push(t);
				cells.push([
					period,
					inst,
					e,
					p
				]);
			}
			if (line === block.lines - 1 && block.lines < 64) {
				const t = free.shift();
				if (t !== void 0) cells[t][2] = 13;
				else warnings.push(`block ${b}: no free column for the break at line ${line}`);
			}
			if (b === first && line === 0) {
				const bpm = Math.round(ptBpmOf(song.tempoMode, song.tempo, song.lpb, song.flags.eightChannel, song.flags.hardwareMix));
				const want = [];
				if (song.speed !== 6) want.push([15, Math.min(31, song.speed)]);
				if (bpm !== 125) want.push([15, Math.max(32, Math.min(255, bpm))]);
				for (const [e, p] of want) {
					const t = free.shift();
					if (t === void 0) warnings.push("no free column on the first line for the tempo");
					else cells[t][2] = e, cells[t][3] = p;
				}
			}
			for (const [period, inst, e, p] of cells) w.u8(inst & 240 | period >> 8 & 15).u8(period & 255).u8((inst & 15) << 4 | e).u8(p);
		}
	}
	if (dropped) warnings.push(`${dropped} command(s) a .mod hasn't got were left out`);
	for (const d of datas) w.bytes(floatsToS8(d.length & 1 ? d.slice(0, d.length - 1) : d));
	return {
		bytes: w.done(),
		warnings
	};
}
function writeMed(original) {
	const warnings = [];
	const { song, baked, drums, lost } = withSynthsBaked(original);
	if (baked) warnings.push(`${baked} synth(s) written as a sample of their C-3 (OctaMED can't play our synth)`);
	if (drums) warnings.push(`the drum machine: ${drums} drum(s) written as samples of their own`);
	if (lost) warnings.push(`${lost} drum note(s) left out: no free instrument`);
	if (hasChords(song)) warnings.push("chords: other trackers play only the note written (.bmed keeps them; med bounce keeps a chord's sound)");
	if (song.echo) warnings.push("the echo isn't written (.bmed keeps it; an export keeps its sound)");
	const w = new Writer();
	const T = song.tracks;
	const insts = song.instruments.slice(0, 63);
	if (song.instruments.length > 63) warnings.push("more than 63 instruments: the rest are left out");
	if (song.instruments.some((i) => i.kind === "synth" || i.kind === "hybrid")) warnings.push("synth instruments are written as their first waveform");
	const seq = song.sequence.slice(0, 256);
	if (song.sequence.length > 256) warnings.push("an MMD1 sequence holds 256 positions: the rest is cut");
	w.text("MMD1", 4).u32(0).u32(52).u32(0).u32(0).u32(0).u32(0).u32(0).u32(0).u32(0).zeros(11).u8(0);
	for (let i = 0; i < 63; i++) {
		const ins = insts[i];
		const loop = ins && ins.loopLength > 2;
		w.u16(loop ? ins.loopStart >> 1 : 0).u16(loop ? ins.loopLength >> 1 : 0).u8(0).u8(0).u8(Math.min(64, ins?.volume ?? 0)).u8((ins?.transpose ?? 0) & 255);
	}
	let tempo = song.tempo, lpb = song.lpb, mode = song.tempoMode;
	if (mode === "pt") mode = "bpm", lpb = 4, tempo = Math.round(ptBpmOf("pt", song.tempo, 4));
	w.u16(song.blocks.length).u16(seq.length);
	for (let i = 0; i < 256; i++) w.u8(seq[i] ?? 0);
	const flags = 16 | (song.flags.ptSlides ? 32 : 0) | (song.flags.eightChannel ? 64 : 0) | (song.flags.filter ? 1 : 0);
	const flags2 = (mode === "bpm" ? 32 | Math.max(1, lpb) - 1 & 31 : 0) | (song.flags.hardwareMix ? 0 : 128);
	w.u16(Math.max(1, Math.min(65535, tempo))).u8(song.transpose & 255).u8(flags).u8(flags2).u8(Math.max(1, Math.min(32, song.speed)));
	for (let t = 0; t < 16; t++) w.u8(Math.min(64, song.trackVolume[t] ?? 64));
	w.u8(Math.min(64, song.masterVolume)).u8(insts.length);
	const blockArr = w.pos;
	w.zeros(4 * song.blocks.length);
	song.blocks.forEach((b, n) => {
		w.align();
		const at = w.pos;
		w.patch32(blockArr + 4 * n, at);
		w.u16(T).u16(b.lines - 1);
		const infoPtr = w.pos;
		w.u32(0);
		const note = (x) => x === 128 ? 128 : x ? Math.max(1, Math.min(127, x + song.noteShift)) : 0;
		const val = (cmd, v) => cmd === 12 ? volumeOf(song, v) : v;
		for (let l = 0; l < b.lines; l++) for (let t = 0; t < T; t++) {
			const c = b.cells[l][t];
			w.u8(note(c.note)).u8(c.inst & 63).u8(c.cmd[0] ?? 0).u8(val(c.cmd[0] ?? 0, c.val[0] ?? 0));
		}
		if (b.pages > 1 || b.name) {
			w.align();
			const pages = [];
			for (let p = 1; p < b.pages; p++) {
				pages.push(w.pos);
				for (let l = 0; l < b.lines; l++) for (let t = 0; t < T; t++) {
					const c = b.cells[l][t];
					w.u8(c.cmd[p] ?? 0).u8(val(c.cmd[p] ?? 0, c.val[p] ?? 0));
				}
			}
			w.align();
			let nameAt = 0;
			if (b.name) nameAt = w.pos, w.text(b.name, b.name.length + 1);
			w.align();
			let tableAt = 0;
			if (pages.length) {
				tableAt = w.pos;
				w.u16(pages.length).u16(0);
				for (const p of pages) w.u32(p);
			}
			w.align();
			const info = w.pos;
			w.u32(0).u32(nameAt).u32(b.name ? b.name.length + 1 : 0).u32(tableAt).u32(0).zeros(16);
			w.patch32(infoPtr, info);
		}
	});
	w.align();
	const sampleArr = w.pos;
	w.zeros(4 * insts.length);
	insts.forEach((ins, i) => {
		if (ins.kind === "empty" || !ins.data.length) return;
		w.align();
		w.patch32(sampleArr + 4 * i, w.pos);
		const bytes = ins.bits16 ? floatsToS16be(ins.data) : floatsToS8(ins.data);
		w.u32(bytes.length).u16(ins.bits16 ? 16 : 0).bytes(bytes);
	});
	w.align();
	const extAt = w.pos;
	for (const ins of insts) {
		const loop = ins.loopLength > 2;
		w.u8(ins.hold & 255).u8(ins.decay & 255).u8(0).u8(ins.finetune & 255).u8(0).u8((loop ? 1 : 0) | (ins.pingPong ? 8 : 0)).u16(0).u8(0).u8(0);
		w.u32(loop ? ins.loopStart : 0).u32(loop ? ins.loopLength : 0).u8(Math.max(0, Math.min(127, Math.round(ins.gain * 128) - 1))).u8(0).u8(0).u8(0);
	}
	const infoAt = w.pos;
	for (const ins of insts) w.text(ins.name, 40);
	let nameAt = 0;
	if (song.title) nameAt = w.pos, w.text(song.title, song.title.length + 1);
	w.align();
	const exp = w.pos;
	w.u32(0).u32(extAt).u16(insts.length).u16(22).u32(0).u32(0).u32(infoAt).u16(insts.length).u16(40).u32(0).u32(0).zeros(4).u32(0).u32(nameAt).u32(song.title ? song.title.length + 1 : 0).zeros(28);
	w.patch32(4, w.pos);
	w.patch32(16, blockArr);
	w.patch32(24, sampleArr);
	w.patch32(32, exp);
	return {
		bytes: w.done(),
		warnings
	};
}
// src/pack.ts
/**
* BreakerMED — the starter sound pack: the sampled sounds we want, made by people
* (not computed: those are the synths and the drum machine). Until a musician
* records one, it's a placeholder: listed, not there. SOUND_DESIGN.md says how to
* make them; `med pack` shows which are in the vault, `med pack load <name>` loads one.
*/
/** where the pack lives in the vault */
var PACK_DIR = "sounds/breakermed-pack";
var PACK = [
	{
		file: "drums/kick-acoustic.wav",
		what: "an acoustic kick drum, one hit",
		pitch: null,
		loop: false
	},
	{
		file: "drums/snare-acoustic.wav",
		what: "an acoustic snare, one hit, medium",
		pitch: null,
		loop: false
	},
	{
		file: "drums/hat-closed.wav",
		what: "a closed hi-hat, one hit",
		pitch: null,
		loop: false
	},
	{
		file: "drums/hat-open.wav",
		what: "an open hi-hat, let ring",
		pitch: null,
		loop: false
	},
	{
		file: "drums/ride.wav",
		what: "a ride cymbal, one hit",
		pitch: null,
		loop: false
	},
	{
		file: "drums/crash.wav",
		what: "a crash cymbal, let ring",
		pitch: null,
		loop: false
	},
	{
		file: "drums/tom-low.wav",
		what: "a floor tom",
		pitch: null,
		loop: false
	},
	{
		file: "drums/tom-high.wav",
		what: "a rack tom",
		pitch: null,
		loop: false
	},
	{
		file: "drums/clap.wav",
		what: "real hands clapping, a few people",
		pitch: null,
		loop: false
	},
	{
		file: "drums/shaker.wav",
		what: "a shaker, one shake",
		pitch: null,
		loop: false
	},
	{
		file: "drums/tambourine.wav",
		what: "a tambourine, one hit",
		pitch: null,
		loop: false
	},
	{
		file: "keys/piano-c3.wav",
		what: "an acoustic piano, middle C, let ring",
		pitch: "C-3",
		loop: false
	},
	{
		file: "keys/epiano-c3.wav",
		what: "an electric piano, middle C",
		pitch: "C-3",
		loop: false
	},
	{
		file: "keys/organ-c3.wav",
		what: "an organ, middle C, held",
		pitch: "C-3",
		loop: true
	},
	{
		file: "bass/bass-electric-c2.wav",
		what: "an electric bass, C an octave under middle C",
		pitch: "C-2",
		loop: false
	},
	{
		file: "bass/bass-upright-c2.wav",
		what: "an upright bass, plucked, C under middle C",
		pitch: "C-2",
		loop: false
	},
	{
		file: "guitar/guitar-clean-c3.wav",
		what: "a clean electric guitar, middle C",
		pitch: "C-3",
		loop: false
	},
	{
		file: "guitar/guitar-muted-c3.wav",
		what: "a palm-muted guitar, middle C",
		pitch: "C-3",
		loop: false
	},
	{
		file: "strings/strings-c3.wav",
		what: "strings (or one violin / cello), middle C, held",
		pitch: "C-3",
		loop: true
	},
	{
		file: "voice/vox-ah-c3.wav",
		what: "a voice singing “ah”, middle C, held",
		pitch: "C-3",
		loop: true
	},
	{
		file: "voice/vox-oh-c3.wav",
		what: "a voice singing “oh”, middle C, held",
		pitch: "C-3",
		loop: true
	},
	{
		file: "voice/vox-hey.wav",
		what: "a short shout: “hey!”",
		pitch: null,
		loop: false
	},
	{
		file: "fx/vinyl-crackle.wav",
		what: "vinyl crackle, a texture",
		pitch: null,
		loop: true
	},
	{
		file: "fx/riser.wav",
		what: "a rising sweep, 2–4 s",
		pitch: null,
		loop: false
	},
	{
		file: "fx/impact.wav",
		what: "a big hit, with its tail",
		pitch: null,
		loop: false
	}
];
/** a sound of the pack by its name: "kick-acoustic", "drums/kick-acoustic", the file */
var findPack = (name) => {
	const n = name.toLowerCase().replace(/\.wav$/, "");
	return PACK.find((p) => p.file.replace(/\.wav$/, "") === n || p.file.split("/").pop().replace(/\.wav$/, "") === n);
};
// src/commands.ts
function registerCommands(ib, engine, st) {
	const { fmt, parseFlags } = ib.lib;
	const find = async (dir = "", depth = 0, out = []) => {
		if (depth > 5 || out.length > 500) return out;
		for (const e of await ib.vault.list(dir).catch(() => [])) if (e.isDir) {
			if (e.name.toLowerCase().endsWith(".bmed")) out.push(e.path);
			else if (!e.name.startsWith(".")) await find(e.path, depth + 1, out);
		} else if (SONG_EXTS.some((x) => e.name.toLowerCase().endsWith(x) || e.name.toLowerCase().startsWith(x.slice(1) + "."))) out.push(e.path);
		return out;
	};
	const open = async (ctx, path, given) => {
		const p = path.replace(/\/+$/, "").replace(/\/song\.json$/i, "");
		if (!given && /\.bmed$/i.test(p)) {
			const song = await readBmed(await ib.vault.read(`${p}/song.json`), (f) => ib.vault.readBytes(`${p}/${f}`));
			await adopt(ctx, song, p);
		} else await adopt(ctx, readSong(given ?? await ib.vault.readBytes(p), p), p);
		if (!given) await ib.storage.set("last", p);
	};
	/** Save the song: our own format (.bmed, a folder: everything), or .mod / .med for other trackers. */
	const save = async (ctx, path) => {
		const s = need();
		const p = path.replace(/\/+$/, "");
		let warnings = [];
		if (/\.mod$/i.test(p) || /(^|\/)mod\.[^/]+$/i.test(p)) ({warnings} = await writeOut(p, writeMod(s)));
		else if (/\.(med|mmd1)$/i.test(p)) ({warnings} = await writeOut(p, writeMed(s)));
		else {
			const dir = /\.bmed$/i.test(p) ? p : `${p}.bmed`;
			await ib.vault.mkdir(`${dir}/samples`).catch(() => {});
			for (const f of writeBmed(s)) if (typeof f.data === "string") await ib.vault.write(`${dir}/${f.path}`, f.data);
			else await ib.vault.writeBytes(`${dir}/${f.path}`, f.data);
			st.path = dir;
			st.editor.dirty = false;
			ctx.out(`${fmt.green("✓")} ${dir}/ (song.json + samples)\n`);
			return;
		}
		for (const w of warnings) ctx.out(`${fmt.dim("  ⚠ " + w)}\n`);
		ctx.out(`${fmt.green("✓")} ${p}${warnings.length ? fmt.dim(" — for other trackers; .bmed keeps everything") : ""}\n`);
	};
	const writeOut = async (path, w) => {
		const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		if (dir) await ib.vault.mkdir(dir).catch(() => {});
		await ib.vault.writeBytes(path, w.bytes);
		return w;
	};
	/** where a song is saved when you don't say: next to where it came from, as .bmed */
	const defaultPath = () => {
		if (/\.bmed$/i.test(st.path)) return st.path;
		const base = (st.path.split("/").pop() || "untitled").replace(/\.(med|mod|mmd\d|bmed)$/i, "").replace(/^(mod|med)\./i, "") || "untitled";
		return `${st.path.includes("/") ? st.path.slice(0, st.path.lastIndexOf("/")) : "songs"}/${base}.bmed`;
	};
	/** this song is the one on the page now */
	const adopt = async (ctx, song, path) => {
		st.song = song;
		st.editor = new Editor(song);
		st.editor.onChange = () => ib.ui.redraw();
		st.sel = null;
		st.col = 0;
		st.path = path;
		st.seq = st.line = st.track = 0;
		st.inst = Math.max(0, song.instruments.findIndex((i) => i.kind !== "empty"));
		st.error = "";
		await engine.load(song);
		const len = songLength(song);
		ctx.out(`${fmt.green("♫")} ${song.title || path} · ${song.format} · ${song.tracks} tracks · ${song.blocks.length} blocks · ${song.sequence.length} positions · ${song.instruments.filter((i) => i.kind !== "empty").length} instruments · ${Math.floor(len.seconds / 60)}:${String(Math.floor(len.seconds % 60)).padStart(2, "0")}\n`);
	};
	/** the pack's sounds that are in the vault (their files, under PACK_DIR) */
	const packHave = async () => {
		const out = /* @__PURE__ */ new Set();
		for (const dir of new Set(PACK.map((p) => p.file.split("/")[0]))) for (const e of await ib.vault.list(`${PACK_DIR}/${dir}`).catch(() => [])) if (!e.isDir) out.add(`${dir}/${e.name}`);
		return out;
	};
	const need = () => {
		if (!st.song) throw new Error("no song loaded (med open <file>)");
		return st.song;
	};
	ib.commands.register({
		name: "med",
		summary: "breakerMED: a tracker for .med (OctaMED) and .mod (ProTracker) songs",
		usage: [
			"med                        what's loaded, where it is",
			"med open [file]            a .med / .mod of the vault (no file: choose one)",
			"med ls                     the songs in the vault",
			"med demo                   a little song of ours, to try it right away",
			"med new [tracks] [--empty] a new song: 8 named tracks (up to 16), drums, synths and a first bar · --empty: a blank page",
			"med new --chip             a chiptune song: 2 pulses, a triangle, a noise (NES-style), chip instruments, a bar",
			"med save [file]            .bmed (ours: a folder, keeps everything — the default), .mod or .med (for other trackers)",
			"med export [file.wav|.aif|.flac] [--rate 48000] [--bits 16|24|32] [--stems | --only-stems | --tracks 1,3] [--normalize] [--tail 1.5]",
			"med export file.mp3|.m4a|.ogg|.opus [--quality …]   through the deck's encoder pack (encoders install, once)",
			"med track <n> name <text> · med track <n> vol <0–64> · med track <n> pan <-100–100> · med track <n> strum <0–200 ms>",
			"med play [song|block] [position] [line]",
			"med stop",
			"med pos <position> [line] [track]   move the cursor (and where play starts)",
			"med mute <track> · med solo <track>   (again: back)",
			"med paula on|off           stepped like the Amiga (on), or smooth",
			"med edit on|off            typing writes in the block (space on the page)",
			"med step <0–9>             lines the cursor moves after a note",
			"med octave <1–8> · med ins <01–3F>   the octave and the instrument the keys play",
			"med guide [--text]         the guide on the page (? or the ? tab) · --text: here",
			"med screen block|instrument|song|export|guide   what the page shows (the tabs, alt B I S E, ?)",
			"med copy · cut · paste · clear   the selection (or the cell under the cursor) · med transpose <±semitones>",
			"med line insert|delete [--all]   a line at the cursor, in its track (--all: every track)",
			"med sampler [file]         load a sound into a free instrument (no file: choose one)",
			"med pack · med pack load <name>   the starter sound pack (sampled by people: SOUND_DESIGN.md) — which are there, load one",
			"med note <line> <track> <C-3|^^^|---> [instrument] [command]   write a cell (hex line, track from 1)",
			"med block new [lines] · med block copy · med block lines <n>",
			"med seq new|copy|rm [position] · med seq set <position> <block> · med seq add <block>",
			"med tracks <n> · med tempo <n> · med speed <n> · med lpb <n>",
			"med chord <line> <track> <0–F>   the chord a note plays (its own column, after the instrument)",
			"med chords · med chords on|off · med chords set <1–F> <name> <semitones…> · med chords invert <1–F> [1|2|3] · med chords reset",
			"med swing <0–100>          every other line longer (0 straight, 100 triplets)",
			"med echo off | normal|cross [ms] [depth 1–6]   OctaMED's echo on the whole mix",
			"med undo · med redo",
			...SAMPLE_USAGE,
			...SYNTH_USAGE,
			...DRUMS_USAGE,
			"med effects                every command (00–2E) in one line each",
			"med info                   the song's settings"
		].join("\n"),
		examples: [
			["med export --stems", "the song as WAV (24 bits, 48 kHz), and each track on its own"],
			["med export songs/x.flac --rate 44100", "FLAC, CD quality"],
			["med export songs/x.mp3 --stems", "MP3 (V0), and each track on its own (encoders install first)"],
			["med play", "play from the cursor"],
			["med play block", "play this block again and again"],
			"med mute 2",
			"med effects"
		],
		complete: () => [
			"open",
			"ls",
			"demo",
			"new",
			"save",
			"export",
			"sample",
			"bounce",
			"synth",
			"fm",
			"drums",
			"kits",
			"kit",
			"grit",
			"presets",
			"settings",
			"preset",
			"bake",
			"show",
			"up",
			"down",
			"filter",
			"load",
			"chop",
			"onsets",
			"stretch",
			"fade",
			"pitch",
			"reverse",
			"crush",
			"normalize",
			"trim",
			"loop",
			"pingpong",
			"--rate",
			"--bits",
			"--quality",
			"--stems",
			"--only-stems",
			"--tracks",
			"--normalize",
			"track",
			"name",
			"vol",
			"pan",
			"edit",
			"step",
			"note",
			"chord",
			"chords",
			"reset",
			"echo",
			"normal",
			"cross",
			"swing",
			"strum",
			"invert",
			"--empty",
			"--chip",
			"chip",
			"table",
			"block",
			"seq",
			"tracks",
			"tempo",
			"speed",
			"lpb",
			"undo",
			"redo",
			"new",
			"copy",
			"rm",
			"set",
			"add",
			"lines",
			"play",
			"stop",
			"pos",
			"mute",
			"solo",
			"paula",
			"effects",
			"info",
			"song",
			"block",
			"on",
			"off"
		],
		async run(ctx) {
			const { rest: positional, flags } = parseFlags(ctx.args, [
				"rate",
				"bits",
				"tracks",
				"tail",
				"quality"
			]);
			if (positional[0] === "sample" || positional[0] === "smp") try {
				return await sampleCommand(ib, st, ctx, positional.slice(1), flags);
			} catch (err) {
				return ctx.err(`med: ${err instanceof Error ? err.message : err}\n`), 1;
			}
			const synth = SYNTHS.find((x) => x.cmd === positional[0]);
			if (synth || positional[0] === "drums") try {
				return await (synth ? synthCommand(ib, st, ctx, positional.slice(1), synth) : drumsCommand(ib, st, ctx, positional.slice(1)));
			} catch (err) {
				return ctx.err(`med: ${err instanceof Error ? err.message : err}\n`), 1;
			}
			if (positional[0] === "bounce") return bounce(ib, engine, st, ctx, flags);
			const [sub = "", ...rest] = positional;
			try {
				switch (sub) {
					case "": {
						if (!st.song) return ctx.out(`${fmt.dim("no song loaded")} · med open <file> · med ls\n`), 0;
						const s = st.song;
						ctx.out(`♫ ${s.title || st.path} (${st.path})\n  ${engine.playing ? fmt.green(`playing (${engine.mode})`) : "stopped"} · position ${hex(st.seq)} · block ${hex(s.sequence[st.seq] ?? 0, 3)} · line ${hex(st.line)}\n`);
						return 0;
					}
					case "ls": {
						const songs = await find();
						ctx.out(songs.length ? songs.join("\n") + "\n" : fmt.dim("no .med / .mod in the vault (drop one in it)\n"));
						return 0;
					}
					case "open": {
						let path = rest.join(" ");
						if (!path) {
							const songs = await find();
							if (!songs.length) return ctx.err("no song in the vault (.bmed, .med, .mod — drop one in it, or med new)\n"), 1;
							const i = await ib.ui.choose("OPEN A SONG", songs.map((p) => ({ label: p })));
							if (i === null) return 1;
							path = songs[i];
						}
						await open(ctx, ctx.resolve(path));
						ib.apps.open("breakermed");
						return 0;
					}
					case "filter": {
						const s = need();
						st.editor.settings("LED filter", (x) => x.flags.filter = rest[0] === "on" ? true : rest[0] === "off" ? false : !x.flags.filter);
						ctx.out(s.flags.filter ? "the A500's LED filter: on (a soft, warm top)\n" : "the A500's LED filter: off\n");
						return 0;
					}
					case "export": {
						const s = need();
						const target = rest.length ? ctx.resolve(rest.join(" ")) : defaultPath().replace(/\.bmed$/i, ".wav");
						const format = formatOf(target);
						if (!format) return ctx.err("med export: .wav .aif .flac — or .mp3 .m4a .ogg .opus (the deck's encoder pack)\n"), 1;
						const rate = format === "opus" ? 48e3 : flags.rate ? parseInt(String(flags.rate), 10) : 48e3;
						const bits = flags.bits ? parseInt(String(flags.bits), 10) : format === "flac" ? 16 : 24;
						if (![
							16,
							24,
							32
						].includes(bits)) return ctx.err("med export: --bits 16, 24 or 32\n"), 1;
						const quality = typeof flags.quality === "string" ? flags.quality.toLowerCase() : "";
						const why = checkFormat(format, bits, rate, quality);
						if (why) return ctx.err(`med export: ${why}\n`), 1;
						if (isLossy(format)) {
							const problem = await encoderProblem(ib.audio, format);
							if (problem) return ctx.err(`med export: ${problem}\n`), 1;
						}
						const base = /\.(wav|aiff?|flac|mp3|m4a|ogg|opus)$/i.test(target) ? target.replace(/\.[^.]+$/, "") : target;
						const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
						const opts = {
							rate,
							bits,
							paula: engine.paula,
							muted: engine.muted,
							normalize: !!flags.normalize,
							tail: flags.tail ? Math.max(0, Math.min(10, parseFloat(String(flags.tail)) || 0)) : 1.5
						};
						const jobs = [];
						if (!flags["only-stems"]) jobs.push({
							path: `${base}.${extOf(format)}`,
							label: "master"
						});
						if (flags.stems || flags["only-stems"] || flags.tracks) {
							const wanted = flags.tracks ? String(flags.tracks).split(",").map((x) => parseInt(x, 10) - 1).filter((t) => t >= 0 && t < s.tracks) : [...Array(s.tracks).keys()].filter((t) => trackUsed(s, t));
							for (const t of wanted) {
								const name = trackName(s, t).replace(/[\\/:*?"<>|]/g, "-");
								jobs.push({
									path: `${base} stems/${String(t + 1).padStart(2, "0")} ${name}.${extOf(format)}`,
									solo: [t],
									label: name
								});
							}
						}
						if (dir) await ib.vault.mkdir(dir).catch(() => {});
						if (jobs.some((j) => j.solo)) await ib.vault.mkdir(`${base} stems`).catch(() => {});
						for (const job of jobs) {
							let shown = 0;
							const pcm = await renderSong(s, {
								...opts,
								solo: job.solo
							}, (p) => {
								if (p - shown >= .25 && p < 1) shown = p, ctx.out(fmt.dim(`  ${job.label}: ${Math.round(p * 100)} %\n`));
							});
							const title = job.solo ? `${s.title || "untitled"} — ${job.label}` : s.title || "";
							const bytes = isLossy(format) ? await encodeLossy(ib.audio, pcm, format, quality, title) : encode(pcm, format, bits);
							await ib.vault.writeBytes(job.path, bytes);
							ctx.out(`${fmt.green("✓")} ${job.path} ${fmt.dim(`(${(bytes.length / 1048576).toFixed(1)} MB)`)}\n`);
						}
						ctx.out(fmt.dim(`  ${describe(format, bits, rate, quality)}${opts.normalize ? " · normalized" : ""}\n`));
						return 0;
					}
					case "save": {
						need();
						const path = rest.length ? ctx.resolve(rest.join(" ")) : defaultPath();
						await save(ctx, path);
						return 0;
					}
					case "new": {
						const n = rest[0] ? parseInt(rest[0], 10) : 8;
						if (!(n >= 1 && n <= 16)) return ctx.err(`med new [tracks 1–16]\n`), 1;
						const song = flags.chip ? chipSong() : flags.empty ? newSong(n) : templateSong(n);
						if (flags.empty) song.instruments = readSong(demoMod()).instruments, song.title = "untitled";
						await adopt(ctx, song, "untitled.bmed");
						ib.apps.open("breakermed");
						return 0;
					}
					case "track": {
						const s = need();
						const tr = parseInt(rest[0] ?? "", 10) - 1;
						const [, what, ...value] = rest;
						if (!(tr >= 0 && tr < s.tracks) || !what) return ctx.err(`med track <1–${s.tracks}> name <text> | vol <0–64> | pan <-100–100> | strum <0–200 ms>\n`), 1;
						const v = value.join(" ");
						if (what === "name") st.editor.setTrack(tr, { name: v });
						else if (what === "vol" && /^\d+$/.test(v)) st.editor.setTrack(tr, { volume: +v });
						else if (what === "pan" && /^-?\d+$/.test(v)) st.editor.setTrack(tr, { pan: Math.max(-100, Math.min(100, +v)) / 100 });
						else if (what === "strum" && /^\d+$/.test(v) && +v <= 200) {
							st.editor.setTrack(tr, { strum: +v });
							ctx.out(+v ? `${trackName(s, tr)}: its chords strummed, ${v} ms a note\n` : `${trackName(s, tr)}: its chords all at once\n`);
						} else return ctx.err(`med track <n> name <text> | vol <0–64> | pan <-100–100> | strum <0–200 ms>\n`), 1;
						return 0;
					}
					case "demo":
						await open(ctx, "demo.mod", demoMod());
						ib.apps.open("breakermed");
						return 0;
					case "play": {
						const s = need();
						const mode = rest[0] === "block" ? "block" : "song";
						const nums = rest.filter((x) => /^[0-9a-f]+$/i.test(x) && x !== "block");
						const seq = nums[0] !== void 0 ? parseInt(nums[0], 16) : st.seq;
						const line = nums[1] !== void 0 ? parseInt(nums[1], 16) : nums[0] !== void 0 ? 0 : st.line;
						if (seq >= s.sequence.length) return ctx.err(`med: position ${hex(seq)} isn't in the sequence (0–${hex(s.sequence.length - 1)})\n`), 1;
						st.seq = seq;
						st.line = line;
						await engine.play(mode, {
							seq,
							line
						});
						return 0;
					}
					case "stop":
						engine.stop();
						return 0;
					case "pos": {
						const s = need();
						const seq = parseInt(rest[0] ?? "0", 16);
						if (!(seq >= 0 && seq < s.sequence.length)) return ctx.err(`med: position 0–${hex(s.sequence.length - 1)}\n`), 1;
						st.seq = seq;
						st.line = rest[1] ? parseInt(rest[1], 16) || 0 : 0;
						if (rest[2]) st.track = Math.max(0, Math.min(s.tracks - 1, (parseInt(rest[2], 10) || 1) - 1));
						if (engine.playing) await engine.play(engine.mode ?? "song", {
							seq: st.seq,
							line: st.line
						});
						return 0;
					}
					case "mute":
					case "solo": {
						const s = need();
						const tr = parseInt(rest[0] ?? "", 10) - 1;
						if (!(tr >= 0 && tr < s.tracks)) return ctx.err(`med: a track is 1–${s.tracks}\n`), 1;
						const before = new Set(engine.muted);
						const after = new Set(engine.muted);
						if (sub === "mute") after.has(tr) ? after.delete(tr) : after.add(tr);
						else {
							const alone = after.size === s.tracks - 1 && !after.has(tr);
							after.clear();
							if (!alone) {
								for (let i = 0; i < s.tracks; i++) if (i !== tr) after.add(i);
							}
						}
						const put = (m) => () => (engine.muted.clear(), m.forEach((x) => engine.muted.add(x)));
						st.editor.act(sub, put(after), put(before), { view: true });
						ctx.out(engine.muted.size ? `muted: ${[...engine.muted].map((x) => x + 1).sort((a, b) => a - b).join(" ")}\n` : "every track plays\n");
						return 0;
					}
					case "paula":
						engine.paula = rest[0] === "on" ? true : rest[0] === "off" ? false : !engine.paula;
						await ib.storage.set("paula", engine.paula);
						ctx.out(engine.paula ? "PAULA: stepped, gritty, like the Amiga\n" : "SMOOTH: interpolated\n");
						return 0;
					case "edit":
						need();
						st.edit = rest[0] === "on" ? true : rest[0] === "off" ? false : !st.edit;
						if (st.edit) engine.stop();
						ctx.out(st.edit ? "edit mode: typing writes in the block\n" : "edit mode off: the keys only play\n");
						return 0;
					case "echo": {
						const s = need();
						const [type, msS, depthS] = rest;
						if (type === "off") st.editor.settings("echo", (x) => delete x.echo);
						else if (type === "normal" || type === "cross") {
							const e = cleanEcho({
								type,
								ms: msS ? parseInt(msS, 10) : s.echo?.ms ?? 250,
								depth: depthS ? parseInt(depthS, 10) : s.echo?.depth ?? 2
							});
							if (!e || msS && !(parseInt(msS, 10) > 0) || depthS && !(parseInt(depthS, 10) >= 1 && parseInt(depthS, 10) <= 6)) return ctx.err(`med echo off | normal|cross [ms 1–${ECHO_MAX_MS}] [depth 1–6: 1 long, 6 short]\n`), 1;
							st.editor.settings("echo", (x) => x.echo = e);
						} else if (type !== void 0) return ctx.err(`med echo off | normal|cross [ms 1–${ECHO_MAX_MS}] [depth 1–6: 1 long, 6 short]\n`), 1;
						const e = s.echo;
						ctx.out(e ? `echo: ${e.type} · ${e.ms} ms · depth ${e.depth} (each repeat at 1/${2 ** e.depth})\n` : "echo: off\n");
						return 0;
					}
					case "chord": {
						const s = need();
						const [lineS, trackS, chordS] = rest;
						const line = parseInt(lineS ?? "", 16), track = parseInt(trackS ?? "", 10) - 1;
						const n = parseInt(chordS ?? "", 16);
						const b = s.blocks[s.sequence[st.seq]];
						if (!b || !(line >= 0 && line < b.lines) || !(track >= 0 && track < s.tracks) || !(n >= 0 && n <= 15) || !/^[0-9a-f]$/i.test(chordS ?? "")) return ctx.err("med chord <line (hex)> <track 1–n> <0–F> (0: none · med chords: the table)\n"), 1;
						st.editor.writeHex(s.sequence[st.seq], line, track, 3, n);
						if (n) s.chordColumn = true;
						const def = chordsOf(s)[n - 1];
						ctx.out(`${fmt.green("✓")} ${hex(line)} · ${trackName(s, track)}: ${n ? `chord ${n.toString(16).toUpperCase()} ${def?.name ?? ""}` : "no chord"}\n`);
						return 0;
					}
					case "chords": {
						const s = need();
						const [op, ...args] = rest;
						if (op === "on" || op === "off") {
							st.editor.settings("chord column", (x) => x.chordColumn = op === "on");
							ctx.out(`the chord column: ${op}\n`);
							return 0;
						}
						if (op === "set") {
							const n = parseInt(args[0] ?? "", 16);
							const name = args[1] ?? "";
							const notes = args.slice(2).map((x) => parseInt(x, 10));
							if (!(n >= 1 && n <= 15) || !name || !notes.length || notes.some((x) => !(x >= -24 && x <= 24) || x === 0) || notes.length > 5) return ctx.err(`med chords set <1–F> <name> <semitones over the note, 1 to 5 of them, -24…24> (e.g. med chords set 1 maj 4 7)\n`), 1;
							st.editor.chords(n, {
								name: name.slice(0, 8),
								notes
							});
							ctx.out(`${fmt.green("✓")} chord ${n.toString(16).toUpperCase()}: ${name} (+${notes.join(" +")})\n`);
							return 0;
						}
						if (op === "invert") {
							const n = parseInt(args[0] ?? "", 16), k = parseInt(args[1] ?? "1", 10);
							const d = chordsOf(s)[n - 1];
							if (!d || !(k >= 1 && k <= 3)) return ctx.err("med chords invert <1–F> [1|2|3] (once: the third in the bass, twice: the fifth…)\n"), 1;
							const notes = invertChord(d.notes, k);
							if (!notes.length || notes.some((x) => x < -24 || x > 24)) return ctx.err("med chords invert: that chord can't turn over\n"), 1;
							const name = `${d.name.replace(/\/\d$/, "")}/${k}`.slice(0, 8);
							st.editor.chords(n, {
								name,
								notes
							});
							ctx.out(`${fmt.green("✓")} chord ${n.toString(16).toUpperCase()}: ${name} (${notes.map((x) => x > 0 ? `+${x}` : x).join(" ")})\n`);
							return 0;
						}
						if (op === "reset") {
							st.editor.chords(0, null);
							ctx.out("the chord table: back to the default\n");
							return 0;
						}
						ctx.out(chordsOf(s).map((d, i) => `  ${(i + 1).toString(16).toUpperCase()}  ${d.name.padEnd(6)} ${d.notes.map((x) => x > 0 ? `+${x}` : x).join(" ")}`).join("\n") + `\n${fmt.dim(`the chord column: ${s.chordColumn ? "on" : "off"} (med chords on|off)`)}\n`);
						return 0;
					}
					case "octave": {
						const n = parseInt(rest[0] ?? "", 10);
						if (!(n >= 1 && n <= 8)) return ctx.err("med octave 1–8 (the piano's bottom row)\n"), 1;
						st.octave = n - 1;
						return 0;
					}
					case "ins": {
						const s = need();
						const n = parseInt(rest[0] ?? "", 16);
						if (!(n >= 1 && n <= Math.min(63, s.instruments.length + 1))) return ctx.err(`med ins 01–${hex(Math.min(63, s.instruments.length + 1))} (the instrument the keys play)\n`), 1;
						st.inst = n - 1;
						return 0;
					}
					case "guide":
						if (flags.text) return ctx.out(GUIDE.map((p) => `${p.title}\n${p.rows.map(([a, b]) => `  ${fmt.cyan(a.padEnd(22))} ${b}`).join("\n")}`).join("\n\n") + "\n"), 0;
						if (st.screen !== "guide") st.back = st.screen;
						st.screen = "guide";
						ib.apps.open("breakermed");
						ctx.out("the guide is on the page: ↑↓ to read, ? to go back · med guide --text: here\n");
						return 0;
					case "screen": {
						const id = rest[0];
						if (!SCREENS.some((x) => x.id === id)) return ctx.err(`med screen ${SCREENS.map((x) => x.id).join("|")}\n`), 1;
						if (id === "guide" && st.screen !== "guide") st.back = st.screen;
						st.screen = id;
						ib.apps.open("breakermed");
						return 0;
					}
					case "copy":
					case "cut":
					case "paste":
					case "clear":
					case "transpose": {
						const s = need();
						const e = st.editor;
						const block = s.sequence[st.seq];
						const sel = st.sel && st.sel.block === block ? st.sel : {
							block,
							line0: st.line,
							line1: st.line,
							track0: st.track,
							track1: st.track
						};
						if (sub === "copy") st.clip = e.copy(sel);
						else if (sub === "cut") st.clip = e.cut(sel), st.sel = null;
						else if (sub === "clear") e.clearSelection(sel);
						else if (sub === "paste") {
							if (!st.clip) return ctx.err("med paste: nothing copied (med copy)\n"), 1;
							e.paste(block, st.line, st.track, st.clip);
						} else {
							const n = parseInt(rest[0] ?? "", 10);
							if (!(n >= -48 && n <= 48 && n !== 0)) return ctx.err("med transpose <±1–48 semitones> (12: an octave)\n"), 1;
							e.transpose(sel, n);
						}
						return 0;
					}
					case "line": {
						const s = need();
						const tracks = flags.all ? [...Array(s.tracks).keys()] : [st.track];
						if (rest[0] === "insert") st.editor.insertLine(s.sequence[st.seq], st.line, tracks);
						else if (rest[0] === "delete") st.editor.deleteLine(s.sequence[st.seq], st.line, tracks);
						else return ctx.err("med line insert|delete [--all]\n"), 1;
						return 0;
					}
					case "pack": {
						if (rest[0] === "load") {
							const p = findPack(rest[1] ?? "");
							if (!p) return ctx.err(`med pack load <name>: ${PACK.map((x) => x.file.split("/").pop().replace(/\.wav$/, "")).join(" · ")}\n`), 1;
							if (!(await packHave()).has(p.file)) return ctx.err(`${p.file}: a placeholder — nobody has recorded it yet (SOUND_DESIGN.md)\n`), 1;
							return ib.shell.run(`med sampler ${PACK_DIR}/${p.file}`);
						}
						let have = 0;
						const found = await packHave();
						for (const p of PACK) {
							const there = found.has(p.file);
							if (there) have++;
							ctx.out(`${there ? fmt.green("✓") : fmt.dim("·")} ${p.file.padEnd(28)} ${fmt.dim(`${p.what}${p.pitch ? ` · ${p.pitch}` : ""}${p.loop ? " · loops" : ""}`)}\n`);
						}
						ctx.out(`${have}/${PACK.length} in ${PACK_DIR}/ · the others are placeholders: sounds made by people, see the module's SOUND_DESIGN.md\n`);
						return 0;
					}
					case "sampler": {
						if (!st.song) await adopt(ctx, templateSong(), "untitled.bmed");
						const s = need();
						let n = s.instruments.findIndex((x) => x.kind === "empty");
						if (n < 0) n = s.instruments.length;
						if (n >= 63) return ctx.err("med sampler: the 63 instruments are taken\n"), 1;
						st.inst = n;
						st.screen = "instrument";
						ib.apps.open("breakermed");
						return sampleCommand(ib, st, ctx, [
							hex(n + 1),
							"load",
							...rest
						], flags);
					}
					case "step": {
						const n = parseInt(rest[0] ?? "", 10);
						if (!(n >= 0 && n <= 16)) return ctx.err("med step 0–16\n"), 1;
						st.step = n;
						return 0;
					}
					case "note": {
						const s = need();
						const [lineS, trackS, noteS, instS, cmdS] = rest;
						const line = parseInt(lineS ?? "", 16), track = parseInt(trackS ?? "", 10) - 1;
						const note = noteS ? parseNote(noteS) : null;
						const b = s.blocks[s.sequence[st.seq]];
						if (!b || !(line >= 0 && line < b.lines) || !(track >= 0 && track < s.tracks) || note === null) return ctx.err("med note <line (hex)> <track 1–n> <C-3|^^^|---> [instrument hex] [command 0C20]\n"), 1;
						if (cmdS && !/^[0-9a-f]{4}$/i.test(cmdS)) return ctx.err(`med note: "${cmdS}" isn't a command (4 hex digits, like 0C20)\n`), 1;
						const e = st.editor;
						const bn = s.sequence[st.seq];
						if (note) e.writeNote(bn, line, track, note, instS ? parseInt(instS, 16) || 0 : 0);
						else e.clear(bn, line, track, 0);
						if (cmdS) [...cmdS].forEach((d, i) => e.writeHex(bn, line, track, 4 + i, parseInt(d, 16)));
						const c = s.blocks[bn].cells[line][track];
						ctx.out(`${fmt.green("✓")} ${hex(line)} · ${trackName(s, track)}: ${c.note ? noteName(c.note) : "---"} ${c.inst ? hex(c.inst) : ".."}${cmdS ? ` ${cmdS.toUpperCase()}` : ""}\n`);
						return 0;
					}
					case "block": {
						const s = need();
						const e = st.editor;
						const what = rest[0];
						if (what === "new") {
							const n = e.newBlock(rest[1] ? parseInt(rest[1], 10) || 64 : s.blocks[s.sequence[st.seq]]?.lines ?? 64);
							ctx.out(`block ${hex(n, 3)}\n`);
						} else if (what === "copy") ctx.out(`block ${hex(e.cloneBlock(s.sequence[st.seq]), 3)}\n`);
						else if (what === "lines") {
							const n = parseInt(rest[1] ?? "", 10);
							if (!(n >= 1 && n <= 3200)) return ctx.err("med block lines 1–3200\n"), 1;
							e.setLines(s.sequence[st.seq], n);
						} else return ctx.err("med block new [lines] | copy | lines <n>\n"), 1;
						return 0;
					}
					case "seq": {
						const s = need();
						const e = st.editor;
						const [what, a, b] = rest;
						const pos = a !== void 0 ? parseInt(a, 16) : st.seq;
						if (what === "new") {
							const n = e.newBlock(s.blocks[s.sequence[st.seq]]?.lines ?? 64);
							e.seqInsert(pos + 1, n);
							st.seq = Math.min(s.sequence.length - 1, pos + 1);
						} else if (what === "copy") {
							const n = e.cloneBlock(s.sequence[pos] ?? 0);
							e.seqInsert(pos + 1, n);
							st.seq = Math.min(s.sequence.length - 1, pos + 1);
						} else if (what === "rm") e.seqDelete(pos);
						else if (what === "set") e.seqSet(pos, parseInt(b ?? "", 16));
						else if (what === "add") e.seqInsert(s.sequence.length, parseInt(a ?? "", 16));
						else return ctx.err("med seq new|copy|rm [position] · set <position> <block> · add <block>\n"), 1;
						st.seq = Math.max(0, Math.min(s.sequence.length - 1, st.seq));
						st.line = 0;
						return 0;
					}
					case "tracks": {
						need();
						const n = parseInt(rest[0] ?? "", 10);
						const most = Math.max(16, need().tracks);
						if (!(n >= 1 && n <= most)) return ctx.err(`med tracks 1–${most}\n`), 1;
						engine.stop();
						st.editor.setTracks(n);
						return 0;
					}
					case "tempo":
					case "speed":
					case "lpb": {
						need();
						const n = parseInt(rest[0] ?? "", 10);
						const [lo, hi] = sub === "tempo" ? [1, 255] : sub === "speed" ? [1, 32] : [1, 32];
						if (!(n >= lo && n <= hi)) return ctx.err(`med ${sub} ${lo}–${hi}\n`), 1;
						st.editor.settings(sub, (x) => sub === "tempo" ? x.tempo = n : sub === "speed" ? x.speed = n : x.lpb = n);
						return 0;
					}
					case "swing": {
						const s = need();
						const n = rest[0] === "off" ? 0 : parseInt(rest[0] ?? "", 10);
						if (rest[0] === void 0) return ctx.out(`swing: ${s.swing ?? 0} · med swing <0–100> (0 straight, 50 a lazy shuffle, 100 triplets)\n`), 0;
						if (!(n >= 0 && n <= 100)) return ctx.err("med swing <0–100> | off (0 straight, 50 a lazy shuffle, 100 triplets)\n"), 1;
						st.editor.settings("swing", (x) => n ? x.swing = n : delete x.swing);
						ctx.out(n ? `swing ${n}: every other line ${Math.round(swingFactor(n, 0) / swingFactor(n, 1) * 100) / 100}× the next\n` : "swing off: straight\n");
						return 0;
					}
					case "undo":
					case "redo": {
						need();
						const label = undoRedo(st, sub === "redo");
						ctx.out(label ? `${sub === "undo" ? "undone" : "redone"}: ${label}\n` : `nothing to ${sub}\n`);
						return 0;
					}
					case "effects":
						for (const [k, v] of EFFECTS) ctx.out(`${fmt.cyan(k.padEnd(13))} ${v}\n`);
						return 0;
					case "info": {
						const s = need();
						const len = songLength(s);
						ctx.out([
							`title       ${s.title || "—"}`,
							`file        ${st.path} (${s.format})`,
							`tracks      ${s.tracks} · blocks ${s.blocks.length} · positions ${s.sequence.length}`,
							`tempo       ${s.tempoMode.toUpperCase()} ${s.tempo} · speed ${s.speed} · lines a beat ${s.lpb}`,
							`transpose   ${s.transpose} · master volume ${s.masterVolume}`,
							`slides      ${s.flags.ptSlides ? "ProTracker" : "OctaMED"} · volumes ${s.flags.volHex ? "hex" : "decimal"} · ${s.flags.hardwareMix ? "Amiga voices" : "mixing"}`,
							`echo        ${s.echo ? `${s.echo.type} · ${s.echo.ms} ms · depth ${s.echo.depth}` : "off"} · LED filter ${s.flags.filter ? "on" : "off"}${s.chordColumn ? " · chords" : ""}${s.swing ? ` · swing ${s.swing}` : ""}`,
							`length      ${Math.floor(len.seconds / 60)}:${String(Math.floor(len.seconds % 60)).padStart(2, "0")} (${len.lines} lines)`,
							`instruments`,
							...s.instruments.map((i, n) => i.kind === "empty" ? "" : `  ${hex(n + 1)} ${i.name.padEnd(22)} ${i.kind.padEnd(6)} ${i.kind === "analog" || i.kind === "fm" ? "  synth" : i.kind === "drums" ? "   kit" : `${String(i.data.length).padStart(7)} frames`} · vol ${i.volume}${i.loopLength ? ` · loop ${i.loopStart}+${i.loopLength}` : ""}${i.transpose ? ` · ${i.transpose > 0 ? "+" : ""}${i.transpose}` : ""}`).filter(Boolean)
						].join("\n") + "\n");
						return 0;
					}
					case "note":
						ctx.out(noteName(parseInt(rest[0] ?? "0", 10)) + "\n");
						return 0;
					default: return ctx.err(`med: unknown "${sub}" (med -h)\n`), 1;
				}
			} catch (e) {
				st.error = e instanceof Error ? e.message : String(e);
				ctx.err(`med: ${st.error}\n`);
				return 1;
			}
		}
	});
}
// src/engine.ts
/**
* breakerMED — the engine: it computes the sound here, in the module (the
* renderer: render.ts), and hands it to the deck through ib.audio.stream. The
* deck asks for more whenever it runs low (~16 ms left): about 30 ms from a key
* to the sound, and a song that never stutters. It also knows which line is
* being heard (what was written minus what still waits), for the page to follow.
*/
var Engine = class {
	constructor(audio) {
		_defineProperty(this, "audio", void 0);
		_defineProperty(this, "song", null);
		_defineProperty(this, "mode", null);
		_defineProperty(
			this,
			/** stepped like the Amiga's Paula (true) or smooth */
			"paula",
			true
		);
		_defineProperty(this, "muted", /* @__PURE__ */ new Set());
		_defineProperty(this, "onChange", void 0);
		_defineProperty(this, "line", null);
		_defineProperty(this, "opening", null);
		_defineProperty(this, "r", null);
		_defineProperty(
			this,
			/** at the last request: frames written then, frames still waiting, when (ms) */
			"clock",
			{
				written: 0,
				waiting: 0,
				at: 0
			}
		);
		this.audio = audio;
	}
	/** A new song (nothing to upload: the module plays its instruments itself). */
	async load(song) {
		this.stop();
		this.song = song;
		this.r = null;
	}
	get playing() {
		return this.mode !== null;
	}
	/** Play the song (or one block, again and again) from a position. */
	async play(mode, from) {
		if (!this.song) throw new Error("no song loaded (med open <file>)");
		if (!this.audio.available()) throw new Error("no sound output here");
		const r = await this.renderer();
		r.paula = this.paula;
		r.play(from.seq, from.line, {
			loopBlock: mode === "block",
			muted: this.muted
		});
		this.mode = mode;
		this.push(this.line.high);
		this.onChange?.();
	}
	stop() {
		const was = this.mode;
		this.mode = null;
		this.r?.stop();
		if (was) {
			this.audio.stop().catch(() => {});
			this.onChange?.();
		}
	}
	/** The deck silenced us (`audio stop`, the ♪): the song stops and nothing rings on. */
	silence() {
		this.stop();
		this.r?.silence();
	}
	/** The line being heard now (null when stopped). */
	current() {
		const r = this.r;
		if (!this.mode || !r || !r.marks.length || !this.line) return null;
		const heard = Math.min(r.frame, this.clock.written - this.clock.waiting + (performance.now() - this.clock.at) / 1e3 * this.line.rate);
		let pos = r.marks[0];
		for (const m of r.marks) {
			if (m.frame > heard) break;
			pos = m;
		}
		return {
			seq: pos.seq,
			block: pos.block,
			line: pos.line
		};
	}
	/** A key played on the piano: instrument `inst` at `rate`, heard ~30 ms later. */
	async preview(inst, rate) {
		if (!this.song) return;
		const r = await this.renderer();
		r.paula = this.paula;
		r.preview(inst, rate);
		if (!this.mode) this.push(this.line.high);
	}
	/** the renderer for this song at the line's rate (the line opens the first time) */
	async renderer() {
		const line = await this.open();
		if (!this.r || this.r.song !== this.song || this.r.rate !== line.rate) this.r = new Renderer(this.song, line.rate, this.paula);
		return this.r;
	}
	open() {
		if (this.line) return Promise.resolve(this.line);
		this.opening ??= this.audio.stream().then((s) => {
			s.onPull = (frames, _played, waiting) => this.pull(frames, waiting);
			this.line = s;
			return s;
		}, (e) => {
			this.opening = null;
			throw e;
		});
		return this.opening;
	}
	/** the deck wants more: what it asks for, while there's something to hear */
	pull(frames, waiting) {
		const r = this.r;
		if (!r) return;
		this.clock = {
			written: r.frame,
			waiting,
			at: performance.now()
		};
		if (!r.busy) {
			if (this.mode && r.ended) {
				this.mode = null;
				this.onChange?.();
			}
			return;
		}
		this.push(frames);
	}
	push(frames) {
		const r = this.r, line = this.line;
		if (!r || !line || frames <= 0) return;
		const n = Math.min(16384, Math.ceil(frames));
		const left = new Float32Array(n), right = new Float32Array(n);
		r.render(left, right, n);
		line.write(left, right);
	}
};
// src/main.ts
var engine = null;
function activate(ib) {
	if (!ib.audio || typeof ib.audio.schedule !== "function") throw new Error("breakerMED needs a newer ICEBREAKER (one with ib.audio, the modules' sound): update the deck");
	ib.lib.addTranslations("fr", FR);
	engine = new Engine(ib.audio);
	const st = newState();
	engine.onChange = () => ib.ui.redraw();
	ib.audio.onStop?.(() => engine?.silence());
	ib.storage.get("paula", true).then((v) => engine && (engine.paula = v !== false));
	registerCommands(ib, engine, st);
	ib.apps.register({
		kind: "breakermed",
		title: "BreakerMED (beta)",
		description: "a tracker: .med and .mod songs, played and edited",
		icon: "♫",
		launcher: true,
		rawKeys: true,
		create: () => makeApp(ib, engine, st)
	});
	ib.palette.register({
		id: "breakermed.open",
		title: "breakerMED: open a song…",
		run: () => void ib.shell.run("med open")
	});
	ib.palette.register({
		id: "breakermed.stop",
		title: "breakerMED: stop",
		run: () => void ib.shell.run("med stop")
	});
	ib.palette.register({
		id: "breakermed.new",
		title: "breakerMED: a new song",
		run: () => void ib.shell.run("med new")
	});
	ib.palette.register({
		id: "breakermed.demo",
		title: "breakerMED: the demo song",
		run: () => void ib.shell.run("med demo")
	});
	ib.palette.register({
		id: "breakermed.save",
		title: "breakerMED: save the song",
		run: () => void ib.shell.run("med save")
	});
	ib.palette.register({
		id: "breakermed.export",
		title: "breakerMED: export (WAV, 24 bits) and the tracks apart",
		run: () => void ib.shell.run("med export --stems")
	});
}
function deactivate() {
	engine?.stop();
	engine = null;
}
var FR = {
	"the starter sounds, recorded by people: which are there (med pack load <name>)": "les sons de départ, enregistrés par des gens : lesquels sont là (med pack load <nom>)",
	"START": "COMMENCER",
	"new song": "nouveau morceau",
	"open…": "ouvrir…",
	"demo": "démo",
	"guide": "guide",
	"chiptune song": "morceau chiptune",
	"sampler": "sampleur",
	"8 tracks, drums and synths, a beat ready: ⏎ plays it, space to write": "8 pistes, batterie et synthés, un rythme prêt : ⏎ le joue, espace pour écrire",
	"a .med, .mod or .bmed of the vault": "un .med, .mod ou .bmed du vault",
	"listen to the demo song": "écouter le morceau de démo",
	"the keys, the edit mode, the effects in hex, the sampler": "les touches, le mode édition, les effets en hexa, le sampleur",
	"2 pulses, a triangle, a noise: an old console's sound": "2 pulses, un triangle, un bruit : le son d'une vieille console",
	"your own sounds: load one into an instrument": "tes propres sons : en charger un dans un instrument",
	"N O D ? C S, or the arrows and ⏎": "N O D ? C S, ou les flèches et ⏎",
	"tracker: notes, samples, synths, chiptune": "tracker : notes, samples, synthés, chiptune",
	"space: edit mode": "espace : mode édition",
	"space: stop editing": "espace : arrêter d'éditer",
	"space: stop": "espace : stop",
	"GUIDE": "GUIDE",
	"? GUIDE": "? GUIDE",
	"? or esc: back": "? ou échap : retour",
	"edit mode on": "mode édition",
	"edit mode off": "quitter le mode édition",
	"sampler: load a sound…": "sampleur : charger un son…",
	"the guide": "le guide",
	"open it (INSTRUMENT)": "l'ouvrir (INSTRUMENT)",
	"play it": "le jouer",
	"a chiptune song": "un morceau chiptune",
	"sampler · load a sound…": "sampleur · charger un son…",
	"your own sound: a .wav, .aif, .iff, .mp3, .m4a, .ogg… of the vault (chop, stretch, loop it after)": "ton propre son : un .wav, .aif, .iff, .mp3, .m4a, .ogg… du vault (à découper, étirer, boucler ensuite)",
	"EDIT MODE (space: the line turns red, ● EDIT at the top)": "MODE ÉDITION (espace : la ligne devient rouge, ● EDIT en haut)",
	"A CELL: C-3 01 . 0C20": "UNE CASE : C-3 01 . 0C20",
	"EFFECTS (the last 4 hex digits of a cell: command, value)": "EFFETS (les 4 derniers chiffres hexa d'une case : commande, valeur)",
	"THE SAMPLER (your own sounds)": "LE SAMPLEUR (tes propres sons)",
	"SCREENS (the tabs, or alt B I S E, ? for this guide)": "ÉCRANS (les onglets, ou alt B I S E, ? pour ce guide)",
	"a new song: 8 tracks, drums and synths, a beat ready to play": "un nouveau morceau : 8 pistes, batterie et synthés, un rythme prêt à jouer",
	"a chiptune song: 2 pulses, a triangle, a noise (NES-style)": "un morceau chiptune : 2 pulses, un triangle, un bruit (façon NES)",
	"open a .med, .mod or .bmed of the vault": "ouvrir un .med, .mod ou .bmed du vault",
	"save (a new song becomes a .bmed in songs/)": "enregistrer (un nouveau morceau devient un .bmed dans songs/)",
	"play the song from the cursor · ⇧enter: this block, again and again": "jouer le morceau depuis le curseur · ⇧entrée : ce bloc, en boucle",
	"stop · when stopped: EDIT MODE on / off": "stop · à l'arrêt : MODE ÉDITION oui / non",
	"a piano: Z S X D C V… (bottom row) and Q 2 W 3 E R… (top row), by place": "un piano : Z S X D C V… (rangée du bas) et Q 2 W 3 E R… (du haut), par position (W X C… en AZERTY)",
	"note off (^^^): the note stops, a synth releases": "note off (^^^) : la note s'arrête, un synthé relâche",
	"the hex columns: the instrument (2 digits), the chord, the command (4)": "les colonnes hexa : l'instrument (2 chiffres), l'accord, la commande (4)",
	"clear the column · delete the line (⇧: in every track)": "vider la colonne · supprimer la ligne (⇧ : dans toutes les pistes)",
	"insert a line (⇧: in every track)": "insérer une ligne (⇧ : dans toutes les pistes)",
	"the octave · the instrument the keys play": "l'octave · l'instrument que jouent les touches",
	"the step: lines the cursor moves after a note": "le pas : les lignes que descend le curseur après une note",
	"select · alt C / X / V copy cut paste · alt Q / A transpose": "sélectionner · alt C / X / V copier couper coller · alt Q / A transposer",
	"undo · redo (notes, instruments, settings, mutes)": "annuler · rétablir (notes, instruments, réglages, mutes)",
	"the note (C-1 … B-7) · ^^^ a note off": "la note (C-1 … B-7) · ^^^ un note off",
	"the instrument (01–3F, the list on the left)": "l'instrument (01–3F, la liste à gauche)",
	"the chord (1–F of the song's table: med chords), when the song has chords": "l'accord (1–F de la table du morceau : med chords), quand le morceau a des accords",
	"an effect: the command (0C) and its value (20) — the list below": "un effet : la commande (0C) et sa valeur (20) — la liste en dessous",
	"load a sound into a free instrument (a list of the vault's sounds)": "charger un son dans un instrument libre (la liste des sons du vault)",
	"on a free slot: “sampler · load a sound…”; on a sound: chop, stretch, fade, loop…": "sur une case libre : « sampleur · charger un son… » ; sur un son : découper, étirer, fondu, boucle…",
	"a .wav .aif .iff .mp3 .m4a .ogg… of the vault into instrument n": "un .wav .aif .iff .mp3 .m4a .ogg… du vault dans l'instrument n",
	"8 slices, each a new instrument · chop onsets: a slice an attack": "8 tranches, chacune un nouvel instrument · chop onsets : une tranche par attaque",
	"the notes, track by track": "les notes, piste par piste",
	"the instrument the keys play: a sound's tools, a synth's settings, a drum kit": "l'instrument que jouent les touches : les outils d'un son, les réglages d'un synthé, un kit",
	"tempo, swing, echo, tracks: name, volume, pan, strum, mute, solo": "tempo, swing, écho, pistes : nom, volume, pan, strum, mute, solo",
	"WAV, AIFF, FLAC, MP3, M4A, OGG, Opus, with each track apart": "WAV, AIFF, FLAC, MP3, M4A, OGG, Opus, avec chaque piste à part",
	"a menu on a cell, a track's name, a position, an instrument": "un menu sur une case, un nom de piste, une position, un instrument",
	"every command (all the mouse does, the shell does too)": "toutes les commandes (tout ce que fait la souris, le shell le fait aussi)",
	"enter play": "entrée joue",
	block: "bloc",
	"space stop": "espace stop",
	"keys: a piano": "touches : un piano",
	octave: "octave",
	instrument: "instrument",
	"med open <file.med|.mod> — or drop one in the vault": "med open <fichier.med|.mod> — ou dépose-en un dans le vault",
	speed: "vitesse",
	"no song loaded": "aucun morceau chargé",
	SEQUENCE: "SÉQUENCE",
	INSTRUMENTS: "INSTRUMENTS",
	"(no name)": "(sans nom)",
	BLOCK: "BLOC",
	BLK: "BLOC",
	"echo delay": "délai de l'écho",
	"echo depth": "profondeur de l'écho",
	"chord column": "colonne d'accords",
	line: "ligne",
	track: "piste",
	"mute / unmute this track": "couper / rétablir cette piste",
	"med open <file.med|.mod> — or med demo": "med open <fichier.med|.mod> — ou med demo",
	"play from here": "jouer d'ici",
	"insert a new block here": "insérer un nouveau bloc ici",
	"insert a copy of this block": "insérer une copie de ce bloc",
	"remove this position": "retirer cette position",
	copied: "copié",
	copy: "copier",
	cut: "couper",
	paste: "coller",
	clear: "effacer",
	"transpose up": "transposer vers le haut",
	"transpose down": "transposer vers le bas",
	"an octave up": "une octave plus haut",
	"an octave down": "une octave plus bas",
	"insert a line": "insérer une ligne",
	"delete the line": "supprimer la ligne",
	EDIT: "ÉDITION",
	space: "espace",
	stop: "stop",
	edit: "éditer",
	step: "pas",
	leave: "sortir",
	ins: "ins",
	play: "jouer",
	oct: "oct",
	"nothing to undo": "rien à annuler",
	undone: "annulé",
	redone: "rétabli",
	note: "note",
	digit: "chiffre",
	"insert line": "insertion de ligne",
	"delete line": "suppression de ligne",
	transpose: "transposition",
	"new block": "nouveau bloc",
	"copy block": "copie de bloc",
	"block length": "longueur du bloc",
	tracks: "pistes",
	sequence: "séquence",
	"open a song…": "ouvrir un morceau…",
	"the demo song": "le morceau de démo",
	"double-click: rename · right-click: mute, solo": "double-clic : renommer · clic droit : couper, solo",
	"rename…": "renommer…",
	unmute: "rétablir",
	mute: "couper",
	solo: "solo",
	"TRACK NAME": "NOM DE LA PISTE",
	save: "enregistrer",
	"export (WAV + tracks)": "exporter (WAV + pistes)",
	INSTRUMENT: "INSTRUMENT",
	"empty — load a sound:": "vide — charge un son :",
	"empty — load a sound, or make a synth:": "vide — charge un son, ou fais un synthé :",
	"analog synth": "synthé analogique",
	"FM synth": "synthé FM",
	"chord": "accord",
	"ECHO": "ÉCHO",
	"two sine waves, one bending the other: pianos, bells, basses": "deux sinusoïdes, l'une tord l'autre : pianos, cloches, basses",
	"ratio": "rapport",
	"detune": "désaccord",
	"index (bright)": "index (brillance)",
	"feedback": "réinjection",
	"mod attack": "mod attaque",
	"mod decay": "mod déclin",
	"mod sustain": "mod maintien",
	"mod release": "mod relâche",
	"drum machine": "boîte à rythmes",
	"twelve drums, one a note: C kick, D snare, E hat…": "douze sons de batterie, un par note : C grosse caisse, D caisse claire, E charleston…",
	"kit": "kit",
	"grit": "grain",
	"clean": "propre",
	"drum": "son",
	"tune": "accord",
	"level": "niveau",
	"tone": "timbre",
	"kick": "grosse caisse",
	"rim": "rimshot",
	"snare": "caisse claire",
	"clap": "clap",
	"closed hat": "charley fermé",
	"low tom": "tom grave",
	"open hat": "charley ouvert",
	"mid tom": "tom médium",
	"cowbell": "cloche",
	"high tom": "tom aigu",
	"crash": "crash",
	"ride": "ride",
	"keys: one drum a note · ↑↓ a drum · ←→ a setting · ⇧←→ change it": "touches : un son par note · ↑↓ un son · ←→ un réglage · ⇧←→ le changer",
	"two oscillators, a filter, two envelopes, an LFO": "deux oscillateurs, un filtre, deux enveloppes, un LFO",
	"preset": "preset",
	"the keys play it · ↑↓ a setting · ←→ change it (⇧ more) · med -h": "les touches le jouent · ↑↓ un réglage · ←→ le changer (⇧ plus vite) · med -h",
	"osc 1 wave": "osc 1 onde",
	"osc 1 width": "osc 1 largeur",
	"osc 1 level": "osc 1 niveau",
	"osc 2 wave": "osc 2 onde",
	"osc 2 width": "osc 2 largeur",
	"osc 2 level": "osc 2 niveau",
	"osc 2 semitones": "osc 2 demi-tons",
	"osc 2 detune": "osc 2 désaccord",
	"sub (octave down)": "sub (−1 octave)",
	"filter": "filtre",
	"filter slope": "pente du filtre",
	"cutoff": "coupure",
	"resonance": "résonance",
	"filter env amount": "enveloppe → filtre",
	"key tracking": "suivi du clavier",
	"filter attack": "filtre attaque",
	"filter decay": "filtre déclin",
	"filter sustain": "filtre maintien",
	"filter release": "filtre relâche",
	"attack": "attaque",
	"decay": "déclin",
	"sustain": "maintien",
	"release": "relâche",
	"lfo wave": "lfo onde",
	"lfo rate": "lfo vitesse",
	"lfo → pitch": "lfo → hauteur",
	"lfo → cutoff": "lfo → coupure",
	"lfo → width": "lfo → largeur",
	"glide": "glissé",
	"load…": "charger…",
	"a .wav, .aif, .iff, .mp3, .m4a, .ogg… of the vault": "un .wav, .aif, .iff, .mp3, .m4a, .ogg… du vault",
	frames: "trames",
	"at C-3": "en C-3",
	loop: "boucle",
	"LED filter": "filtre LED",
	"chop 4": "découper en 4",
	"chop 8": "découper en 8",
	"chop at attacks": "découper aux attaques",
	"stretch ×2": "étirer ×2",
	"stretch ×½": "étirer ×½",
	"fade in": "fondu d'entrée",
	"fade out": "fondu de sortie",
	"pitch +12": "hauteur +12",
	"pitch −12": "hauteur −12",
	reverse: "à l'envers",
	normalize: "normaliser",
	trim: "rogner",
	"loop off": "sans boucle",
	"ping-pong": "aller-retour",
	"bounce block": "bloc → sample",
	"LED filter on": "filtre LED",
	"LED filter off": "sans filtre LED",
	"replace this sound with a file of the vault": "remplacer ce son par un fichier du vault",
	"4 equal slices → new instruments": "4 tranches égales → nouveaux instruments",
	"8 equal slices → new instruments": "8 tranches égales → nouveaux instruments",
	"a slice at each attack": "une tranche à chaque attaque",
	"twice as long, same pitch (Amiga grains)": "deux fois plus long, même hauteur (grains Amiga)",
	"half as long, same pitch": "deux fois plus court, même hauteur",
	"an octave up (half the frames)": "une octave plus haut",
	"destructive 8 bits: the grit": "8 bits destructif : le grain",
	"4 bits, half the rate: more grit": "4 bits, moitié de la fréquence : plus de grain",
	"remove the silence at both ends": "enlever le silence aux deux bouts",
	"the loop goes back and forth": "la boucle va et vient",
	"this block, rendered into a new instrument": "ce bloc, rendu en un nouvel instrument",
	"the A500's low-pass (0FF9 / 0FF8)": "le passe-bas de l'A500 (0FF9 / 0FF8)",
	"the keys play it · alt ←→ another · alt B the block · med sample -h": "les touches le jouent · alt ←→ un autre · alt B le bloc · med sample -h",
	"a new song": "un nouveau morceau",
	"SONG": "MORCEAU",
	"EXPORT": "EXPORT",
	"title": "titre",
	"the song's title": "le titre du morceau",
	"tempo": "tempo",
	"ticks a line": "ticks par ligne",
	"lines a beat": "lignes par temps",
	"swing": "swing",
	"straight": "droit",
	"every other line longer: 50 a lazy shuffle, 100 triplets": "une ligne sur deux plus longue : 50 un shuffle paresseux, 100 des triolets",
	"echo": "écho",
	"normal": "normal",
	"cross": "croisé",
	"delay": "délai",
	"depth": "profondeur",
	"long": "long",
	"short": "court",
	"medium": "moyen",
	"positions": "positions",
	"blocks": "blocs",
	"name": "nom",
	"vol": "vol",
	"pan": "pano",
	"strum": "arpège",
	"double-click: rename": "double-clic : renommer",
	"wheel or ⇧←→: change": "molette ou ⇧←→ : changer",
	"click: switch": "clic : basculer",
	"track name": "nom de la piste",
	"file": "fichier",
	"format": "format",
	"encoder pack": "pack d'encodeurs",
	"rate": "fréquence",
	"quality": "qualité",
	"bits": "bits",
	"32-bit float": "32 bits flottant",
	"master": "master",
	"master + stems": "master + pistes",
	"stems only": "pistes seules",
	"on (-0.3 dB)": "oui (-0,3 dB)",
	"tail": "traîne",
	"export to": "exporter vers",
	"normalized": "normalisé",
	"needs the encoder pack: run `encoders install` in the shell (once, ~3 MB)": "il faut le pack d'encodeurs : lance `encoders install` dans le shell (une fois, ~3 Mo)",
	"needs a newer ICEBREAKER (0.5.5+): WAV, AIFF and FLAC work here": "il faut un ICEBREAKER plus récent (0.5.5+) : WAV, AIFF et FLAC marchent ici",
	"no encoder pack for this computer yet": "pas encore de pack d'encodeurs pour cet ordinateur",
	"export…": "exporter…",
	free: "libre",
	"more tracks to the left": "d'autres pistes à gauche",
	"more tracks to the right": "d'autres pistes à droite",
	"chip synth": "synthé chip",
	"old consoles' sound chips, for chiptune: NES, Game Boy, C64, AY, SN76489, PC Engine-style": "les puces son des vieilles consoles, pour la chiptune : façon NES, Game Boy, C64, AY, SN76489, PC Engine",
	"chip": "puce",
	"wave": "onde",
	"pulse width": "largeur d'impulsion",
	"noise": "bruit",
	"wavetable": "table d'onde",
	"vibrato": "vibrato",
	"vibrato rate": "vitesse du vibrato",
	"vibrato delay": "délai du vibrato",
	"pitch sweep": "glissé de hauteur",
	"chord arpeggio": "arpège des accords",
	"pwm depth": "profondeur PWM",
	"pwm rate": "vitesse PWM",
	"ring mod": "modulation en anneau",
	"hard sync": "synchro dure",
	"exporting… (the LOG shows each file)": "export en cours… (le LOG montre chaque fichier)",
	exported: "exporté",
	"✗ the export failed: the LOG says why": "✗ l'export a échoué : le LOG dit pourquoi",
	position: "position",
	"the song's settings": "les réglages du morceau",
	"off": "non",
	"on": "oui"
};
export { activate, deactivate };
