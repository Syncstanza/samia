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
// ayat (9:72, 29:45, 40:10). The verse tracker already ignores it when the ayah
// being recited contains those words. As a second guard, a takbir heard while
// standing is only accepted after a short silence: if the recitation carries
// on, it was part of the ayah and the screen keeps following.
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
  takbirSilence: 1.2,  // seconds of no recitation after a standing takbir = ruku'
  resumeHops: 2,       // hops of recitation that mean "standing again"
  minRecited: 3,
  cancelLetters: 6,    // speech after a standing takbir that cancels ruku'
  minDwell: 1.0,       // seconds before a position can change on unrecognised speech
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
  step(res, dt) {
    const before = this.position;
    this.since += dt;
    const reciting = !!res.progressed;
    this.reciteRun = reciting ? this.reciteRun + 1 : 0;
    if (reciting && this.position === 'QIYAM') this.recited++;

    // A takbir while standing waits for silence: in ruku' the imam is silent.
    // Recitation, or any real speech, means it was part of the ayah.
    if (this.pending && !res.call) {
      if (reciting || (res.speech && (res.heard || '').length >= this.o.cancelLetters)) this.pending = null;
      else if (!res.speech && (this.pending.t += dt) >= this.o.takbirSilence) {
        this.pending = null;
        this._go('RUKU');
      }
    }

    const burst = res.speech && !this.wasSpeech; // speech starting after silence
    this.wasSpeech = !!res.speech;

    if (res.call) this._onCall(res.call);
    else if (this.reciteRun >= this.o.resumeHops && this.position !== 'QIYAM') this._onRecitation();
    else if (burst && this.since >= this.o.minDwell) this._onBurst(res.heard || '');

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
        if (this.recited >= this.o.minRecited) this.pending = { t: 0 };
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
    return { position: this.position, rakah: this.rakah, changed, ar: p.ar, en: p.en, note };
  }
}
