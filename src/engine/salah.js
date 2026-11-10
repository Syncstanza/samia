// Follows the positions of the prayer from what the imam says aloud.
//
//   QIYAM (reciting) --takbir--> RUKU --"sami' Allahu liman hamidah"--> QAWMAH
//   --takbir--> SUJOOD_1 --takbir--> JALSAH --takbir--> SUJOOD_2 --takbir-->
//       odd rak'ah  (1st, 3rd): RISING (or JALSAT_ISTIRAHAH)  --recitation--> QIYAM, next rak'ah
//       even rak'ah (2nd, 4th): TASHAHHUD --salam--> SALAM
//                                         --takbir--> RISING (3rd rak'ah of a 4)
//   SALAM --recitation--> QIYAM, rak'ah 1 of the next set
//
// The one hard case is the takbir for ruku': "الله أكبر" also occurs inside
// ayat (9:72, 29:45, 40:10, and phrases that sound close: see
// docs/takbir-ayat.md). Three guards:
//   1. The verse tracker ignores it when the words just ahead in the ayah are
//      "الله أكبر" (exact, from the Quran text).
//   2. How it was said (utter, measured from the audio): a movement takbir
//      comes after a pause and is usually stretched ("اللّٰهُ أكبـــر"),
//      then silence. Inside an ayah it is said in one breath with the words
//      around it.
//   3. Silence after it: in ruku' the imam is silent. If recitation or any
//      real speech follows, it was the ayah. In or just before an inventory
//      ayah the silence must be longer, and a takbir said in one breath with
//      the recitation is ignored there altogether.
//
// Between ruku' and the end of the sujood the imam says nothing aloud except
// the transition words. So in those positions any new burst of speech after
// silence is taken as the next call, even when the speech model garbled it
// (a long, melodic takbir often comes out as "الهزكبر"). In qawmah the
// congregation may say "ربنا ولك الحمد" aloud, so there the burst has to look
// more like a takbir than like that.
//
// Recovery: missed calls happen (a quiet takbir, a cough). Hearing Quran again
// always means standing; "sami' Allahu" always means qawmah; salam always
// ends the set. So the state can't drift for long.

import { align } from './align.js';
import { normalize } from './normalize.js';

const TAKBIR = normalize('الله اكبر');
const TAHMID = normalize('ربنا ولك الحمد');

export const POSITIONS = {
  QIYAM: { ar: 'قِيَام', en: 'Qiyam', note: '' },
  RUKU: { ar: 'رُكُوع', en: "Ruku'", note: 'Bowing' },
  QAWMAH: { ar: 'قَوْمَة', en: 'Qawmah', note: "Standing up from ruku'" },
  SUJOOD_1: { ar: 'سُجُود', en: 'Sujood', note: 'First prostration' },
  JALSAH: { ar: 'جَلْسَة', en: 'Jalsah', note: 'Sitting between the two prostrations' },
  SUJOOD_2: { ar: 'سُجُود', en: 'Sujood', note: 'Second prostration' },
  JALSAT_ISTIRAHAH: { ar: 'جَلْسَةُ الِاسْتِرَاحَة', en: 'Jalsat al-Istirahah', note: 'Brief sitting before standing' },
  RISING: { ar: 'قِيَام', en: 'Standing', note: '' },
  TASHAHHUD: { ar: 'تَشَهُّد', en: 'Tashahhud', note: 'Sitting' },
  SALAM: { ar: 'السَّلَامُ عَلَيْكُمْ', en: 'Salam', note: '' },
};

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];

const DEFAULTS = {
  takbirSilence: 1.2,  // seconds of silence after a standing takbir = ruku'
  takbirSilenceClear: 0.8,  // ...if it clearly was a movement takbir (pause + stretched)
  takbirSilenceRisky: 2.2,  // ...in or just before an ayah that sounds like a takbir
  pauseBefore: 0.25,   // seconds of silence before a movement takbir
  stretched: 0.9,      // seconds: a takbir this long or longer is drawn out
  maxTakbir: 4.5,      // ...but a stretch of speech longer than this is recitation
  takbirAyat: null,    // Set of global ayah indices from data/takbir-ayat.json
  resumeHops: 2,       // hops of recitation that mean "standing again"
  minRecited: 3,
  cancelLetters: 6,    // speech after a standing takbir that cancels ruku'
  minDwell: 1.0,
  recitationLetters: 26,
  staleSilence: 4,       // seconds of silence while standing that reset "has recited" // this much speech in ruku'/sujood = reciting again       // seconds before a position can change on unrecognised speech
  qawmahTakbir: 0.4,   // how takbir-like a burst in qawmah must be       // hops of recitation in a qiyam before a takbir can mean ruku'
  istirahah: false,    // the imam sits briefly before rising (jalsat al-istirahah)
  istirahahSeconds: 2.5,
};

export class Salah {
  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.position = 'QIYAM';
    this.rakah = 1;
    this.pending = null;  // standing takbir waiting for silence
    this.reciteRun = 0;   // consecutive hops with recitation
    this.since = 0;       // seconds in this position
    this.recited = 0;     // hops of recitation heard in this qiyam
    this.wasSpeech = false;
  }

  /**
   * Feed one tracker result. dt = seconds since the previous call.
   * Returns { position, rakah, changed, label } for the display.
   */
  step(res, dt, utter = null) {
    this.utter = utter;
    this.ayah = res.ayah ? res.ayah.index : this.ayah;
    const before = this.position;
    this.since += dt;
    const reciting = !!res.progressed;
    this.reciteRun = reciting ? this.reciteRun + 1 : 0;
    if (reciting && this.position === 'QIYAM') this.recited++;
    // A long silence while "standing" means we're not really mid-recitation
    // (a missed salam or movement, then tashahhud or the silent opening dua):
    // the next takbir needs fresh recitation before it can mean ruku'.
    this.quiet = res.speech ? 0 : (this.quiet || 0) + dt;
    if (this.position === 'QIYAM' && this.quiet >= this.o.staleSilence) this.recited = 0;

    // A takbir while standing waits for silence: in ruku' the imam is silent.
    // Recitation, or any real speech, means it was part of the ayah.
    if (this.pending && !res.call) {
      if (reciting || (res.speech && (res.heard || '').length >= this.o.cancelLetters)) this.pending = null;
      else if (!res.speech && (this.pending.t += dt) >= this.pending.need) {
        this.pending = null;
        this._go('RUKU');
      }
    }

    const burst = res.speech && !this.wasSpeech; // speech starting after silence
    this.wasSpeech = !!res.speech;
    const heard = res.heard || '';
    // Calls are short (takbir ~8 letters, "sami' Allahu" ~14): long speech
    // while bowing or prostrating means the imam is reciting again.
    const longSpeech = heard.length >= this.o.recitationLetters;

    if (res.call) this._onCall(res.call);
    else if (this.position !== 'QIYAM' && (this.reciteRun >= this.o.resumeHops || (longSpeech && this.position !== 'QAWMAH'))) this._onRecitation();
    else if (burst && !longSpeech && this.since >= this.o.minDwell) this._onBurst(heard);

    if (this.position === 'JALSAT_ISTIRAHAH' && this.since >= this.o.istirahahSeconds) this._go('RISING');

    return this.view(this.position !== before);
  }

  _onCall(call) {
    const p = this.position;
    if (call === 'salam') return this._go('SALAM');
    if (call === 'tasmi') return this._go('QAWMAH');       // also fixes a missed ruku' takbir
    if (call !== 'takbir') return;                        // ameen, tahmid: no change
    switch (p) {
      case 'QIYAM':
        // Ruku' only after the imam has recited in this qiyam. The opening
        // takbir (followed by the silent opening dua) must not count.
        if (this.recited >= this.o.minRecited) this._standingTakbir();
        break;
      case 'RUKU': break;                                 // extra takbir: ignore
      case 'QAWMAH': this._go('SUJOOD_1'); break;
      case 'SUJOOD_1': this._go('JALSAH'); break;
      case 'JALSAH': this._go('SUJOOD_2'); break;
      case 'SUJOOD_2':
        if (this.rakah % 2 === 0) this._go('TASHAHHUD');
        else this._go(this.o.istirahah ? 'JALSAT_ISTIRAHAH' : 'RISING');
        break;
      case 'TASHAHHUD': this._go('RISING'); break;        // middle tashahhud of a 4
      case 'SALAM':                                       // opening takbir of the next set
        this.rakah = 1;
        this._go('QIYAM');
        break;
      default: break;
    }
  }

  /** A takbir while standing: ruku', or "الله أكبر" inside the ayah? */
  _standingTakbir() {
    const u = this.utter;
    // A movement takbir is its own utterance: a pause before it, then a
    // drawn-out "الله أكبر" of about 1-4 s. Inside an ayah it is part of a
    // longer stretch of recitation with no pause just before it.
    const paused = u ? u.gapBefore >= this.o.pauseBefore : null;
    const drawnOut = u ? u.dur >= this.o.stretched && u.dur <= this.o.maxTakbir : null;
    const set = this.o.takbirAyat;
    const risky = !!set && this.ayah !== undefined && (set.has(this.ayah) || set.has(this.ayah + 1));
    if (risky) {
      // In (or just before) an ayah that contains or sounds like a takbir:
      // a takbir run on from the recitation is the ayah itself.
      if (u && !paused) return;
      this.pending = { t: 0, need: this.o.takbirSilenceRisky };
    } else if (paused && drawnOut) {
      this.pending = { t: 0, need: this.o.takbirSilenceClear };
    } else {
      this.pending = { t: 0, need: this.o.takbirSilence };
    }
  }

  /** Unrecognised speech in a position where only a call can be said. */
  _onBurst(heard) {
    switch (this.position) {
      case 'RUKU': this._go('QAWMAH'); break; // "sami' Allahu liman hamidah"
      case 'QAWMAH': {
        const t = align(TAKBIR, heard, 0, heard.length).norm;
        const h = align(TAHMID, heard, 0, heard.length).norm;
        if (t >= this.o.qawmahTakbir && t > h) this._onCall('takbir');
        break;
      }
      case 'SUJOOD_1': case 'JALSAH': case 'SUJOOD_2':
        this._onCall('takbir');
        break;
      default: break; // standing, rising, tashahhud: recitation or real calls decide
    }
  }

  _onRecitation() {
    // Recitation after a rise or a salam starts the next rak'ah.
    if (this.position === 'RISING' || this.position === 'JALSAT_ISTIRAHAH') this.rakah += 1;
    // After tashahhud, recitation means the salam was missed: a new set begins.
    else if (this.position === 'SALAM' || this.position === 'TASHAHHUD') this.rakah = 1;
    this.pending = null;
    this._go('QIYAM');
  }

  _go(position) {
    if (position === this.position) return;
    this.position = position;
    this.since = 0;
    this.recited = 0;
  }

  /** Volunteer sets the rak'ah by hand (e.g. after starting mid-prayer). */
  setRakah(n) { this.rakah = Math.max(1, n); }

  view(changed = false) {
    const p = POSITIONS[this.position];
    let note = p.note;
    if (this.position === 'RISING') note = `For the ${ORDINAL[this.rakah + 1] || 'next'} rak'ah`;
    if (this.position === 'JALSAT_ISTIRAHAH') note = `${p.note}, then the ${ORDINAL[this.rakah + 1] || 'next'} rak'ah`;
    if (this.position === 'SALAM') note = this.rakah >= 2 ? `End of ${this.rakah} rak'ahs` : 'End of the prayer';
    const phase = this.position === 'QIYAM' ? 'RECITATION' : 'MOVEMENT';
    return { position: this.position, phase, rakah: this.rakah, changed, ar: p.ar, en: p.en, note };
  }
}
